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

    this.bot.on('callback_query', async (query) => {
      logger.info(`Received callback query: ${JSON.stringify(query)}`);
      try {
        if (!query.message || !query.data) {
          logger.warn('Callback query missing message or data');
          return;
        }
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        logger.info(`Callback from user ${userId}, data: ${query.data}`);

        if (!securityManager.isUserAllowed(userId)) {
          logger.warn(`User ${userId} not allowed for callback`);
          return;
        }

        logger.info('User allowed, processing model switch...');

        if (query.data.startsWith('model:')) {
          const selectedModel = query.data.split(':')[1];
          logger.info(`Selected model: ${selectedModel}`);
          
          // Update in memory and file
          const envPath = require('path').join(process.cwd(), '.env');
          const fs = require('fs');
          let envContent = fs.readFileSync(envPath, 'utf8');
          if (!envContent.includes('DEEPSEEK_MODEL=')) {
            envContent += `\nDEEPSEEK_MODEL=${selectedModel}`;
          } else {
            envContent = envContent.replace(/DEEPSEEK_MODEL=.*/, `DEEPSEEK_MODEL=${selectedModel}`);
          }
          config.DEEPSEEK_MODEL = selectedModel;
          fs.writeFileSync(envPath, envContent);

          logger.info('Model switch complete, showing alert popup.');
          // We show an alert popup instead of editing the message text to avoid any Telegram parsing errors
          await this.bot.answerCallbackQuery(query.id, {
            text: `✅ Model switched to: ${selectedModel}`,
            show_alert: true
          });
          
          logger.info('Attempting to edit message text...');
          // Optionally, edit the message to remove buttons but keep it simple text
          try {
            await this.bot.editMessageText(`Model is now: ${selectedModel}`, {
              chat_id: chatId,
              message_id: query.message.message_id
            });
            logger.info('Message text edited successfully.');
          } catch (e: any) {
            logger.error(`Ignored edit error: ${e.message}`);
          }
        } else {
          logger.warn(`Unknown callback data: ${query.data}`);
        }
      } catch (error: any) {
        logger.error(`Callback error: ${error.message}`);
        if (query.message) {
          await this.bot.sendMessage(query.message.chat.id, `❌ Error switching model: ${error.message}`);
        }
      } finally {
        this.bot.answerCallbackQuery(query.id).catch(() => {});
      }
    });
  }

  private async handleCommand(chatId: number, text: string) {
    const cmd = text.split(' ')[0].toLowerCase();
    switch (cmd) {
      case '/start':
      case '/help':
        const helpMsg = `🤖 **XaCode Enterprise Bot**\n\n`
          + `Here are the available commands:\n\n`
          + `📊 **Status & Analytics**\n`
          + `/status - View current task status\n`
          + `/plan - View current execution plan\n`
          + `/cost - View persistent API costs\n`
          + `/files - List files modified by current task\n\n`
          + `⚙️ **Configuration**\n`
          + `/model - Switch DeepSeek API model\n`
          + `/fullaccess <enable|disable> - Manage Full Access mode\n\n`
          + `🛠 **System**\n`
          + `/sandbox clear - Wipe the sandbox directory\n`
          + `/workspace - Show current workspace info\n`
          + `/terminal - Info about background terminals\n\n`
          + `🛑 **Control**\n`
          + `/stop - Abort current task immediately\n`
          + `/reset - Clear bot memory and context`;
        await this.bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
        break;
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
      case '/model':
        const modelArg = text.split(' ')[1];
        if (modelArg) {
          // Update in memory and file
          const envPath = require('path').join(process.cwd(), '.env');
          const fs = require('fs');
          let envContent = fs.readFileSync(envPath, 'utf8');
          if (!envContent.includes('DEEPSEEK_MODEL=')) {
            envContent += `\nDEEPSEEK_MODEL=${modelArg}`;
          } else {
            envContent = envContent.replace(/DEEPSEEK_MODEL=.*/, `DEEPSEEK_MODEL=${modelArg}`);
          }
          config.DEEPSEEK_MODEL = modelArg;
          fs.writeFileSync(envPath, envContent);

          await this.bot.sendMessage(chatId, `✅ Model successfully switched to: ${modelArg}`);
        } else {
          const modelMsg = `🧠 **DeepSeek Model Selection**\n\n`
            + `Current active model: \`${config.DEEPSEEK_MODEL}\`\n\n`
            + `*Promo Prices (Ukraine, May 2026):*\n`
            + `🚀 **V4 Pro**: $0.435 (In) / $0.87 (Out)\n`
            + `⚡ **V4 Flash**: $0.14 (In) / $0.28 (Out)\n\n`
            + `To switch models, type:\n`
            + `/model deepseek-v4-pro\n`
            + `/model deepseek-v4-flash`;
            
          await this.bot.sendMessage(chatId, modelMsg, { parse_mode: 'Markdown' });
        }
        break;
      case '/sandbox':
        const sbArg = text.split(' ')[1];
        if (sbArg === 'clear') {
          const fs = require('fs');
          const path = require('path');
          const sandboxDir = path.join(process.cwd(), 'sandbox');
          if (fs.existsSync(sandboxDir)) {
            fs.rmSync(sandboxDir, { recursive: true, force: true });
            fs.mkdirSync(sandboxDir);
          }
          await this.bot.sendMessage(chatId, '🧹 Sandbox directory has been securely cleared.');
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/sandbox clear`', { parse_mode: 'Markdown' });
        }
        break;
      case '/cost':
        const { metricsTracker } = require('../metrics/MetricsTracker');
        const session = metricsTracker.getMetrics();
        const persistent = metricsTracker.getPersistentMetrics();
        const costMsg = `💰 **XaCode Financial Analytics**\n\n`
          + `*All-Time Usage (Persistent):*\n`
          + `- Total Tokens: ${persistent.tokenUsage.toLocaleString()}\n`
          + `- Total Cost: $${persistent.apiCost.toFixed(4)}\n\n`
          + `*Current Session:*\n`
          + `- Session Tokens: ${session.tokenUsage.toLocaleString()}\n`
          + `- Session Cost: $${session.apiCost.toFixed(4)}`;
        await this.bot.sendMessage(chatId, costMsg, { parse_mode: 'Markdown' });
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
