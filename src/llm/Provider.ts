import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../logger';
import { metricsTracker } from '../metrics/MetricsTracker';

export interface LLMRequest {
  messages: any[];
  tools?: any[];
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

// Factory to allow switching providers in the future easily
export class LLMFactory {
  static getProvider(name: string = 'deepseek'): LLMProvider {
    switch(name.toLowerCase()) {
      case 'deepseek':
        return new DeepSeekProvider();
      // case 'openai': return new OpenAIProvider();
      // case 'anthropic': return new AnthropicProvider();
      default:
        throw new Error(`Unsupported LLM provider: ${name}`);
    }
  }
}

export const llmProvider = LLMFactory.getProvider('deepseek');
