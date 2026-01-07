/**
 * Check Agent Visibility Command
 *
 * Verifies agent config files are correctly formatted and provides
 * instructions for manual verification in Cursor IDE.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { listGeneratedAgents } from '../../providers/ai/cursor-agent-generator';

interface AgentValidationResult {
  name: string;
  filePath: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Verify agent config format matches working examples
 */
function verifyAgentFormat(filePath: string, content: string): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check 1: Should not have YAML frontmatter
  if (content.trim().startsWith('---')) {
    errors.push('Agent config contains YAML frontmatter (should be plain markdown)');
  }

  // Check 2: Should start with # heading
  if (!content.trim().startsWith('#')) {
    errors.push('Agent config should start with a markdown heading (# Agent Name)');
  }

  // Check 3: Should have Role section
  if (!content.includes('## Role')) {
    warnings.push('Agent config missing "## Role" section (recommended)');
  }

  // Check 4: File should be readable
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      errors.push('Path is not a file');
    }
    // Check permissions (readable)
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (error) {
    errors.push(`File is not readable: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Check 5: File name should match agent name (basic check)
  const fileName = path.basename(filePath, '.md');
  const firstHeading = content.match(/^#\s+(.+)$/m);
  if (firstHeading) {
    const agentNameFromContent = firstHeading[1].replace(/\s+Agent$/, '').trim();
    if (fileName !== agentNameFromContent) {
      warnings.push(`File name (${fileName}) doesn't match agent name in content (${agentNameFromContent})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if agent name is valid (no special characters that might break detection)
 */
function validateAgentName(name: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for invalid characters
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(name)) {
    errors.push(`Agent name contains invalid characters: ${name}`);
  }

  // Check length
  if (name.length > 100) {
    errors.push(`Agent name is too long (${name.length} > 100 characters)`);
  }

  // Check for reserved names
  const reservedNames = ['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'];
  if (reservedNames.includes(name.toLowerCase())) {
    errors.push(`Agent name is reserved: ${name}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Compare agent config with working examples
 */
async function compareWithWorkingExamples(filePath: string): Promise<{ matches: boolean; differences: string[] }> {
  const differences: string[] = [];
  const workingExamples = [
    path.join(process.cwd(), '.cursor', 'agents', 'architecture.md'),
    path.join(process.cwd(), '.cursor', 'agents', 'debugging.md'),
  ];

  let workingExampleContent = '';
  for (const examplePath of workingExamples) {
    if (fs.existsSync(examplePath)) {
      workingExampleContent = await fs.promises.readFile(examplePath, 'utf-8');
      break;
    }
  }

  if (!workingExampleContent) {
    differences.push('No working examples found for comparison');
    return { matches: false, differences };
  }

  const currentContent = await fs.promises.readFile(filePath, 'utf-8');

  // Check format similarities
  const workingStartsWithHeading = workingExampleContent.trim().startsWith('#');
  const currentStartsWithHeading = currentContent.trim().startsWith('#');

  if (workingStartsWithHeading !== currentStartsWithHeading) {
    differences.push('Heading format differs from working examples');
  }

  const workingHasYAML = workingExampleContent.trim().startsWith('---');
  const currentHasYAML = currentContent.trim().startsWith('---');

  if (workingHasYAML !== currentHasYAML) {
    differences.push('YAML frontmatter presence differs from working examples');
  }

  return {
    matches: differences.length === 0,
    differences,
  };
}

/**
 * Check if Cursor process is running (basic check)
 */
function checkCursorProcess(): { running: boolean; note: string } {
  try {
    // Try to detect Cursor process (platform-specific)
    const { execSync } = require('child_process');
    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS
      try {
        execSync('pgrep -f "Cursor"', { stdio: 'ignore' });
        return { running: true, note: 'Cursor process detected on macOS' };
      } catch {
        return { running: false, note: 'Cursor process not detected (may need to restart)' };
      }
    } else if (platform === 'win32') {
      // Windows
      try {
        execSync('tasklist /FI "IMAGENAME eq Cursor.exe"', { stdio: 'ignore' });
        return { running: true, note: 'Cursor process detected on Windows' };
      } catch {
        return { running: false, note: 'Cursor process not detected (may need to restart)' };
      }
    } else {
      // Linux
      try {
        execSync('pgrep -f cursor', { stdio: 'ignore' });
        return { running: true, note: 'Cursor process detected on Linux' };
      } catch {
        return { running: false, note: 'Cursor process not detected (may need to restart)' };
      }
    }
  } catch (error) {
    return { running: false, note: 'Could not detect Cursor process' };
  }
}

export async function checkAgentVisibilityCommand(): Promise<void> {
  console.log(chalk.cyan('\n=== Agent Visibility Check ===\n'));

  try {
    // Get all agents
    const agents = await listGeneratedAgents();

    if (agents.length === 0) {
      console.log(chalk.yellow('No agent config files found in .cursor/agents/'));
      console.log(chalk.cyan('\nTo create agents, run: npx dev-loop validate-cursor-agents\n'));
      process.exit(0);
    }

    console.log(chalk.yellow(`Found ${agents.length} agent config file(s)\n`));

    // Validate each agent
    const validationResults: AgentValidationResult[] = [];

    for (const agent of agents) {
      const filePath = agent.filePath;
      const content = await fs.promises.readFile(filePath, 'utf-8');

      // Validate format
      const formatCheck = verifyAgentFormat(filePath, content);

      // Validate name
      const nameCheck = validateAgentName(agent.name);

      // Compare with working examples
      const comparison = await compareWithWorkingExamples(filePath);

      const allErrors = [...formatCheck.errors, ...nameCheck.errors];
      const allWarnings = [...formatCheck.warnings, ...comparison.differences];

      validationResults.push({
        name: agent.name,
        filePath,
        valid: formatCheck.valid && nameCheck.valid,
        errors: allErrors,
        warnings: allWarnings,
      });
    }

    // Display results
    let allValid = true;
    for (const result of validationResults) {
      const status = result.valid ? chalk.green('✓') : chalk.red('✗');
      console.log(`${status} ${result.name}`);

      if (result.errors.length > 0) {
        allValid = false;
        for (const error of result.errors) {
          console.log(chalk.red(`    ✗ ${error}`));
        }
      }

      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.log(chalk.yellow(`    ⚠ ${warning}`));
        }
      }

      if (result.valid && result.warnings.length === 0) {
        console.log(chalk.gray(`    → ${result.filePath}`));
      }
      console.log();
    }

    // Check Cursor process
    console.log(chalk.yellow('Cursor Process Check:'));
    const cursorCheck = checkCursorProcess();
    if (cursorCheck.running) {
      console.log(chalk.green(`  ✓ ${cursorCheck.note}`));
    } else {
      console.log(chalk.yellow(`  ⚠ ${cursorCheck.note}`));
    }
    console.log();

    // Check directory structure
    console.log(chalk.yellow('Directory Structure:'));
    const agentsPath = path.join(process.cwd(), '.cursor', 'agents');
    if (fs.existsSync(agentsPath)) {
      const stats = fs.statSync(agentsPath);
      if (stats.isDirectory()) {
        console.log(chalk.green(`  ✓ .cursor/agents/ directory exists`));
        try {
          fs.accessSync(agentsPath, fs.constants.R_OK);
          console.log(chalk.green(`  ✓ Directory is readable`));
        } catch {
          console.log(chalk.red(`  ✗ Directory is not readable`));
          allValid = false;
        }
      } else {
        console.log(chalk.red(`  ✗ .cursor/agents/ is not a directory`));
        allValid = false;
      }
    } else {
      console.log(chalk.red(`  ✗ .cursor/agents/ directory does not exist`));
      allValid = false;
    }
    console.log();

    // Summary
    console.log(chalk.cyan('📋 Summary:'));
    const validCount = validationResults.filter(r => r.valid).length;
    const invalidCount = validationResults.length - validCount;
    console.log(`  Valid agents: ${validCount}/${validationResults.length}`);
    console.log(`  Invalid agents: ${invalidCount}/${validationResults.length}`);

    if (allValid && validCount === validationResults.length) {
      console.log(chalk.green('\n✅ All agent configs are valid'));
    } else {
      console.log(chalk.yellow('\n⚠️  Some agent configs have issues'));
    }

    // Manual verification steps
    console.log(chalk.cyan('\n📝 Manual Verification Steps:'));
    console.log('  1. Open Cursor IDE');
    console.log('  2. Press Ctrl+E (Cmd+E on Mac) to toggle agent panel');
    console.log('  3. Or restart Cursor IDE to refresh agent detection');
    console.log('  4. Check the right side of the window if panel is hidden');
    console.log('  5. Verify agents appear in the agent panel');
    console.log('  6. Click on an agent to start a chat session\n');

    process.exit(allValid ? 0 : 1);
  } catch (error) {
    console.error(chalk.red(`\n❌ Check failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}



