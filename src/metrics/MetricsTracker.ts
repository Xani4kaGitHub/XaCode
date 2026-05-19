import { eventBus, EVENTS } from '../events/EventBus';
import fs from 'fs';
import path from 'path';

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

  private metricsFile = path.join(process.cwd(), '.xacode_metrics.json');
  private persistentMetrics = { tokenUsage: 0, apiCost: 0 };

  constructor() {
    this.setupListeners();
    this.loadPersistentMetrics();
  }

  private loadPersistentMetrics() {
    try {
      if (fs.existsSync(this.metricsFile)) {
        const data = JSON.parse(fs.readFileSync(this.metricsFile, 'utf8'));
        this.persistentMetrics.tokenUsage = data.tokenUsage || 0;
        this.persistentMetrics.apiCost = data.apiCost || 0;
      }
    } catch (e) {}
  }

  private savePersistentMetrics() {
    try {
      fs.writeFileSync(this.metricsFile, JSON.stringify(this.persistentMetrics, null, 2));
    } catch (e) {}
  }

  private setupListeners() {
    eventBus.on(EVENTS.VERIFICATION_FAILED, () => this.metrics.verificationFailures++);
    eventBus.on(EVENTS.CONTEXT_COMPRESSED, () => this.metrics.compressionFrequency++);
  }

  addTokens(count: number, costEstimate: number = 0) {
    this.metrics.tokenUsage += count;
    this.metrics.apiCost += costEstimate;
    this.persistentMetrics.tokenUsage += count;
    this.persistentMetrics.apiCost += costEstimate;
    this.savePersistentMetrics();
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

  getPersistentMetrics() {
    return this.persistentMetrics;
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
