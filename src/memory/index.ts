import { logger } from '../logger';
import { ContextManager } from './ContextManager';

export interface TaskContext {
  originalRequest: string;
  currentStep: string;
  filesModified: string[];
  status: 'idle' | 'running' | 'completed' | 'error';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export class MemoryManager {
  public contextManager: ContextManager;

  constructor() {
    this.contextManager = new ContextManager();
  }

  private taskContext: TaskContext = {
    originalRequest: '',
    currentStep: 'Waiting for task',
    filesModified: [],
    status: 'idle',
  };

  /**
   * Initializes a new session, clearing past history but keeping system prompts.
   */
  resetSession(systemPrompt: string, tools: any[] = []) {
    this.contextManager.init(systemPrompt, tools);
    this.taskContext = {
      originalRequest: '',
      currentStep: 'Waiting for task',
      filesModified: [],
      status: 'idle',
    };
    logger.info('Session memory reset.');
  }

  addMessage(message: ChatMessage) {
    this.contextManager.addMessage(message);
  }

  async ensureCompressed() {
    await this.contextManager.ensureCompressed();
  }

  getHistory(): ChatMessage[] {
    return this.contextManager.getMessagesForLLM();
  }

  setTask(request: string) {
    this.taskContext.originalRequest = request;
    this.taskContext.status = 'running';
    this.taskContext.currentStep = 'Analyzing task';
  }

  updateStep(step: string) {
    this.taskContext.currentStep = step;
  }

  addModifiedFile(file: string) {
    if (!this.taskContext.filesModified.includes(file)) {
      this.taskContext.filesModified.push(file);
    }
  }

  completeTask() {
    this.taskContext.status = 'completed';
    this.taskContext.currentStep = 'Task completed successfully.';
  }

  failTask() {
    this.taskContext.status = 'error';
  }

  getTaskContext(): TaskContext {
    return this.taskContext;
  }
}

// Removed singleton export
