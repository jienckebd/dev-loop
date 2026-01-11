import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { generateConfigJsonSchema, generateJsonSchema } from '../../config/schema/generator';
import {
  patternsFileSchema,
  observationsFileSchema,
  metricsFileSchema,
  stateFileSchema,
  testResultsFileSchema,
} from '../../config/schema/runtime';
import {
  prdSetMetricsFileSchema,
  prdMetricsFileSchema,
  phaseMetricsFileSchema,
  parallelMetricsFileSchema,
  featureMetricsFileSchema,
  schemaMetricsFileSchema,
  contributionModeFileSchema,
  retryCountsFileSchema,
  evolutionStateFileSchema,
} from '../../config/schema/metrics';
import {
  prdSetStateSchema,
  chatRequestSchema,
  sessionSchema,
  checkpointSchema,
  conversationFileSchema,
  prdContextV2FileSchema,
} from '../../config/schema/metadata';

/**
 * Generate JSON Schema files from Zod schemas
 */
export async function generateSchemasCommand(options: { output?: string }): Promise<void> {
  const outputDir = options.output || path.resolve(process.cwd(), 'node_modules/dev-loop/schemas');
  await fs.ensureDir(outputDir);

  const schemas: Array<{ name: string; schema: any }> = [
    { name: 'config', schema: generateConfigJsonSchema() },
    { name: 'patterns-file', schema: generateJsonSchema(patternsFileSchema) },
    { name: 'observations-file', schema: generateJsonSchema(observationsFileSchema) },
    { name: 'metrics-file', schema: generateJsonSchema(metricsFileSchema) },
    { name: 'state-file', schema: generateJsonSchema(stateFileSchema) },
    { name: 'test-results-file', schema: generateJsonSchema(testResultsFileSchema) },
    { name: 'prd-set-metrics-file', schema: generateJsonSchema(prdSetMetricsFileSchema) },
    { name: 'prd-metrics-file', schema: generateJsonSchema(prdMetricsFileSchema) },
    { name: 'phase-metrics-file', schema: generateJsonSchema(phaseMetricsFileSchema) },
    { name: 'parallel-metrics-file', schema: generateJsonSchema(parallelMetricsFileSchema) },
    { name: 'feature-metrics-file', schema: generateJsonSchema(featureMetricsFileSchema) },
    { name: 'schema-metrics-file', schema: generateJsonSchema(schemaMetricsFileSchema) },
    { name: 'contribution-mode-file', schema: generateJsonSchema(contributionModeFileSchema) },
    { name: 'retry-counts-file', schema: generateJsonSchema(retryCountsFileSchema) },
    { name: 'evolution-state-file', schema: generateJsonSchema(evolutionStateFileSchema) },
    { name: 'prd-set-state', schema: generateJsonSchema(prdSetStateSchema) },
    { name: 'chat-request', schema: generateJsonSchema(chatRequestSchema) },
    { name: 'session', schema: generateJsonSchema(sessionSchema) },
    { name: 'checkpoint', schema: generateJsonSchema(checkpointSchema) },
    { name: 'conversation-file', schema: generateJsonSchema(conversationFileSchema) },
    { name: 'prd-context-v2-file', schema: generateJsonSchema(prdContextV2FileSchema) },
  ];

  console.log(chalk.blue(`Generating JSON Schema files to ${outputDir}...`));

  for (const { name, schema } of schemas) {
    const filePath = path.join(outputDir, `${name}.schema.json`);
    await fs.writeJSON(filePath, schema, { spaces: 2 });
    console.log(chalk.green(`  ✓ Generated ${name}.schema.json`));
  }

  console.log(chalk.green(`\n✓ Successfully generated ${schemas.length} JSON Schema files`));
}
