import chalk from 'chalk';
import { loadConfig } from '../../config/loader';
import { FrameworkLoader } from '../../frameworks';
import { CodeQualityScanner, ScanOptions } from "../../core/analysis/code/quality-scanner";
import { ScanReporter } from "../../core/analysis/code/scan-reporter";
import { TaskMasterBridge } from "../../core/execution/task-bridge";

export async function scanCommand(options: {
  type?: 'all' | 'static-analysis' | 'duplicate-detection' | 'security' | 'complexity' | 'tech-debt';
  output?: 'console' | 'json' | 'markdown';
  createTasks?: boolean;
  minSeverity?: 'info' | 'warning' | 'error';
  config?: string;
}): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const projectRoot = process.cwd();

    // Load framework
    const frameworkLoader = new FrameworkLoader(projectRoot, config.debug);
    const framework = await frameworkLoader.loadFramework(config.framework?.type);

    console.log(chalk.bold('\nCode Quality Scan\n'));
    console.log(chalk.gray('─'.repeat(50)));

    // Get code quality tools from framework
    const tools = framework.getCodeQualityTools?.() || [];
    const techDebtIndicators = framework.getTechDebtIndicators?.() || [];

    if (tools.length === 0 && techDebtIndicators.length === 0) {
      console.log(chalk.yellow('No code quality tools configured for this framework.'));
      return;
    }

    console.log(chalk.cyan(`Framework: ${framework.name}`));
    console.log(chalk.cyan(`Tools: ${tools.length}`));
    console.log(chalk.cyan(`Tech Debt Indicators: ${techDebtIndicators.length}\n`));

    // Determine scan types
    const scanTypes = options.type === 'all' || !options.type
      ? undefined
      : [options.type];

    // Run scans
    const scanner = new CodeQualityScanner(config.debug);
    const scanOptions: ScanOptions = {
      projectRoot,
      tools,
      techDebtIndicators,
      types: scanTypes,
      minSeverity: options.minSeverity || 'info',
    };

    console.log(chalk.cyan('Running scans...\n'));
    const results = await scanner.runScans(scanOptions);

    // Display results
    const totalIssues = results.reduce((sum, r) => sum + r.summary.total, 0);
    const successfulTools = results.filter(r => r.success).length;

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('Results\n'));

    for (const result of results) {
      const status = result.success ? chalk.green('✓') : chalk.red('✗');
      const issueCount = result.summary.total;
      const issueColor = issueCount === 0 ? chalk.green : issueCount < 10 ? chalk.yellow : chalk.red;

      console.log(`${status} ${chalk.cyan(result.tool)} (${result.purpose})`);
      console.log(`  Issues: ${issueColor(issueCount)} | Duration: ${result.duration}ms`);
      if (result.error) {
        console.log(`  ${chalk.red('Error:')} ${result.error}`);
      }
      console.log('');
    }

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('Summary\n'));
    console.log(`Total Issues: ${chalk.yellow(totalIssues)}`);
    console.log(`Tools Run: ${successfulTools}/${results.length}`);

    // Generate reports
    const reporter = new ScanReporter(config.scan?.output?.path, config.debug);

    if (options.output === 'json' || options.output === 'markdown' || !options.output) {
      await reporter.saveReports(results);
      console.log(chalk.green(`\nReports saved to ${config.scan?.output?.path || '.devloop/scan-results'}`));
    }

    // Display console output if requested
    if (options.output === 'console' || !options.output) {
      const markdown = reporter.generateMarkdownReport(results);
      console.log('\n' + markdown);
    }

    // Create tasks if requested
    if (options.createTasks) {
      console.log(chalk.cyan('\nCreating fix tasks...\n'));
      const taskBridge = new TaskMasterBridge(config);
      const allIssues = results.flatMap(r => r.issues);
      const taskIds = await reporter.createFixTasks(allIssues, taskBridge, {
        minSeverity: options.minSeverity || 'warning',
        groupBy: config.scan?.taskCreation?.groupBy || 'rule',
      });

      if (taskIds.length > 0) {
        console.log(chalk.green(`Created ${taskIds.length} fix task(s)`));
      } else {
        console.log(chalk.yellow('No tasks created (all issues below minimum severity)'));
      }
    }

    // Exit with error code if there are errors
    if (totalIssues > 0 && config.scan?.thresholds?.failOnSecurityVulnerability) {
      const securityIssues = results
        .filter(r => r.purpose === 'security')
        .reduce((sum, r) => sum + r.summary.total, 0);
      if (securityIssues > 0) {
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(chalk.red('Scan failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
