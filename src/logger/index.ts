import fs from 'fs';
import path from 'path';

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

class Logger {
  private logFile: string;

  constructor() {
    const logDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFile = path.join(logDir, `xacode_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  }

  private write(level: LogLevel, message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    const logLine = `[${timestamp}] [${level}] ${message}${formattedArgs}\n`;
    
    // Write to stdout
    if (level === LogLevel.ERROR) {
      console.error(logLine.trim());
    } else {
      console.log(logLine.trim());
    }

    // Write to file
    fs.appendFileSync(this.logFile, logLine);
  }

  info(message: string, ...args: any[]) { this.write(LogLevel.INFO, message, ...args); }
  warn(message: string, ...args: any[]) { this.write(LogLevel.WARN, message, ...args); }
  error(message: string, ...args: any[]) { this.write(LogLevel.ERROR, message, ...args); }
  debug(message: string, ...args: any[]) { this.write(LogLevel.DEBUG, message, ...args); }

  async uploadPaste(content: string, filename: string = 'log.txt'): Promise<string> {
    // Basic pastebin fallback for long logs. Using a public service or just saving locally and returning path.
    // For a real production app, integration with something like hastebin, gist, or a custom server is better.
    // For now, we will save to a temporary file in the sandbox and return the path, or a stub URL.
    const tempFile = path.join(process.cwd(), 'logs', `paste_${Date.now()}_${filename}`);
    fs.writeFileSync(tempFile, content);
    return `Saved to local file: ${tempFile} (Pastebin upload not configured)`;
  }
}

export const logger = new Logger();
