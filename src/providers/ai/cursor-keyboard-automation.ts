/**
 * Cursor Keyboard Automation
 *
 * Provides keyboard automation for Cursor IDE on macOS using AppleScript.
 * Allows programmatic triggering of keyboard shortcuts like Cmd+L (open composer).
 *
 * Note: This module only works on macOS and requires Accessibility permissions.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from "../../core/utils/logger";

const execAsync = promisify(exec);

/**
 * Check if the current platform supports keyboard automation
 */
export function isKeyboardAutomationSupported(): boolean {
  return process.platform === 'darwin';
}

/**
 * Focus the Cursor application window
 */
export async function focusCursorWindow(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    logger.debug('[KeyboardAutomation] Not supported on this platform');
    return false;
  }

  try {
    const script = `
      tell application "Cursor"
        activate
      end tell
    `;

    await execAsync(`osascript -e '${script}'`);
    logger.debug('[KeyboardAutomation] Focused Cursor window');
    return true;
  } catch (error) {
    logger.warn(`[KeyboardAutomation] Failed to focus Cursor: ${error}`);
    return false;
  }
}

/**
 * Trigger the Cursor composer
 *
 * Uses Cmd+I (the actual composer shortcut) or command palette with "Open Composer"
 */
export async function triggerComposer(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    logger.debug('[KeyboardAutomation] Not supported on this platform');
    return false;
  }

  try {
    // First focus Cursor, then trigger the shortcut
    await focusCursorWindow();

    // Longer delay to ensure window is fully focused and ready
    await sleep(800);

    // Method 1: Use command palette with ">" prefix to show only commands (not files)
    // The ">" prefix filters to commands only, avoiding file matches like composer.json
    const paletteScript = `
      tell application "System Events"
        tell process "Cursor"
          set frontmost to true
          delay 0.4
          -- Open command palette (Cmd+Shift+P) - key code 35 = P
          key code 35 using {command down, shift down}
          delay 0.8
          -- Type ">" to show commands only, then "composer"
          keystroke ">composer"
          delay 0.6
          -- Press Enter to execute the first match (should be "Open Composer" command)
          key code 36
        end tell
      end tell
    `;

    await execAsync(`osascript -e '${paletteScript}'`);
    logger.info('[KeyboardAutomation] Opened composer via command palette (Cmd+Shift+P → ">composer" → Enter)');
    await sleep(1200); // Wait for composer to fully open
    return true;
  } catch (error) {
    logger.warn(`[KeyboardAutomation] Failed to trigger composer: ${error}`);
    return false;
  }
}

/**
 * Trigger the Cursor inline edit (Cmd+K)
 */
export async function triggerInlineEdit(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    await focusCursorWindow();
    await sleep(200);

    const script = `
      tell application "System Events"
        tell process "Cursor"
          keystroke "k" using command down
        end tell
      end tell
    `;

    await execAsync(`osascript -e '${script}'`);
    logger.info('[KeyboardAutomation] Triggered Cmd+K (Inline Edit)');
    return true;
  } catch (error) {
    logger.warn(`[KeyboardAutomation] Failed to trigger inline edit: ${error}`);
    return false;
  }
}

/**
 * Trigger the Cursor chat panel (Cmd+I / Ctrl+I or legacy Cmd+Shift+I)
 */
export async function triggerChatPanel(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    await focusCursorWindow();
    await sleep(200);

    const script = `
      tell application "System Events"
        tell process "Cursor"
          keystroke "i" using command down
        end tell
      end tell
    `;

    await execAsync(`osascript -e '${script}'`);
    logger.info('[KeyboardAutomation] Triggered Cmd+I (Chat Panel)');
    return true;
  } catch (error) {
    logger.warn(`[KeyboardAutomation] Failed to trigger chat panel: ${error}`);
    return false;
  }
}

/**
 * Select all text in the current editor (Cmd+A)
 */
export async function selectAll(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    const script = `
      tell application "System Events"
        tell process "Cursor"
          keystroke "a" using command down
        end tell
      end tell
    `;

    await execAsync(`osascript -e '${script}'`);
    logger.debug('[KeyboardAutomation] Triggered Cmd+A (Select All)');
    return true;
  } catch (error) {
    logger.warn(`[KeyboardAutomation] Failed to select all: ${error}`);
    return false;
  }
}

/**
 * Copy selected text (Cmd+C)
 */
export async function copy(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    const script = `
      tell application "System Events"
        tell process "Cursor"
          keystroke "c" using command down
        end tell
      end tell
    `;

    await execAsync(`osascript -e '${script}'`);
    logger.debug('[KeyboardAutomation] Triggered Cmd+C (Copy)');
    return true;
  } catch (error) {
    logger.warn(`[KeyboardAutomation] Failed to copy: ${error}`);
    return false;
  }
}

/**
 * Paste from clipboard (Cmd+V)
 */
export async function paste(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    const script = `
      tell application "System Events"
        tell process "Cursor"
          keystroke "v" using command down
        end tell
      end tell
    `;

    await execAsync(`osascript -e '${script}'`);
    logger.debug('[KeyboardAutomation] Triggered Cmd+V (Paste)');
    return true;
  } catch (error) {
    logger.warn(`[KeyboardAutomation] Failed to paste: ${error}`);
    return false;
  }
}

/**
 * Press Enter key
 */
export async function pressEnter(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    const script = `
      tell application "System Events"
        tell process "Cursor"
          key code 36
        end tell
      end tell
    `;

    await execAsync(`osascript -e '${script}'`);
    logger.debug('[KeyboardAutomation] Pressed Enter');
    return true;
  } catch (error) {
    logger.warn(`[KeyboardAutomation] Failed to press Enter: ${error}`);
    return false;
  }
}

/**
 * Execute a full composer workflow:
 * 1. Focus Cursor
 * 2. Open composer (Cmd+L)
 * 3. Wait for composer to open
 * 4. Paste content (Cmd+V)
 */
export async function executeComposerWorkflow(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    logger.warn('[KeyboardAutomation] Composer workflow not supported on this platform');
    return false;
  }

  try {
    // Focus Cursor
    await focusCursorWindow();
    await sleep(300);

    // Open composer
    await triggerComposer();
    await sleep(500);

    // Paste content
    await paste();
    await sleep(100);

    logger.info('[KeyboardAutomation] Executed composer workflow');
    return true;
  } catch (error) {
    logger.error(`[KeyboardAutomation] Composer workflow failed: ${error}`);
    return false;
  }
}

/**
 * Set clipboard content (macOS only)
 *
 * @param text - Text to set in clipboard
 */
export async function setClipboard(text: string): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    // Escape special characters and set clipboard using pbcopy
    // Use printf to handle newlines and special characters properly
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');

    // Use printf to preserve newlines and special characters
    await execAsync(`printf '%s' "${escapedText}" | pbcopy`);
    logger.debug('[KeyboardAutomation] Set clipboard content');
    return true;
  } catch (error) {
    logger.error(`[KeyboardAutomation] Failed to set clipboard: ${error}`);
    return false;
  }
}

/**
 * Copy text to clipboard and paste into composer
 *
 * @param text - Text to paste into composer
 */
export async function pasteTextToComposer(text: string): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    // Set clipboard content
    const clipboardSet = await setClipboard(text);
    if (!clipboardSet) {
      return false;
    }

    // Execute the workflow
    return executeComposerWorkflow();
  } catch (error) {
    logger.error(`[KeyboardAutomation] Failed to paste text to composer: ${error}`);
    return false;
  }
}

/**
 * Full composer workflow with automatic paste and send
 *
 * This function:
 * 1. Sets clipboard content
 * 2. Focuses Cursor window
 * 3. Opens composer (Cmd+L)
 * 4. Pastes content (Cmd+V)
 * 5. Optionally sends (Enter)
 *
 * @param promptText - Text to paste into composer
 * @param autoSend - Whether to automatically press Enter to send (default: false)
 */
export async function fullComposerWorkflow(promptText: string, autoSend: boolean = false): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    logger.warn('[KeyboardAutomation] Full composer workflow not supported on this platform');
    return false;
  }

  try {
    // 1. Set clipboard content
    logger.info('[KeyboardAutomation] Setting clipboard content...');
    const clipboardSet = await setClipboard(promptText);
    if (!clipboardSet) {
      logger.error('[KeyboardAutomation] Failed to set clipboard');
      return false;
    }

    // 2. Focus Cursor window
    logger.info('[KeyboardAutomation] Focusing Cursor window...');
    await focusCursorWindow();
    await sleep(800); // Longer delay to ensure Cursor is fully ready

    // 3. Open composer (Cmd+L)
    logger.info('[KeyboardAutomation] Opening composer (Cmd+L)...');
    await triggerComposer();
    await sleep(1000); // Wait longer for composer to fully open

    // 4. Paste content (Cmd+V)
    logger.info('[KeyboardAutomation] Pasting content (Cmd+V)...');
    await paste();
    await sleep(200);

    // 5. Optionally send (Enter)
    if (autoSend) {
      logger.info('[KeyboardAutomation] Sending message (Enter)...');
      await pressEnter();
      await sleep(100);
    }

    logger.info('[KeyboardAutomation] Full composer workflow completed successfully');
    return true;
  } catch (error) {
    logger.error(`[KeyboardAutomation] Full composer workflow failed: ${error}`);
    return false;
  }
}

/**
 * Check if Cursor application is running
 */
export async function isCursorRunning(): Promise<boolean> {
  if (!isKeyboardAutomationSupported()) {
    return false;
  }

  try {
    const script = `
      tell application "System Events"
        return (name of processes) contains "Cursor"
      end tell
    `;

    const { stdout } = await execAsync(`osascript -e '${script}'`);
    return stdout.trim() === 'true';
  } catch (error) {
    return false;
  }
}

/**
 * Get the title of the frontmost Cursor window
 */
export async function getCursorWindowTitle(): Promise<string | null> {
  if (!isKeyboardAutomationSupported()) {
    return null;
  }

  try {
    const script = `
      tell application "Cursor"
        return name of front window
      end tell
    `;

    const { stdout } = await execAsync(`osascript -e '${script}'`);
    return stdout.trim();
  } catch (error) {
    return null;
  }
}

/**
 * Helper function to sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Keyboard automation configuration
 */
export interface KeyboardAutomationConfig {
  /** Enable keyboard automation (macOS only) */
  enabled: boolean;
  /** Delay between actions in milliseconds */
  actionDelay?: number;
  /** Focus Cursor before sending keystrokes */
  focusFirst?: boolean;
}

/**
 * KeyboardAutomation class for more control over automation
 */
export class KeyboardAutomation {
  private config: KeyboardAutomationConfig;

  constructor(config?: Partial<KeyboardAutomationConfig>) {
    this.config = {
      enabled: isKeyboardAutomationSupported(),
      actionDelay: 200,
      focusFirst: true,
      ...config,
    };
  }

  /**
   * Check if automation is available
   */
  isAvailable(): boolean {
    return this.config.enabled && isKeyboardAutomationSupported();
  }

  /**
   * Open the Cursor composer
   */
  async openComposer(): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    if (this.config.focusFirst) {
      await focusCursorWindow();
      await sleep(this.config.actionDelay || 200);
    }

    return triggerComposer();
  }

  /**
   * Open the Cursor chat panel
   */
  async openChatPanel(): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    if (this.config.focusFirst) {
      await focusCursorWindow();
      await sleep(this.config.actionDelay || 200);
    }

    return triggerChatPanel();
  }

  /**
   * Execute a sequence of keyboard actions
   */
  async executeSequence(actions: Array<'focus' | 'composer' | 'chat' | 'selectAll' | 'copy' | 'paste' | 'enter'>): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    const delay = this.config.actionDelay || 200;

    for (const action of actions) {
      switch (action) {
        case 'focus':
          await focusCursorWindow();
          break;
        case 'composer':
          await triggerComposer();
          break;
        case 'chat':
          await triggerChatPanel();
          break;
        case 'selectAll':
          await selectAll();
          break;
        case 'copy':
          await copy();
          break;
        case 'paste':
          await paste();
          break;
        case 'enter':
          await pressEnter();
          break;
      }
      await sleep(delay);
    }

    return true;
  }

  /**
   * Execute full composer workflow with automatic paste
   *
   * @param promptText - Text to paste into composer
   * @param autoSend - Whether to automatically send (default: false)
   */
  async fullComposerWorkflow(promptText: string, autoSend: boolean = false): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    return fullComposerWorkflow(promptText, autoSend);
  }
}

