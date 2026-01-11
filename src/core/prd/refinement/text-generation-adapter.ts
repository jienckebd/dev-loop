/**
 * Text Generation Adapter
 *
 * Adapter for AI providers to support text generation for PRD building.
 * Wraps existing AIProvider interface to provide generate() method for text generation.
 */

import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { TaskContext } from '../../../types';
import Anthropic from '@anthropic-ai/sdk';
import { OpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../../utils/logger';

/**
 * Text Generation Options
 */
export interface TextGenerationOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Adapter for text generation using AI providers
 */
export class TextGenerationAdapter {
  private provider: AIProvider;
  private providerConfig: AIProviderConfig;
  private providerName: string;
  private debug: boolean;

  constructor(provider: AIProvider, providerConfig: AIProviderConfig, debug = false) {
    this.provider = provider;
    this.providerConfig = providerConfig;
    this.providerName = provider.name;
    this.debug = debug;
  }

  /**
   * Generate text from prompt (text generation, not code generation)
   */
  async generate(prompt: string, options: TextGenerationOptions = {}): Promise<string> {
    const maxTokens = options.maxTokens || this.providerConfig.maxTokens || 4000;
    const temperature = options.temperature ?? this.providerConfig.temperature ?? 0.7;
    const systemPrompt = options.systemPrompt || 'You are a helpful assistant that generates structured documents.';

    try {
      // Use underlying SDK based on provider type
      switch (this.providerName) {
        case 'anthropic':
          return await this.generateWithAnthropic(prompt, systemPrompt, maxTokens, temperature);
        case 'openai':
          return await this.generateWithOpenAI(prompt, systemPrompt, maxTokens, temperature);
        case 'gemini':
          return await this.generateWithGemini(prompt, systemPrompt, maxTokens, temperature);
        case 'ollama':
          return await this.generateWithOllama(prompt, systemPrompt, maxTokens, temperature);
        default:
          // Fallback: use generateCode and extract text from response
          return await this.generateWithCodeGeneration(prompt, systemPrompt);
      }
    } catch (error) {
      logger.error(`[TextGenerationAdapter] Text generation failed: ${error}`);
      throw error;
    }
  }

  /**
   * Generate with Anthropic
   */
  private async generateWithAnthropic(
    prompt: string,
    systemPrompt: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    const client = new Anthropic({ apiKey: this.providerConfig.apiKey });
    const model = this.providerConfig.model || 'claude-3-5-sonnet-20241022';

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text from response
    if (response.content && response.content.length > 0) {
      const textBlock = response.content.find(block => block.type === 'text');
      if (textBlock && 'text' in textBlock) {
        return textBlock.text;
      }
    }

    throw new Error('No text content in Anthropic response');
  }

  /**
   * Generate with OpenAI
   */
  private async generateWithOpenAI(
    prompt: string,
    systemPrompt: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    const client = new OpenAI({ apiKey: this.providerConfig.apiKey });
    const model = this.providerConfig.model || 'gpt-4-turbo-preview';

    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });

    if (response.choices && response.choices.length > 0) {
      return response.choices[0].message.content || '';
    }

    throw new Error('No content in OpenAI response');
  }

  /**
   * Generate with Gemini
   */
  private async generateWithGemini(
    prompt: string,
    systemPrompt: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.providerConfig.apiKey || '');
    const model = genAI.getGenerativeModel({ model: this.providerConfig.model || 'gemini-pro' });

    const fullPrompt = `${systemPrompt}\n\n${prompt}`;
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    });

    const response = await result.response;
    return response.text();
  }

  /**
   * Generate with Ollama (local)
   */
  private async generateWithOllama(
    prompt: string,
    systemPrompt: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    // Ollama uses HTTP API
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const model = this.providerConfig.model || 'llama2';

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${systemPrompt}\n\n${prompt}`,
        options: {
          num_predict: maxTokens,
          temperature,
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json() as { response?: string };
    return data.response || '';
  }

  /**
   * Fallback: Generate using code generation interface
   */
  private async generateWithCodeGeneration(prompt: string, systemPrompt: string): Promise<string> {
    // Create a minimal context
    const context: TaskContext = {
      task: {
        id: 'text-generation',
        title: 'Text Generation',
        description: prompt,
        status: 'pending',
        priority: 'medium',
      },
      codebaseContext: systemPrompt,
    };

    // Use generateCode and extract text from summary
    const codeChanges = await this.provider.generateCode(prompt, context);
    
    // Extract text from codeChanges summary or first file content
    if (codeChanges.summary) {
      return codeChanges.summary;
    }

    if (codeChanges.files && codeChanges.files.length > 0 && codeChanges.files[0].content) {
      return codeChanges.files[0].content;
    }

    throw new Error('No text content in code generation response');
  }
}
