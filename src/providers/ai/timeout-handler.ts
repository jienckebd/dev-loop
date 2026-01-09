/**
 * Provider-Agnostic Timeout Handler
 *
 * Provides timeout management for all AI providers with:
 * - Progressive timeout (starts short, extends if agent is active)
 * - Heartbeat mechanism for long-running agents
 * - Timeout warnings before actual timeout
 */

import { EventEmitter } from 'events';
import { logger } from '../../core/logger';

export interface TimeoutConfig {
  initialTimeoutMs: number;      // Initial timeout (e.g., 2 minutes)
  maxTimeoutMs: number;           // Maximum timeout (e.g., 30 minutes)
  extensionIntervalMs: number;   // How often to check for extension (e.g., 30 seconds)
  extensionAmountMs: number;     // How much to extend by (e.g., 2 minutes)
  warningThresholdMs: number;    // Warn when this much time remains (e.g., 30 seconds)
  heartbeatIntervalMs?: number;  // How often to check for heartbeat (optional)
}

export interface TimeoutHandlerOptions {
  config: TimeoutConfig;
  onTimeout: () => void;
  onWarning?: (remainingMs: number) => void;
  onHeartbeat?: () => boolean; // Return true if agent is still active
  onExtension?: (newTimeoutMs: number) => void;
}

/**
 * Provider-agnostic timeout handler with progressive timeout and heartbeat
 */
export class TimeoutHandler extends EventEmitter {
  private config: TimeoutConfig;
  private timeoutId: NodeJS.Timeout | null = null;
  private warningId: NodeJS.Timeout | null = null;
  private heartbeatId: NodeJS.Timeout | null = null;
  private extensionId: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private currentTimeoutMs: number = 0;
  private onTimeout: () => void;
  private onWarning?: (remainingMs: number) => void;
  private onHeartbeat?: () => boolean;
  private onExtension?: (newTimeoutMs: number) => void;
  private isActive: boolean = false;

  constructor(options: TimeoutHandlerOptions) {
    super();
    this.config = options.config;
    this.onTimeout = options.onTimeout;
    this.onWarning = options.onWarning;
    this.onHeartbeat = options.onHeartbeat;
    this.onExtension = options.onExtension;
    this.currentTimeoutMs = this.config.initialTimeoutMs;
  }

  /**
   * Start the timeout handler
   */
  start(): void {
    this.startTime = Date.now();
    this.isActive = true;

    // Set initial timeout
    this.setTimeout();

    // Start progressive extension if configured
    if (this.config.extensionIntervalMs > 0) {
      this.startProgressiveExtension();
    }

    // Start heartbeat monitoring if configured
    if (this.config.heartbeatIntervalMs && this.onHeartbeat) {
      this.startHeartbeat();
    }

    logger.debug(`[TimeoutHandler] Started with initial timeout: ${this.currentTimeoutMs}ms`);
  }

  /**
   * Stop the timeout handler
   */
  stop(): void {
    this.isActive = false;
    this.clearAll();
    logger.debug('[TimeoutHandler] Stopped');
  }

  /**
   * Reset the timeout (extend it)
   */
  reset(newTimeoutMs?: number): void {
    if (!this.isActive) {
      return;
    }

    const elapsed = Date.now() - this.startTime;
    const remaining = this.currentTimeoutMs - elapsed;

    // If we're close to timeout, extend it
    if (remaining < this.config.warningThresholdMs) {
      const extension = newTimeoutMs || this.config.extensionAmountMs;
      const newTimeout = Math.min(
        this.currentTimeoutMs + extension,
        this.config.maxTimeoutMs
      );

      if (newTimeout > this.currentTimeoutMs) {
        this.currentTimeoutMs = newTimeout;
        this.setTimeout();

        if (this.onExtension) {
          this.onExtension(this.currentTimeoutMs);
        }

        logger.debug(`[TimeoutHandler] Extended timeout to ${this.currentTimeoutMs}ms`);
        this.emit('extended', this.currentTimeoutMs);
      }
    }
  }

  /**
   * Get remaining time in milliseconds
   */
  getRemainingTime(): number {
    if (!this.isActive) {
      return 0;
    }
    const elapsed = Date.now() - this.startTime;
    return Math.max(0, this.currentTimeoutMs - elapsed);
  }

  /**
   * Check if timeout has been reached
   */
  isTimedOut(): boolean {
    return this.getRemainingTime() === 0 && this.isActive;
  }

  /**
   * Set the timeout
   */
  private setTimeout(): void {
    this.clearTimeout();

    const remaining = this.getRemainingTime();
    if (remaining <= 0) {
      this.handleTimeout();
      return;
    }

    // Set main timeout
    this.timeoutId = setTimeout(() => {
      this.handleTimeout();
    }, remaining);

    // Set warning timeout
    const warningTime = remaining - this.config.warningThresholdMs;
    if (warningTime > 0) {
      this.warningId = setTimeout(() => {
        this.handleWarning();
      }, warningTime);
    }
  }

  /**
   * Start progressive extension mechanism
   */
  private startProgressiveExtension(): void {
    this.extensionId = setInterval(() => {
      if (!this.isActive) {
        return;
      }

      // Check if agent is still active (via heartbeat if available)
      if (this.onHeartbeat) {
        const isActive = this.onHeartbeat();
        if (isActive) {
          // Agent is active, extend timeout
          this.reset();
        }
      } else {
        // No heartbeat, just extend if we're close to timeout
        const remaining = this.getRemainingTime();
        if (remaining < this.config.extensionAmountMs) {
          this.reset();
        }
      }
    }, this.config.extensionIntervalMs);
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    if (!this.onHeartbeat || !this.config.heartbeatIntervalMs) {
      return;
    }

    this.heartbeatId = setInterval(() => {
      if (!this.isActive) {
        return;
      }

      const isActive = this.onHeartbeat!();
      if (isActive) {
        // Agent is active, emit heartbeat event
        this.emit('heartbeat', Date.now());

        // Reset timeout if close to limit
        this.reset();
      } else {
        // Agent appears inactive, but don't timeout yet (might be processing)
        logger.debug('[TimeoutHandler] Heartbeat check: agent appears inactive');
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Handle timeout
   */
  private handleTimeout(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    this.clearAll();

    logger.warn(`[TimeoutHandler] Timeout reached after ${this.currentTimeoutMs}ms`);
    this.emit('timeout', this.currentTimeoutMs);
    this.onTimeout();
  }

  /**
   * Handle warning
   */
  private handleWarning(): void {
    if (!this.isActive) {
      return;
    }

    const remaining = this.getRemainingTime();
    logger.warn(`[TimeoutHandler] Timeout warning: ${Math.round(remaining / 1000)}s remaining`);

    if (this.onWarning) {
      this.onWarning(remaining);
    }

    this.emit('warning', remaining);
  }

  /**
   * Clear all timeouts
   */
  private clearAll(): void {
    this.clearTimeout();
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
    if (this.extensionId) {
      clearInterval(this.extensionId);
      this.extensionId = null;
    }
  }

  /**
   * Clear timeout
   */
  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.warningId) {
      clearTimeout(this.warningId);
      this.warningId = null;
    }
  }
}

/**
 * Create a timeout handler with default configuration
 */
export function createTimeoutHandler(
  onTimeout: () => void,
  options?: Partial<TimeoutConfig>
): TimeoutHandler {
  const defaultConfig: TimeoutConfig = {
    initialTimeoutMs: 2 * 60 * 1000,      // 2 minutes
    maxTimeoutMs: 30 * 60 * 1000,         // 30 minutes
    extensionIntervalMs: 30 * 1000,        // Check every 30 seconds
    extensionAmountMs: 2 * 60 * 1000,      // Extend by 2 minutes
    warningThresholdMs: 30 * 1000,         // Warn 30 seconds before timeout
    heartbeatIntervalMs: 10 * 1000,        // Check heartbeat every 10 seconds
  };

  const config = { ...defaultConfig, ...options };

  return new TimeoutHandler({
    config,
    onTimeout,
    onWarning: (remainingMs) => {
      logger.warn(`[TimeoutHandler] Timeout warning: ${Math.round(remainingMs / 1000)}s remaining`);
    },
  });
}


