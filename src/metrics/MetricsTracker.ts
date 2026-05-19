import { eventBus, EVENTS } from '../events/EventBus';

export interface Metrics {
  tokenUsage: number;
  apiCost: number;
  totalExecutionTimeMs: number;
  retryCount: number;
  compressionFrequency: number;
  verificationFailures: number;
  stuckLoopDetections: number;
}

export class MetricsTracker {
  private metrics: Metrics = {
    tokenUsage: 0,
    apiCost: 0,
    totalExecutionTimeMs: 0,
    retryCount: 0,
    compressionFrequency: 0,
    verificationFailures: 0,
    stuckLoopDetections: 0,
  };

  private startTime: number = Date.now();

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on(EVENTS.VERIFICATION_FAILED, () => this.metrics.verificationFailures++);
    eventBus.on(EVENTS.CONTEXT_COMPRESSED, () => this.metrics.compressionFrequency++);
  }

  addTokens(count: number, costEstimate: number = 0) {
    this.metrics.tokenUsage += count;
    this.metrics.apiCost += costEstimate;
  }

  addRetry() {
    this.metrics.retryCount++;
  }

  addStuckLoop() {
    this.metrics.stuckLoopDetections++;
  }

  getMetrics(): Metrics & { uptimeMs: number } {
    return {
      ...this.metrics,
      uptimeMs: Date.now() - this.startTime,
    };
  }

  reset() {
    this.metrics = {
      tokenUsage: 0,
      apiCost: 0,
      totalExecutionTimeMs: 0,
      retryCount: 0,
      compressionFrequency: 0,
      verificationFailures: 0,
      stuckLoopDetections: 0,
    };
    this.startTime = Date.now();
  }
}

export const metricsTracker = new MetricsTracker();
