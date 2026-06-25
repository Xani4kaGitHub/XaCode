import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { logger } from '../logger';

export interface SessionMemoryData {
  date: string;
  task: string;
  status: string;
  filesCreated: string[];
  filesRead: string[];
  decisions: string[];
  discoveries: string[];
  errors: { tool: string; summary: string }[];
}

export class AutoMemory {
  private baseDir: string;
  private projectHash: string | null = null;
  private memoryFilePath: string | null = null;

  constructor() {
    this.baseDir = path.join(os.homedir(), '.xacode', 'projects');
  }

  private getProjectHash(): string {
    if (this.projectHash) return this.projectHash;

    let idString = '';
    
    // Priority 1: git remote origin url
    try {
      idString = execSync('git config --get remote.origin.url', { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (e) {}

    // Priority 2: git root path
    if (!idString) {
      try {
        idString = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: 'pipe' }).trim();
      } catch (e) {}
    }

    // Priority 3: cwd
    if (!idString) {
      idString = process.cwd();
    }

    this.projectHash = crypto.createHash('sha256').update(idString).digest('hex').substring(0, 16);
    this.memoryFilePath = path.join(this.baseDir, this.projectHash, 'memory.md');
    return this.projectHash;
  }

  public async loadLastMemory(): Promise<string | null> {
    const hash = this.getProjectHash();
    if (!this.memoryFilePath) return null;

    try {
      if (!fs.existsSync(this.memoryFilePath)) return null;
      
      const content = await fs.promises.readFile(this.memoryFilePath, 'utf8');
      const sessions = content.split('---\n## 📅').filter(s => s.trim());
      
      if (sessions.length === 0) return null;
      
      // Get the very last session
      const lastSessionRaw = sessions[sessions.length - 1];
      const lastSession = lastSessionRaw.startsWith('## 📅') ? lastSessionRaw : '## 📅' + lastSessionRaw;

      // Extract date to check if it's older than 7 days
      const dateMatch = lastSession.match(/## 📅 ([\d-]+)/);
      if (dateMatch) {
        const sessionDate = new Date(dateMatch[1]);
        const daysOld = (Date.now() - sessionDate.getTime()) / (1000 * 60 * 60 * 24);
        
        // If older than 7 days and not FAILED, ignore
        if (daysOld > 7 && !lastSession.includes('FAILED')) {
          return null;
        }
      }

      return `[CONTEXT FROM PREVIOUS SESSION]\n${lastSession.trim()}`;
    } catch (err: any) {
      logger.warn(`Failed to load Auto Memory: ${err.message}`);
      return null;
    }
  }

  public async saveSessionSnapshot(data: SessionMemoryData) {
    const hash = this.getProjectHash();
    if (!this.memoryFilePath) return;

    try {
      const projectDir = path.dirname(this.memoryFilePath);
      if (!fs.existsSync(projectDir)) {
        await fs.promises.mkdir(projectDir, { recursive: true });
      }

      let existingSessions: string[] = [];
      if (fs.existsSync(this.memoryFilePath)) {
        const content = await fs.promises.readFile(this.memoryFilePath, 'utf8');
        existingSessions = content.split('---\n## 📅').filter(s => s.trim());
      }

      // Format new session
      const lines: string[] = [];
      lines.push(`## 📅 ${data.date} | Status: ${data.status}`);
      if (data.task) lines.push(`🎯 Task: ${data.task}`);
      if (data.filesCreated.length) lines.push(`📁 Created/Edited: ${data.filesCreated.join(', ')}`);
      if (data.filesRead.length) lines.push(`📖 Read: ${data.filesRead.join(', ')}`);
      if (data.decisions.length) lines.push(`🧭 Decisions: ${data.decisions.join('; ')}`);
      if (data.discoveries.length) lines.push(`💡 Discoveries: ${data.discoveries.join('; ')}`);
      
      if (data.errors.length) {
        // Take only last 3 errors
        const lastErrors = data.errors.slice(-3);
        lines.push(`❌ Errors: ${lastErrors.map(e => `${e.tool}: ${e.summary}`).join('; ')}`);
      }

      const newSessionStr = lines.join('\n');
      
      // Ensure we have '## 📅' prefix back for existing sessions
      existingSessions = existingSessions.map(s => s.startsWith('## 📅') ? s : '## 📅' + s);
      existingSessions.push(newSessionStr);

      // Keep only last 10 sessions
      if (existingSessions.length > 10) {
        existingSessions = existingSessions.slice(existingSessions.length - 10);
      }

      await fs.promises.writeFile(this.memoryFilePath, existingSessions.join('\n---\n') + '\n');
    } catch (err: any) {
      logger.warn(`Failed to save Auto Memory: ${err.message}`);
    }
  }
}

export const autoMemory = new AutoMemory();
