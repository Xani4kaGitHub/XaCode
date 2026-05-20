import { eventBus, EVENTS } from '../events/EventBus';
import { logger } from '../logger';

export enum AgentState {
  IDLE = 'IDLE',
  ANALYZING_TASK = 'ANALYZING_TASK',
  RESEARCHING_PROJECT = 'RESEARCHING_PROJECT',
  PLANNING = 'PLANNING',
  EXECUTING = 'EXECUTING',
  VERIFYING = 'VERIFYING',
  REPORTING = 'REPORTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  STOPPED = 'STOPPED',
}

const validTransitions: Record<AgentState, AgentState[]> = {
  [AgentState.IDLE]: [AgentState.ANALYZING_TASK, AgentState.STOPPED],
  [AgentState.ANALYZING_TASK]: [AgentState.RESEARCHING_PROJECT, AgentState.PLANNING, AgentState.COMPLETED, AgentState.FAILED, AgentState.STOPPED, AgentState.IDLE],
  [AgentState.RESEARCHING_PROJECT]: [AgentState.PLANNING, AgentState.COMPLETED, AgentState.FAILED, AgentState.STOPPED, AgentState.IDLE],
  [AgentState.PLANNING]: [AgentState.EXECUTING, AgentState.COMPLETED, AgentState.FAILED, AgentState.STOPPED, AgentState.IDLE],
  [AgentState.EXECUTING]: [AgentState.VERIFYING, AgentState.COMPLETED, AgentState.FAILED, AgentState.STOPPED, AgentState.IDLE],
  [AgentState.VERIFYING]: [AgentState.REPORTING, AgentState.EXECUTING, AgentState.COMPLETED, AgentState.FAILED, AgentState.STOPPED, AgentState.IDLE], // Loop back to EXECUTING if verification fails and we retry
  [AgentState.REPORTING]: [AgentState.COMPLETED, AgentState.FAILED, AgentState.STOPPED, AgentState.IDLE],
  [AgentState.COMPLETED]: [AgentState.IDLE],
  [AgentState.FAILED]: [AgentState.IDLE],
  [AgentState.STOPPED]: [AgentState.IDLE],
};

export class StateMachine {
  private currentState: AgentState = AgentState.IDLE;
  private stateHistory: AgentState[] = [];

  transition(newState: AgentState) {
    const allowed = validTransitions[this.currentState];
    if (!allowed.includes(newState)) {
      const errorMsg = `Invalid state transition from ${this.currentState} to ${newState}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    logger.info(`State Transition: ${this.currentState} -> ${newState}`);
    this.stateHistory.push(this.currentState);
    
    // Prevent recursive loops by checking history
    this.detectLoops(newState);

    this.currentState = newState;
    eventBus.emit(EVENTS.AGENT_STATE_CHANGED, { oldState: this.stateHistory[this.stateHistory.length - 1], newState });
  }

  private detectLoops(newState: AgentState) {
    if (this.stateHistory.length > 20) {
      // Basic recursive loop detection: EXECUTING -> VERIFYING -> EXECUTING repeatedly
      const recent = this.stateHistory.slice(-10);
      const executeCount = recent.filter(s => s === AgentState.EXECUTING).length;
      if (executeCount > 5) {
        logger.warn('Unstable Agent Detected: Repeated execution/verification loops.');
        // The orchestrator should catch this and trigger FAILED/STOPPED
      }
    }
  }

  getState() {
    return this.currentState;
  }

  reset() {
    this.currentState = AgentState.IDLE;
    this.stateHistory = [];
  }
}

export const agentStateMachine = new StateMachine();
