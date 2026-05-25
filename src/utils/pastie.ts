import fs from 'fs/promises';
import path from 'path';
import { logger } from '../logger';
import { config } from '../config';

interface PasteRecord {
  taskId: string;
  url: string;
  editCode: string;
  expiresAt: number;
}

const PASTES_FILE = path.resolve(process.cwd(), '.xacode_pastes.json');

class PastieManager {
  private pastes: PasteRecord[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadPastes().catch(e => logger.error('Failed to load pastes:', e));
  }

  private async loadPastes() {
    try {
      const data = await fs.readFile(PASTES_FILE, 'utf8');
      this.pastes = JSON.parse(data);
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        logger.error('Error reading pastes file:', e);
      }
      this.pastes = [];
    }
  }

  private async savePastes() {
    try {
      await fs.writeFile(PASTES_FILE, JSON.stringify(this.pastes, null, 2), 'utf8');
    } catch (e) {
      logger.error('Error saving pastes file:', e);
    }
  }

  public async uploadLog(taskId: string, text: string): Promise<string> {
    try {
      const response = await fetch('https://rentry.co/api/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://rentry.co'
        },
        body: `csrfmiddlewaretoken=&text=${encodeURIComponent(text)}`
      });

      const result = await response.json();
      if (result.status !== '200') {
        throw new Error(result.content || 'Failed to upload paste');
      }

      const url = result.url;
      const editCode = result.edit_code;
      const expiresAt = Date.now() + config.PASTE_LOGS_EXPIRY_MINUTES * 60 * 1000;

      this.pastes.push({ taskId, url, editCode, expiresAt });
      await this.savePastes();

      return url;
    } catch (error) {
      logger.error('Failed to upload log to rentry:', error);
      throw error;
    }
  }

  public async deleteLog(url: string, editCode: string): Promise<boolean> {
    try {
      // Extract the short code from url
      const shortCode = url.split('/').pop();
      if (!shortCode) return false;

      // Rentry doesn't have an explicit delete API, but we can blank it out
      const response = await fetch(`https://rentry.co/api/edit/${shortCode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `https://rentry.co/${shortCode}/edit`
        },
        body: `csrfmiddlewaretoken=&text=${encodeURIComponent('[DELETED]')}&edit_code=${encodeURIComponent(editCode)}`
      });

      const result = await response.json();
      return result.status === '200';
    } catch (error) {
      logger.error(`Failed to delete paste ${url}:`, error);
      return false;
    }
  }

  public getActivePastes(): PasteRecord[] {
    return [...this.pastes];
  }

  public async removePaste(url: string): Promise<boolean> {
    const pasteIndex = this.pastes.findIndex(p => p.url === url);
    if (pasteIndex === -1) return false;

    const paste = this.pastes[pasteIndex];
    const success = await this.deleteLog(paste.url, paste.editCode);
    
    if (success) {
      this.pastes.splice(pasteIndex, 1);
      await this.savePastes();
      return true;
    }
    return false;
  }

  public startCleanupTimer() {
    if (this.timer) clearInterval(this.timer);
    
    this.timer = setInterval(async () => {
      if (!config.PASTE_LOGS_ENABLED) return;
      
      const now = Date.now();
      const expired = this.pastes.filter(p => now >= p.expiresAt);
      
      for (const paste of expired) {
        logger.info(`Auto-deleting expired paste for task: ${paste.taskId} (${paste.url})`);
        const success = await this.deleteLog(paste.url, paste.editCode);
        if (success || Date.now() > paste.expiresAt + 86400000) {
          // If deleted successfully, or if it failed but it's older than 1 day, remove it locally
          this.pastes = this.pastes.filter(p => p.url !== paste.url);
          await this.savePastes();
        }
      }
    }, 60000); // Check every 1 minute
  }
}

export const pastieManager = new PastieManager();
