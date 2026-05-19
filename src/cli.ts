#!/usr/bin/env node
import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// ANSI escape codes for basic colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

async function sendIPCCommand(command: string, args: any = {}) {
  const tokenPath = path.join(process.cwd(), '.xacode_ipc_token');
  const socketPath = process.platform === 'win32' 
    ? path.join('\\\\?\\pipe', process.cwd(), 'xacode.sock')
    : path.join(process.cwd(), 'xacode.sock');

  if (!fs.existsSync(tokenPath)) {
    console.error(`${colors.red}Error: IPC Token not found. Is the XaCode agent running?${colors.reset}`);
    process.exit(1);
  }

  const token = fs.readFileSync(tokenPath, 'utf8');

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify({ token, command, args }));
    });

    let data = '';
    client.on('data', (chunk) => data += chunk.toString());
    client.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON from IPC server')); }
    });
    client.on('error', (err) => reject(err));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'info':
      console.log(`${colors.cyan}Fetching agent info...${colors.reset}`);
      const info: any = await sendIPCCommand('info');
      if (info.error) {
        console.error(`${colors.red}Error: ${info.error}${colors.reset}`);
        console.log(`\n${colors.cyan}$$\\   $$\\            $$$$$$\\                  $$\\           
$$ |  $$ |          $$  __$$\\                 $$ |          
\\$$\\ $$  | $$$$$$\\  $$ /  \\__| $$$$$$\\   $$$$$$$ | $$$$$$\\  
 \\$$$$  /  \\____$$\\ $$ |      $$  __$$\\ $$  __$$ |$$  __$$\\ 
 $$  $$<   $$$$$$$ |$$ |      $$ /  $$ |$$ /  $$ |$$$$$$$$ |
$$  /\\$$\\ $$  __$$ |$$ |  $$\\ $$ |  $$ |$$ |  $$ |$$   ____|
$$ /  $$ |\\$$$$$$$ |\\$$$$$$  |\\$$$$$$  |\\$$$$$$$ |\\$$$$$$$\\ 
\\__|  \\__| \\_______| \\______/  \\______/  \\_______| \\_______|${colors.reset}\n`);
        
        console.log(`${colors.green}┌────────────────────────────────────────────────────────┐${colors.reset}`);
        console.log(`${colors.green}│               XACODE ENTERPRISE STATUS                 │${colors.reset}`);
        console.log(`${colors.green}├────────────────────────────────────────────────────────┤${colors.reset}`);
        console.log(`${colors.green}│ [ AGENT CORE ]${colors.reset}`);
        console.log(`│ Current State    : ${info.state === 'IDLE' ? colors.green : colors.yellow}${info.state}${colors.reset}`);
        console.log(`│ Full Access Mode : ${info.fullAccess ? colors.red + 'ENABLED [UNSAFE]' : colors.green + 'DISABLED [SAFE]'}${colors.reset}`);
        console.log(`│ Agent Uptime     : ${Math.round(info.metrics.uptimeMs / 1000)} seconds`);
        console.log(`${colors.green}│${colors.reset}`);
        console.log(`${colors.green}│ [ MEMORY & CONTEXT ]${colors.reset}`);
        console.log(`│ Context Window   : ${info.memory.usageTokens} / ${info.memory.maxTokens} tokens`);
        console.log(`│ Context Usage    : ${Math.round((info.memory.usageTokens / info.memory.maxTokens) * 100)}%`);
        console.log(`│ Compressed State : ${info.memory.hasSummary ? colors.green + 'Active' : colors.yellow + 'Inactive'}${colors.reset}`);
        console.log(`${colors.green}│${colors.reset}`);
        console.log(`${colors.green}│ [ TELEMETRY & METRICS ]${colors.reset}`);
        console.log(`│ Total API Tokens : ${info.metrics.tokenUsage}`);
        console.log(`│ API Cost Est.    : $${info.metrics.apiCost.toFixed(4)}`);
        console.log(`│ LLM Retries      : ${info.metrics.retryCount}`);
        console.log(`│ Verification Err : ${info.metrics.verificationFailures}`);
        console.log(`│ Stuck Loops Block: ${info.metrics.stuckLoopDetections}`);
        console.log(`${colors.green}│${colors.reset}`);
        console.log(`${colors.green}│ [ SYSTEM ENVIRONMENT ]${colors.reset}`);
        console.log(`│ Process ID (PID) : ${info.system.pid}`);
        console.log(`│ Platform & Arch  : ${info.system.platform} (${info.system.arch})`);
        console.log(`│ Node.js Version  : ${info.system.nodeVersion}`);
        console.log(`│ Host Uptime      : ${Math.round(info.system.uptime / 60)} minutes`);
        console.log(`│ Workspace Path   : ${info.system.cwd}`);
        console.log(`${colors.green}└────────────────────────────────────────────────────────┘${colors.reset}`);
      }
      break;

    case 'update':
      console.log(`${colors.yellow}Updating XaCode from GitHub...${colors.reset}`);
      const updateProc = spawn('sudo', ['bash', 'update.sh'], { stdio: 'inherit', cwd: process.cwd() });
      updateProc.on('close', (code) => {
        if (code === 0) console.log(`${colors.green}XaCode successfully updated!${colors.reset}`);
        else console.error(`${colors.red}Update failed with code ${code}${colors.reset}`);
      });
      break;

    case 'uninstall':
      console.log(`${colors.red}WARNING: This will completely remove XaCode from your system!${colors.reset}`);
      console.log(`Press Ctrl+C within 5 seconds to abort...`);
      setTimeout(() => {
        const uninstallProc = spawn('sudo', ['bash', 'uninstall.sh'], { stdio: 'inherit', cwd: process.cwd() });
        uninstallProc.on('close', (code) => {
          if (code === 0) console.log(`${colors.green}XaCode has been uninstalled.${colors.reset}`);
        });
      }, 5000);
      break;

    case 'doctor':
      console.log(`${colors.yellow}Running diagnostics...${colors.reset}`);
      const doc: any = await sendIPCCommand('doctor');
      console.log(JSON.stringify(doc, null, 2));
      break;

    case 'auth':
      const type = args[1];
      const token = args[2];
      if (!type || !token || !['telegram', 'deepseek'].includes(type)) {
        console.error(`${colors.red}Usage: xacode auth <telegram|deepseek> <new_token>${colors.reset}`);
        process.exit(1);
      }
      console.log(`${colors.yellow}Updating ${type} token...${colors.reset}`);
      const authRes: any = await sendIPCCommand('auth', { type, token });
      console.log(`${colors.green}${authRes.message}${colors.reset}`);
      console.log(`Please restart the service for token changes to fully apply: sudo systemctl restart xacode`);
      break;

    case 'ban':
      const banId = args[1];
      if (!banId) {
        console.error(`${colors.red}Usage: xacode ban <telegram_id>${colors.reset}`);
        process.exit(1);
      }
      console.log(`${colors.yellow}Banning user ${banId}...${colors.reset}`);
      const banRes: any = await sendIPCCommand('ban', { id: banId });
      console.log(`${colors.green}${banRes.message}${colors.reset}`);
      break;

    case 'logs':
      console.log(`${colors.cyan}Streaming XaCode logs (Press Ctrl+C to exit)...${colors.reset}`);
      spawn('sudo', ['journalctl', '-u', 'xacode', '-f'], { stdio: 'inherit' });
      break;

    case 'task':
      const prompt = args.slice(1).join(' ');
      if (!prompt) {
        console.error(`${colors.red}Usage: xacode task "your prompt here"${colors.reset}`);
        process.exit(1);
      }
      console.log(`${colors.yellow}Submitting task to XaCode agent...${colors.reset}`);
      await sendIPCCommand('task', { prompt });
      console.log(`${colors.green}Task submitted successfully! Streaming logs...${colors.reset}`);
      
      const logProc = spawn('sudo', ['journalctl', '-u', 'xacode', '-f'], { stdio: 'inherit' });
      
      process.on('SIGINT', async () => {
        console.log(`\n${colors.red}Caught interrupt signal (Ctrl+C). Stopping agent...${colors.reset}`);
        await sendIPCCommand('stop_task');
        logProc.kill('SIGINT');
        process.exit(0);
      });
      break;

    case 'help':
    default:
      console.log(`\n${colors.cyan}$$\\   $$\\            $$$$$$\\                  $$\\           
$$ |  $$ |          $$  __$$\\                 $$ |          
\\$$\\ $$  | $$$$$$\\  $$ /  \\__| $$$$$$\\   $$$$$$$ | $$$$$$\\  
 \\$$$$  /  \\____$$\\ $$ |      $$  __$$\\ $$  __$$ |$$  __$$\\ 
 $$  $$<   $$$$$$$ |$$ |      $$ /  $$ |$$ /  $$ |$$$$$$$$ |
$$  /\\$$\\ $$  __$$ |$$ |  $$\\ $$ |  $$ |$$ |  $$ |$$   ____|
$$ /  $$ |\\$$$$$$$ |\\$$$$$$  |\\$$$$$$  |\\$$$$$$$ |\\$$$$$$$\\ 
\\__|  \\__| \\_______| \\______/  \\______/  \\_______| \\_______|${colors.reset}\n`);
      console.log(`${colors.green}XaCode CLI Enterprise${colors.reset}`);
      console.log('Available commands:');
      console.log('  info                        - Show detailed agent metrics, memory, and status');
      console.log('  doctor                      - Run diagnostics');
      console.log('  update                      - Pull latest code from GitHub and restart service');
      console.log('  uninstall                   - Completely remove XaCode service and files');
      console.log('  auth <telegram|deepseek> <t>- Update API tokens instantly');
      console.log('  ban <telegram_id>           - Ban a user ID from accessing the bot');
      console.log('  logs                        - Stream live agent logs');
      console.log('  task "prompt"               - Run a task locally (Ctrl+C to abort)');
      console.log('  stop_task                   - Halt agent execution');
      break;
  }
}

main().catch(err => {
  console.error(`${colors.red}CLI Error: ${err.message}${colors.reset}`);
});
