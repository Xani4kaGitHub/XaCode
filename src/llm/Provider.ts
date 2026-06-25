import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../logger';
import { metricsTracker } from '../metrics/MetricsTracker';

export interface LLMRequest {
  messages: any[];
  tools?: any[];
  signal?: AbortSignal;
}

export interface LLMResponse {
  content: string | null;
  toolCalls?: any[];
  reasoningContent?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  chatComplete(request: LLMRequest): Promise<LLMResponse>;
}

class DeepSeekProvider implements LLMProvider {
  private openai: OpenAI;
  private readonly maxRetries = 3;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.DEEPSEEK_API_KEY,
      baseURL: config.DEEPSEEK_BASE_URL,
    });
  }

  async chatComplete(request: LLMRequest): Promise<LLMResponse> {
    let attempt = 0;
    let delay = 1000;

    while (attempt < this.maxRetries) {
      try {
        const start = Date.now();
        const response = await this.openai.chat.completions.create({
          model: config.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: request.messages,
          tools: request.tools,
          tool_choice: request.tools && request.tools.length > 0 ? 'auto' : 'none',
        }, {
          signal: request.signal
        });
        
        const executionTime = Date.now() - start;
        logger.debug(`DeepSeek API call took ${executionTime}ms`);

        const msg = response.choices[0].message;
        const usage = response.usage;

        if (usage) {
          // Rough estimate API cost: deepseek-chat is usually around $0.14 per 1M tokens input, $0.28 output
          const costEstimate = (usage.prompt_tokens / 1000000) * 0.14 + (usage.completion_tokens / 1000000) * 0.28;
          metricsTracker.addTokens(usage.total_tokens, costEstimate);
        }

        return {
          content: msg.content,
          reasoningContent: (msg as any).reasoning_content,
          toolCalls: msg.tool_calls,
          usage: usage ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          } : undefined,
        };

      } catch (error: any) {
        attempt++;
        metricsTracker.addRetry();
        logger.warn(`LLM Provider error (Attempt ${attempt}/${this.maxRetries}):`, error.message);
        
        if (attempt >= this.maxRetries) {
          throw new Error(`LLM Provider failed after ${this.maxRetries} attempts: ${error.message}`);
        }
        
        // Exponential backoff
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      }
    }
    throw new Error('Unexpected LLM Provider failure');
  }
}

class AnthropicProvider implements LLMProvider {
  private readonly maxRetries = 3;

  async chatComplete(request: LLMRequest): Promise<LLMResponse> {
    let attempt = 0;
    let delay = 1000;

    // Convert OpenAI messages to Anthropic format
    let systemPrompt = '';
    const anthropicMessages: any[] = [];
    
    // Process messages
    let lastRole = '';
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
      } else if (msg.role === 'tool') {
        // Anthropic expects tool results from the user
        const toolResult = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content
        };
        
        // If last message was user, append. Otherwise create new user message.
        if (anthropicMessages.length > 0 && anthropicMessages[anthropicMessages.length - 1].role === 'user') {
           const lastMsg = anthropicMessages[anthropicMessages.length - 1];
           if (Array.isArray(lastMsg.content)) {
             lastMsg.content.push(toolResult);
           } else {
             lastMsg.content = [{ type: 'text', text: lastMsg.content }, toolResult];
           }
        } else {
           anthropicMessages.push({
             role: 'user',
             content: [toolResult]
           });
        }
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        const content = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.tool_calls) {
           content.push({
             type: 'tool_use',
             id: tc.id,
             name: tc.function.name,
             input: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
           });
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else {
        anthropicMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Convert OpenAI tools to Anthropic format
    const anthropicTools = request.tools ? request.tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    })) : undefined;

    while (attempt < this.maxRetries) {
      try {
        const start = Date.now();
        const headers: any = {
          'Content-Type': 'application/json',
          'x-api-key': config.DEEPSEEK_API_KEY,
          'anthropic-version': '2023-06-01'
        };

        const body: any = {
          model: config.DEEPSEEK_MODEL || 'deepseek-chat',
          max_tokens: config.MAX_CONTEXT_TOKENS || 4096,
          messages: anthropicMessages,
        };

        if (systemPrompt) body.system = systemPrompt;
        if (anthropicTools && anthropicTools.length > 0) {
          body.tools = anthropicTools;
          body.tool_choice = { type: 'auto' };
        }

        const fetchRes = await fetch(config.DEEPSEEK_BASE_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: request.signal
        });

        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          throw new Error(`API Error ${fetchRes.status}: ${errText}`);
        }

        const response = await fetchRes.json();
        
        const executionTime = Date.now() - start;
        logger.debug(`Anthropic API call took ${executionTime}ms`);

        // Convert Anthropic response back to OpenAI format
        let textContent = '';
        const toolCalls: any[] = [];
        
        for (const block of response.content || []) {
          if (block.type === 'text') {
            textContent += block.text;
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input)
              }
            });
          }
        }

        const usage = response.usage;
        if (usage) {
          // Anthropic standard metric mapping roughly
          const promptTokens = usage.input_tokens || 0;
          const completionTokens = usage.output_tokens || 0;
          metricsTracker.addTokens(promptTokens + completionTokens, 0); // Cost estimate omitted for now
        }

        return {
          content: textContent || null,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: usage ? {
            promptTokens: usage.input_tokens || 0,
            completionTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          } : undefined,
        };

      } catch (error: any) {
        attempt++;
        metricsTracker.addRetry();
        logger.warn(`LLM Provider error (Attempt ${attempt}/${this.maxRetries}):`, error.message);
        if (attempt >= this.maxRetries) {
          throw new Error(`LLM Provider failed after ${this.maxRetries} attempts: ${error.message}`);
        }
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      }
    }
    throw new Error('Unexpected LLM Provider failure');
  }
}

// Factory to allow switching providers in the future easily
export class LLMFactory {
  static getProvider(name: string = 'deepseek'): LLMProvider {
    switch(name.toLowerCase()) {
      case 'deepseek':
      case 'openai':
        return new DeepSeekProvider();
      case 'anthropic':
      case 'openmodel':
        return new AnthropicProvider();
      default:
        throw new Error(`Unsupported LLM provider: ${name}`);
    }
  }
}

export const llmProvider = LLMFactory.getProvider(config.LLM_PROVIDER);
