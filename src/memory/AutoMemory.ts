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

export interface SessionJSON {
  id: string;
  projectHash: string;
  startedAt: string;
  endedAt: string;
  status: string;
  task: string;
  messages: any[];
  filesModified: string[];
  filesRead: string[];
  decisions: string[];
  discoveries: string[];
  errors: any[];
  tokenUsage?: number;
  apiCost?: number;
}

export interface Checkpoint {
  id: number;
  name: string;
  sessionId: string;
  messageIndex: number;
  savedAt: string;
  summary: string;
}

export class AutoMemory {
  private baseDir: string;
  private projectHash: string | null = null;
  private memoryFilePath: string | null = null;
  private currentSessionId: string | null = null;
  private sessionStartedAt: string | null = null;

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

  public initNewSession() {
    const dateStr = new Date().toISOString().split('T')[0];
    const shortId = crypto.randomBytes(4).toString('hex');
    this.currentSessionId = `session_${dateStr}_${shortId}`;
    this.sessionStartedAt = new Date().toISOString();
  }

  public getCurrentSessionId(): string | null {
    return this.currentSessionId;
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

  public async saveSessionSnapshot(data: SessionMemoryData, messages: any[] = [], metrics: any = {}) {
    const hash = this.getProjectHash();
    if (!this.memoryFilePath) return;

    try {
      const projectDir = path.dirname(this.memoryFilePath);
      if (!fs.existsSync(projectDir)) {
        await fs.promises.mkdir(projectDir, { recursive: true });
      }

      // 1. Update memory.md (Snapshot)
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
      
      existingSessions = existingSessions.map(s => s.startsWith('## 📅') ? s : '## 📅' + s);
      existingSessions.push(newSessionStr);

      if (existingSessions.length > 10) {
        existingSessions = existingSessions.slice(existingSessions.length - 10);
      }

      await fs.promises.writeFile(this.memoryFilePath, existingSessions.join('\n---\n') + '\n');

      // 2. Save full session JSON
      if (!this.currentSessionId) {
         this.initNewSession();
      }

      const sessionObj: SessionJSON = {
        id: this.currentSessionId!,
        projectHash: hash,
        startedAt: this.sessionStartedAt || new Date().toISOString(),
        endedAt: new Date().toISOString(),
        status: data.status,
        task: data.task,
        messages: messages,
        filesModified: data.filesCreated,
        filesRead: data.filesRead,
        decisions: data.decisions,
        discoveries: data.discoveries,
        errors: data.errors,
        tokenUsage: metrics.tokenUsage || 0,
        apiCost: metrics.apiCost || 0
      };

      const sessionsDir = path.join(projectDir, 'sessions');
      if (!fs.existsSync(sessionsDir)) {
        await fs.promises.mkdir(sessionsDir, { recursive: true });
      }

      await fs.promises.writeFile(
        path.join(sessionsDir, `${this.currentSessionId}.json`),
        JSON.stringify(sessionObj, null, 2),
        'utf8'
      );

      logger.info(`Session ${this.currentSessionId} fully saved to disk.`);

    } catch (err: any) {
      logger.warn(`Failed to save Auto Memory: ${err.message}`);
    }
  }

  // --- Session Management ---

  public async loadSession(sessionId?: string): Promise<SessionJSON | null> {
    const hash = this.getProjectHash();
    const sessionsDir = path.join(this.baseDir, hash, 'sessions');
    
    if (!fs.existsSync(sessionsDir)) return null;

    try {
      if (sessionId) {
        const p = path.join(sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(p)) {
          return JSON.parse(await fs.promises.readFile(p, 'utf8'));
        }
        return null;
      } else {
        // Load latest
        const files = await fs.promises.readdir(sessionsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        if (jsonFiles.length === 0) return null;
        
        jsonFiles.sort((a, b) => fs.statSync(path.join(sessionsDir, b)).mtimeMs - fs.statSync(path.join(sessionsDir, a)).mtimeMs);
        const latest = jsonFiles[0];
        return JSON.parse(await fs.promises.readFile(path.join(sessionsDir, latest), 'utf8'));
      }
    } catch (e: any) {
      logger.error(`Error loading session: ${e.message}`);
      return null;
    }
  }

  public async listSessions(): Promise<any[]> {
    const hash = this.getProjectHash();
    const sessionsDir = path.join(this.baseDir, hash, 'sessions');
    if (!fs.existsSync(sessionsDir)) return [];

    try {
      const files = await fs.promises.readdir(sessionsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      const sessions = [];
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(sessionsDir, file);
          const stat = await fs.promises.stat(filePath);
          const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
          const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
          sessions.push({
            id: data.id,
            date: data.startedAt,
            status: data.status,
            task: data.task,
            name: data.userName,
            sizeMb: sizeMb
          });
        } catch(e) {}
      }
      sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return sessions;
    } catch (e: any) {
      logger.error(`Error listing sessions: ${e.message}`);
      return [];
    }
  }

  public async renameSession(id: string, newName: string): Promise<boolean> {
    const hash = this.getProjectHash();
    const sessionPath = path.join(this.baseDir, hash, 'sessions', `${id}.json`);
    if (fs.existsSync(sessionPath)) {
      const data = JSON.parse(await fs.promises.readFile(sessionPath, 'utf8'));
      data.task = newName;
      data.renamedAt = new Date().toISOString();
      await fs.promises.writeFile(sessionPath, JSON.stringify(data, null, 2));
      return true;
    }
    return false;
  }

  public async deleteSession(id: string): Promise<boolean> {
    const hash = this.getProjectHash();
    const sessionPath = path.join(this.baseDir, hash, 'sessions', `${id}.json`);
    if (fs.existsSync(sessionPath)) {
      await fs.promises.unlink(sessionPath);
      return true;
    }
    return false;
  }

  // --- Checkpoints Management ---

  public async saveCheckpoint(name: string, messageIndex: number, summary: string): Promise<boolean> {
    const hash = this.getProjectHash();
    if (!this.currentSessionId) return false;

    const favoritesPath = path.join(this.baseDir, hash, 'favorites.json');
    try {
      let data = { projectHash: hash, checkpoints: [] as Checkpoint[] };
      if (fs.existsSync(favoritesPath)) {
        data = JSON.parse(await fs.promises.readFile(favoritesPath, 'utf8'));
      }

      const id = data.checkpoints.length > 0 ? Math.max(...data.checkpoints.map(c => c.id)) + 1 : 1;

      data.checkpoints.push({
        id,
        name,
        sessionId: this.currentSessionId,
        messageIndex,
        savedAt: new Date().toISOString(),
        summary
      });

      await fs.promises.writeFile(favoritesPath, JSON.stringify(data, null, 2));
      return true;
    } catch (e: any) {
      logger.error(`Failed to save checkpoint: ${e.message}`);
      return false;
    }
  }

  public async listCheckpoints(): Promise<Checkpoint[]> {
    const hash = this.getProjectHash();
    const favoritesPath = path.join(this.baseDir, hash, 'favorites.json');
    if (!fs.existsSync(favoritesPath)) return [];
    try {
      const data = JSON.parse(await fs.promises.readFile(favoritesPath, 'utf8'));
      return data.checkpoints || [];
    } catch (e) {
      return [];
    }
  }

  public async getCheckpoint(id: number): Promise<Checkpoint | null> {
    const cps = await this.listCheckpoints();
    return cps.find(c => c.id === id) || null;
  }
}

export const autoMemory = new AutoMemory();
