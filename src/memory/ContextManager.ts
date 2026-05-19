import { tokenizer } from './Tokenizer';
import { logger } from '../logger';
import { eventBus, EVENTS } from '../events/EventBus';
import { llmProvider } from '../llm/Provider';

export interface MemoryConfig {
  maxContextTokens: number;
  compressionThresholdPercent: number;
  summaryMaxTokens: number;
}

export class ContextManager {
  private config: MemoryConfig = {
    maxContextTokens: 32000,
    compressionThresholdPercent: 0.85,
    summaryMaxTokens: 2000,
  };

  private shortTermHistory: any[] = [];
  private summarizedMemory: string = '';
  private executionMemory: any = {};
  private systemPrompt: any = null;
  private toolSchemas: any[] = [];

  constructor() {}

  init(systemContent: string, tools: any[]) {
    this.systemPrompt = { role: 'system', content: systemContent };
    this.toolSchemas = tools;
    this.shortTermHistory = [];
    this.summarizedMemory = '';
  }

  addMessage(msg: any) {
    this.shortTermHistory.push(msg);
    this.checkAndCompress();
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
    const threshold = this.config.maxContextTokens * this.config.compressionThresholdPercent;

    if (currentTokens > threshold) {
      logger.warn(`Context window at ${Math.round((currentTokens / this.config.maxContextTokens) * 100)}%. Triggering compression.`);
      await this.compressMemory();
    }
  }

  private async compressMemory() {
    eventBus.emit(EVENTS.CONTEXT_COMPRESSED);

    // Keep the last N messages that are highly relevant (execution state, errors)
    // and summarize the rest.
    const messagesToSummarize = this.shortTermHistory.slice(0, -10); // Keep last 10
    const messagesToKeep = this.shortTermHistory.slice(-10);

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
      maxTokens: this.config.maxContextTokens,
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

export const contextManager = new ContextManager();
