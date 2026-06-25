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

export interface StructuredMemory {
  goal: string;
  filesCreated: string[];
  filesRead: string[];
  errors: { tool: string; summary: string }[];
  discoveries: string[];
  decisions: string[];
}

function isErrorContent(content: string): boolean {
  return /error|failed|ENOENT|EACCES|SyntaxError|TypeError/i.test(content?.slice(0, 200) || '');
}

export class ContextManager {
  private config: MemoryConfig;

  constructor() {
    this.config = {
      maxContextTokens: 32000,
      compressionThresholdPercent: 0.85,
      summaryMaxTokens: 2000,
    };
  }

  private shortTermHistory: any[] = [];
  private summarizedMemory: string = '';
  private executionMemory: any = {};
  private systemPrompt: any = null;
  private toolSchemas: any[] = [];
  private memory: StructuredMemory = {
    goal: '',
    filesCreated: [],
    filesRead: [],
    errors: [],
    discoveries: [],
    decisions: []
  };

  init(systemContent: string, tools: any[]) {
    this.systemPrompt = { role: 'system', content: systemContent };
    this.toolSchemas = tools;
    this.shortTermHistory = [];
    this.summarizedMemory = '';
    this.memory = {
      goal: '',
      filesCreated: [],
      filesRead: [],
      errors: [],
      discoveries: [],
      decisions: []
    };
  }

  getStructuredMemory(): StructuredMemory {
    return this.memory;
  }

  setTask(task: string) {
    this.memory.goal = task;
  }

  addMessage(msg: any) {
    if (appConfig.SMART_MEMORY_MODE) {
      if (msg.role === 'tool' && msg.content?.length > 6000) {
        msg = { ...msg, content: msg.content.slice(0, 6000) + '\n[...truncated]' };
      }

      const predicted = this.getCurrentTokenUsage() + tokenizer.estimateTokenCount(msg.content || '');
      if (predicted > (appConfig.MAX_CONTEXT_TOKENS || 32000) * 0.95 && this.shortTermHistory.length > 3) {
        this.trimOneExchange(this.shortTermHistory);
      }
    }

    this.shortTermHistory.push(msg);
    this.updateMemory(msg);
  }

  async ensureCompressed() {
    if (!appConfig.SMART_MEMORY_MODE) {
      await this.checkAndCompress();
    }
  }

  private updateMemory(msg: any) {
    if (msg.role === 'tool') {
      const args = typeof msg.name === 'string' ? msg : undefined; // we actually don't have args in tool result easily unless we parse, wait, in OpenAI format the msg.role='tool' doesn't have args, only tool_call_id and content. The args are in the assistant's tool_calls.
      // But we can extract path from content or if we pass the original request.
      // Let's just do a basic implementation or rely on what we can.
      // If we don't have args here easily, let's just use regex on content or try to parse.
      
      // For now, let's just log errors
      if (isErrorContent(msg.content)) {
        this.memory.errors.push({ 
          tool: msg.name || 'tool', 
          summary: msg.content.split('\n')[0].slice(0, 150) 
        });
      }
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      // In OpenAI format, assistant role contains tool_calls with function.arguments
      for (const call of msg.tool_calls) {
        if (['write_file', 'edit_file', 'apply_patch'].includes(call.function?.name)) {
          try {
            const args = JSON.parse(call.function.arguments);
            const path = args.targetPath;
            if (path && !this.memory.filesCreated.includes(path)) {
              this.memory.filesCreated.push(path);
            }
          } catch (e) {}
        }
        if (['read_file', 'read_files'].includes(call.function?.name)) {
          try {
            const args = JSON.parse(call.function.arguments);
            const paths = args.targetPath ? [args.targetPath] : (args.paths || []);
            for (const p of paths) {
              if (p && !this.memory.filesRead.includes(p)) {
                this.memory.filesRead.push(p);
              }
            }
          } catch (e) {}
        }
      }
    }
  }

  formatMemory(): string {
    const parts: string[] = [];
    if (this.memory.goal) parts.push(`🎯 Task: ${this.memory.goal}`);
    if (this.memory.filesCreated.length) parts.push(`📁 Created/Edited: ${this.memory.filesCreated.join(', ')}`);
    if (this.memory.filesRead.length) parts.push(`📖 Read: ${this.memory.filesRead.join(', ')}`);
    if (this.memory.errors.length) parts.push(`❌ Errors: ${this.memory.errors.map(e => `${e.tool}: ${e.summary}`).join('; ')}`);
    if (this.memory.decisions.length) parts.push(`🧭 Decisions: ${this.memory.decisions.join('; ')}`);
    if (this.memory.discoveries.length) parts.push(`💡 Discoveries: ${this.memory.discoveries.join('; ')}`);
    return parts.length ? '[CONTEXT MEMORY]\n' + parts.join('\n') : '';
  }

  getMessagesForLLM(): any[] {
    if (!appConfig.SMART_MEMORY_MODE) {
      const messages = [];
      if (this.systemPrompt) messages.push(this.systemPrompt);
      if (this.summarizedMemory) {
        messages.push({ role: 'system', content: `Previous Context Summary:\n${this.summarizedMemory}` });
      }
      messages.push(...this.shortTermHistory);
      return messages;
    }

    const MAX_TOKENS = appConfig.MAX_CONTEXT_TOKENS || 32000;
    const messages: any[] = [];
    
    if (this.systemPrompt) messages.push(this.systemPrompt);
    
    const memStr = this.formatMemory();
    if (memStr) messages.push({ role: 'system', content: memStr });
    
    const window = this.getSmartWindow();
    messages.push(...window);
    
    while (tokenizer.estimateMessagesTokenCount(messages) > MAX_TOKENS * 0.9 && messages.length > 3) {
      this.trimOneExchange(messages);
    }
    
    return messages;
  }

  private getSmartWindow(): any[] {
    const result: any[] = [];
    let userTurns = 0;
    
    for (let i = this.shortTermHistory.length - 1; i >= 0 && userTurns < 3; i--) {
      const msg = this.shortTermHistory[i];
      result.unshift(msg);
      if (msg.role === 'user') userTurns++;
    }
    
    return result;
  }

  getFullHistory(): any[] {
    const messages = [];
    if (this.systemPrompt) messages.push(this.systemPrompt);
    messages.push(...this.shortTermHistory);
    return messages;
  }

  private trimOneExchange(messages: any[]) {
    // Find the first user message after system prompts and remove it and its responses up to the next user message
    let startIndex = -1;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        startIndex = i;
        break;
      }
    }
    
    if (startIndex !== -1) {
      let endIndex = startIndex + 1;
      while (endIndex < messages.length && messages[endIndex].role !== 'user') {
        endIndex++;
      }
      messages.splice(startIndex, endIndex - startIndex);
    } else if (messages.length > 2) {
      // Just pop the oldest non-system message if no user message found
      messages.splice(1, 1);
    }
  }

  getCurrentTokenUsage(): number {
    const msgs = this.getMessagesForLLM();
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

    let splitIndex = Math.max(0, this.shortTermHistory.length - 10);
    
    while (splitIndex > 0 && splitIndex < this.shortTermHistory.length) {
      const msg = this.shortTermHistory[splitIndex];
      if (msg.role === 'tool') {
        splitIndex--;
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        break;
      } else {
        break;
      }
    }

    const messagesToSummarize = this.shortTermHistory.slice(0, splitIndex);
    const messagesToKeep = this.shortTermHistory.slice(splitIndex);

    if (messagesToSummarize.length === 0) return;

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
      hasSummary: !!this.formatMemory()
    };
  }

  reset() {
    this.shortTermHistory = [];
    this.summarizedMemory = '';
    this.memory = {
      goal: '',
      filesCreated: [],
      filesRead: [],
      errors: [],
      discoveries: [],
      decisions: []
    };
    this.executionMemory = {};
  }
}

// Removed singleton export
