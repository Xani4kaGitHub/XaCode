import { logger } from '../logger';
import { contextManager } from './ContextManager';

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
}

export class MemoryManager {
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
    contextManager.init(systemPrompt, tools);
    this.taskContext = {
      originalRequest: '',
      currentStep: 'Waiting for task',
      filesModified: [],
      status: 'idle',
    };
    logger.info('Session memory reset.');
  }

  addMessage(message: ChatMessage) {
    contextManager.addMessage(message);
  }

  getHistory(): ChatMessage[] {
    return contextManager.getMessagesForLLM();
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

export const memoryManager = new MemoryManager();
