import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

interface InteractiveSession {
  process: ChildProcess;
  outputBuffer: string;
  lastActive: number;
}

const sessions = new Map<string, InteractiveSession>();

export async function interactiveShell(sessionId: string | null, command: string, signal?: AbortSignal, timeoutMs: number = 1500): Promise<string> {
  const id = sessionId || randomUUID();
  let session = sessions.get(id);

  if (!session) {
    // Determine shell based on OS
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
    const proc = spawn(shell, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    session = {
      process: proc,
      outputBuffer: '',
      lastActive: Date.now()
    };
    
    proc.stdout?.on('data', (data) => {
      if (session) session.outputBuffer += data.toString();
    });
    
    proc.stderr?.on('data', (data) => {
      if (session) session.outputBuffer += data.toString();
    });

    proc.on('close', () => {
      sessions.delete(id);
    });
    
    sessions.set(id, session);
  }

  session.lastActive = Date.now();
  session.outputBuffer = ''; // clear buffer before sending new command

  // Send command
  session.process.stdin?.write(command + '\n');

  // Wait a short amount of time for immediate output
  await new Promise<void>((resolve, reject) => {
    let timer: any;
    const onAbort = () => {
      clearTimeout(timer);
      if (session) {
        session.process.kill('SIGKILL');
        sessions.delete(id);
      }
      reject(new Error('[USER KILLED]'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, timeoutMs);
  });

  let output = session.outputBuffer;
  
  if (!output.trim()) {
    output = '(Command executed, no immediate output. Use the same session ID with an empty command to read later output.)';
  }

  return `Session ID: ${id}\nOutput:\n${output}`;
}

// Clean up old sessions (e.g. inactive for > 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActive > 3600000) {
      session.process.kill();
      sessions.delete(id);
    }
  }
}, 600000);
