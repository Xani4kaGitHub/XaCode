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
      if (!query.message || !query.data) return;
      const chatId = query.message.chat.id;
      const userId = query.from.id;

      if (!securityManager.isUserAllowed(userId)) return;

      if (query.data.startsWith('model:')) {
        const selectedModel = query.data.split(':')[1];
        
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

        await this.bot.editMessageText(`✅ Model successfully switched to: **${selectedModel}**`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
      }
      
      this.bot.answerCallbackQuery(query.id);
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
        const modelMsg = `🧠 **DeepSeek Model Selection**\n\n`
          + `Current active model: \`${config.DEEPSEEK_MODEL}\`\n\n`
          + `*Promo Prices (Ukraine, May 2026):*\n`
          + `🚀 **V4 Pro**: $0.435 (In) / $0.87 (Out)\n`
          + `⚡ **V4 Flash**: $0.14 (In) / $0.28 (Out)\n\n`
          + `Select the model you want to use:`;
          
        await this.bot.sendMessage(chatId, modelMsg, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🚀 V4 Pro ($0.435)', callback_data: 'model:deepseek-v4-pro' },
                { text: '⚡ V4 Flash ($0.14)', callback_data: 'model:deepseek-v4-flash' }
              ]
            ]
          }
        });
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
