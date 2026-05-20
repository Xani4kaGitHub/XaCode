import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { logger } from '../logger';
import { config } from '../config';
import { securityManager } from '../security';
import { permissionSystem } from '../security/PermissionSystem';

export class TerminalManager {
  private activeProcesses: Map<string, ChildProcessWithoutNullStreams> = new Map();

  getActiveProcessesCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Executes a command with a timeout and returns its output.
   */
  async runCommand(command: string, cwd: string = config.SANDBOX_DIR): Promise<{ stdout: string, stderr: string, code: number }> {
    if (!permissionSystem.canExecute(command)) {
      throw new Error(`Command rejected by Permission System: ${command}. Type /fullaccess enable to run dangerous commands.`);
    }

    if (!permissionSystem.isFullAccess() && !securityManager.isPathAllowed(cwd)) {
      throw new Error(`Execution outside sandbox is forbidden: ${cwd}. Type /fullaccess enable to allow.`);
    }

    logger.info(`Executing command: ${command}`, { cwd });

    return new Promise((resolve, reject) => {
      // Using ulimit on Linux to enforce resource limits:
      // -t 60: Max CPU time in seconds
      // -v 1048576: Max virtual memory in KB (1GB)
      // -u 100: Max processes
      const resourceLimits = process.platform === 'win32' ? '' : 'ulimit -t 60 -v 1048576 -u 100; ';
      
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
      const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', `${resourceLimits}${command}`];

      // Use detached: true on non-Windows to create a new process group for clean killing of descendants
      const isWin = process.platform === 'win32';
      const child = spawn(shell, shellArgs, { cwd, detached: !isWin });
      const processId = child.pid?.toString() || Math.random().toString();
      this.activeProcesses.set(processId, child);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        // Truncate on the fly to prevent massive memory usage
        if (stdout.length > 10000) stdout = stdout.slice(-8000);
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 10000) stderr = stderr.slice(-8000);
      });

      const timeoutId = setTimeout(() => {
        if (this.activeProcesses.has(processId)) {
          logger.warn(`Command timed out after ${config.MAX_EXECUTION_TIMEOUT_MS}ms: ${command}`);
          this.killChildSafely(child, isWin);
          resolve({ stdout, stderr: stderr + '\n[TIMEOUT KILLED]', code: 124 });
          this.activeProcesses.delete(processId);
        }
      }, config.MAX_EXECUTION_TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(processId);
        resolve({ stdout: stdout.slice(-8000), stderr: stderr.slice(-8000), code: code ?? 1 });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(processId);
        reject(err);
      });
    });
  }

  killAll() {
    const isWin = process.platform === 'win32';
    for (const [pid, child] of this.activeProcesses.entries()) {
      this.killChildSafely(child, isWin);
      this.activeProcesses.delete(pid);
    }
  }

  private killChildSafely(child: ChildProcessWithoutNullStreams, isWin: boolean) {
    try {
      if (!isWin && child.pid) {
        // Kill the entire process group
        process.kill(-child.pid, 'SIGKILL');
      } else {
        child.kill('SIGKILL');
      }
    } catch (e: any) {
      logger.error(`Error killing process ${child.pid}: ${e.message}`);
    }
  }
}

export const terminalManager = new TerminalManager();
