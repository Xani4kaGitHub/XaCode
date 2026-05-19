import { logger } from '../logger';

export interface TaskContext {
  originalRequest: string;
  currentStep: string;
  filesModified: string[];
  status: 'idle' | 'running' | 'completed' | 'error';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string; // used for tool names
  tool_calls?: any[]; // For DeepSeek
  tool_call_id?: string;
}

export class MemoryManager {
  private history: ChatMessage[] = [];
  private taskContext: TaskContext = {
    originalRequest: '',
    currentStep: 'Waiting for task',
    filesModified: [],
    status: 'idle',
  };

  /**
   * Initializes a new session, clearing past history but keeping system prompts.
   */
  resetSession(systemPrompt: string) {
    this.history = [{ role: 'system', content: systemPrompt }];
    this.taskContext = {
      originalRequest: '',
      currentStep: 'Waiting for task',
      filesModified: [],
      status: 'idle',
    };
    logger.info('Session memory reset.');
  }

  addMessage(message: ChatMessage) {
    this.history.push(message);
    // Keep history from growing indefinitely (optional, basic truncation)
    if (this.history.length > 50) {
      // keep system prompt (index 0) and remove oldest messages
      this.history.splice(1, 10);
    }
  }

  getHistory(): ChatMessage[] {
    return this.history;
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
