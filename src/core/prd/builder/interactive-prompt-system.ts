/**
 * Interactive Prompt System
 *
 * Wrapper for CLI prompt libraries (@clack/prompts or inquirer).
 * Supports multiple question types with conditional follow-up questions.
 * Independent of Cursor - uses open-source CLI libraries.
 */

import { Question, QuestionType, Answer } from '../../conversation/types';
import { logger } from '../../utils/logger';

/**
 * Interactive Prompt System Configuration
 */
export interface InteractivePromptSystemConfig {
  useRichUI?: boolean; // Use @clack/prompts if available, fallback to inquirer
  library?: 'clack' | 'inquirer'; // Force specific library
  debug?: boolean;
}

/**
 * Interactive Prompt System
 */
export class InteractivePromptSystem {
  private config: InteractivePromptSystemConfig & { useRichUI: boolean; library: 'clack' | 'inquirer'; debug: boolean };
  private useClack: boolean;

  constructor(config: InteractivePromptSystemConfig = {}) {
    this.config = {
      useRichUI: config.useRichUI !== false,
      library: config.library || 'clack',
      debug: config.debug || false,
    };
    this.useClack = this.detectLibrary();
  }

  /**
   * Detect which library to use
   */
  private detectLibrary(): boolean {
    if (this.config.library === 'inquirer') {
      return false;
    }
    if (this.config.library === 'clack') {
      return true;
    }

    // Try to use @clack/prompts if available, fallback to inquirer
    try {
      require('@clack/prompts');
      return true;
    } catch {
      try {
        require('inquirer');
        return false;
      } catch {
        throw new Error(
          'Neither @clack/prompts nor inquirer is installed. Please install one of them.'
        );
      }
    }
  }

  /**
   * Ask a question
   */
  async askQuestion(question: Question): Promise<string | string[] | boolean> {
    switch (question.type) {
      case 'multiple-choice':
        return await this.askMultipleChoice(question);
      case 'open-ended':
        return await this.askOpenEnded(question);
      case 'multi-select':
        return await this.askMultiSelect(question);
      case 'confirm':
        return await this.askConfirm(question);
      default:
        throw new Error(`Unsupported question type: ${question.type}`);
    }
  }

  /**
   * Ask a multiple choice question
   */
  async askMultipleChoice(question: Question): Promise<string> {
    if (!question.options || question.options.length === 0) {
      throw new Error('Multiple choice question must have options');
    }

    if (this.useClack) {
      return await this.askMultipleChoiceClack(question);
    } else {
      return await this.askMultipleChoiceInquirer(question);
    }
  }

  /**
   * Ask multiple choice using @clack/prompts
   */
  private async askMultipleChoiceClack(question: Question): Promise<string> {
    try {
      const { select } = require('@clack/prompts');
      const result = await select({
        message: question.text,
        options: question.options!.map(opt => ({
          value: opt,
          label: opt,
        })),
        initialValue: question.default as string | undefined,
      });

      if (typeof result === 'symbol') {
        // User cancelled
        throw new Error('Question cancelled by user');
      }

      return result as string;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask question with clack: ${error}`);
      throw error;
    }
  }

  /**
   * Ask multiple choice using inquirer
   */
  private async askMultipleChoiceInquirer(question: Question): Promise<string> {
    try {
      const inquirer = require('inquirer');
      const result = await inquirer.prompt([
        {
          type: 'list',
          name: 'answer',
          message: question.text,
          choices: question.options!,
          default: question.default as string | undefined,
        },
      ]);

      return result.answer;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask question with inquirer: ${error}`);
      throw error;
    }
  }

  /**
   * Ask an open-ended question
   */
  async askOpenEnded(question: Question): Promise<string> {
    if (this.useClack) {
      return await this.askOpenEndedClack(question);
    } else {
      return await this.askOpenEndedInquirer(question);
    }
  }

  /**
   * Ask open-ended using @clack/prompts
   */
  private async askOpenEndedClack(question: Question): Promise<string> {
    try {
      const { text } = require('@clack/prompts');
      const result = await text({
        message: question.text,
        placeholder: question.context || '',
        initialValue: question.default as string | undefined,
        validate: (value: string) => {
          if (question.required && !value) {
            return 'This field is required';
          }
          return undefined;
        },
      });

      if (typeof result === 'symbol') {
        // User cancelled
        throw new Error('Question cancelled by user');
      }

      return result as string;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask question with clack: ${error}`);
      throw error;
    }
  }

  /**
   * Ask open-ended using inquirer
   */
  private async askOpenEndedInquirer(question: Question): Promise<string> {
    try {
      const inquirer = require('inquirer');
      const result = await inquirer.prompt([
        {
          type: 'input',
          name: 'answer',
          message: question.text,
          default: question.default as string | undefined,
          validate: (value: string) => {
            if (question.required && !value) {
              return 'This field is required';
            }
            return true;
          },
        },
      ]);

      return result.answer;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask question with inquirer: ${error}`);
      throw error;
    }
  }

  /**
   * Ask a multi-select question
   */
  async askMultiSelect(question: Question): Promise<string[]> {
    if (!question.options || question.options.length === 0) {
      throw new Error('Multi-select question must have options');
    }

    if (this.useClack) {
      return await this.askMultiSelectClack(question);
    } else {
      return await this.askMultiSelectInquirer(question);
    }
  }

  /**
   * Ask multi-select using @clack/prompts
   */
  private async askMultiSelectClack(question: Question): Promise<string[]> {
    try {
      const { multiselect } = require('@clack/prompts');
      const result = await multiselect({
        message: question.text,
        options: question.options!.map(opt => ({
          value: opt,
          label: opt,
        })),
        initialValue: question.default as string[] | undefined,
      });

      if (typeof result === 'symbol') {
        // User cancelled
        throw new Error('Question cancelled by user');
      }

      return result as string[];
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask question with clack: ${error}`);
      throw error;
    }
  }

  /**
   * Ask multi-select using inquirer
   */
  private async askMultiSelectInquirer(question: Question): Promise<string[]> {
    try {
      const inquirer = require('inquirer');
      const result = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'answer',
          message: question.text,
          choices: question.options!,
          default: question.default as string[] | undefined,
        },
      ]);

      return result.answer;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask question with inquirer: ${error}`);
      throw error;
    }
  }

  /**
   * Ask a confirmation question
   */
  async askConfirm(question: Question, defaultAnswer?: boolean): Promise<boolean> {
    if (this.useClack) {
      return await this.askConfirmClack(question, defaultAnswer);
    } else {
      return await this.askConfirmInquirer(question, defaultAnswer);
    }
  }

  /**
   * Ask confirm using @clack/prompts
   */
  private async askConfirmClack(question: Question, defaultAnswer?: boolean): Promise<boolean> {
    try {
      const { confirm } = require('@clack/prompts');
      const result = await confirm({
        message: question.text,
        initialValue: defaultAnswer ?? (question.default as boolean | undefined) ?? false,
      });

      if (typeof result === 'symbol') {
        // User cancelled
        throw new Error('Question cancelled by user');
      }

      return result as boolean;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask question with clack: ${error}`);
      throw error;
    }
  }

  /**
   * Ask confirm using inquirer
   */
  private async askConfirmInquirer(question: Question, defaultAnswer?: boolean): Promise<boolean> {
    try {
      const inquirer = require('inquirer');
      const result = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'answer',
          message: question.text,
          default: defaultAnswer ?? (question.default as boolean | undefined) ?? false,
        },
      ]);

      return result.answer;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask question with inquirer: ${error}`);
      throw error;
    }
  }

  /**
   * Present refinement results and get user response
   */
  async presentRefinement(
    iteration: number,
    enhancements: Array<{ type: string; description: string; changes?: any }>
  ): Promise<'approve' | 'reject' | 'edit'> {
    if (this.useClack) {
      return await this.presentRefinementClack(iteration, enhancements);
    } else {
      return await this.presentRefinementInquirer(iteration, enhancements);
    }
  }

  /**
   * Present refinement using @clack/prompts
   */
  private async presentRefinementClack(
    iteration: number,
    enhancements: Array<{ type: string; description: string; changes?: any }>
  ): Promise<'approve' | 'reject' | 'edit'> {
    try {
      const { select, log } = require('@clack/prompts');
      log.info(`Refinement iteration ${iteration} results:`);
      for (const enhancement of enhancements) {
        log.step(`${enhancement.type}: ${enhancement.description}`);
      }

      const result = await select({
        message: 'How would you like to proceed?',
        options: [
          { value: 'approve', label: 'Approve and continue' },
          { value: 'edit', label: 'Edit and retry' },
          { value: 'reject', label: 'Reject and skip' },
        ],
        initialValue: 'approve',
      });

      if (typeof result === 'symbol') {
        return 'reject'; // User cancelled
      }

      return result as 'approve' | 'reject' | 'edit';
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to present refinement: ${error}`);
      return 'reject';
    }
  }

  /**
   * Present refinement using inquirer
   */
  private async presentRefinementInquirer(
    iteration: number,
    enhancements: Array<{ type: string; description: string; changes?: any }>
  ): Promise<'approve' | 'reject' | 'edit'> {
    try {
      const inquirer = require('inquirer');
      const { log } = require('../../utils/logger');

      log.info(`Refinement iteration ${iteration} results:`);
      for (const enhancement of enhancements) {
        log.info(`  ${enhancement.type}: ${enhancement.description}`);
      }

      const result = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'How would you like to proceed?',
          choices: [
            { name: 'Approve and continue', value: 'approve' },
            { name: 'Edit and retry', value: 'edit' },
            { name: 'Reject and skip', value: 'reject' },
          ],
          default: 'approve',
        },
      ]);

      return result.action;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to present refinement: ${error}`);
      return 'reject';
    }
  }

  /**
   * Present gaps and get user selection
   */
  async presentGaps(
    gaps: Array<{ type: string; severity: string; description: string; recommendation: string }>
  ): Promise<{ selectedGaps: string[]; action: 'enhance' | 'skip' }> {
    if (this.useClack) {
      return await this.presentGapsClack(gaps);
    } else {
      return await this.presentGapsInquirer(gaps);
    }
  }

  /**
   * Present gaps using @clack/prompts
   */
  private async presentGapsClack(
    gaps: Array<{ type: string; severity: string; description: string; recommendation: string }>
  ): Promise<{ selectedGaps: string[]; action: 'enhance' | 'skip' }> {
    try {
      const { multiselect, select, log } = require('@clack/prompts');
      log.info('Detected gaps in PRD set:');
      for (const gap of gaps) {
        log.warn(`  [${gap.severity}] ${gap.type}: ${gap.description}`);
      }

      const selectedGaps = await multiselect({
        message: 'Select gaps to enhance:',
        options: gaps.map(gap => ({
          value: gap.type,
          label: `${gap.severity}: ${gap.description}`,
        })),
      });

      if (typeof selectedGaps === 'symbol') {
        return { selectedGaps: [], action: 'skip' };
      }

      const action = await select({
        message: 'What would you like to do?',
        options: [
          { value: 'enhance', label: 'Enhance selected gaps' },
          { value: 'skip', label: 'Skip enhancement' },
        ],
        initialValue: 'enhance',
      });

      return {
        selectedGaps: selectedGaps as string[],
        action: (typeof action === 'symbol' ? 'skip' : action) as 'enhance' | 'skip',
      };
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to present gaps: ${error}`);
      return { selectedGaps: [], action: 'skip' };
    }
  }

  /**
   * Present gaps using inquirer
   */
  private async presentGapsInquirer(
    gaps: Array<{ type: string; severity: string; description: string; recommendation: string }>
  ): Promise<{ selectedGaps: string[]; action: 'enhance' | 'skip' }> {
    try {
      const inquirer = require('inquirer');
      const { log } = require('../../utils/logger');

      log.info('Detected gaps in PRD set:');
      for (const gap of gaps) {
        log.warn(`  [${gap.severity}] ${gap.type}: ${gap.description}`);
      }

      const gapResult = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedGaps',
          message: 'Select gaps to enhance:',
          choices: gaps.map(gap => ({
            name: `${gap.severity}: ${gap.description}`,
            value: gap.type,
          })),
        },
      ]);

      const actionResult = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Enhance selected gaps', value: 'enhance' },
            { name: 'Skip enhancement', value: 'skip' },
          ],
          default: 'enhance',
        },
      ]);

      return {
        selectedGaps: gapResult.selectedGaps,
        action: actionResult.action,
      };
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to present gaps: ${error}`);
      return { selectedGaps: [], action: 'skip' };
    }
  }

  /**
   * Summarize progress
   */
  async summarizeProgress(context: {
    phase: string;
    progress: number;
    questionsAsked?: number;
    questionsTotal?: number;
    draftsGenerated?: number;
    refinementsApplied?: number;
  }): Promise<void> {
    if (this.useClack) {
      await this.summarizeProgressClack(context);
    } else {
      await this.summarizeProgressInquirer(context);
    }
  }

  /**
   * Summarize progress using @clack/prompts
   */
  private async summarizeProgressClack(context: {
    phase: string;
    progress: number;
    questionsAsked?: number;
    questionsTotal?: number;
    draftsGenerated?: number;
    refinementsApplied?: number;
  }): Promise<void> {
    try {
      const { log, spinner } = require('@clack/prompts');
      log.info(`Phase: ${context.phase}`);
      log.info(`Progress: ${context.progress}%`);
      if (context.questionsAsked !== undefined && context.questionsTotal !== undefined) {
        log.info(
          `Questions: ${context.questionsAsked}/${context.questionsTotal} answered`
        );
      }
      if (context.draftsGenerated !== undefined) {
        log.info(`Drafts generated: ${context.draftsGenerated}`);
      }
      if (context.refinementsApplied !== undefined) {
        log.info(`Refinements applied: ${context.refinementsApplied}`);
      }
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to summarize progress: ${error}`);
    }
  }

  /**
   * Summarize progress using inquirer (just log, no interactive element)
   */
  private async summarizeProgressInquirer(context: {
    phase: string;
    progress: number;
    questionsAsked?: number;
    questionsTotal?: number;
    draftsGenerated?: number;
    refinementsApplied?: number;
  }): Promise<void> {
    const { log } = require('../../utils/logger');
    log.info(`Phase: ${context.phase}`);
    log.info(`Progress: ${context.progress}%`);
    if (context.questionsAsked !== undefined && context.questionsTotal !== undefined) {
      log.info(`Questions: ${context.questionsAsked}/${context.questionsTotal} answered`);
    }
    if (context.draftsGenerated !== undefined) {
      log.info(`Drafts generated: ${context.draftsGenerated}`);
    }
    if (context.refinementsApplied !== undefined) {
      log.info(`Refinements applied: ${context.refinementsApplied}`);
    }
  }

  /**
   * Select mode (convert, enhance, or create)
   */
  async selectMode(): Promise<'convert' | 'enhance' | 'create'> {
    if (this.useClack) {
      return await this.selectModeClack();
    } else {
      return await this.selectModeInquirer();
    }
  }

  /**
   * Select mode using @clack/prompts
   */
  private async selectModeClack(): Promise<'convert' | 'enhance' | 'create'> {
    try {
      const { select } = require('@clack/prompts');
      const result = await select({
        message: 'Select mode:',
        options: [
          { value: 'convert', label: 'Convert - Convert planning document to PRD set' },
          { value: 'enhance', label: 'Enhance - Enhance existing PRD set' },
          { value: 'create', label: 'Create - Create new PRD set interactively' },
        ],
        initialValue: 'convert',
      });

      if (typeof result === 'symbol') {
        throw new Error('Mode selection cancelled by user');
      }

      return result as 'convert' | 'enhance' | 'create';
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to select mode: ${error}`);
      throw error;
    }
  }

  /**
   * Select mode using inquirer
   */
  private async selectModeInquirer(): Promise<'convert' | 'enhance' | 'create'> {
    try {
      const inquirer = require('inquirer');
      const result = await inquirer.prompt([
        {
          type: 'list',
          name: 'mode',
          message: 'Select mode:',
          choices: [
            { name: 'Convert - Convert planning document to PRD set', value: 'convert' },
            { name: 'Enhance - Enhance existing PRD set', value: 'enhance' },
            { name: 'Create - Create new PRD set interactively', value: 'create' },
          ],
          default: 'convert',
        },
      ]);

      return result.mode as 'convert' | 'enhance' | 'create';
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to select mode: ${error}`);
      throw error;
    }
  }

  /**
   * Select file from list
   */
  async selectFileFromList(
    files: Array<{ path: string; name: string; relativePath?: string }>,
    message: string = 'Select a file:'
  ): Promise<string> {
    if (files.length === 0) {
      throw new Error('No files available to select');
    }

    if (files.length === 1) {
      // Auto-select if only one file
      return files[0].path;
    }

    if (this.useClack) {
      return await this.selectFileFromListClack(files, message);
    } else {
      return await this.selectFileFromListInquirer(files, message);
    }
  }

  /**
   * Select file from list using @clack/prompts
   */
  private async selectFileFromListClack(
    files: Array<{ path: string; name: string; relativePath?: string }>,
    message: string
  ): Promise<string> {
    try {
      const { select } = require('@clack/prompts');
      const result = await select({
        message,
        options: files.map(file => ({
          value: file.path,
          label: file.relativePath || file.name,
          hint: file.path !== file.relativePath ? file.path : undefined,
        })),
      });

      if (typeof result === 'symbol') {
        throw new Error('File selection cancelled by user');
      }

      return result as string;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to select file: ${error}`);
      throw error;
    }
  }

  /**
   * Select file from list using inquirer
   */
  private async selectFileFromListInquirer(
    files: Array<{ path: string; name: string; relativePath?: string }>,
    message: string
  ): Promise<string> {
    try {
      const inquirer = require('inquirer');
      const result = await inquirer.prompt([
        {
          type: 'list',
          name: 'file',
          message,
          choices: files.map(file => ({
            name: file.relativePath || file.name,
            value: file.path,
          })),
        },
      ]);

      return result.file as string;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to select file: ${error}`);
      throw error;
    }
  }

  /**
   * Select PRD set from list
   */
  async selectPrdSetFromList(
    prdSets: Array<{ path: string; setId: string; relativePath?: string }>,
    message: string = 'Select a PRD set:'
  ): Promise<string> {
    if (prdSets.length === 0) {
      throw new Error('No PRD sets available to select');
    }

    if (prdSets.length === 1) {
      // Auto-select if only one PRD set
      return prdSets[0].path;
    }

    if (this.useClack) {
      return await this.selectPrdSetFromListClack(prdSets, message);
    } else {
      return await this.selectPrdSetFromListInquirer(prdSets, message);
    }
  }

  /**
   * Select PRD set from list using @clack/prompts
   */
  private async selectPrdSetFromListClack(
    prdSets: Array<{ path: string; setId: string; relativePath?: string }>,
    message: string
  ): Promise<string> {
    try {
      const { select } = require('@clack/prompts');
      const result = await select({
        message,
        options: prdSets.map(prdSet => ({
          value: prdSet.path,
          label: `${prdSet.setId}${prdSet.relativePath ? ` (${prdSet.relativePath})` : ''}`,
          hint: prdSet.path !== prdSet.relativePath ? prdSet.path : undefined,
        })),
      });

      if (typeof result === 'symbol') {
        throw new Error('PRD set selection cancelled by user');
      }

      return result as string;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to select PRD set: ${error}`);
      throw error;
    }
  }

  /**
   * Select PRD set from list using inquirer
   */
  private async selectPrdSetFromListInquirer(
    prdSets: Array<{ path: string; setId: string; relativePath?: string }>,
    message: string
  ): Promise<string> {
    try {
      const inquirer = require('inquirer');
      const result = await inquirer.prompt([
        {
          type: 'list',
          name: 'prdSet',
          message,
          choices: prdSets.map(prdSet => ({
            name: `${prdSet.setId}${prdSet.relativePath ? ` (${prdSet.relativePath})` : ''}`,
            value: prdSet.path,
          })),
        },
      ]);

      return result.prdSet as string;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to select PRD set: ${error}`);
      throw error;
    }
  }

  /**
   * Ask refinement questions before a phase
   */
  async askRefinementQuestions(
    questions: Array<{ id: string; type: string; text: string; options?: string[]; required: boolean; context?: string; hint?: string }>,
    phase: string
  ): Promise<Map<string, any>> {
    if (questions.length === 0) {
      return new Map();
    }

    if (this.useClack) {
      return await this.askRefinementQuestionsClack(questions, phase);
    } else {
      return await this.askRefinementQuestionsInquirer(questions, phase);
    }
  }

  /**
   * Ask refinement questions using @clack/prompts
   */
  private async askRefinementQuestionsClack(
    questions: Array<{ id: string; type: string; text: string; options?: string[]; required: boolean; context?: string; hint?: string }>,
    phase: string
  ): Promise<Map<string, any>> {
    try {
      const { select, confirm, multiselect, text, log } = require('@clack/prompts');
      const answers = new Map<string, any>();

      log.info(`Phase: ${phase.toUpperCase()} Enhancement`);
      log.info('Let me ask a few questions to guide the enhancement:');
      log.info('');

      for (const question of questions) {
        let answer: any;

        if (question.context) {
          log.info(`  Context: ${question.context}`);
        }

        if (question.hint) {
          log.info(`  Hint: ${question.hint}`);
        }

        if (question.options && question.options.length > 0) {
          // Multiple choice question
          if (question.type === 'prioritization' && question.options.length > 3) {
            // Use multiselect for prioritization questions
            const selected = await multiselect({
              message: question.text,
              options: question.options.map(opt => ({ value: opt, label: opt })),
            });

            if (typeof selected === 'symbol') {
              if (question.required) {
                throw new Error(`Question ${question.id} is required but was cancelled`);
              }
              answer = [];
            } else {
              answer = selected as string[];
            }
          } else {
            // Use select for single choice
            const selected = await select({
              message: question.text,
              options: question.options.map(opt => ({ value: opt, label: opt })),
            });

            if (typeof selected === 'symbol') {
              if (question.required) {
                throw new Error(`Question ${question.id} is required but was cancelled`);
              }
              answer = question.options[0]; // Default to first option
            } else {
              answer = selected as string;
            }
          }
        } else {
          // Open-ended question
          const input = await text({
            message: question.text,
            placeholder: 'Enter your answer...',
          });

          if (typeof input === 'symbol') {
            if (question.required) {
              throw new Error(`Question ${question.id} is required but was cancelled`);
            }
            answer = '';
          } else {
            answer = input as string;
          }
        }

        answers.set(question.id, answer);
        log.info('');
      }

      return answers;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask refinement questions: ${error}`);
      throw error;
    }
  }

  /**
   * Ask refinement questions using inquirer
   */
  private async askRefinementQuestionsInquirer(
    questions: Array<{ id: string; type: string; text: string; options?: string[]; required: boolean; context?: string; hint?: string }>,
    phase: string
  ): Promise<Map<string, any>> {
    try {
      const inquirer = require('inquirer');
      const { log } = require('../../utils/logger');
      const answers = new Map<string, any>();

      log.info(`Phase: ${phase.toUpperCase()} Enhancement`);
      log.info('Let me ask a few questions to guide the enhancement:');
      log.info('');

      for (const question of questions) {
        if (question.context) {
          log.info(`  Context: ${question.context}`);
        }

        if (question.hint) {
          log.info(`  Hint: ${question.hint}`);
        }

        let promptConfig: any = {
          type: 'input',
          name: 'answer',
          message: question.text,
          validate: question.required ? (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'This question is required';
            }
            return true;
          } : undefined,
        };

        if (question.options && question.options.length > 0) {
          if (question.type === 'prioritization' && question.options.length > 3) {
            promptConfig.type = 'checkbox';
            promptConfig.choices = question.options;
          } else {
            promptConfig.type = 'list';
            promptConfig.choices = question.options;
          }
        }

        const result = await inquirer.prompt([promptConfig]);
        answers.set(question.id, result.answer);
        log.info('');
      }

      return answers;
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask refinement questions: ${error}`);
      throw error;
    }
  }

  /**
   * Show codebase insights and get user preferences
   */
  async showCodebaseInsights(
    insights: Array<{ id: string; type: string; description: string; relevance: string; example?: string; recommendation?: string; filePath?: string; pattern?: string; count?: number }>,
    message: string
  ): Promise<{ selectedInsights: string[]; preferences: Map<string, any> }> {
    if (insights.length === 0) {
      return { selectedInsights: [], preferences: new Map() };
    }

    if (this.useClack) {
      return await this.showCodebaseInsightsClack(insights, message);
    } else {
      return await this.showCodebaseInsightsInquirer(insights, message);
    }
  }

  /**
   * Show codebase insights using @clack/prompts
   */
  private async showCodebaseInsightsClack(
    insights: Array<{ id: string; type: string; description: string; relevance: string; example?: string; recommendation?: string; filePath?: string; pattern?: string; count?: number }>,
    message: string
  ): Promise<{ selectedInsights: string[]; preferences: Map<string, any> }> {
    try {
      const { multiselect, select, log } = require('@clack/prompts');
      const preferences = new Map<string, any>();

      log.info(message);
      log.info('');

      // Show insights grouped by relevance
      const highRelevance = insights.filter(i => i.relevance === 'high');
      const mediumRelevance = insights.filter(i => i.relevance === 'medium');
      const lowRelevance = insights.filter(i => i.relevance === 'low');

      if (highRelevance.length > 0) {
        log.info('High Relevance Insights:');
        for (const insight of highRelevance) {
          log.info(`  • ${insight.description}`);
          if (insight.example) {
            log.info(`    Example: ${insight.example}`);
          }
          if (insight.recommendation) {
            log.info(`    Recommendation: ${insight.recommendation}`);
          }
        }
        log.info('');
      }

      if (mediumRelevance.length > 0) {
        log.info('Medium Relevance Insights:');
        for (const insight of mediumRelevance.slice(0, 5)) {
          log.info(`  • ${insight.description}`);
        }
        if (mediumRelevance.length > 5) {
          log.info(`  ... and ${mediumRelevance.length - 5} more`);
        }
        log.info('');
      }

      // Ask user to select insights to use
      const selectedInsights = await multiselect({
        message: 'Which insights should I use for enhancement?',
        options: insights.map(insight => ({
          value: insight.id,
          label: `[${insight.relevance}] ${insight.description}`,
          hint: insight.recommendation || insight.example,
        })),
      });

      const selected = typeof selectedInsights === 'symbol' ? [] : (selectedInsights as string[]);

      // Ask follow-up questions for selected insights
      for (const insightId of selected) {
        const insight = insights.find(i => i.id === insightId);
        if (!insight) continue;

        if (insight.recommendation) {
          const action = await select({
            message: `How should I use this insight: ${insight.description}?`,
            options: [
              { value: 'use', label: `Use: ${insight.recommendation}` },
              { value: 'adapt', label: 'Adapt it to my needs' },
              { value: 'skip', label: 'Skip this insight' },
            ],
            initialValue: 'use',
          });

          preferences.set(insightId, {
            action: typeof action === 'symbol' ? 'use' : action,
            insight,
          });
        }
      }

      return { selectedInsights: selected, preferences };
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to show codebase insights: ${error}`);
      return { selectedInsights: [], preferences: new Map() };
    }
  }

  /**
   * Show codebase insights using inquirer
   */
  private async showCodebaseInsightsInquirer(
    insights: Array<{ id: string; type: string; description: string; relevance: string; example?: string; recommendation?: string; filePath?: string; pattern?: string; count?: number }>,
    message: string
  ): Promise<{ selectedInsights: string[]; preferences: Map<string, any> }> {
    try {
      const inquirer = require('inquirer');
      const { log } = require('../../utils/logger');
      const preferences = new Map<string, any>();

      log.info(message);
      log.info('');

      // Show insights
      log.info('Codebase Insights:');
      for (const insight of insights.slice(0, 10)) {
        log.info(`  [${insight.relevance}] ${insight.description}`);
        if (insight.example) {
          log.info(`    Example: ${insight.example}`);
        }
        if (insight.recommendation) {
          log.info(`    Recommendation: ${insight.recommendation}`);
        }
      }
      if (insights.length > 10) {
        log.info(`  ... and ${insights.length - 10} more`);
      }
      log.info('');

      // Ask user to select insights
      const result = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedInsights',
          message: 'Which insights should I use for enhancement?',
          choices: insights.map(insight => ({
            name: `[${insight.relevance}] ${insight.description}`,
            value: insight.id,
          })),
        },
      ]);

      const selectedInsights = result.selectedInsights || [];

      // Ask follow-up for selected insights
      for (const insightId of selectedInsights) {
        const insight = insights.find(i => i.id === insightId);
        if (!insight || !insight.recommendation) continue;

        const actionResult = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: `How should I use: ${insight.description}?`,
            choices: [
              { name: `Use: ${insight.recommendation}`, value: 'use' },
              { name: 'Adapt it to my needs', value: 'adapt' },
              { name: 'Skip this insight', value: 'skip' },
            ],
          },
        ]);

        preferences.set(insightId, {
          action: actionResult.action,
          insight,
        });
      }

      return { selectedInsights, preferences };
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to show codebase insights: ${error}`);
      return { selectedInsights: [], preferences: new Map() };
    }
  }

  /**
   * Ask what to refine after seeing results
   */
  async askWhatToRefine(
    results: any,
    validation: { errors?: Array<{ type: string; severity: string; message: string }>; warnings?: Array<{ type: string; message: string }>; score?: number },
    phase: string
  ): Promise<{ refineItems: string[]; skipItems: string[] }> {
    if (this.useClack) {
      return await this.askWhatToRefineClack(results, validation, phase);
    } else {
      return await this.askWhatToRefineInquirer(results, validation, phase);
    }
  }

  /**
   * Ask what to refine using @clack/prompts
   */
  private async askWhatToRefineClack(
    results: any,
    validation: { errors?: Array<{ type: string; severity: string; message: string }>; warnings?: Array<{ type: string; message: string }>; score?: number },
    phase: string
  ): Promise<{ refineItems: string[]; skipItems: string[] }> {
    try {
      const { multiselect, select, log } = require('@clack/prompts');

      log.info(`Phase: ${phase.toUpperCase()} - Results Review`);
      log.info('');

      const itemsToRefine: string[] = [];
      const itemsToSkip: string[] = [];

      // Show validation results
      if (validation.score !== undefined) {
        log.info(`Validation Score: ${validation.score}/100`);
      }

      if (validation.errors && validation.errors.length > 0) {
        log.warn(`Errors: ${validation.errors.length}`);
        for (const error of validation.errors.slice(0, 5)) {
          log.warn(`  [${error.severity}] ${error.message}`);
        }
      }

      if (validation.warnings && validation.warnings.length > 0) {
        log.warn(`Warnings: ${validation.warnings.length}`);
        for (const warning of validation.warnings.slice(0, 3)) {
          log.warn(`  ${warning.message}`);
        }
      }

      log.info('');

      // Build list of items to refine
      const refineOptions: Array<{ value: string; label: string; hint?: string }> = [];

      if (phase === 'schema' && results.schemas) {
        for (const schema of results.schemas) {
          const confidence = schema.confidence || 0;
          const needsRefinement = confidence < 0.7 || !schema.content || schema.content.trim().length < 100;
          
          if (needsRefinement) {
            refineOptions.push({
              value: schema.id || `schema-${refineOptions.length}`,
              label: `${schema.id || 'schema'} (confidence: ${Math.round(confidence * 100)}%)`,
              hint: confidence < 0.7 ? 'Low confidence - needs refinement' : 'Incomplete content',
            });
          }
        }
      }

      if (phase === 'test' && results.testPlans) {
        for (const plan of results.testPlans) {
          const needsRefinement = !plan.testCases || plan.testCases.length < 2;
          
          if (needsRefinement) {
            refineOptions.push({
              value: plan.id || plan.taskId || `test-${refineOptions.length}`,
              label: `${plan.taskId || plan.id} - ${plan.description?.substring(0, 50) || 'test plan'}`,
              hint: `Only ${plan.testCases?.length || 0} test case(s) - needs more`,
            });
          }
        }
      }

      if (phase === 'feature' && results.enhancements) {
        for (const enhancement of results.enhancements) {
          const needsRefinement = enhancement.priority === 'high' && !enhancement.content;
          
          if (needsRefinement) {
            refineOptions.push({
              value: enhancement.id || `feature-${refineOptions.length}`,
              label: `[${enhancement.priority}] ${enhancement.type || 'enhancement'}`,
              hint: enhancement.description,
            });
          }
        }
      }

      // Add validation errors as refine options
      if (validation.errors) {
        for (const error of validation.errors) {
          if ((phase === 'schema' && error.type === 'missing-schema') ||
              (phase === 'test' && error.type === 'missing-test') ||
              (phase === 'feature' && error.type === 'missing-config')) {
            refineOptions.push({
              value: `error-${error.type}`,
              label: `[${error.severity}] Fix: ${error.message}`,
              hint: 'Validation error - needs to be addressed',
            });
          }
        }
      }

      if (refineOptions.length === 0) {
        log.info('No items need refinement. Results look good!');
        return { refineItems: [], skipItems: [] };
      }

      // Ask user what to refine
      const selected = await multiselect({
        message: 'Which items should I refine?',
        options: [
          ...refineOptions,
          { value: '_skip_all', label: 'Skip all - continue with current results' },
        ],
      });

      const selectedItems = typeof selected === 'symbol' ? [] : (selected as string[]);

      if (selectedItems.includes('_skip_all')) {
        return { refineItems: [], skipItems: refineOptions.map(o => o.value).filter(v => v !== '_skip_all') };
      }

      // Ask if user wants to skip specific items
      const skipOptions = refineOptions.filter(o => !selectedItems.includes(o.value));
      if (skipOptions.length > 0) {
        const skipSelected = await multiselect({
          message: 'Which items should I skip refining? (optional)',
          options: [
            ...skipOptions,
            { value: '_refine_all', label: 'Refine all remaining items' },
          ],
        });

        const skipItems = typeof skipSelected === 'symbol' ? [] : (skipSelected as string[]);
        if (skipItems.includes('_refine_all')) {
          return { refineItems: refineOptions.map(o => o.value), skipItems: [] };
        }

        return { refineItems: selectedItems, skipItems: skipItems.filter(v => v !== '_refine_all') };
      }

      return { refineItems: selectedItems, skipItems: [] };
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask what to refine: ${error}`);
      return { refineItems: [], skipItems: [] };
    }
  }

  /**
   * Ask what to refine using inquirer
   */
  private async askWhatToRefineInquirer(
    results: any,
    validation: { errors?: Array<{ type: string; severity: string; message: string }>; warnings?: Array<{ type: string; message: string }>; score?: number },
    phase: string
  ): Promise<{ refineItems: string[]; skipItems: string[] }> {
    try {
      const inquirer = require('inquirer');
      const { log } = require('../../utils/logger');

      log.info(`Phase: ${phase.toUpperCase()} - Results Review`);
      log.info('');

      if (validation.score !== undefined) {
        log.info(`Validation Score: ${validation.score}/100`);
      }

      if (validation.errors && validation.errors.length > 0) {
        log.warn(`Errors: ${validation.errors.length}`);
      }

      log.info('');

      // Build refine options
      const refineOptions: Array<{ name: string; value: string }> = [];

      if (phase === 'schema' && results.schemas) {
        for (const schema of results.schemas) {
          const confidence = schema.confidence || 0;
          if (confidence < 0.7 || !schema.content || schema.content.trim().length < 100) {
            refineOptions.push({
              name: `${schema.id} (confidence: ${Math.round(confidence * 100)}%)`,
              value: schema.id || `schema-${refineOptions.length}`,
            });
          }
        }
      }

      if (phase === 'test' && results.testPlans) {
        for (const plan of results.testPlans) {
          if (!plan.testCases || plan.testCases.length < 2) {
            refineOptions.push({
              name: `${plan.taskId || plan.id} - ${plan.description?.substring(0, 50) || 'test plan'}`,
              value: plan.id || plan.taskId || `test-${refineOptions.length}`,
            });
          }
        }
      }

      if (refineOptions.length === 0) {
        log.info('No items need refinement. Results look good!');
        return { refineItems: [], skipItems: [] };
      }

      // Ask what to refine
      const result = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'refineItems',
          message: 'Which items should I refine?',
          choices: refineOptions,
        },
      ]);

      return { refineItems: result.refineItems || [], skipItems: [] };
    } catch (error) {
      logger.error(`[InteractivePromptSystem] Failed to ask what to refine: ${error}`);
      return { refineItems: [], skipItems: [] };
    }
  }
}
