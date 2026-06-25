type EventCallback = (payload: any) => Promise<void> | void;

export class EventBus {
  private listeners: Map<string, EventCallback[]> = new Map();

  on(event: string, callback: EventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: EventCallback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      this.listeners.set(event, callbacks.filter(cb => cb !== callback));
    }
  }

  async emit(event: string, payload?: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          await cb(payload);
        } catch (error) {
          const { logger } = require('../logger');
          logger.error(`Error in event listener for ${event}:`, error);
        }
      }
    }
  }
}

export const eventBus = new EventBus();

// Core Events
export const EVENTS = {
  TASK_STARTED: 'task.started',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TOOL_EXECUTED: 'tool.executed',
  VERIFICATION_FAILED: 'verification.failed',
  CONTEXT_COMPRESSED: 'context.compressed',
  WORKSPACE_CHANGED: 'workspace.changed',
  PROCESS_STARTED: 'process.started',
  PROCESS_STOPPED: 'process.stopped',
  AGENT_STATE_CHANGED: 'agent.state.changed',
  PROTECTION_HALT_EXECUTION: 'protection.halt.execution',
};
