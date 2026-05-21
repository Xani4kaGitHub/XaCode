import { tokenizer } from './Tokenizer';
import { logger } from '../logger';
import { eventBus, EVENTS } from '../events/EventBus';
import { llmProvider } from '../llm/Provider';
import { config as appConfig } from '../config';

export interface MemoryConfig {
  maxContextTokens: number;
  compressionThresholdPercent: number;
  summaryMaxTokens: number;
}

export class ContextManager {
  private config: MemoryConfig;

  constructor() {
    this.config = {
      maxContextTokens: 32000, // Fallback, we will use appConfig directly
      compressionThresholdPercent: 0.85,
      summaryMaxTokens: 2000,
    };
  }

  private shortTermHistory: any[] = [];
  private summarizedMemory: string = '';
  private executionMemory: any = {};
  private systemPrompt: any = null;
  private toolSchemas: any[] = [];

  init(systemContent: string, tools: any[]) {
    this.systemPrompt = { role: 'system', content: systemContent };
    this.toolSchemas = tools;
    this.shortTermHistory = [];
    this.summarizedMemory = '';
  }

  addMessage(msg: any) {
    this.shortTermHistory.push(msg);
  }

  async ensureCompressed() {
    await this.checkAndCompress();
  }

  getMessagesForLLM(): any[] {
    const messages = [];
    if (this.systemPrompt) messages.push(this.systemPrompt);
    if (this.summarizedMemory) {
      messages.push({ role: 'system', content: `Previous Context Summary:\n${this.summarizedMemory}` });
    }
    messages.push(...this.shortTermHistory);
    return messages;
  }

  getCurrentTokenUsage(): number {
    const msgs = this.getMessagesForLLM();
    // Add overhead of tool schemas
    const toolsTokenEstimate = tokenizer.estimateTokenCount(JSON.stringify(this.toolSchemas));
    return tokenizer.estimateMessagesTokenCount(msgs) + toolsTokenEstimate;
  }

  private async checkAndCompress() {
    const currentTokens = this.getCurrentTokenUsage();
    const maxTokens = appConfig.MAX_CONTEXT_TOKENS || 32000;
    const threshold = maxTokens * this.config.compressionThresholdPercent;

    if (currentTokens > threshold) {
      logger.warn(`Context window at ${Math.round((currentTokens / maxTokens) * 100)}%. Triggering compression.`);
      await this.compressMemory();
    }
  }

  private async compressMemory() {
    eventBus.emit(EVENTS.CONTEXT_COMPRESSED);

    // Determine safe split index (keep ~10 messages, but don't split tools)
    let splitIndex = Math.max(0, this.shortTermHistory.length - 10);
    
    // Walk backward to ensure we don't split a tool call from its response
    while (splitIndex > 0 && splitIndex < this.shortTermHistory.length) {
      const msg = this.shortTermHistory[splitIndex];
      // If the current message is a tool result, we MUST include the assistant message that called it
      if (msg.role === 'tool') {
        splitIndex--;
      } 
      // If the current message is an assistant with tool_calls, we MUST include it (which we do if we stop here)
      else if (msg.role === 'assistant' && msg.tool_calls) {
        break; // Safe boundary, the tool calls are kept, and the preceding messages can be summarized
      } 
      else {
        break; // Safe boundary
      }
    }

    const messagesToSummarize = this.shortTermHistory.slice(0, splitIndex);
    const messagesToKeep = this.shortTermHistory.slice(splitIndex);

    if (messagesToSummarize.length === 0) return; // Nothing to compress

    const summaryPrompt = `You are a memory compressor. Summarize the following conversation history. 
Focus on: active goals, architectural decisions, recent errors, and modified files.
Make it concise. Previous summary: ${this.summarizedMemory}`;

    try {
      const response = await llmProvider.chatComplete({
        messages: [
          { role: 'system', content: summaryPrompt },
          ...messagesToSummarize
        ]
      });

      if (response.content) {
        this.summarizedMemory = response.content;
        this.shortTermHistory = messagesToKeep;
        logger.info('Memory compressed successfully.');
      }
    } catch (e: any) {
      logger.error('Failed to compress memory:', e.message);
    }
  }

  getMemoryStats() {
    return {
      usageTokens: this.getCurrentTokenUsage(),
      maxTokens: appConfig.MAX_CONTEXT_TOKENS || 32000,
      historyLength: this.shortTermHistory.length,
      hasSummary: !!this.summarizedMemory
    };
  }

  reset() {
    this.shortTermHistory = [];
    this.summarizedMemory = '';
    this.executionMemory = {};
  }
}

// Removed singleton export
