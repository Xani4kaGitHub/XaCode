import net from 'net';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger';
import { metricsTracker } from '../metrics/MetricsTracker';
import { agentStateMachine, AgentState } from '../agent/StateMachine';
import { contextManager } from '../memory/ContextManager';
import { permissionSystem } from '../security/PermissionSystem';
import { config } from '../config';
import { agentCore } from '../agent';

export class IPCServer {
  private server: net.Server;
  private readonly socketPath: string;
  private authToken: string;

  constructor() {
    this.socketPath = process.platform === 'win32' 
      ? path.join('\\\\?\\pipe', process.cwd(), 'xacode.sock')
      : path.join(process.cwd(), 'xacode.sock');
      
    this.authToken = crypto.randomBytes(32).toString('hex');
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  async start() {
    // Generate auth token file for local CLI
    await fs.promises.writeFile(path.join(process.cwd(), '.xacode_ipc_token'), this.authToken, { mode: 0o600 });
    
    // Cleanup old socket
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    this.server.listen(this.socketPath, () => {
      logger.info(`IPC Server listening on ${this.socketPath}`);
    });
  }

  private handleConnection(socket: net.Socket) {
    socket.on('data', async (data) => {
      try {
        const req = JSON.parse(data.toString());
        
        if (req.token !== this.authToken) {
          socket.write(JSON.stringify({ error: 'Unauthorized. Invalid IPC Token.' }));
          socket.end();
          return;
        }

        const response = await this.handleCommand(req.command, req.args);
        socket.write(JSON.stringify(response));
      } catch (e: any) {
        socket.write(JSON.stringify({ error: e.message }));
      } finally {
        socket.end();
      }
    });
  }

  private async handleCommand(command: string, args: any): Promise<any> {
    switch (command) {
      case 'info':
        return {
          status: 'OK',
          metrics: metricsTracker.getMetrics(),
          state: agentStateMachine.getState(),
          memory: contextManager.getMemoryStats(),
          fullAccess: permissionSystem.isFullAccess(),
          system: {
            pid: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            uptime: process.uptime(),
            cwd: process.cwd(),
          }
        };
      case 'doctor':
        return {
          status: 'OK',
          diagnostics: {
            npm: true,
            typescript: true,
            docker: false
          }
        };

      case 'sandbox_clear':
        const fsLib = require('fs');
        const pathLib = require('path');
        const sandboxDir = pathLib.join(process.cwd(), 'sandbox');
        if (fsLib.existsSync(sandboxDir)) {
          fsLib.rmSync(sandboxDir, { recursive: true, force: true });
          fsLib.mkdirSync(sandboxDir);
        }
        return { status: 'OK', message: 'Sandbox cleared successfully.' };

      case 'cost':
        return {
          status: 'OK',
          session: metricsTracker.getMetrics(),
          persistent: metricsTracker.getPersistentMetrics()
        };

      case 'auth':
        const envPath = path.join(process.cwd(), '.env');
        let envContent = await fs.promises.readFile(envPath, 'utf8');
        if (args.type === 'telegram') {
          envContent = envContent.replace(/TELEGRAM_BOT_TOKEN=.*/, `TELEGRAM_BOT_TOKEN=${args.token}`);
          config.TELEGRAM_BOT_TOKEN = args.token;
        } else if (args.type === 'deepseek') {
          envContent = envContent.replace(/DEEPSEEK_API_KEY=.*/, `DEEPSEEK_API_KEY=${args.token}`);
          config.DEEPSEEK_API_KEY = args.token;
        } else if (args.type === 'model') {
          if (!envContent.includes('DEEPSEEK_MODEL=')) {
            envContent += `\nDEEPSEEK_MODEL=${args.token}`;
          } else {
            envContent = envContent.replace(/DEEPSEEK_MODEL=.*/, `DEEPSEEK_MODEL=${args.token}`);
          }
          config.DEEPSEEK_MODEL = args.token;
        }
        await fs.promises.writeFile(envPath, envContent);
        return { status: 'OK', message: `${args.type} token updated successfully.` };

      case 'ban':
        const banEnvPath = path.join(process.cwd(), '.env');
        let banEnv = await fs.promises.readFile(banEnvPath, 'utf8');
        const ids = String(config.ALLOWED_USER_IDS).split(',').map((id: string) => id.trim()).filter((id: string) => id !== args.id);
        const newIds = ids.join(',');
        banEnv = banEnv.replace(/ALLOWED_USER_IDS=.*/, `ALLOWED_USER_IDS=${newIds}`);
        config.ALLOWED_USER_IDS = newIds.split(',').map(Number).filter(n => !isNaN(n));
        await fs.promises.writeFile(banEnvPath, banEnv);
        return { status: 'OK', message: `User ${args.id} banned. Remaining allowed: ${newIds}` };

      case 'task':
        // Start task asynchronously, don't await here otherwise IPC blocks
        agentCore.handleTask(args.prompt, (msg: string) => logger.info(`[Task] ${msg}`)).catch(e => logger.error(`CLI Task error: ${e.message}`));
        return { status: 'OK', message: 'Task submitted.' };

      case 'stop_task':
        if (agentStateMachine.getState() !== AgentState.IDLE) {
          agentStateMachine.transition(AgentState.STOPPED);
          return { status: 'OK', message: 'Agent execution halted.' };
        }
        return { status: 'OK', message: 'Agent was already idle.' };

      default:
        return { error: 'Unknown IPC command' };
    }
  }
}

export const ipcServer = new IPCServer();
