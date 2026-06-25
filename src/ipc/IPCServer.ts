import net from 'net';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger';
import { metricsTracker } from '../metrics/MetricsTracker';
import { AgentState } from '../agent/StateMachine';
import { permissionSystem } from '../security/PermissionSystem';
import { config } from '../config';
import { agentOrchestrator } from '../agent';

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
          state: agentOrchestrator.getSession(0).stateMachine.getState(),
          memory: agentOrchestrator.getSession(0).memoryManager.contextManager.getMemoryStats(),
          fullAccess: permissionSystem.isFullAccess(),
          showReasoning: config.SHOW_REASONING,
          disableLoopLimit: config.DISABLE_LOOP_LIMIT,
          whisperEnabled: config.WHISPER_ENABLED,
          whisperModel: config.WHISPER_MODEL,
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

      case 'cd': {
        const targetDir = args.dir || require('os').homedir();
        try {
          const path = require('path');
          const fs = require('fs');
          const resolvedDir = path.resolve(targetDir);
          
          if (!fs.existsSync(resolvedDir)) {
            return { status: 'ERROR', message: `Directory not found: ${resolvedDir}` };
          }
          
          process.chdir(resolvedDir);
          const { securityManager } = require('../security');
          securityManager.setSandboxDir(resolvedDir);
          config.SANDBOX_DIR = resolvedDir;
          
          const envPath = path.join(path.resolve(__dirname, '..', '..'), '.env');
          if (fs.existsSync(envPath)) {
            let envContent = await fs.promises.readFile(envPath, 'utf8');
            if (!envContent.includes('SANDBOX_DIR=')) {
              envContent += `\nSANDBOX_DIR=${resolvedDir}`;
            } else {
              envContent = envContent.replace(/SANDBOX_DIR=.*/, `SANDBOX_DIR=${resolvedDir}`);
            }
            await fs.promises.writeFile(envPath, envContent);
          }
          
          return { status: 'OK', message: `Working directory changed to: ${resolvedDir}` };
        } catch (e: any) {
          return { status: 'ERROR', message: `Failed to change directory: ${e.message}` };
        }
      }

      case 'task':
        // Start task asynchronously, don't await here otherwise IPC blocks
        agentOrchestrator.getSession(0).handleTask(args.prompt, (msg: string) => logger.info(`[Task] ${msg}`)).catch(e => logger.error(`CLI Task error: ${e.message}`));
        return { status: 'OK', message: 'Task submitted.' };

      case 'execute_skill':
        const { skillManager } = require('../skills/SkillManager');
        const skill = skillManager.getSkill(args.name);
        if (skill && skill.userInvocable !== false) {
          const body = skillManager.getSkillBody(skill.name);
          if (body) {
            const taskText = `[EXPLICIT SKILL INVOCATION: ${skill.name}]\nExecute the following skill instructions strictly:\n${body}\n\nUser Arguments: ${args.args || 'None'}`;
            agentOrchestrator.getSession(0).handleTask(taskText, (msg: string) => logger.info(`[Task] ${msg}`)).catch(e => logger.error(`CLI Task error: ${e.message}`));
            return { status: 'OK', message: 'Skill executing.' };
          }
        }
        return { status: 'ERROR', message: 'Skill not found or not invocable' };

      case 'stop_task':
        if (agentOrchestrator.getSession(0).stateMachine.getState() !== AgentState.IDLE) {
          agentOrchestrator.getSession(0).stateMachine.transition(AgentState.STOPPED);
          return { status: 'OK', message: 'Agent execution halted.' };
        }
        return { status: 'OK', message: 'Agent was already idle.' };

      case 'fullaccess':
        const action = args.action;
        if (action === 'enable') {
          const duration = args.durationMs;
          permissionSystem.enableFullAccess(duration);
          const minutes = Math.round((duration || 15 * 60 * 1000) / 1000 / 60);
          return { status: 'OK', message: `Full Access enabled for ${minutes} minutes.` };
        } else if (action === 'disable') {
          permissionSystem.disableFullAccess();
          return { status: 'OK', message: 'Full Access disabled.' };
        } else {
          return {
            status: 'OK',
            isFullAccess: permissionSystem.isFullAccess(),
            remainingMinutes: permissionSystem.getFullAccessRemainingMinutes()
          };
        }

      case 'config':
        const cfgEnvPath = path.join(process.cwd(), '.env');
        let cfgEnvContent = await fs.promises.readFile(cfgEnvPath, 'utf8');
        const key = args.key;
        const val = args.value;
        if (key === 'loops') {
          const num = parseInt(val, 10);
          if (isNaN(num) || num <= 0) return { error: 'Invalid loops value' };
          if (!cfgEnvContent.includes('MAX_LOOPS=')) {
            cfgEnvContent += `\nMAX_LOOPS=${num}`;
          } else {
            cfgEnvContent = cfgEnvContent.replace(/MAX_LOOPS=.*/, `MAX_LOOPS=${num}`);
          }
          config.MAX_LOOPS = num;
          await fs.promises.writeFile(cfgEnvPath, cfgEnvContent);
          return { status: 'OK', message: `MAX_LOOPS set to ${num}.` };
        } else if (key === 'max_context') {
          const num = parseInt(val, 10);
          if (isNaN(num) || num < 4000) return { error: 'Invalid max_context value (minimum 4000)' };
          if (!cfgEnvContent.includes('MAX_CONTEXT_TOKENS=')) {
            cfgEnvContent += `\nMAX_CONTEXT_TOKENS=${num}`;
          } else {
            cfgEnvContent = cfgEnvContent.replace(/MAX_CONTEXT_TOKENS=.*/, `MAX_CONTEXT_TOKENS=${num}`);
          }
          config.MAX_CONTEXT_TOKENS = num;
          await fs.promises.writeFile(cfgEnvPath, cfgEnvContent);
          return { status: 'OK', message: `MAX_CONTEXT_TOKENS set to ${num}.` };
        } else if (key === 'timeout') {
          const num = parseInt(val, 10);
          if (isNaN(num) || num <= 0) return { error: 'Invalid timeout value' };
          if (!cfgEnvContent.includes('MAX_EXECUTION_TIMEOUT_MS=')) {
            cfgEnvContent += `\nMAX_EXECUTION_TIMEOUT_MS=${num}`;
          } else {
            cfgEnvContent = cfgEnvContent.replace(/MAX_EXECUTION_TIMEOUT_MS=.*/, `MAX_EXECUTION_TIMEOUT_MS=${num}`);
          }
          config.MAX_EXECUTION_TIMEOUT_MS = num;
          await fs.promises.writeFile(cfgEnvPath, cfgEnvContent);
          return { status: 'OK', message: `MAX_EXECUTION_TIMEOUT_MS set to ${num} ms.` };
        } else if (key === 'reasoning') {
          const isTrue = val.toLowerCase() === 'true' || val === '1';
          const isFalse = val.toLowerCase() === 'false' || val === '0';
          if (!isTrue && !isFalse) return { error: 'Invalid reasoning value. Must be true or false' };
          const writeVal = isTrue ? 'true' : 'false';
          if (!cfgEnvContent.includes('SHOW_REASONING=')) {
            cfgEnvContent += `\nSHOW_REASONING=${writeVal}`;
          } else {
            cfgEnvContent = cfgEnvContent.replace(/SHOW_REASONING=.*/, `SHOW_REASONING=${writeVal}`);
          }
          config.SHOW_REASONING = isTrue;
          await fs.promises.writeFile(cfgEnvPath, cfgEnvContent);
          return { status: 'OK', message: `SHOW_REASONING set to ${writeVal}.` };
        } else if (key === 'loop_limit') {
          const isTrue = val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'on';
          const isFalse = val.toLowerCase() === 'false' || val === '0' || val.toLowerCase() === 'off';
          if (!isTrue && !isFalse) return { error: 'Invalid loop_limit value. Must be true or false' };
          const writeVal = isTrue ? 'false' : 'true';
          if (!cfgEnvContent.includes('DISABLE_LOOP_LIMIT=')) {
            cfgEnvContent += `\nDISABLE_LOOP_LIMIT=${writeVal}`;
          } else {
            cfgEnvContent = cfgEnvContent.replace(/DISABLE_LOOP_LIMIT=.*/, `DISABLE_LOOP_LIMIT=${writeVal}`);
          }
          config.DISABLE_LOOP_LIMIT = !isTrue;
          await fs.promises.writeFile(cfgEnvPath, cfgEnvContent);
          return { status: 'OK', message: `LOOP_LIMIT (enforce loop safety limits) set to ${isTrue ? 'true' : 'false'}.` };
        } else if (key === 'whisper_enabled') {
          const isTrue = val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'on';
          const isFalse = val.toLowerCase() === 'false' || val === '0' || val.toLowerCase() === 'off';
          if (!isTrue && !isFalse) return { error: 'Invalid whisper_enabled value. Must be true or false' };
          const writeVal = isTrue ? 'true' : 'false';
          if (!cfgEnvContent.includes('WHISPER_ENABLED=')) {
            cfgEnvContent += `\nWHISPER_ENABLED=${writeVal}`;
          } else {
            cfgEnvContent = cfgEnvContent.replace(/WHISPER_ENABLED=.*/, `WHISPER_ENABLED=${writeVal}`);
          }
          config.WHISPER_ENABLED = isTrue;
          await fs.promises.writeFile(cfgEnvPath, cfgEnvContent);
          return { status: 'OK', message: `WHISPER_ENABLED set to ${writeVal}.` };
        } else if (key === 'whisper_model') {
          const allowedModels = ['tiny', 'base', 'small', 'medium', 'large'];
          if (!allowedModels.includes(val.toLowerCase())) {
            return { error: `Invalid whisper_model. Must be one of: ${allowedModels.join(', ')}` };
          }
          const writeVal = val.toLowerCase();
          if (!cfgEnvContent.includes('WHISPER_MODEL=')) {
            cfgEnvContent += `\nWHISPER_MODEL=${writeVal}`;
          } else {
            cfgEnvContent = cfgEnvContent.replace(/WHISPER_MODEL=.*/, `WHISPER_MODEL=${writeVal}`);
          }
          config.WHISPER_MODEL = writeVal;
          await fs.promises.writeFile(cfgEnvPath, cfgEnvContent);
          return { status: 'OK', message: `WHISPER_MODEL set to ${writeVal}.` };
        }
        return { error: 'Invalid config key' };

      default:
        return { error: 'Unknown IPC command' };
    }
  }
}

export const ipcServer = new IPCServer();
