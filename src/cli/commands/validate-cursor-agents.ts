/**
 * Validate Cursor Agents Command
 *
 * Creates 3 test agent configs, chat requests, and auto-processes them
 * to validate the Cursor agent integration.
 */

import chalk from 'chalk';
import { loadConfig } from '../../config/loader';
import { generateAgentConfig, listGeneratedAgents, deleteAgentConfig } from '../../providers/ai/cursor-agent-generator';
import { createChatRequest, listPendingChatRequests, listAllChatRequests } from '../../providers/ai/cursor-chat-requests';
import { ChatRequestAutoProcessor } from '../../providers/ai/cursor-chat-auto-processor';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get chat instruction files
 */
async function listChatInstructions(): Promise<any[]> {
  const instructionsPath = getInstructionsPath();

  try {
    if (!fs.existsSync(instructionsPath)) {
      return [];
    }

    const files = await fs.promises.readdir(instructionsPath);
    const instructionFiles = files.filter(file => file.endsWith('.json'));

    const instructions = [];
    for (const file of instructionFiles) {
      const filePath = path.join(instructionsPath, file);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const instruction = JSON.parse(content);
      instructions.push({
        requestId: instruction.requestId,
        agentName: instruction.agentName,
        question: instruction.question,
        model: instruction.model,
        mode: instruction.mode,
        filePath,
      });
    }

    return instructions;
  } catch (error) {
    return [];
  }
}

/**
 * Get the chat instructions directory path from config or use default
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
  return path.join(process.cwd(), 'files-private', 'cursor', 'chat-instructions');
}

/**
 * Get the chat requests file path from config or use default
 */
function getChatRequestsPath(): string {
  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    if (fs.existsSync(configPath)) {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      if (config?.cursor?.agents?.chatRequestsPath) {
        return path.join(process.cwd(), config.cursor.agents.chatRequestsPath);
      }
    }
  } catch (error) {
    // Config loading failed, use default
  }

  // Default path
  return path.join(process.cwd(), 'files-private', 'cursor', 'chat-requests.json');
}

/**
 * Load chat requests from file
 */
async function loadChatRequests(): Promise<{ requests: any[] }> {
  const requestsPath = getChatRequestsPath();

  try {
    if (fs.existsSync(requestsPath)) {
      const content = await fs.promises.readFile(requestsPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    // Return empty if file doesn't exist or parsing failed
  }

  return { requests: [] };
}

/**
 * Save chat requests to file
 */
async function saveChatRequests(requests: { requests: any[] }): Promise<void> {
  const requestsPath = getChatRequestsPath();

  try {
    // Ensure directory exists
    const dir = path.dirname(requestsPath);
    await fs.promises.mkdir(dir, { recursive: true });

    // Write file with pretty formatting
    await fs.promises.writeFile(requestsPath, JSON.stringify(requests, null, 2), 'utf-8');
  } catch (error) {
    throw error;
  }
}

export async function validateCursorAgentsCommand(): Promise<void> {
  console.log(chalk.cyan('\n=== Cursor Agents Validation ===\n'));

  const questions = [
    'What is the purpose of this codebase?',
    'What are the main dependencies and frameworks used?',
    'What testing strategy is implemented?',
  ];

  try {
    const config = await loadConfig(undefined);

    // Cleanup: Remove previous validation artifacts
    console.log(chalk.yellow('Step 0: Cleaning up previous validation artifacts...'));
    const allAgents = await listGeneratedAgents();
    const validationAgents = allAgents.filter(a => a.name.startsWith('DevLoopValidation'));
    for (const agent of validationAgents) {
      await deleteAgentConfig(agent.name);
      console.log(chalk.gray(`  ✓ Removed agent: ${agent.name}`));
    }

    // Remove validation-related chat requests
    const allRequests = await listAllChatRequests();
    const validationRequests = allRequests.filter(req => req.agentName.startsWith('DevLoopValidation'));
    if (validationRequests.length > 0) {
      const requestsPath = getChatRequestsPath();
      const requests = await loadChatRequests();
      requests.requests = requests.requests.filter(req => !req.agentName.startsWith('DevLoopValidation'));
      await saveChatRequests(requests);
      console.log(chalk.gray(`  ✓ Removed ${validationRequests.length} validation chat request(s)`));
    }

    // Remove validation-related instruction files
    const instructionsPath = getInstructionsPath();
    if (fs.existsSync(instructionsPath)) {
      const files = await fs.promises.readdir(instructionsPath);
      const validationInstructionFiles = files.filter(file => {
        // Check if the instruction file is for a validation request
        return validationRequests.some(req => file.includes(req.id));
      });
      for (const file of validationInstructionFiles) {
        await fs.promises.unlink(path.join(instructionsPath, file));
        console.log(chalk.gray(`  ✓ Removed instruction file: ${file}`));
      }
    }
    console.log(chalk.green('  ✓ Cleanup complete\n'));

    // 1. Generate 3 agent config files
    console.log(chalk.yellow('Step 1: Generating agent config files...'));
    const agents = [];
    for (let i = 0; i < 3; i++) {
      const agentName = `DevLoopValidation${i + 1}`;
      const filePath = await generateAgentConfig({
        name: agentName,
        question: questions[i],
        model: 'Auto',
        mode: 'Ask',
        purpose: 'Validation test agent',
        type: 'validation',
      });
      agents.push({ name: agentName, filePath, question: questions[i] });
      console.log(chalk.green(`  ✓ Created agent config: ${filePath}`));
    }

    // 2. Create chat requests for each agent
    console.log(chalk.yellow('\nStep 2: Creating chat requests...'));
    const requests = [];
    for (const agent of agents) {
      const requestId = await createChatRequest({
        agentName: agent.name,
        question: agent.question,
        model: 'Auto',
        mode: 'Ask',
      });
      requests.push(requestId);
      console.log(chalk.green(`  ✓ Created chat request: ${requestId} for agent ${agent.name}`));
    }

    // 3. Auto-process all chat requests (100% automated)
    console.log(chalk.yellow('\nStep 3: Auto-processing chat requests...'));
    const processor = new ChatRequestAutoProcessor(config);
    const processResults = await processor.processAllPending();

    console.log(chalk.green(`  ✓ Processed ${processResults.length} chat requests`));
    for (const result of processResults) {
      if (result.status === 'success') {
        console.log(chalk.green(`    ✓ ${result.requestId}: ${result.status}`));
      } else {
        console.log(chalk.red(`    ✗ ${result.requestId}: ${result.status} - ${result.error}`));
      }
    }

    // 4. Verify files exist and validate format
    console.log(chalk.yellow('\nStep 4: Verifying files and format...'));
    const allAgentFilesForValidation = await listGeneratedAgents();
    const validationAgentFiles = allAgentFilesForValidation.filter(a => a.name.startsWith('DevLoopValidation'));

    // Validate agent config format
    let formatValid = true;
    for (const agent of validationAgentFiles) {
      const content = await fs.promises.readFile(agent.filePath, 'utf-8');

      // Check for YAML frontmatter (should not have it)
      if (content.trim().startsWith('---')) {
        console.log(chalk.red(`  ✗ ${agent.name}: Contains YAML frontmatter (should be plain markdown)`));
        formatValid = false;
      } else {
        console.log(chalk.green(`  ✓ ${agent.name}: Format valid (plain markdown)`));
      }

      // Check for required sections
      if (!content.includes('## Role')) {
        console.log(chalk.yellow(`  ⚠ ${agent.name}: Missing "## Role" section (recommended)`));
      }

      // Check file name matches agent name
      const fileName = path.basename(agent.filePath, '.md');
      if (fileName !== agent.name) {
        console.log(chalk.yellow(`  ⚠ ${agent.name}: File name doesn't match agent name`));
      }
    }

    const requestFile = await listPendingChatRequests();
    const instructionFiles = await listChatInstructions();
    const validationInstructions = instructionFiles.filter(i => i.agentName.startsWith('DevLoopValidation'));

    // Validate instruction file format
    let instructionFormatValid = true;
    for (const instruction of validationInstructions) {
      try {
        const content = await fs.promises.readFile(instruction.filePath, 'utf-8');
        const parsed = JSON.parse(content);

        // Check required fields
        const requiredFields = ['action', 'agentName', 'question', 'model', 'mode', 'requestId', 'createdAt', 'instructions'];
        const missingFields = requiredFields.filter(field => !(field in parsed));

        if (missingFields.length > 0) {
          console.log(chalk.red(`  ✗ ${instruction.requestId}: Missing required fields: ${missingFields.join(', ')}`));
          instructionFormatValid = false;
        } else {
          console.log(chalk.green(`  ✓ ${instruction.requestId}: Format valid`));
        }
      } catch (error) {
        console.log(chalk.red(`  ✗ ${instruction.requestId}: Invalid JSON - ${error instanceof Error ? error.message : String(error)}`));
        instructionFormatValid = false;
      }
    }

    console.log(chalk.cyan('\n📋 Validation Summary:'));
    console.log(`  Agent configs: ${validationAgentFiles.length}/3 ${validationAgentFiles.length === 3 ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  Agent format: ${formatValid ? chalk.green('✓ Valid') : chalk.red('✗ Invalid')}`);
    console.log(`  Chat requests: ${requestFile.length}/0 (should be 0 after processing) ${requestFile.length === 0 ? chalk.green('✓') : chalk.yellow('⚠')}`);
    console.log(`  Instruction files: ${validationInstructions.length}/3 ${validationInstructions.length === 3 ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  Instruction format: ${instructionFormatValid ? chalk.green('✓ Valid') : chalk.red('✗ Invalid')}`);

    const success = validationAgentFiles.length === 3 && validationInstructions.length === 3 && formatValid && instructionFormatValid;

    if (success) {
      console.log(chalk.green('\n✅ Validation Complete - 100% Automated'));
    } else {
      console.log(chalk.yellow('\n⚠️  Validation Partially Complete'));
    }

    console.log(chalk.cyan('\n📝 Next Steps:'));
    console.log('  1. Check .cursor/agents/ directory for agent config files');
    console.log('  2. Check files-private/cursor/chat-requests.json for chat requests');
    console.log('  3. Check files-private/cursor/chat-instructions/ for instruction files');
    console.log('  4. Run "npx dev-loop check-agent-visibility" to verify agent configs');
    console.log('  5. To see agents in Cursor agent panel:');
    console.log('     - Press Ctrl+E (Cmd+E on Mac) to toggle agent panel');
    console.log('     - Or restart Cursor IDE to refresh agent detection');
    console.log('     - Hover over the right side of the window if panel is hidden');
    console.log('  6. Verify 3 agent configs appear in Cursor agent panel');
    console.log('  7. Note: Instruction files are created but Cursor may not automatically create visible chats');
    console.log('     - You may need to manually select agents from the panel to start chats');
    console.log('  8. If dev-loop watch is running, chats will be auto-processed\n');

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error(chalk.red(`\n❌ Validation failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

