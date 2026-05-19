import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { securityManager } from '../security';
import { agentCore } from '../agent';
import { memoryManager } from '../memory';
import { terminalManager } from '../terminal';
import { logger } from '../logger';
import { permissionSystem } from '../security/PermissionSystem';

export class BotService {
  private bot: TelegramBot;

  constructor() {
    this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
    this.setupListeners();
    logger.info('Telegram Bot initialized.');
  }

  private setupListeners() {
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const text = msg.text || '';

      if (!userId || !securityManager.isUserAllowed(userId)) {
        logger.warn(`Unauthorized access attempt from user ID: ${userId}`);
        return;
      }

      // Ignore if it's not a text message
      if (!text) return;

      // Handle Commands
      if (text.startsWith('/')) {
        await this.handleCommand(chatId, text);
        return;
      }

      // Handle normal task
      const statusCallback = (updateMsg: string) => {
        this.bot.sendMessage(chatId, updateMsg).catch(err => logger.error('Failed to send telegram msg:', err));
      };

      agentCore.handleTask(text, statusCallback);
    });
  }

  private async handleCommand(chatId: number, text: string) {
    const cmd = text.split(' ')[0].toLowerCase();
    switch (cmd) {
      case '/plan':
        const context = memoryManager.getTaskContext();
        await this.bot.sendMessage(chatId, `Current Task: ${context.originalRequest || 'None'}\nStep: ${context.currentStep}`);
        break;
      case '/status':
        const ctx = memoryManager.getTaskContext();
        await this.bot.sendMessage(chatId, `Agent Status: ${ctx.status}\nTask: ${ctx.originalRequest}\nStep: ${ctx.currentStep}\nFiles Modified: ${ctx.filesModified.length}`);
        break;
      case '/stop':
        agentCore.stop();
        terminalManager.killAll();
        await this.bot.sendMessage(chatId, 'Agent and all background terminals stopped immediately.');
        break;
      case '/reset':
        memoryManager.resetSession('You are XaCode.');
        await this.bot.sendMessage(chatId, 'Memory and context have been completely reset.');
        break;
      case '/workspace':
        await this.bot.sendMessage(chatId, `Current Workspace: Active Sandbox`);
        break;
      case '/fullaccess':
        const subcmd = text.split(' ')[1];
        if (subcmd === 'enable' || subcmd === 'confirm') {
          permissionSystem.enableFullAccess();
          await this.bot.sendMessage(chatId, '⚠️ FULL ACCESS MODE ENABLED. Dangerous commands are permitted for the next 15 minutes. All actions are audited.');
        } else if (subcmd === 'disable') {
          permissionSystem.disableFullAccess();
          await this.bot.sendMessage(chatId, 'Full Access Mode disabled.');
        } else {
          await this.bot.sendMessage(chatId, `Full Access Status: ${permissionSystem.isFullAccess() ? 'ENABLED' : 'DISABLED'}`);
        }
        break;
      case '/files':
        const files = memoryManager.getTaskContext().filesModified;
        await this.bot.sendMessage(chatId, `Modified Files:\n${files.length > 0 ? files.join('\n') : 'No files modified yet.'}`);
        break;
      case '/terminal':
        await this.bot.sendMessage(chatId, 'Active background processes are managed automatically. Check logs for details.');
        break;
      default:
        await this.bot.sendMessage(chatId, 'Unknown command.');
    }
  }
}

export const botService = new BotService();
