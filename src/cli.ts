#!/usr/bin/env node
import net from 'net';
import fs from 'fs';
import path from 'path';

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
      } else {
        console.log(`\n${colors.cyan}$$\\   $$\\            $$$$$$\\                  $$\\           
$$ |  $$ |          $$  __$$\\                 $$ |          
\\$$\\ $$  | $$$$$$\\  $$ /  \\__| $$$$$$\\   $$$$$$$ | $$$$$$\\  
 \\$$$$  /  \\____$$\\ $$ |      $$  __$$\\ $$  __$$ |$$  __$$\\ 
 $$  $$<   $$$$$$$ |$$ |      $$ /  $$ |$$ /  $$ |$$$$$$$$ |
$$  /\\$$\\ $$  __$$ |$$ |  $$\\ $$ |  $$ |$$ |  $$ |$$   ____|
$$ /  $$ |\\$$$$$$$ |\\$$$$$$  |\\$$$$$$  |\\$$$$$$$ |\\$$$$$$$\\ 
\\__|  \\__| \\_______| \\______/  \\______/  \\_______| \\_______|${colors.reset}\n`);
        console.log(`${colors.green}XaCode Agent Info${colors.reset}`);
        console.log(`State: ${info.state}`);
        console.log(`Full Access Mode: ${info.fullAccess ? 'ENABLED' : 'DISABLED'}`);
        console.log(`Uptime: ${Math.round(info.metrics.uptimeMs / 1000)}s`);
        console.log(`Tokens Used: ${info.metrics.tokenUsage}`);
        console.log(`API Cost Estimate: $${info.metrics.apiCost.toFixed(4)}`);
        console.log(`Memory Usage: ${info.memory.usageTokens} / ${info.memory.maxTokens} tokens`);
      }
      break;

    case 'doctor':
      console.log(`${colors.yellow}Running diagnostics...${colors.reset}`);
      const doc: any = await sendIPCCommand('doctor');
      console.log(JSON.stringify(doc, null, 2));
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
      console.log('  info      - Show agent metrics and status');
      console.log('  doctor    - Run diagnostics');
      console.log('  status    - View current task status');
      console.log('  stop      - Halt agent execution');
      break;
  }
}

main().catch(err => {
  console.error(`${colors.red}CLI Error: ${err.message}${colors.reset}`);
});
