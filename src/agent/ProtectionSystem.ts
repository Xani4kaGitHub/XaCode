import { eventBus, EVENTS } from '../events/EventBus';
import { logger } from '../logger';
import { AgentState } from './StateMachine';

export class ProtectionSystem {
  private verificationFailures = new Map<number, number>();
  private totalToolCalls = new Map<number, number>();
  private readonly MAX_VERIFICATION_FAILURES = 3;
  private readonly MAX_TOOL_CALLS_PER_TASK = 50;

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on(EVENTS.VERIFICATION_FAILED, (payload: any) => {
      const chatId = payload?.chatId;
      if (chatId === undefined) return;
      const fails = (this.verificationFailures.get(chatId) || 0) + 1;
      this.verificationFailures.set(chatId, fails);
      this.checkInstability(chatId);
    });

    eventBus.on(EVENTS.TOOL_EXECUTED, (payload: any) => {
      const chatId = payload?.chatId;
      if (chatId === undefined) return;
      const calls = (this.totalToolCalls.get(chatId) || 0) + 1;
      this.totalToolCalls.set(chatId, calls);
      this.checkInstability(chatId);
    });

    eventBus.on(EVENTS.TASK_STARTED, (payload: any) => {
      const chatId = payload?.chatId;
      if (chatId === undefined) return;
      this.reset(chatId);
    });
  }

  private checkInstability(chatId: number) {
    let unstable = false;
    let reason = '';

    const vFails = this.verificationFailures.get(chatId) || 0;
    if (vFails >= this.MAX_VERIFICATION_FAILURES) {
      unstable = true;
      reason = `Agent failed verification ${this.MAX_VERIFICATION_FAILURES} times in a row. Possible recursive loop.`;
    }

    const tCalls = this.totalToolCalls.get(chatId) || 0;
    if (tCalls >= this.MAX_TOOL_CALLS_PER_TASK) {
      unstable = true;
      reason = `Agent exceeded maximum allowed tool calls (${this.MAX_TOOL_CALLS_PER_TASK}) for a single task. Runaway execution detected.`;
    }

    if (unstable) {
      logger.error(`[UNSTABLE AGENT PROTECTION TRIGGERED for Chat ${chatId}] ${reason}`);
      this.haltExecution(chatId, reason);
    }
  }

  private haltExecution(chatId: number, reason: string) {
    logger.error(`Execution halted by Protection System for chat ${chatId}. Diagnostics generated.`);
    eventBus.emit(EVENTS.PROTECTION_HALT_EXECUTION, { chatId, reason });
  }

  reset(chatId: number) {
    this.verificationFailures.set(chatId, 0);
    this.totalToolCalls.set(chatId, 0);
  }
}

export const protectionSystem = new ProtectionSystem();
