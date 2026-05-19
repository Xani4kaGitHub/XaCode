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
  private readonly FULL_ACCESS_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  enableFullAccess() {
    this.fullAccessEnabled = true;
    logger.warn('!!! FULL ACCESS MODE ENABLED !!!');
    
    if (this.fullAccessTimeout) clearTimeout(this.fullAccessTimeout);
    
    this.fullAccessTimeout = setTimeout(() => {
      this.disableFullAccess();
    }, this.FULL_ACCESS_DURATION_MS);
  }

  disableFullAccess() {
    this.fullAccessEnabled = false;
    logger.info('Full Access Mode disabled.');
    if (this.fullAccessTimeout) {
      clearTimeout(this.fullAccessTimeout);
      this.fullAccessTimeout = null;
    }
  }

  isFullAccess(): boolean {
    return this.fullAccessEnabled;
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
