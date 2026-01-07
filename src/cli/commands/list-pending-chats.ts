/**
 * List Pending Chats Command
 *
 * Lists all pending chat instruction files and provides instructions
 * for manually creating chats in Cursor IDE.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../../config/loader';

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
  const instructionFiles = files.filter(file => file.endsWith('.json'));

  const instructions: ChatInstruction[] = [];

  for (const file of instructionFiles) {
    try {
      const filePath = path.join(instructionsPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const instruction = JSON.parse(content) as ChatInstruction;
      instruction.requestId = instruction.requestId || file.replace('.json', '');
      instructions.push(instruction);
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
 * List pending chats command
 */
export async function listPendingChatsCommand(): Promise<void> {
  console.log(chalk.blue('\n📋 Pending Chat Instructions\n'));

  const instructions = listChatInstructions();

  if (instructions.length === 0) {
    console.log(chalk.yellow('No pending chat instructions found.'));
    console.log(chalk.gray(`\nInstructions directory: ${getInstructionsPath()}`));
    return;
  }

  console.log(chalk.green(`Found ${instructions.length} pending chat instruction(s):\n`));

  instructions.forEach((instruction, index) => {
    console.log(chalk.cyan(`\n${index + 1}. ${instruction.agentName}`));
    console.log(chalk.gray(`   Request ID: ${instruction.requestId}`));
    console.log(chalk.gray(`   Created: ${new Date(instruction.createdAt).toLocaleString()}`));
    console.log(chalk.gray(`   Model: ${instruction.model} | Mode: ${instruction.mode}`));
    console.log(chalk.white(`   Question: ${instruction.question.substring(0, 100)}${instruction.question.length > 100 ? '...' : ''}`));

    if (instruction.context) {
      console.log(chalk.gray(`   Context: PRD=${instruction.context.prdId || 'N/A'}, Phase=${instruction.context.phaseId || 'N/A'}, Task=${instruction.context.taskId || 'N/A'}`));
    }
  });

  console.log(chalk.blue('\n\n📝 How to Create Chats in Cursor IDE:\n'));
  console.log(chalk.white('1. Open Cursor IDE'));
  console.log(chalk.white('2. Press ') + chalk.yellow('Ctrl+E') + chalk.white(' (or ') + chalk.yellow('Cmd+E') + chalk.white(' on Mac) to open the agent panel'));
  console.log(chalk.white('3. Select the agent from the list (e.g., ') + chalk.cyan(instructions[0]?.agentName || 'AgentName') + chalk.white(')'));
  console.log(chalk.white('4. Start a new chat and use the question from the instruction file'));
  console.log(chalk.gray('\n   Or manually open the instruction file to see all details:'));
  console.log(chalk.gray(`   ${getInstructionsPath()}/`));
  console.log(chalk.gray('\n   Note: Cursor IDE does not automatically open instruction files as editor tabs.'));
  console.log(chalk.gray('   You need to manually create the chat session using the information above.\n'));
}


