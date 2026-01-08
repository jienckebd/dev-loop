/**
 * Agent IPC System
 *
 * Unix domain socket-based inter-process communication for reliable
 * parent/child agent communication in dev-loop.
 *
 * Architecture:
 * - AgentIPCServer: Runs in parent workflow engine
 * - AgentIPCClient: Runs in background agent process
 * - Protocol: JSON messages over Unix domain socket
 */

import * as net from 'net';
import * as fs from 'fs-extra';
import * as path from 'path';
import { EventEmitter } from 'events';
import { CodeChanges } from '../types';
import { logger } from './logger';

/**
 * IPC Message types for communication between parent and child agents
 */
export type IPCMessageType =
  | 'status'        // Agent status updates
  | 'progress'      // Percentage completion
  | 'files_changed' // List of modified files
  | 'code_changes'  // Structured CodeChanges result
  | 'error'         // Error information
  | 'complete'      // Execution finished
  | 'ack';          // Acknowledgment

/**
 * IPC Message structure
 */
export interface IPCMessage {
  type: IPCMessageType;
  sessionId: string;
  requestId: string;
  timestamp: number;
  payload: {
    status?: string;
    progress?: number;
    filesChanged?: string[];
    codeChanges?: CodeChanges;
    error?: string;
    success?: boolean;
    summary?: string;
  };
}

/**
 * Create a unique socket path for a session
 */
export function getSocketPath(sessionId: string): string {
  const tmpDir = process.env.TMPDIR || '/tmp';
  return path.join(tmpDir, `devloop-${sessionId}.sock`);
}

/**
 * AgentIPCServer - Runs in parent workflow engine
 *
 * Creates a Unix domain socket server that background agents connect to
 * for sending status updates and results.
 */
export class AgentIPCServer extends EventEmitter {
  private server: net.Server | null = null;
  private socketPath: string;
  private connections: Map<string, net.Socket> = new Map();
  private pendingResults: Map<string, IPCMessage> = new Map();
  private debug: boolean;

  constructor(sessionId: string, debug = false) {
    super();
    this.socketPath = getSocketPath(sessionId);
    this.debug = debug;
  }

  /**
   * Start the IPC server
   */
  async start(): Promise<void> {
    // Clean up any existing socket file
    await this.cleanup();

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        logger.error(`[AgentIPCServer] Server error: ${err.message}`);
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        if (this.debug) {
          logger.debug(`[AgentIPCServer] Listening on ${this.socketPath}`);
        }
        resolve();
      });
    });
  }

  /**
   * Handle incoming connection from a background agent
   */
  private handleConnection(socket: net.Socket): void {
    let buffer = '';
    let connectionId = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Parse complete messages (newline-delimited JSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message: IPCMessage = JSON.parse(line);
            connectionId = message.requestId;
            this.connections.set(connectionId, socket);
            this.handleMessage(message, socket);
          } catch (err) {
            logger.warn(`[AgentIPCServer] Failed to parse message: ${line.substring(0, 100)}`);
          }
        }
      }
    });

    socket.on('close', () => {
      if (connectionId) {
        this.connections.delete(connectionId);
        if (this.debug) {
          logger.debug(`[AgentIPCServer] Connection closed: ${connectionId}`);
        }
      }
    });

    socket.on('error', (err) => {
      logger.warn(`[AgentIPCServer] Socket error: ${err.message}`);
    });
  }

  /**
   * Handle received message from background agent
   */
  private handleMessage(message: IPCMessage, socket: net.Socket): void {
    if (this.debug) {
      logger.debug(`[AgentIPCServer] Received ${message.type} from ${message.requestId}`);
    }

    // Emit event for each message type
    this.emit('message', message);
    this.emit(message.type, message);

    // Store completion results for retrieval
    if (message.type === 'complete' || message.type === 'code_changes') {
      this.pendingResults.set(message.requestId, message);
    }

    // Send acknowledgment
    const ack: IPCMessage = {
      type: 'ack',
      sessionId: message.sessionId,
      requestId: message.requestId,
      timestamp: Date.now(),
      payload: { success: true },
    };
    socket.write(JSON.stringify(ack) + '\n');
  }

  /**
   * Wait for a result from a specific request
   */
  async waitForResult(requestId: string, timeoutMs = 300000): Promise<IPCMessage | null> {
    // Check if result already received
    if (this.pendingResults.has(requestId)) {
      return this.pendingResults.get(requestId)!;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.removeListener('complete', handler);
        this.removeListener('code_changes', handler);
        this.removeListener('error', errorHandler);
        resolve(null);
      }, timeoutMs);

      const handler = (message: IPCMessage) => {
        if (message.requestId === requestId) {
          clearTimeout(timeout);
          this.removeListener('complete', handler);
          this.removeListener('code_changes', handler);
          this.removeListener('error', errorHandler);
          resolve(message);
        }
      };

      const errorHandler = (message: IPCMessage) => {
        if (message.requestId === requestId) {
          clearTimeout(timeout);
          this.removeListener('complete', handler);
          this.removeListener('code_changes', handler);
          this.removeListener('error', errorHandler);
          resolve(message);
        }
      };

      this.on('complete', handler);
      this.on('code_changes', handler);
      this.on('error', errorHandler);
    });
  }

  /**
   * Get socket path for passing to child processes
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Clean up socket file
   */
  async cleanup(): Promise<void> {
    try {
      if (await fs.pathExists(this.socketPath)) {
        await fs.remove(this.socketPath);
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  }

  /**
   * Stop the server and clean up
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Close all connections
        for (const socket of this.connections.values()) {
          socket.destroy();
        }
        this.connections.clear();

        this.server.close(() => {
          this.cleanup().then(resolve);
        });
      } else {
        resolve();
      }
    });
  }
}

/**
 * AgentIPCClient - Runs in background agent process
 *
 * Connects to the parent's IPC server to send status updates and results.
 */
export class AgentIPCClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private socketPath: string;
  private sessionId: string;
  private requestId: string;
  private connected = false;
  private debug: boolean;

  constructor(socketPath: string, sessionId: string, requestId: string, debug = false) {
    super();
    this.socketPath = socketPath;
    this.sessionId = sessionId;
    this.requestId = requestId;
    this.debug = debug;
  }

  /**
   * Connect to the IPC server
   */
  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.socket = net.createConnection(this.socketPath, () => {
        this.connected = true;
        if (this.debug) {
          console.log(`[AgentIPCClient] Connected to ${this.socketPath}`);
        }
        resolve(true);
      });

      this.socket.on('error', (err) => {
        if (this.debug) {
          console.warn(`[AgentIPCClient] Connection error: ${err.message}`);
        }
        this.connected = false;
        resolve(false);
      });

      this.socket.on('close', () => {
        this.connected = false;
      });

      this.socket.on('data', (data) => {
        // Handle acknowledgments or other messages from server
        try {
          const lines = data.toString().split('\n').filter(l => l.trim());
          for (const line of lines) {
            const message: IPCMessage = JSON.parse(line);
            this.emit('message', message);
            if (message.type === 'ack') {
              this.emit('ack', message);
            }
          }
        } catch {
          // Ignore parse errors
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.connected) {
          resolve(false);
        }
      }, 5000);
    });
  }

  /**
   * Send a message to the IPC server
   */
  private send(type: IPCMessageType, payload: IPCMessage['payload']): boolean {
    if (!this.socket || !this.connected) {
      return false;
    }

    const message: IPCMessage = {
      type,
      sessionId: this.sessionId,
      requestId: this.requestId,
      timestamp: Date.now(),
      payload,
    };

    try {
      this.socket.write(JSON.stringify(message) + '\n');
      return true;
    } catch (err) {
      if (this.debug) {
        console.warn(`[AgentIPCClient] Send error: ${err}`);
      }
      return false;
    }
  }

  /**
   * Send status update
   */
  sendStatus(status: string): boolean {
    return this.send('status', { status });
  }

  /**
   * Send progress update
   */
  sendProgress(progress: number): boolean {
    return this.send('progress', { progress });
  }

  /**
   * Send list of changed files
   */
  sendFilesChanged(files: string[]): boolean {
    return this.send('files_changed', { filesChanged: files });
  }

  /**
   * Send code changes result
   */
  sendCodeChanges(codeChanges: CodeChanges): boolean {
    return this.send('code_changes', { codeChanges, success: true });
  }

  /**
   * Send error
   */
  sendError(error: string): boolean {
    return this.send('error', { error, success: false });
  }

  /**
   * Send completion message
   */
  sendComplete(success: boolean, summary?: string, codeChanges?: CodeChanges): boolean {
    return this.send('complete', { success, summary, codeChanges });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }
}

/**
 * Create IPC client from environment variables
 * Background agents call this to get a client instance
 */
export function createIPCClientFromEnv(): AgentIPCClient | null {
  const socketPath = process.env.DEVLOOP_IPC_SOCKET;
  const sessionId = process.env.DEVLOOP_SESSION_ID;
  const requestId = process.env.DEVLOOP_REQUEST_ID;
  const debug = process.env.DEVLOOP_DEBUG === 'true';

  if (!socketPath || !sessionId || !requestId) {
    return null;
  }

  return new AgentIPCClient(socketPath, sessionId, requestId, debug);
}

