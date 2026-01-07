/**
 * Open Chat Instructions Command
 *
 * Opens pending chat instruction files in Cursor IDE as editor tabs or agent chats.
 * Enhanced with direct CLI-based chat opening via cursor agent commands.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { CursorChatOpener, quickCreateChat, quickStartAgent } from '../../providers/ai/cursor-chat-opener';

interface ChatInstruction {
  action: string;
  agentName: string;
  question: string;
  model: string;
  mode: string;
  requestId: string;
  createdAt: string;
  instructions?: string;
  context?: any;
  cliCommand?: string;
}

/**
 * Get the chat instructions directory path
 */
function getInstructionsPath(): string {
  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    if (fs.existsSync(configPath)) {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      if (config?.cursor?.agents?.chatInstructionsPath) {
        return path.join(process.cwd(), config.cursor.agents.chatInstructionsPath);
      }
    }
  } catch (error) {
    // Config loading failed, use default
  }

  // Default path
  return path.join(process.cwd(), '.cursor', 'chat-instructions');
}

/**
 * List all chat instruction files
 */
function listChatInstructions(): ChatInstruction[] {
  const instructionsPath = getInstructionsPath();

  if (!fs.existsSync(instructionsPath)) {
    return [];
  }

  const files = fs.readdirSync(instructionsPath);
  const instructionFiles = files.filter(file => file.endsWith('.json') && file !== 'README.md');

  const instructions: ChatInstruction[] = [];

  for (const file of instructionFiles) {
    try {
      const filePath = path.join(instructionsPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const instruction = JSON.parse(content) as ChatInstruction;
      instruction.requestId = instruction.requestId || file.replace('.json', '');
      instructions.push({
        ...instruction,
        _filePath: filePath, // Store file path for opening
      } as any);
    } catch (error) {
      // Skip invalid JSON files
    }
  }

  return instructions.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return timeB - timeA; // Most recent first
  });
}

/**
 * Find Cursor executable (synchronous check)
 */
function findCursorExecutable(): string | null {
  const possiblePaths = [
    'cursor',
    'code', // VS Code CLI (Cursor is based on VS Code)
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor', // macOS
    '/usr/local/bin/cursor',
    process.env.CURSOR_PATH,
  ];

  for (const cmd of possiblePaths) {
    if (!cmd) continue;

    // Check if command exists using which (synchronous)
    try {
      const { execSync } = require('child_process');
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return cmd;
    } catch (error) {
      // Try next path
    }
  }

  // Try to find Cursor in common locations
  if (process.platform === 'darwin') {
    const macPath = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
    if (fs.existsSync(macPath)) {
      return macPath;
    }
  }

  return null;
}

/**
 * Open file in Cursor (non-blocking)
 */
async function openFileInCursor(filePath: string): Promise<boolean> {
  const cursorCmd = findCursorExecutable();

  if (!cursorCmd) {
    console.error(chalk.red('❌ Cursor CLI not found.'));
    console.error(chalk.yellow('   Please install Cursor CLI or add it to your PATH.'));
    console.error(chalk.gray('   On macOS: Cursor > Install Command Line Tools'));
    return false;
  }

  try {
    // Use Cursor/VS Code CLI to open the file (non-blocking with timeout)
    // Use spawn instead of execAsync to avoid blocking
    const { spawn } = require('child_process');
    const child = spawn(cursorCmd, [filePath], {
      detached: true,
      stdio: 'ignore',
    });

    // Don't wait for the process - let it run in background
    child.unref();

    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 100));

    return true;
  } catch (error) {
    console.error(chalk.red(`❌ Failed to open file in Cursor: ${error}`));
    return false;
  }
}

/**
 * Create a markdown chat instruction file that Cursor might recognize
 */
function createMarkdownChatFile(instruction: ChatInstruction, outputPath: string): void {
  const markdown = `# Chat: ${instruction.agentName}

## Agent
${instruction.agentName}

## Question
${instruction.question}

## Settings
- **Model**: ${instruction.model}
- **Mode**: ${instruction.mode}
- **Request ID**: ${instruction.requestId}
- **Created**: ${new Date(instruction.createdAt).toLocaleString()}

${instruction.context ? `## Context
- **PRD ID**: ${instruction.context.prdId || 'N/A'}
- **Phase ID**: ${instruction.context.phaseId || 'N/A'}
- **PRD Set ID**: ${instruction.context.prdSetId || 'N/A'}
- **Task ID**: ${instruction.context.taskId || 'N/A'}
` : ''}

## Instructions
${instruction.instructions || 'Create a new chat session in Cursor IDE with the agent and question above.'}

---
*This file was auto-generated by dev-loop. Open this file and create a chat manually using the information above.*
`;

  fs.writeFileSync(outputPath, markdown, 'utf-8');
}

/**
 * Open chat instructions command
 */
export async function openChatInstructionsCommand(options: {
  all?: boolean;
  latest?: boolean;
  requestId?: string;
  createMarkdown?: boolean;
  agent?: boolean;
  create?: boolean;
  prompt?: string;
}): Promise<void> {
  console.log(chalk.blue('\n📂 Chat Instructions & Agent Control\n'));

  const opener = new CursorChatOpener();

  // Check if Cursor CLI is available
  if (!opener.isCursorAvailable()) {
    console.error(chalk.red('❌ Cursor CLI not found.'));
    console.error(chalk.yellow('\nPlease install Cursor CLI:'));
    console.error(chalk.white('  1. Open Cursor IDE'));
    console.error(chalk.white('  2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)'));
    console.error(chalk.white('  3. Type "Shell Command: Install \'cursor\' command in PATH"'));
    console.error(chalk.white('  4. Run this command again\n'));
    return;
  }

  // Handle --create flag: create a new empty chat
  if (options.create) {
    console.log(chalk.cyan('Creating new chat via Cursor agent CLI...'));
    const result = await quickCreateChat();
    if (result.success) {
      console.log(chalk.green(`✅ Created new chat with ID: ${result.chatId}`));
      console.log(chalk.gray(`\nTo resume this chat: cursor agent resume ${result.chatId}`));
    } else {
      console.error(chalk.red(`❌ Failed to create chat: ${result.error}`));
    }
    return;
  }

  // Handle --prompt flag: start agent with prompt directly
  if (options.prompt) {
    console.log(chalk.cyan(`Starting Cursor agent with prompt...`));
    const result = await quickStartAgent(options.prompt, process.cwd());
    if (result.success) {
      console.log(chalk.green(`✅ Agent started: ${result.message}`));
    } else {
      console.error(chalk.red(`❌ Failed to start agent: ${result.message}`));
    }
    return;
  }

  const instructions = listChatInstructions();

  if (instructions.length === 0) {
    console.log(chalk.yellow('No pending chat instruction files found.'));
    console.log(chalk.gray(`\nInstructions directory: ${getInstructionsPath()}`));
    console.log(chalk.gray('\nOther options:'));
    console.log(chalk.white('  --create        Create a new empty chat'));
    console.log(chalk.white('  --prompt "..."  Start agent with a prompt directly'));
    return;
  }

  let filesToOpen: any[] = [];

  if (options.requestId) {
    const instruction = instructions.find(i => i.requestId === options.requestId);
    if (instruction) {
      filesToOpen = [instruction];
    } else {
      console.error(chalk.red(`❌ Request ID not found: ${options.requestId}`));
      return;
    }
  } else if (options.latest) {
    filesToOpen = [instructions[0]];
  } else if (options.all) {
    filesToOpen = instructions;
  } else {
    filesToOpen = instructions.slice(0, 3);
  }

  console.log(chalk.green(`Processing ${filesToOpen.length} instruction file(s)...\n`));

  const instructionsPath = getInstructionsPath();
  const results: { file: string; success: boolean; method: string }[] = [];

  for (const instruction of filesToOpen) {
    const filePath = (instruction as any)._filePath;

    // Try to start agent directly if --agent flag is set
    if (options.agent && instruction.question) {
      console.log(chalk.cyan(`  → Starting agent for: ${instruction.requestId}`));
      const result = await quickStartAgent(instruction.question, process.cwd());
      results.push({
        file: instruction.requestId,
        success: result.success,
        method: 'agent',
      });
      if (result.success) {
        console.log(chalk.green(`    ✓ Agent started`));
      } else {
        console.log(chalk.yellow(`    ⚠ Agent failed, falling back to file: ${result.message}`));
        await openFileInCursor(filePath);
      }
    } else if (options.createMarkdown) {
      const markdownPath = path.join(instructionsPath, `${instruction.requestId}.md`);
      createMarkdownChatFile(instruction, markdownPath);
      console.log(chalk.cyan(`  ✓ Created and opening: ${path.basename(markdownPath)}`));
      await openFileInCursor(markdownPath);
      results.push({ file: markdownPath, success: true, method: 'file' });
    } else {
      console.log(chalk.cyan(`  ✓ Opening: ${path.basename(filePath)}`));
      await openFileInCursor(filePath);
      results.push({ file: filePath, success: true, method: 'file' });
    }

    if (filesToOpen.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(chalk.green(`\n✅ Processed ${successCount}/${results.length} instruction(s)`));

  if (!options.agent) {
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.white('  1. Review the instruction file(s) in the editor tabs'));
    console.log(chalk.white('  2. Run with --agent flag to start agents directly'));
    console.log(chalk.white('  3. Or manually start: cursor agent "<question>"'));
  }

  // Show CLI commands for manual use
  console.log(chalk.gray('\nUseful commands:'));
  console.log(chalk.white('  cursor agent create-chat       # Create new empty chat'));
  console.log(chalk.white('  cursor agent resume            # Resume latest chat'));
  console.log(chalk.white('  cursor agent "Your prompt"     # Start agent with prompt\n'));
}

