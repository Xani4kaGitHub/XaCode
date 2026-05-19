import { logger } from '../logger';

export class LockManager {
  private fileLocks: Set<string> = new Set();
  private workspaceLocked: boolean = false;

  acquireWorkspaceLock(): boolean {
    if (this.workspaceLocked) {
      logger.warn('Failed to acquire workspace lock (already locked)');
      return false;
    }
    this.workspaceLocked = true;
    return true;
  }

  releaseWorkspaceLock() {
    this.workspaceLocked = false;
  }

  acquireFileLock(filePath: string): boolean {
    if (this.fileLocks.has(filePath)) {
      logger.warn(`Failed to acquire lock for file: ${filePath}`);
      return false;
    }
    this.fileLocks.add(filePath);
    return true;
  }

  releaseFileLock(filePath: string) {
    this.fileLocks.delete(filePath);
  }

  isWorkspaceLocked(): boolean {
    return this.workspaceLocked;
  }
}

export const lockManager = new LockManager();
