/**
 * Agent Templates for Cursor Agent Config Generation
 *
 * Provides templates for different agent types that can be generated
 * in .cursor/agents/ directory.
 */

import { AgentConfig } from '../../types';

/**
 * Get agent template based on type
 */
export function getAgentTemplate(agentConfig: AgentConfig): string {
  const template = getTemplateByType(agentConfig.type || 'code-generation');
  return renderTemplate(template, agentConfig);
}

/**
 * Get template by agent type
 */
function getTemplateByType(type: string): string {
  switch (type) {
    case 'validation':
      return validationAgentTemplate;
    case 'code-generation':
      return codeGenAgentTemplate;
    case 'analyzer':
      return analyzerAgentTemplate;
    case 'tester':
      return testerAgentTemplate;
    default:
      return codeGenAgentTemplate;
  }
}

/**
 * Render template with agent config values
 */
function renderTemplate(template: string, config: AgentConfig): string {
  const metadata = config.metadata || {};
  const contextInfo = metadata.prdId || metadata.taskId
    ? `\n\n## Context\n- PRD ID: ${metadata.prdId || 'N/A'}\n- Phase ID: ${metadata.phaseId || 'N/A'}\n- PRD Set ID: ${metadata.prdSetId || 'N/A'}\n- Task ID: ${metadata.taskId || 'N/A'}`
    : '';

  return template
    .replace(/\{\{name\}\}/g, config.name)
    .replace(/\{\{model\}\}/g, config.model || 'Auto')
    .replace(/\{\{purpose\}\}/g, config.purpose)
    .replace(/\{\{type\}\}/g, config.type || 'code-generation')
    .replace(/\{\{question\}\}/g, config.question)
    .replace(/\{\{mode\}\}/g, config.mode)
    .replace(/\{\{created\}\}/g, new Date().toISOString())
    .replace(/\{\{contextInfo\}\}/g, contextInfo);
}

/**
 * Validation Agent Template
 */
const validationAgentTemplate = `# {{name}} Agent

## Role
You are a validation test agent created by dev-loop.

## Question
{{question}}

## Instructions
- Answer in "{{mode}}" mode
- Use "{{model}}" model
- Provide a clear, concise answer

## When to Use
This agent is used for validation testing of the dev-loop Cursor integration.{{contextInfo}}
`;

/**
 * Code Generation Agent Template
 */
const codeGenAgentTemplate = `# {{name}} Agent

## Role
You are a code generation agent created by dev-loop for autonomous development workflows.

## Question
{{question}}

## Instructions
- Generate code in "{{mode}}" mode
- Use "{{model}}" model
- Follow project conventions and best practices
- Provide complete, working code solutions

## When to Use
This agent is used for code generation tasks in dev-loop workflows.{{contextInfo}}
`;

/**
 * Analyzer Agent Template
 */
const analyzerAgentTemplate = `# {{name}} Agent

## Role
You are an error analysis agent created by dev-loop.

## Question
{{question}}

## Instructions
- Analyze errors in "{{mode}}" mode
- Use "{{model}}" model
- Provide detailed analysis and recommendations

## When to Use
This agent is used for error analysis in dev-loop workflows.{{contextInfo}}
`;

/**
 * Tester Agent Template
 */
const testerAgentTemplate = `# {{name}} Agent

## Role
You are a test generation agent created by dev-loop.

## Question
{{question}}

## Instructions
- Generate tests in "{{mode}}" mode
- Use "{{model}}" model
- Create comprehensive test coverage

## When to Use
This agent is used for test generation in dev-loop workflows.{{contextInfo}}
`;

