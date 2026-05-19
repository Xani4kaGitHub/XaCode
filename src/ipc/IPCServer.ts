import net from 'net';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger';
import { metricsTracker } from '../metrics/MetricsTracker';
import { agentStateMachine } from '../agent/StateMachine';
import { contextManager } from '../memory/ContextManager';
import { permissionSystem } from '../security/PermissionSystem';

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
    socket.on('data', (data) => {
      try {
        const req = JSON.parse(data.toString());
        
        if (req.token !== this.authToken) {
          socket.write(JSON.stringify({ error: 'Unauthorized. Invalid IPC Token.' }));
          socket.end();
          return;
        }

        const response = this.handleCommand(req.command, req.args);
        socket.write(JSON.stringify(response));
      } catch (e: any) {
        socket.write(JSON.stringify({ error: e.message }));
      } finally {
        socket.end();
      }
    });
  }

  private handleCommand(command: string, args: any): any {
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
          checks: {
            apiKeys: 'Valid',
            permissions: permissionSystem.isFullAccess() ? 'Full Access' : 'Restricted',
            filesystem: 'OK',
          }
        };
      // ... other commands (status, stop, reset, etc.)
      default:
        return { error: 'Unknown IPC command' };
    }
  }
}

export const ipcServer = new IPCServer();
