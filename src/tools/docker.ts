import { execSync } from 'child_process';

export interface DockerOptions {
  action: 'ps' | 'logs' | 'compose';
  container?: string;
  lines?: number;
  command?: string;
}

export async function handleDocker(args: DockerOptions, basePath: string = process.cwd()): Promise<any> {
  const { action, container, lines, command } = args;

  try {
    // Check if docker exists
    execSync('docker --version', { stdio: 'pipe' });
  } catch (e) {
    throw new Error("Docker is not installed or not running on this system.");
  }

  try {
    if (action === 'ps') {
      const out = execSync('docker ps --format "{{json .}}"', { encoding: 'utf8' });
      return out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    }

    if (action === 'logs') {
      if (!container) throw new Error("Container name/id is required for logs.");
      const tail = lines || 50;
      const out = execSync(`docker logs --tail ${tail} ${container}`, { encoding: 'utf8', stdio: 'pipe' });
      return out;
    }

    if (action === 'compose') {
      if (!command) throw new Error("Command is required for docker compose (e.g., 'up -d').");
      const out = execSync(`docker compose ${command}`, { cwd: basePath, encoding: 'utf8', stdio: 'pipe' });
      return out;
    }

    throw new Error("Invalid docker action. Use 'ps', 'logs', or 'compose'.");
  } catch (e: any) {
    throw new Error(`Docker command failed: ${e.message}\nOutput: ${e.stdout?.toString() || ''}\nError: ${e.stderr?.toString() || ''}`);
  }
}
