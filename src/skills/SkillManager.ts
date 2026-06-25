import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../logger';

export interface Skill {
  name: string;
  description: string;
  userInvocable: boolean;
  allowedTools: string[];
  filePath: string;
}

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private disabledSkills: Set<string> = new Set();
  private disabledSkillsPath: string;

  constructor() {
    this.disabledSkillsPath = path.join(os.homedir(), '.xacode', 'disabled_skills.json');
    this.loadDisabledSkills();
    this.scanSkills();
  }

  private loadDisabledSkills() {
    try {
      if (fs.existsSync(this.disabledSkillsPath)) {
        const data = JSON.parse(fs.readFileSync(this.disabledSkillsPath, 'utf8'));
        this.disabledSkills = new Set(data);
      }
    } catch (e) {
      logger.warn('Failed to load disabled skills.');
    }
  }

  private saveDisabledSkills() {
    try {
      const dir = path.dirname(this.disabledSkillsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.disabledSkillsPath, JSON.stringify(Array.from(this.disabledSkills), null, 2));
    } catch (e) {
      logger.warn('Failed to save disabled skills.');
    }
  }

  public toggleSkill(name: string): boolean {
    const lower = name.toLowerCase();
    let isEnabled = true;
    if (this.disabledSkills.has(lower)) {
      this.disabledSkills.delete(lower);
    } else {
      this.disabledSkills.add(lower);
      isEnabled = false;
    }
    this.saveDisabledSkills();
    return isEnabled;
  }
  
  public isSkillEnabled(name: string): boolean {
    return !this.disabledSkills.has(name.toLowerCase());
  }

  public getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  public scanSkills() {
    this.skills.clear();
    const homeSkillsDir = path.join(os.homedir(), '.xacode', 'skills');
    const projectSkillsDir = path.join(process.cwd(), '.xacode', 'skills');

    this.scanDirectory(homeSkillsDir);
    this.scanDirectory(projectSkillsDir);
    
    logger.info(`Loaded ${this.skills.size} skills from catalog.`);
  }

  private scanDirectory(baseDir: string) {
    if (!fs.existsSync(baseDir)) return;

    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(baseDir, entry.name, 'SKILL.md');
          if (fs.existsSync(skillPath)) {
            const skill = this.parseFrontmatter(skillPath, entry.name);
            if (skill) {
              this.skills.set(skill.name.toLowerCase(), skill);
            }
          }
        }
      }
    } catch (e: any) {
      logger.error(`Error scanning skills in ${baseDir}: ${e.message}`);
    }
  }

  private parseFrontmatter(filePath: string, folderName: string): Skill | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
      
      if (!match) return null;
      
      const frontmatter = match[1];
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      const userInvocableMatch = frontmatter.match(/^user-invocable:\s*(.+)$/m);
      const allowedToolsMatch = frontmatter.match(/^allowed-tools:\s*(.+)$/m);

      if (!nameMatch || !descMatch) {
        logger.warn(`Skill at ${filePath} is missing required 'name' or 'description'.`);
        return null;
      }

      const name = nameMatch[1].trim();
      
      // Name must match regex and folder name (mostly)
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(name)) {
        logger.warn(`Skill name '${name}' is invalid.`);
        return null;
      }

      const userInvocable = userInvocableMatch ? userInvocableMatch[1].trim() !== 'false' : true;
      const allowedTools = allowedToolsMatch ? allowedToolsMatch[1].split(',').map(s => s.trim()) : [];

      return {
        name,
        description: descMatch[1].trim(),
        userInvocable,
        allowedTools,
        filePath
      };
    } catch (e: any) {
      logger.error(`Failed to parse skill file ${filePath}: ${e.message}`);
      return null;
    }
  }

  public getSkillsCatalog(): string {
    const activeSkills = this.getAllSkills().filter(s => this.isSkillEnabled(s.name));
    if (activeSkills.length === 0) return '';
    
    let catalog = '\n📋 Доступні скіли (Agent Skills):\n';
    for (const skill of activeSkills) {
      catalog += `  /${skill.name} — ${skill.description}\n`;
    }
    catalog += `\nТи можеш використовувати ці скіли коли це доречно.\nЯкщо pre-loaded скіл підходить — виконай його інструкції.\n`;
    return catalog;
  }

  public getSkill(name: string): Skill | undefined {
    if (!this.isSkillEnabled(name)) return undefined;
    return this.skills.get(name.toLowerCase());
  }

  public getSkillBody(name: string): string | null {
    const skill = this.getSkill(name);
    if (!skill) return null;

    try {
      const content = fs.readFileSync(skill.filePath, 'utf8');
      // Strip frontmatter
      return content.replace(/^---\r?\n[\s\S]+?\r?\n---/, '').trim();
    } catch (e: any) {
      logger.error(`Failed to read skill body for ${name}: ${e.message}`);
      return null;
    }
  }

  public prefilterSkills(message: string): Skill[] {
    const matched: Skill[] = [];
    const lowerMessage = message.toLowerCase();

    for (const skill of this.getAllSkills().filter(s => this.isSkillEnabled(s.name))) {
      // Very basic keyword matching: split description into words > 3 chars
      const keywords = skill.description
        .toLowerCase()
        .replace(/[^\wа-яіїєґ]/gi, ' ')
        .split(' ')
        .filter(w => w.length > 3);
        
      if (keywords.some(k => lowerMessage.includes(k)) || lowerMessage.includes(skill.name)) {
        matched.push(skill);
      }
    }
    return matched;
  }
}

export const skillManager = new SkillManager();
