import { eventBus, EVENTS } from '../events/EventBus';
import { logger } from '../logger';

export enum RiskLevel {
  SAFE = 'SAFE',
  MODERATE = 'MODERATE',
  DANGEROUS = 'DANGEROUS',
  BLOCKED = 'BLOCKED',
}

export class PermissionSystem {
  private fullAccessEnabled: boolean = false;
  private fullAccessTimeout: NodeJS.Timeout | null = null;
  private fullAccessExpiry: number = 0;
  private readonly FULL_ACCESS_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  enableFullAccess(durationMs?: number) {
    this.fullAccessEnabled = true;
    const duration = durationMs ?? this.FULL_ACCESS_DURATION_MS;
    this.fullAccessExpiry = Date.now() + duration;
    logger.warn(`!!! FULL ACCESS MODE ENABLED !!!`);
    
    if (this.fullAccessTimeout) clearTimeout(this.fullAccessTimeout);
    
    this.fullAccessTimeout = setTimeout(() => {
      this.disableFullAccess();
    }, duration);
  }

  disableFullAccess() {
    this.fullAccessEnabled = false;
    this.fullAccessExpiry = 0;
    logger.info('Full Access Mode disabled.');
    if (this.fullAccessTimeout) {
      clearTimeout(this.fullAccessTimeout);
      this.fullAccessTimeout = null;
    }
  }

  isFullAccess(): boolean {
    return this.fullAccessEnabled;
  }

  getFullAccessRemainingMinutes(): number {
    if (!this.fullAccessEnabled) return 0;
    const remaining = this.fullAccessExpiry - Date.now();
    return Math.max(0, Math.round(remaining / 1000 / 60));
  }

  assessCommandRisk(command: string): RiskLevel {
    const cmd = command.toLowerCase().trim();
    
    const blockedPatterns = ['mkfs', 'dd if=', ':(){ :|:& };:', '> /dev/sda'];
    for (const p of blockedPatterns) {
      if (cmd.includes(p)) return RiskLevel.BLOCKED;
    }

    const dangerousPatterns = ['rm -rf', 'chmod', 'chown', 'iptables', 'ufw', 'systemctl'];
    for (const p of dangerousPatterns) {
      if (cmd.includes(p)) return RiskLevel.DANGEROUS;
    }

    const moderatePatterns = ['npm install', 'apt-get', 'pip install', 'curl', 'wget'];
    for (const p of moderatePatterns) {
      if (cmd.includes(p)) return RiskLevel.MODERATE;
    }

    return RiskLevel.SAFE;
  }

  canExecute(command: string): boolean {
    const risk = this.assessCommandRisk(command);
    
    if (risk === RiskLevel.BLOCKED) {
      logger.error(`Blocked command execution attempt: ${command}`);
      return false;
    }

    if (risk === RiskLevel.DANGEROUS && !this.fullAccessEnabled) {
      logger.warn(`Rejected DANGEROUS command (Full Access required): ${command}`);
      return false;
    }

    if (risk === RiskLevel.DANGEROUS && this.fullAccessEnabled) {
      // Extensive audit logging for privileged actions
      logger.warn(`[AUDIT] EXECUTING DANGEROUS COMMAND: ${command}`);
    }

    return true;
  }
}

export const permissionSystem = new PermissionSystem();
