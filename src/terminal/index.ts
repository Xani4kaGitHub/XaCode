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

    logger.info(`[Terminal] Executing command: "${command}" in directory: ${cwd}`);

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
      let stdoutLineBuffer = '';
      let stderrLineBuffer = '';

      child.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        if (stdout.length > 32000) stdout = stdout.slice(-30000);

        stdoutLineBuffer += str;
        const lines = stdoutLineBuffer.split('\n');
        stdoutLineBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            logger.info(`[Terminal Live Out] ${line.trim()}`);
          }
        }
      });

      child.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        if (stderr.length > 32000) stderr = stderr.slice(-30000);

        stderrLineBuffer += str;
        const lines = stderrLineBuffer.split('\n');
        stderrLineBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            logger.warn(`[Terminal Live Err] ${line.trim()}`);
          }
        }
      });

      let hasFinished = false;
      const finish = (exitCode: number, outStr: string, errStr: string, isTimeout = false) => {
        if (hasFinished) return;
        hasFinished = true;

        if (stdoutLineBuffer.trim()) {
          logger.info(`[Terminal Live Out] ${stdoutLineBuffer.trim()}`);
        }
        if (stderrLineBuffer.trim()) {
          logger.warn(`[Terminal Live Err] ${stderrLineBuffer.trim()}`);
        }
        
        const finalStdout = outStr.slice(-30000);
        const finalStderr = errStr.slice(-30000);
        
        if (isTimeout) {
          logger.warn(`[Terminal] Command timed out after ${config.MAX_EXECUTION_TIMEOUT_MS}ms: "${command}"`);
        } else {
          logger.info(`[Terminal] Command "${command}" exited with code ${exitCode}`);
        }
        
        resolve({ stdout: finalStdout, stderr: finalStderr, code: exitCode });
      };

      const timeoutId = setTimeout(() => {
        if (this.activeProcesses.has(processId)) {
          this.killChildSafely(child, isWin);
          finish(124, stdout, stderr + '\n[TIMEOUT KILLED]', true);
          this.activeProcesses.delete(processId);
        }
      }, config.MAX_EXECUTION_TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(processId);
        finish(code ?? 0, stdout, stderr);
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(processId);
        logger.error(`[Terminal] Process error for "${command}": ${err.message}`);
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
