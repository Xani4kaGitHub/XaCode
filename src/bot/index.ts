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
      const statusCallback = async (updateMsg: string) => {
        try {
          await this.sendChunkedMessage(chatId, updateMsg);
        } catch (err) {
          logger.error('Failed to send telegram msg:', err);
        }
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
        const helpMsg = `🤖 *XaCode Enterprise Bot v1.1.0*\n`
          + `────────────────────────\n`
          + `Here are the available commands:\n\n`
          + `📊 *Status & Analytics*\n`
          + `• \`/status\` — View current task status\n`
          + `• \`/plan\` — View current execution plan\n`
          + `• \`/cost\` — View persistent API costs\n`
          + `• \`/files\` — List files modified by current task\n\n`
          + `⚙️ *Configuration*\n`
          + `• \`/model\` — Switch DeepSeek API model\n`
          + `• \`/fullaccess <enable|disable>\` — Manage Full Access mode\n\n`
          + `🛠 *System*\n`
          + `• \`/sandbox clear\` — Wipe the sandbox directory\n`
          + `• \`/workspace\` — Show current workspace info\n`
          + `• \`/terminal\` — Info about background terminals\n\n`
          + `🛑 *Control*\n`
          + `• \`/stop\` — Abort current task immediately\n`
          + `• \`/reset\` — Clear bot memory and context`;
        await this.bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
        break;
      case '/plan':
        const context = memoryManager.getTaskContext();
        const planMsg = `📋 *Current Execution Plan*\n`
          + `────────────────────────\n`
          + `• *Task:* \`${context.originalRequest || 'None'}\`\n`
          + `• *Step:* \`${context.currentStep || 'Idle'}\``;
        await this.bot.sendMessage(chatId, planMsg, { parse_mode: 'Markdown' });
        break;
      case '/status':
        const ctx = memoryManager.getTaskContext();
        const statusMsg = `📊 *Agent Current Status*\n`
          + `────────────────────────\n`
          + `• *🚦 Status:* *${ctx.status}*\n`
          + `• *📝 Task:* \`${ctx.originalRequest || 'None'}\`\n`
          + `• *📍 Step:* \`${ctx.currentStep || 'Idle'}\`\n`
          + `• *📁 Files Modified:* *${ctx.filesModified.length}*`;
        await this.bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
        break;
      case '/stop':
        agentCore.stop();
        terminalManager.killAll();
        const stopMsg = `🛑 *Execution Halted*\n`
          + `────────────────────────\n`
          + `Agent execution has been aborted immediately.\n`
          + `All active background processes have been terminated.`;
        await this.bot.sendMessage(chatId, stopMsg, { parse_mode: 'Markdown' });
        break;
      case '/reset':
        memoryManager.resetSession('You are XaCode.');
        const resetMsg = `🧹 *Session Reset*\n`
          + `────────────────────────\n`
          + `Agent memory and context have been completely cleared.\n`
          + `Ready for a new task!`;
        await this.bot.sendMessage(chatId, resetMsg, { parse_mode: 'Markdown' });
        break;
      case '/workspace':
        const wsMsg = `📁 *Workspace Environment*\n`
          + `────────────────────────\n`
          + `• *Sandbox Path:* \`${config.SANDBOX_DIR}\`\n`
          + `• *Security Mode:* *${permissionSystem.isFullAccess() ? '⚠️ FULL ACCESS' : '🔒 RESTRICTED SANDBOX'}*`;
        await this.bot.sendMessage(chatId, wsMsg, { parse_mode: 'Markdown' });
        break;
      case '/fullaccess':
        const subcmd = text.split(' ')[1];
        if (subcmd === 'enable' || subcmd === 'confirm') {
          permissionSystem.enableFullAccess();
          const faEnableMsg = `⚠️ *FULL ACCESS ENABLED*\n`
            + `────────────────────────\n`
            + `Dangerous commands are now permitted outside the sandbox for the next *15 minutes*.\n`
            + `All actions are logged and audited.`;
          await this.bot.sendMessage(chatId, faEnableMsg, { parse_mode: 'Markdown' });
        } else if (subcmd === 'disable') {
          permissionSystem.disableFullAccess();
          const faDisableMsg = `🔒 *RESTRICTED SANDBOX ACTIVATED*\n`
            + `────────────────────────\n`
            + `Full Access has been disabled. Actions are restricted to the sandbox.`;
          await this.bot.sendMessage(chatId, faDisableMsg, { parse_mode: 'Markdown' });
        } else {
          const faStatusMsg = `🛡 *Access Security Status*\n`
            + `────────────────────────\n`
            + `• *Current Mode:* *${permissionSystem.isFullAccess() ? '⚠️ FULL ACCESS (15m)' : '🔒 RESTRICTED (Sandbox only)'}*\n\n`
            + `• To enable: \`/fullaccess enable\`\n`
            + `• To disable: \`/fullaccess disable\``;
          await this.bot.sendMessage(chatId, faStatusMsg, { parse_mode: 'Markdown' });
        }
        break;
      case '/files':
        const files = memoryManager.getTaskContext().filesModified;
        const filesMsg = `📂 *Modified Files Log*\n`
          + `────────────────────────\n`
          + `${files.length > 0 ? files.map(f => `• \`${f}\``).join('\n') : '_No files modified in this session._'}`;
        await this.bot.sendMessage(chatId, filesMsg, { parse_mode: 'Markdown' });
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

          const switchMsg = `✅ *Model Switched Successfully*\n`
            + `────────────────────────\n`
            + `Active model is now: \`${modelArg}\``;
          await this.bot.sendMessage(chatId, switchMsg, { parse_mode: 'Markdown' });
        } else {
          const modelMsg = `🧠 *DeepSeek Model Selection*\n`
            + `────────────────────────\n`
            + `• *Current Model:* \`${config.DEEPSEEK_MODEL}\`\n\n`
            + `*Promo Pricing (Ukraine, May 2026):*\n`
            + `• 🚀 *V4 Pro*: $0.435 (In) / $0.870 (Out)\n`
            + `• ⚡ *V4 Flash*: $0.140 (In) / $0.280 (Out)\n\n`
            + `Click a button below or type \`/model [name]\` to switch:`;
            
          const replyMarkup = {
            inline_keyboard: [
              [
                { text: '🚀 V4 Pro', callback_data: 'model:deepseek-v4-pro' },
                { text: '⚡ V4 Flash', callback_data: 'model:deepseek-v4-flash' }
              ]
            ]
          };

          await this.bot.sendMessage(chatId, modelMsg, { 
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
          });
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
          const sbMsg = `🧹 *Sandbox Wiped*\n`
            + `────────────────────────\n`
            + `The sandbox directory has been securely cleared.`;
          await this.bot.sendMessage(chatId, sbMsg, { parse_mode: 'Markdown' });
        } else {
          await this.bot.sendMessage(chatId, '❓ *Usage:* \`/sandbox clear\`', { parse_mode: 'Markdown' });
        }
        break;
      case '/cost':
        const { metricsTracker } = require('../metrics/MetricsTracker');
        const session = metricsTracker.getMetrics();
        const persistent = metricsTracker.getPersistentMetrics();
        const costMsg = `💰 *XaCode Financial Analytics*\n`
          + `────────────────────────\n`
          + `📊 *All-Time Usage (Persistent)*\n`
          + `• Tokens: \`${persistent.tokenUsage.toLocaleString()}\`\n`
          + `• Cost: *$${persistent.apiCost.toFixed(4)}*\n\n`
          + `⏱ *Current Session*\n`
          + `• Tokens: \`${session.tokenUsage.toLocaleString()}\`\n`
          + `• Cost: *$${session.apiCost.toFixed(4)}*`;
        await this.bot.sendMessage(chatId, costMsg, { parse_mode: 'Markdown' });
        break;
      case '/terminal':
        const termMsg = `💻 *Background Terminals*\n`
          + `────────────────────────\n`
          + `• *Active Processes:* *${terminalManager.getActiveProcessesCount()}*\n\n`
          + `_Background processes are monitored and closed automatically. Check logs for details._`;
        await this.bot.sendMessage(chatId, termMsg, { parse_mode: 'Markdown' });
        break;
      default:
        await this.bot.sendMessage(chatId, '❓ *Unknown command.*\nType `/help` to see all available commands.', { parse_mode: 'Markdown' });
    }
  }

  /**
   * Helper to send long messages bypassing the 4096 character Telegram limit
   */
  private async sendChunkedMessage(chatId: number, text: string) {
    const MAX_LENGTH = 4000;
    
    // Helper to format/sanitize text for Telegram Markdown V1
    const formatText = (val: string) => {
      // Standard markdown bold is **, Telegram Markdown V1 uses *
      return val.replace(/\*\*/g, '*');
    };

    const send = async (msgText: string) => {
      const formatted = formatText(msgText);
      try {
        await this.bot.sendMessage(chatId, formatted, { parse_mode: 'Markdown' });
      } catch (err: any) {
        logger.warn(`Failed to send message as Markdown, falling back to plain text: ${err.message}`);
        await this.bot.sendMessage(chatId, msgText);
      }
    };

    if (text.length <= MAX_LENGTH) {
      await send(text);
      return;
    }

    let remaining = text;
    while (remaining.length > 0) {
      const chunk = remaining.substring(0, MAX_LENGTH);
      remaining = remaining.substring(MAX_LENGTH);
      await send(chunk);
    }
  }
}

export const botService = new BotService();
