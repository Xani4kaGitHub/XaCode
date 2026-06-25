import { config } from '../config';
import path from 'path';

export class SecurityManager {
  private allowedUserIds: Set<number>;
  private sandboxDir: string;

  constructor() {
    this.allowedUserIds = new Set(config.ALLOWED_USER_IDS);
    this.sandboxDir = path.resolve(config.SANDBOX_DIR);
  }

  setSandboxDir(dir: string) {
    this.sandboxDir = path.resolve(dir);
  }

  /**
   * Validates if a user is allowed to interact with the bot.
   */
  isUserAllowed(userId: number): boolean {
    if (this.allowedUserIds.size === 0) return true; // If empty, allow anyone (for debugging, but we warn in config)
    return this.allowedUserIds.has(userId);
  }

  /**
   * Ensures the given file path is within the sandbox directory.
   */
  isPathAllowed(targetPath: string): boolean {
    const resolvedPath = path.resolve(targetPath);
    // Ensure the path is exactly the sandbox dir or is inside it
    if (resolvedPath === this.sandboxDir) return true;
    return resolvedPath.startsWith(this.sandboxDir + path.sep);
  }

  /**
   * Validates if a shell command is safe to run.
   */
  isCommandAllowed(command: string): boolean {
    const lowerCmd = command.toLowerCase().trim();
    
    // Blacklisted commands
    const blacklisted = [
      'rm -rf /',
      'mkfs',
      'dd if=',
      ':(){ :|:& };:', // fork bomb
      '> /dev/sda'
    ];

    for (const b of blacklisted) {
      if (lowerCmd.includes(b)) {
        return false;
      }
    }

    return true;
  }
}

export const securityManager = new SecurityManager();
