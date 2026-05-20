import { eventBus, EVENTS } from '../events/EventBus';
import { logger } from '../logger';
import { AgentState } from './StateMachine';
import { agentOrchestrator } from './index';
export class ProtectionSystem {
  private verificationFailures = 0;
  private totalToolCalls = 0;
  private readonly MAX_VERIFICATION_FAILURES = 3;
  private readonly MAX_TOOL_CALLS_PER_TASK = 50;

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on(EVENTS.VERIFICATION_FAILED, () => {
      this.verificationFailures++;
      this.checkInstability();
    });

    eventBus.on(EVENTS.TOOL_EXECUTED, () => {
      this.totalToolCalls++;
      this.checkInstability();
    });

    eventBus.on(EVENTS.TASK_STARTED, () => {
      this.reset();
    });
  }

  private checkInstability() {
    let unstable = false;
    let reason = '';

    if (this.verificationFailures >= this.MAX_VERIFICATION_FAILURES) {
      unstable = true;
      reason = `Agent failed verification ${this.MAX_VERIFICATION_FAILURES} times in a row. Possible recursive loop.`;
    }

    if (this.totalToolCalls >= this.MAX_TOOL_CALLS_PER_TASK) {
      unstable = true;
      reason = `Agent exceeded maximum allowed tool calls (${this.MAX_TOOL_CALLS_PER_TASK}) for a single task. Runaway execution detected.`;
    }

    if (unstable) {
      logger.error(`[UNSTABLE AGENT PROTECTION TRIGGERED] ${reason}`);
      this.haltExecution(reason);
    }
  }

  private haltExecution(reason: string) {
    if (agentOrchestrator.getSession(0).stateMachine.getState() !== AgentState.FAILED && agentOrchestrator.getSession(0).stateMachine.getState() !== AgentState.STOPPED) {
      agentOrchestrator.getSession(0).stateMachine.transition(AgentState.FAILED);
      logger.error('Execution halted by Protection System. Diagnostics generated.');
      // Emit event so the orchestrator can notify the user via Telegram
      eventBus.emit(EVENTS.AGENT_STATE_CHANGED, { oldState: agentOrchestrator.getSession(0).stateMachine.getState(), newState: AgentState.FAILED, reason });
    }
  }

  reset() {
    this.verificationFailures = 0;
    this.totalToolCalls = 0;
  }
}

export const protectionSystem = new ProtectionSystem();
