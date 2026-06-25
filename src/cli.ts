#!/usr/bin/env node
import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const PROJECT_ROOT = path.join(__dirname, '..');

// Auto-elevate to sudo on Linux/macOS if not running as root
if (process.getuid && process.getuid() !== 0) {
  spawnSync('sudo', [process.execPath, __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(0);
}

// ANSI escape codes for basic colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function printLogo() {
  const logoLines = [
    '$$\\   $$\\            $$$$$$\\                  $$\\           ',
    '$$ |  $$ |          $$  __$$\\                 $$ |          ',
    '\\$$\\ $$  | $$$$$$\\  $$ /  \\__| $$$$$$\\   $$$$$$$ | $$$$$$\\  ',
    ' \\$$$$  /  \\____$$\\ $$ |      $$  __$$\\ $$  __$$ |$$  __$$\\ ',
    ' $$  $$<   $$$$$$$ |$$ |      $$ /  $$ |$$ /  $$ |$$$$$$$$ |',
    '$$  /\\$$\\ $$  __$$ |$$ |  $$\\ $$ |  $$ |$$ |  $$ |$$   ____|',
    '$$ /  $$ |\\$$$$$$$ |\\$$$$$$  |\\$$$$$$  |\\$$$$$$$ |\\$$$$$$$\\ ',
    '\\__|  \\__| \\_______| \\______/  \\______/  \\_______| \\_______|'
  ];
  
  const gradient = [
    '\x1b[38;2;251;194;235m',
    '\x1b[38;2;239;194;235m',
    '\x1b[38;2;227;194;236m',
    '\x1b[38;2;215;194;236m',
    '\x1b[38;2;202;194;237m',
    '\x1b[38;2;190;193;237m',
    '\x1b[38;2;178;193;238m',
    '\x1b[38;2;166;193;238m'
  ];

  console.log('');
  logoLines.forEach((line, i) => {
    console.log(`${gradient[i]}${line}\x1b[0m`);
  });
  console.log('');
}

async function sendIPCCommand(command: string, args: any = {}) {
  const tokenPath = path.join(PROJECT_ROOT, '.xacode_ipc_token');
  const socketPath = process.platform === 'win32' 
    ? path.join('\\\\?\\pipe', PROJECT_ROOT, 'xacode.sock')
    : path.join(PROJECT_ROOT, 'xacode.sock');

  if (!fs.existsSync(tokenPath)) {
    console.error(`${colors.red}Error: IPC Token not found. Is the XaCode agent running?${colors.reset}`);
    process.exit(1);
  }

  const token = fs.readFileSync(tokenPath, 'utf8');

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify({ token, command, args }));
    });

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('IPC Request timed out. The XaCode agent is not responding.'));
    }, 5000);

    let data = '';
    client.on('data', (chunk) => data += chunk.toString());
    client.on('end', () => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON from IPC server')); }
    });
    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function monitorStatus() {
  console.clear();
  console.log('Starting XaCode real-time monitor... Press ESC or Ctrl+C to exit.');
  
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key: string) => {
      if (key === '\u0003' || key === '\u001b') {
        console.clear();
        process.exit(0);
      }
    });
  }

  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

  while (true) {
    try {
      const info: any = await sendIPCCommand('info');
      if (info.error) {
        process.stdout.write('\x1b[H');
        console.error(`${colors.red}Error: ${info.error}${colors.reset}                                                     `);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      
      process.stdout.write('\x1b[H');
      
      const stateColor = info.state === 'IDLE' ? colors.green : colors.yellow;
      const fullAccessColor = info.fullAccess ? colors.red + 'ENABLED [UNSAFE]' : colors.green + 'DISABLED [SAFE]';
      const showReasoningColor = info.showReasoning ? colors.green + 'ON' : colors.yellow + 'OFF';
      const disableLoopLimitColor = info.disableLoopLimit ? colors.red + 'ON [NO LIMIT]' : colors.green + 'OFF [SAFE]';
      const uptime = Math.round(info.metrics.uptimeMs / 1000);
      const memPercent = Math.round((info.memory.usageTokens / info.memory.maxTokens) * 100);
      
      const border = colors.green + '┌────────────────────────────────────────────────────────┐' + colors.reset;
      const borderBottom = colors.green + '└────────────────────────────────────────────────────────┘' + colors.reset;
      const divider = colors.green + '├────────────────────────────────────────────────────────┤' + colors.reset;
      const side = colors.green + '│' + colors.reset;
      
      let output = '';
      output += `${border}\n`;
      output += `${side}               ${colors.cyan}XACODE LIVE MONITOR (ESC/Ctrl+C to exit)${colors.reset}       ${side}\n`;
      output += `${divider}\n`;
      output += `${side} ${colors.green}[ AGENT CORE ]${colors.reset}                                           ${side}\n`;
      output += `${side} Current State    : ${stateColor}${info.state.padEnd(38)}${colors.reset} ${side}\n`;
      output += `${side} Full Access Mode : ${fullAccessColor.padEnd(49)}${colors.reset} ${side}\n`;
      output += `${side} Show Reasoning   : ${showReasoningColor.padEnd(49)}${colors.reset} ${side}\n`;
      output += `${side} Loop Limit Bypass: ${disableLoopLimitColor.padEnd(49)}${colors.reset} ${side}\n`;
      output += `${side} Whisper Transcr. : ${info.whisperEnabled ? colors.green + 'ENABLED'.padEnd(37) : colors.yellow + 'DISABLED'.padEnd(37)}${colors.reset} ${side}\n`;
      output += `${side} Whisper Model    : ${colors.cyan}${info.whisperModel.padEnd(38)}${colors.reset} ${side}\n`;
      output += `${side} Agent Uptime     : ${(uptime + ' seconds').padEnd(38)} ${side}\n`;
      output += `${side}                                                        ${side}\n`;
      output += `${side} ${colors.green}[ MEMORY & CONTEXT ]${colors.reset}                                     ${side}\n`;
      output += `${side} Context Window   : ${(info.memory.usageTokens + ' / ' + info.memory.maxTokens + ' tokens').padEnd(38)} ${side}\n`;
      output += `${side} Context Usage    : ${(memPercent + '%').padEnd(38)} ${side}\n`;
      output += `${side} Compressed State : ${(info.memory.hasSummary ? colors.green + 'Active' : colors.yellow + 'Inactive').padEnd(49)}${colors.reset} ${side}\n`;
      output += `${side}                                                        ${side}\n`;
      output += `${side} ${colors.green}[ TELEMETRY & METRICS ]${colors.reset}                                  ${side}\n`;
      output += `${side} Total API Tokens : ${info.metrics.tokenUsage.toString().padEnd(38)} ${side}\n`;
      output += `${side} API Cost Est.    : $${info.metrics.apiCost.toFixed(4).padEnd(37)} ${side}\n`;
      output += `${side} LLM Retries      : ${info.metrics.retryCount.toString().padEnd(38)} ${side}\n`;
      output += `${side} Verification Err : ${info.metrics.verificationFailures.toString().padEnd(38)} ${side}\n`;
      output += `${side} Stuck Loops Block: ${info.metrics.stuckLoopDetections.toString().padEnd(38)} ${side}\n`;
      output += `${borderBottom}\n`;
      
      process.stdout.write(output);
    } catch (e: any) {
      process.stdout.write('\x1b[H');
      console.error(`${colors.red}Connection error: ${e.message}. Is agent active?${colors.reset}                      `);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
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
        process.exit(1);
      }
      
      
      printLogo();
        
        console.log(`${colors.green}┌────────────────────────────────────────────────────────┐${colors.reset}`);
        console.log(`${colors.green}│               XACODE ENTERPRISE STATUS                 │${colors.reset}`);
        console.log(`${colors.green}├────────────────────────────────────────────────────────┤${colors.reset}`);
        console.log(`${colors.green}│ [ AGENT CORE ]${colors.reset}`);
        console.log(`│ Current State    : ${info.state === 'IDLE' ? colors.green : colors.yellow}${info.state}${colors.reset}`);
        console.log(`│ Full Access Mode : ${info.fullAccess ? colors.red + 'ENABLED [UNSAFE]' : colors.green + 'DISABLED [SAFE]'}${colors.reset}`);
        console.log(`│ Show Reasoning   : ${info.showReasoning ? colors.green + 'ON' : colors.yellow + 'OFF'}${colors.reset}`);
        console.log(`│ Loop Limit Bypass: ${info.disableLoopLimit ? colors.red + 'ON [NO LIMIT]' : colors.green + 'OFF [SAFE]'}${colors.reset}`);
        console.log(`│ Whisper Transcr. : ${info.whisperEnabled ? colors.green + 'ENABLED' : colors.yellow + 'DISABLED'}${colors.reset}`);
        console.log(`│ Whisper Model    : ${colors.cyan}${info.whisperModel}${colors.reset}`);
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
      process.exit(0);
      break;

    case 'update':
      console.log(`${colors.yellow}Updating XaCode from GitHub...${colors.reset}`);
      const updateProc = spawn('sudo', ['bash', 'update.sh'], { stdio: 'inherit', cwd: PROJECT_ROOT });
      updateProc.on('close', (code) => {
        if (code === 0) console.log(`${colors.green}XaCode successfully updated!${colors.reset}`);
        else console.error(`${colors.red}Update failed with code ${code}${colors.reset}`);
      });
      break;

    case 'uninstall':
      console.log(`${colors.red}WARNING: This will completely remove XaCode from your system!${colors.reset}`);
      console.log(`Press Ctrl+C within 5 seconds to abort...`);
      setTimeout(() => {
        const uninstallProc = spawn('sudo', ['bash', 'uninstall.sh'], { stdio: 'inherit', cwd: PROJECT_ROOT });
        uninstallProc.on('close', (code) => {
          if (code === 0) console.log(`${colors.green}XaCode has been uninstalled.${colors.reset}`);
        });
      }, 5000);
      break;

    case 'doctor':
      console.log(`${colors.yellow}Running diagnostics...${colors.reset}`);
      const doc: any = await sendIPCCommand('doctor');
      console.log(JSON.stringify(doc, null, 2));
      process.exit(0);
      break;

    case 'auth':
      const type = args[1];
      const token = args[2];
      if (!type || !token || !['telegram', 'deepseek', 'model'].includes(type)) {
        console.error(`${colors.red}Usage: xacode auth <telegram|deepseek|model> <new_value>${colors.reset}`);
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

    case 'fullaccess':
      const faAction = args[1];
      if (!faAction || !['enable', 'disable', 'status'].includes(faAction)) {
        console.error(`${colors.red}Usage: xacode fullaccess <enable|disable|status> [duration (e.g. 30m, 2h)]${colors.reset}`);
        process.exit(1);
      }
      if (faAction === 'enable') {
        const durStr = args[2];
        let durationMs = 15 * 60 * 1000;
        if (durStr) {
          const clean = durStr.trim().toLowerCase();
          const match = clean.match(/^(\d+)(ms|s|m|h|d)?$/);
          if (match) {
            const val = parseInt(match[1], 10);
            const unit = match[2] || 'm';
            let parsed = null;
            if (unit === 'ms') parsed = val;
            else if (unit === 's') parsed = val * 1000;
            else if (unit === 'm') parsed = val * 60 * 1000;
            else if (unit === 'h') parsed = val * 60 * 60 * 1000;
            else if (unit === 'd') parsed = val * 24 * 60 * 60 * 1000;
            if (parsed !== null && parsed > 0) {
              durationMs = parsed;
            }
          }
        }
        console.log(`${colors.yellow}Requesting Full Access activation...${colors.reset}`);
        const res: any = await sendIPCCommand('fullaccess', { action: 'enable', durationMs });
        console.log(`${colors.green}${res.message}${colors.reset}`);
      } else if (faAction === 'disable') {
        console.log(`${colors.yellow}Deactivating Full Access...${colors.reset}`);
        const res: any = await sendIPCCommand('fullaccess', { action: 'disable' });
        console.log(`${colors.green}${res.message}${colors.reset}`);
      } else {
        const res: any = await sendIPCCommand('fullaccess', { action: 'status' });
        if (res.isFullAccess) {
          console.log(`Full Access Mode: ${colors.red}ENABLED [UNSAFE]${colors.reset} (${res.remainingMinutes} minutes remaining)`);
        } else {
          console.log(`Full Access Mode: ${colors.green}DISABLED [SAFE]${colors.reset} (restricted to sandbox)`);
        }
      }
      break;

    case 'models':
      printLogo();
      const envPath = path.join(PROJECT_ROOT, '.env');
      let currentModel = 'deepseek-v4-pro';
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/DEEPSEEK_MODEL=(.*)/);
        if (match) currentModel = match[1];
      }
      
      console.log(`${colors.cyan}🧠 DeepSeek Model Selection (May 2026 Promo) ${colors.reset}`);
      console.log(`Current active model: ${colors.green}${currentModel}${colors.reset}\n`);
      
      console.log(`${colors.yellow}🚀 V4 Pro (Recommended)${colors.reset}`);
      console.log(`  Input (Cache Miss) : $0.435 / 1M tokens`);
      console.log(`  Output             : $0.870 / 1M tokens`);
      console.log(`  Command            : xacode auth model deepseek-v4-pro\n`);

      console.log(`${colors.cyan}⚡ V4 Flash${colors.reset}`);
      console.log(`  Input (Cache Miss) : $0.140 / 1M tokens`);
      console.log(`  Output             : $0.280 / 1M tokens`);
      console.log(`  Command            : xacode auth model deepseek-v4-flash\n`);
      process.exit(0);
      break;

    case 'cost':
      console.log(`${colors.cyan}Fetching financial metrics...${colors.reset}`);
      const costInfo: any = await sendIPCCommand('cost');
      printLogo();
      console.log(`${colors.green}┌────────────────────────────────────────────────────────┐${colors.reset}`);
      console.log(`${colors.green}│               XACODE FINANCIAL ANALYTICS               │${colors.reset}`);
      console.log(`${colors.green}├────────────────────────────────────────────────────────┤${colors.reset}`);
      console.log(`${colors.green}│ [ ALL-TIME USAGE (Persistent) ]${colors.reset}`);
      console.log(`│ Total API Tokens : ${costInfo.persistent.tokenUsage.toLocaleString()}`);
      console.log(`│ Total API Cost   : $${costInfo.persistent.apiCost.toFixed(4)}`);
      console.log(`${colors.green}│${colors.reset}`);
      console.log(`${colors.green}│ [ CURRENT SESSION ]${colors.reset}`);
      console.log(`│ Session Tokens   : ${costInfo.session.tokenUsage.toLocaleString()}`);
      console.log(`│ Session Cost     : $${costInfo.session.apiCost.toFixed(4)}`);
      console.log(`${colors.green}└────────────────────────────────────────────────────────┘${colors.reset}\n`);
      process.exit(0);
      break;

    case 'sandbox':
      const sandboxAction = args[1];
      if (sandboxAction === 'clear') {
        console.log(`${colors.yellow}Clearing sandbox directory...${colors.reset}`);
        const sbRes: any = await sendIPCCommand('sandbox_clear');
        console.log(`${colors.green}${sbRes.message}${colors.reset}`);
      } else {
        console.error(`${colors.red}Usage: xacode sandbox clear${colors.reset}`);
        process.exit(1);
      }
      process.exit(0);
      break;

    case 'status':
    case 'monitor':
      await monitorStatus();
      break;

    case 'config':
      const cfgKey = args[1];
      const cfgVal = args[2];
      if (!cfgKey || !cfgVal || !['loops', 'timeout', 'reasoning', 'loop_limit', 'whisper_enabled', 'whisper_model'].includes(cfgKey)) {
        console.error(`${colors.red}Usage: xacode config <loops|timeout|reasoning|loop_limit|whisper_enabled|whisper_model> <new_value>${colors.reset}`);
        process.exit(1);
      }
      console.log(`${colors.yellow}Updating config ${cfgKey} to ${cfgVal}...${colors.reset}`);
      const cfgRes: any = await sendIPCCommand('config', { key: cfgKey, value: cfgVal });
      if (cfgRes.error) {
        console.error(`${colors.red}Error: ${cfgRes.error}${colors.reset}`);
        process.exit(1);
      }
      console.log(`${colors.green}${cfgRes.message}${colors.reset}`);
      console.log(`Please restart the service for configuration changes to fully apply: sudo systemctl restart xacode`);
      break;

    case 'logs':
      console.log(`${colors.cyan}Streaming XaCode logs (Press Ctrl+C to exit)...${colors.reset}`);
      spawn('sudo', ['journalctl', '-u', 'xacode', '-f'], { stdio: 'inherit' });
      break;

    case 'reload':
      console.log(`${colors.cyan}Restarting XaCode service...${colors.reset}`);
      try {
        spawnSync('sudo', ['systemctl', 'restart', 'xacode'], { stdio: 'inherit' });
        console.log(`${colors.green}XaCode service restarted successfully.${colors.reset}`);
      } catch (e: any) {
        console.error(`${colors.red}Failed to restart service: ${e.message}${colors.reset}`);
      }
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

    case 'cd':
      const targetDir = args.slice(1).join(' ');
      console.log(`${colors.cyan}Changing working directory...${colors.reset}`);
      const cdRes: any = await sendIPCCommand('cd', { dir: targetDir });
      if (cdRes.error || cdRes.status === 'ERROR') {
        console.error(`${colors.red}Error: ${cdRes.error || cdRes.message}${colors.reset}`);
      } else {
        console.log(`${colors.green}${cdRes.message}${colors.reset}`);
      }
      break;

    case 'resume':
    case 'r':
      const resId = args[1];
      console.log(`${colors.cyan}Resuming session...${colors.reset}`);
      await sendIPCCommand('resume', { id: resId });
      console.log(`${colors.green}Session resumed successfully! Streaming logs...${colors.reset}`);
      const logProcRes = spawn('sudo', ['journalctl', '-u', 'xacode', '-f'], { stdio: 'inherit' });
      process.on('SIGINT', async () => {
        console.log(`\n${colors.red}Stopping agent...${colors.reset}`);
        await sendIPCCommand('stop_task');
        logProcRes.kill('SIGINT');
        process.exit(0);
      });
      break;

    case 'sessions':
    case 's':
      const sessRes: any = await sendIPCCommand('sessions');
      if (sessRes.sessions && sessRes.sessions.length > 0) {
        console.log(`${colors.cyan}Saved Sessions:${colors.reset}`);
        sessRes.sessions.forEach((s: any, i: number) => {
          console.log(`  ${i+1}. ${s.id} | ${s.status} | "${s.name || s.task}"`);
        });
      } else {
        console.log(`${colors.yellow}No saved sessions found.${colors.reset}`);
      }
      break;

    case 'checkpoint':
    case 'cp':
      const cpName = args.slice(1).join(' ').replace(/"/g, '');
      if (!cpName) {
        console.error(`${colors.red}Usage: xacode cp "name"${colors.reset}`);
        break;
      }
      const cpRes: any = await sendIPCCommand('checkpoint', { name: cpName });
      if (cpRes.status === 'OK') console.log(`${colors.green}Checkpoint saved!${colors.reset}`);
      else console.error(`${colors.red}Failed to save checkpoint.${colors.reset}`);
      break;

    case 'checkpoints':
    case 'cps':
      const cpsRes: any = await sendIPCCommand('checkpoints');
      if (cpsRes.checkpoints && cpsRes.checkpoints.length > 0) {
        console.log(`${colors.cyan}Saved Checkpoints:${colors.reset}`);
        cpsRes.checkpoints.forEach((c: any) => {
          console.log(`  ${c.id}. "${c.name}" (${new Date(c.savedAt).toLocaleString()})`);
        });
      } else {
        console.log(`${colors.yellow}No saved checkpoints found.${colors.reset}`);
      }
      break;

    case 'goto':
    case 'g':
      const gId = args[1];
      if (!gId) {
        console.error(`${colors.red}Usage: xacode goto <id>${colors.reset}`);
        break;
      }
      console.log(`${colors.cyan}Restoring checkpoint...${colors.reset}`);
      await sendIPCCommand('goto', { id: gId });
      console.log(`${colors.green}Checkpoint restored successfully! Streaming logs...${colors.reset}`);
      const logProcG = spawn('sudo', ['journalctl', '-u', 'xacode', '-f'], { stdio: 'inherit' });
      process.on('SIGINT', async () => {
        console.log(`\n${colors.red}Stopping agent...${colors.reset}`);
        await sendIPCCommand('stop_task');
        logProcG.kill('SIGINT');
        process.exit(0);
      });
      break;

    case 'rename':
      if (args.length < 3) {
        console.error(`${colors.red}Usage: xacode rename <id> "new name"${colors.reset}`);
        break;
      }
      const rName = args.slice(2).join(' ').replace(/"/g, '');
      const rnRes: any = await sendIPCCommand('rename_session', { id: args[1], name: rName });
      if (rnRes.status === 'OK') console.log(`${colors.green}Renamed successfully!${colors.reset}`);
      else console.error(`${colors.red}Session not found.${colors.reset}`);
      break;

    case 'delete':
      if (args.length < 2) {
        console.error(`${colors.red}Usage: xacode delete <id>${colors.reset}`);
        break;
      }
      const delRes: any = await sendIPCCommand('delete_session', { id: args[1] });
      if (delRes.status === 'OK') console.log(`${colors.green}Deleted successfully!${colors.reset}`);
      else console.error(`${colors.red}Session not found.${colors.reset}`);
      break;

    case 'help':
      printLogo();
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
      console.log(`${colors.green}XaCode CLI Enterprise v${pkg.version}${colors.reset}`);
      console.log('Available commands:');
      console.log('  info                        - Show detailed agent metrics, memory, and status');
      break;
    default:
      // Try to execute as a skill via IPC
      const skillRes: any = await sendIPCCommand('execute_skill', { name: command, args: args.slice(1).join(' ') });
      if (skillRes && skillRes.status === 'OK') {
        console.log(`${colors.green}Skill '${command}' invoked successfully! Streaming logs...${colors.reset}`);
        const logProcSkill = spawn('sudo', ['journalctl', '-u', 'xacode', '-f'], { stdio: 'inherit' });
        process.on('SIGINT', async () => {
          console.log(`\n${colors.red}Caught interrupt signal (Ctrl+C). Stopping agent...${colors.reset}`);
          await sendIPCCommand('stop_task');
          logProcSkill.kill('SIGINT');
          process.exit(0);
        });
        break;
      }
      
      printLogo();
      const pkg2 = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
      console.log(`${colors.green}XaCode CLI Enterprise v${pkg2.version}${colors.reset}`);
      console.log('Available commands:');
      console.log('  info                        - Show detailed agent metrics, memory, and status');
      console.log('  cost                        - Show persistent API cost analytics');
      console.log('  doctor                      - Run diagnostics');
      console.log('  models                      - View available models and pricing');
      console.log('  update                      - Pull latest code from GitHub and restart service');
      console.log('  uninstall                   - Completely remove XaCode service and files');
      console.log('  sandbox clear               - Wipes the sandbox directory clean');
      console.log('  auth <telegram|deepseek|model> <val> - Update API tokens or active model');
      console.log('  config <loops|timeout|reasoning|loop_limit> <val> - Update system configuration parameters');
      console.log('  status                      - Stream real-time status dashboard (ESC/Ctrl+C to exit)');
      console.log('  ban <telegram_id>           - Ban a user ID from accessing the bot');
      console.log('  fullaccess <enable|disable|status> [dur] - Enable/disable full filesystem access (e.g. 30m, 1h)');
      console.log('  logs                        - Stream live agent logs');
      console.log('  reload                      - Restart the XaCode systemd service');
      console.log('  cd [dir]                    - Change working directory for the agent');
      console.log('  task "prompt"               - Run a task locally (Ctrl+C to abort)');
      console.log('  stop_task                   - Halt agent execution');
      console.log('  resume [id] (or r)          - Resume last or specific session');
      console.log('  sessions (or s)             - List saved sessions');
      console.log('  checkpoint "name" (or cp)   - Save a checkpoint');
      console.log('  checkpoints (or cps)        - List checkpoints');
      console.log('  goto <id> (or g)            - Restore a checkpoint');
      console.log('  rename <id> "name"          - Rename a session');
      console.log('  delete <id>                 - Delete a session');
      break;
  }
}

main().catch(err => {
  console.error(`${colors.red}CLI Error: ${err.message}${colors.reset}`);
});
