import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { securityManager } from '../security';
import fs from 'fs';
import path from 'path';
import { agentCore } from '../agent';
import { memoryManager } from '../memory';
import { terminalManager } from '../terminal';
import { logger } from '../logger';
import { permissionSystem } from '../security/PermissionSystem';

export class BotService {
  private bot: TelegramBot;
  private pendingVoiceTasks = new Map<string, string>();

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

      if (msg.voice) {
        await this.handleVoiceMessage(chatId, msg);
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
         } else if (query.data.startsWith('voice_accept:')) {
          const taskId = query.data.split(':')[1];
          const taskText = this.pendingVoiceTasks.get(taskId);
          if (!taskText) {
            await this.bot.answerCallbackQuery(query.id, { text: '❌ Task not found or expired', show_alert: true });
            return;
          }
          this.pendingVoiceTasks.delete(taskId);
          
          await this.bot.answerCallbackQuery(query.id, { text: '✅ Task accepted!' });
          
          try {
            await this.bot.editMessageText(`🎙 *Transcribed Task Accepted:*\n_"${taskText}"_\n\n🚀 Starting execution...`, {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            });
          } catch (e: any) {
            logger.error(`Ignored edit error: ${e.message}`);
          }
          
          const statusCallback = async (updateMsg: string) => {
            try {
              await this.sendChunkedMessage(chatId, updateMsg);
            } catch (err) {
              logger.error('Failed to send telegram msg:', err);
            }
          };
          agentCore.handleTask(taskText, statusCallback);
          
        } else if (query.data.startsWith('voice_cancel:')) {
          const taskId = query.data.split(':')[1];
          this.pendingVoiceTasks.delete(taskId);
          
          await this.bot.answerCallbackQuery(query.id, { text: '❌ Task cancelled' });
          
          try {
            await this.bot.editMessageText(`❌ *Transcription Cancelled.*`, {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            });
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
          + `• \`/config\` — View and modify system limits\n`
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
          const durationStr = text.split(' ')[2];
          let durationMs = 15 * 60 * 1000;
          if (durationStr) {
            const parsed = parseDurationToMs(durationStr);
            if (parsed !== null && parsed > 0) {
              durationMs = parsed;
            }
          }
          permissionSystem.enableFullAccess(durationMs);
          const minutes = Math.round(durationMs / 60 / 1000);
          const faEnableMsg = `⚠️ *FULL ACCESS ENABLED*\n`
            + `────────────────────────\n`
            + `Dangerous commands are now permitted outside the sandbox for the next *${minutes} minutes*.\n`
            + `All actions are logged and audited.`;
          await this.bot.sendMessage(chatId, faEnableMsg, { parse_mode: 'Markdown' });
        } else if (subcmd === 'disable') {
          permissionSystem.disableFullAccess();
          const faDisableMsg = `🔒 *RESTRICTED SANDBOX ACTIVATED*\n`
            + `────────────────────────\n`
            + `Full Access has been disabled. Actions are restricted to the sandbox.`;
          await this.bot.sendMessage(chatId, faDisableMsg, { parse_mode: 'Markdown' });
        } else {
          const isFA = permissionSystem.isFullAccess();
          const remainingMin = permissionSystem.getFullAccessRemainingMinutes();
          const faStatusMsg = `🛡 *Access Security Status*\n`
            + `────────────────────────\n`
            + `• *Current Mode:* *${isFA ? `⚠️ FULL ACCESS (${remainingMin}m remaining)` : '🔒 RESTRICTED (Sandbox only)'}*\n\n`
            + `• To enable: \`/fullaccess enable\` (15 minutes)\n`
            + `• To enable custom duration: \`/fullaccess enable <duration>\` (e.g. \`30m\`, \`2h\`)\n`
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
      case '/config':
        const cfgSubcmd = text.split(' ')[1];
        const cfgValStr = text.split(' ')[2];
        if (cfgSubcmd && cfgValStr) {
          const envPath = require('path').join(process.cwd(), '.env');
          const fs = require('fs');
          let envContent = fs.readFileSync(envPath, 'utf8');
          
          if (cfgSubcmd === 'loops') {
            const num = parseInt(cfgValStr, 10);
            if (!isNaN(num) && num > 0) {
              if (!envContent.includes('MAX_LOOPS=')) {
                envContent += `\nMAX_LOOPS=${num}`;
              } else {
                envContent = envContent.replace(/MAX_LOOPS=.*/, `MAX_LOOPS=${num}`);
              }
              config.MAX_LOOPS = num;
              fs.writeFileSync(envPath, envContent);
              await this.bot.sendMessage(chatId, `✅ *Configuration Updated*\n────────────────────────\n• *MAX_LOOPS* is now set to \`${num}\``, { parse_mode: 'Markdown' });
            } else {
              await this.bot.sendMessage(chatId, `❌ *Invalid Value:* Please specify a positive integer for loops.`, { parse_mode: 'Markdown' });
            }
          } else if (cfgSubcmd === 'timeout') {
            const num = parseInt(cfgValStr, 10);
            if (!isNaN(num) && num > 0) {
              if (!envContent.includes('MAX_EXECUTION_TIMEOUT_MS=')) {
                envContent += `\nMAX_EXECUTION_TIMEOUT_MS=${num}`;
              } else {
                envContent = envContent.replace(/MAX_EXECUTION_TIMEOUT_MS=.*/, `MAX_EXECUTION_TIMEOUT_MS=${num}`);
              }
              config.MAX_EXECUTION_TIMEOUT_MS = num;
              fs.writeFileSync(envPath, envContent);
              await this.bot.sendMessage(chatId, `✅ *Configuration Updated*\n────────────────────────\n• *MAX_EXECUTION_TIMEOUT_MS* is now set to \`${num}\` ms`, { parse_mode: 'Markdown' });
            } else {
              await this.bot.sendMessage(chatId, `❌ *Invalid Value:* Please specify a positive integer for timeout.`, { parse_mode: 'Markdown' });
            }
          } else if (cfgSubcmd === 'reasoning') {
            const isTrue = cfgValStr.toLowerCase() === 'true' || cfgValStr === '1';
            const isFalse = cfgValStr.toLowerCase() === 'false' || cfgValStr === '0';
            if (isTrue || isFalse) {
              const val = isTrue ? 'true' : 'false';
              if (!envContent.includes('SHOW_REASONING=')) {
                envContent += `\nSHOW_REASONING=${val}`;
              } else {
                envContent = envContent.replace(/SHOW_REASONING=.*/, `SHOW_REASONING=${val}`);
              }
              config.SHOW_REASONING = isTrue;
              fs.writeFileSync(envPath, envContent);
              await this.bot.sendMessage(chatId, `✅ *Configuration Updated*\n────────────────────────\n• *SHOW_REASONING* is now set to \`${val}\``, { parse_mode: 'Markdown' });
            } else {
              await this.bot.sendMessage(chatId, `❌ *Invalid Value:* Please specify \`true\` or \`false\`.`, { parse_mode: 'Markdown' });
            }
          } else if (cfgSubcmd === 'loop_limit') {
            const isTrue = cfgValStr.toLowerCase() === 'true' || cfgValStr === 'on' || cfgValStr === '1';
            const isFalse = cfgValStr.toLowerCase() === 'false' || cfgValStr === 'off' || cfgValStr === '0';
            if (isTrue || isFalse) {
              const val = isTrue ? 'true' : 'false';
              const disableVal = isTrue ? 'false' : 'true';
              if (!envContent.includes('DISABLE_LOOP_LIMIT=')) {
                envContent += `\nDISABLE_LOOP_LIMIT=${disableVal}`;
              } else {
                envContent = envContent.replace(/DISABLE_LOOP_LIMIT=.*/, `DISABLE_LOOP_LIMIT=${disableVal}`);
              }
              config.DISABLE_LOOP_LIMIT = !isTrue;
              fs.writeFileSync(envPath, envContent);
              await this.bot.sendMessage(chatId, `✅ *Configuration Updated*\n────────────────────────\n• *LOOP_LIMIT* is now set to \`${val}\` (Limits: ${isTrue ? 'Enforced' : 'Bypassed'})`, { parse_mode: 'Markdown' });
            } else {
              await this.bot.sendMessage(chatId, `❌ *Invalid Value:* Please specify \`true\` or \`false\`.`, { parse_mode: 'Markdown' });
            }
          } else if (cfgSubcmd === 'whisper_enabled') {
            const isTrue = cfgValStr.toLowerCase() === 'true' || cfgValStr === 'on' || cfgValStr === '1';
            const isFalse = cfgValStr.toLowerCase() === 'false' || cfgValStr === 'off' || cfgValStr === '0';
            if (isTrue || isFalse) {
              const val = isTrue ? 'true' : 'false';
              if (!envContent.includes('WHISPER_ENABLED=')) {
                envContent += `\nWHISPER_ENABLED=${val}`;
              } else {
                envContent = envContent.replace(/WHISPER_ENABLED=.*/, `WHISPER_ENABLED=${val}`);
              }
              config.WHISPER_ENABLED = isTrue;
              fs.writeFileSync(envPath, envContent);
              await this.bot.sendMessage(chatId, `✅ *Configuration Updated*\n────────────────────────\n• *WHISPER_ENABLED* is now set to \`${val}\``, { parse_mode: 'Markdown' });
            } else {
              await this.bot.sendMessage(chatId, `❌ *Invalid Value:* Please specify \`true\` or \`false\`.`, { parse_mode: 'Markdown' });
            }
          } else if (cfgSubcmd === 'whisper_model') {
            const allowedModels = ['tiny', 'base', 'small', 'medium', 'large'];
            const val = cfgValStr.toLowerCase();
            if (allowedModels.includes(val)) {
              if (!envContent.includes('WHISPER_MODEL=')) {
                envContent += `\nWHISPER_MODEL=${val}`;
              } else {
                envContent = envContent.replace(/WHISPER_MODEL=.*/, `WHISPER_MODEL=${val}`);
              }
              config.WHISPER_MODEL = val;
              fs.writeFileSync(envPath, envContent);
              await this.bot.sendMessage(chatId, `✅ *Configuration Updated*\n────────────────────────\n• *WHISPER_MODEL* is now set to \`${val}\` (CPU RAM usage: tiny: ~70MB, base: ~140MB, small: ~460MB)`, { parse_mode: 'Markdown' });
            } else {
              await this.bot.sendMessage(chatId, `❌ *Invalid Value:* Use one of: \`tiny\`, \`base\`, \`small\`, \`medium\`, \`large\`.`, { parse_mode: 'Markdown' });
            }
          } else {
            await this.bot.sendMessage(chatId, `❌ *Unknown Parameter:* Use \`loops\`, \`timeout\`, \`reasoning\`, \`loop_limit\`, \`whisper_enabled\`, or \`whisper_model\`.`, { parse_mode: 'Markdown' });
          }
        } else {
          const cfgMsg = `⚙️ *XaCode Configuration Options*\n`
            + `────────────────────────\n`
            + `• *MAX_LOOPS:* \`${config.MAX_LOOPS}\` steps\n`
            + `• *MAX_EXECUTION_TIMEOUT_MS:* \`${config.MAX_EXECUTION_TIMEOUT_MS}\` ms\n`
            + `• *SHOW_REASONING:* \`${config.SHOW_REASONING}\` (Output deep thought stream)\n`
            + `• *LOOP_LIMIT:* \`${!config.DISABLE_LOOP_LIMIT}\` (Enforce execution loop safety checks)\n`
            + `• *WHISPER_ENABLED:* \`${config.WHISPER_ENABLED}\` (Local voice transcription)\n`
            + `• *WHISPER_MODEL:* \`${config.WHISPER_MODEL}\` (Transcription quality/RAM model)\n\n`
            + `*To update config, type:*\n`
            + `• \`/config loops <value>\`\n`
            + `• \`/config timeout <value>\`\n`
            + `• \`/config reasoning <true|false>\`\n`
            + `• \`/config loop_limit <true|false>\`\n`
            + `• \`/config whisper_enabled <true|false>\`\n`
            + `• \`/config whisper_model <tiny|base|small|medium|large>\``;
          await this.bot.sendMessage(chatId, cfgMsg, { parse_mode: 'Markdown' });
        }
        break;
      default:
        await this.bot.sendMessage(chatId, '❓ *Unknown command.*\nType `/help` to see all available commands.', { parse_mode: 'Markdown' });
    }
  }

  private async handleVoiceMessage(chatId: number, msg: TelegramBot.Message) {
    if (!config.WHISPER_ENABLED) {
      await this.bot.sendMessage(
        chatId, 
        `🎙 *Voice messages are currently disabled.*\nTo enable them, use command:\n\`/config whisper_enabled true\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (!msg.voice) return;

    const fileId = msg.voice.file_id;
    const processMsg = await this.bot.sendMessage(chatId, `⏳ *Downloading and transcribing voice message...*`, { parse_mode: 'Markdown' });

    try {
      const tmpDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      const audioPath = await this.bot.downloadFile(fileId, tmpDir);
      
      const { exec, execSync } = require('child_process');
      const scriptPath = path.join(process.cwd(), 'scripts', 'transcribe.py');
      
      // Auto-detect available Python binary
      let pythonBin = 'python3';
      try {
        execSync('python3 --version', { stdio: 'ignore' });
      } catch {
        try {
          execSync('python --version', { stdio: 'ignore' });
          pythonBin = 'python';
        } catch {
          await this.bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
          await this.bot.sendMessage(chatId, `❌ *Transcription Error:*\n\`Python is not installed. Install python3 to use voice transcription.\``, { parse_mode: 'Markdown' });
          return;
        }
      }
      
      const pythonCmd = `${pythonBin} "${scriptPath}" "${audioPath}" "${config.WHISPER_MODEL}"`;
      
      logger.info(`Running Whisper transcription: ${pythonCmd}`);
      
      exec(pythonCmd, async (error: any, stdout: string, stderr: string) => {
        // Clean up temporary downloaded file
        try {
          if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
          }
        } catch (cleanupErr) {
          logger.warn(`Failed to clean up temp voice file: ${cleanupErr}`);
        }

        // Delete the downloading helper message
        try {
          await this.bot.deleteMessage(chatId, processMsg.message_id);
        } catch (e) {}

        if (error) {
          logger.error(`Whisper transcription failed: ${error.message}`);
          await this.bot.sendMessage(chatId, `❌ *Transcription Error:*\n\`${error.message}\``, { parse_mode: 'Markdown' });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) {
            await this.bot.sendMessage(chatId, `❌ *Transcription Error:*\n\`${result.error}\``, { parse_mode: 'Markdown' });
            return;
          }

          const transcribedText = result.text;
          if (!transcribedText || transcribedText.trim() === '') {
            await this.bot.sendMessage(chatId, `📭 *Could not recognize any speech in the voice message.*`);
            return;
          }

          // Store in pending tasks map
          const taskId = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          this.pendingVoiceTasks.set(taskId, transcribedText);

          // Send confirmation with buttons
          const confirmMsg = `🎙 *Voice Transcription result:*\n`
            + `────────────────────────\n`
            + `_"${transcribedText}"_\n\n`
            + `Do you want to run this task?`;

          await this.bot.sendMessage(chatId, confirmMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Принять (Accept)', callback_data: `voice_accept:${taskId}` },
                  { text: '❌ Отменить (Cancel)', callback_data: `voice_cancel:${taskId}` }
                ]
              ]
            }
          });
        } catch (jsonErr) {
          logger.error(`Failed to parse Whisper stdout: ${stdout}. Err: ${jsonErr}`);
          await this.bot.sendMessage(chatId, `❌ *Failed to parse transcription output.*`);
        }
      });
    } catch (err: any) {
      logger.error(`Failed to download voice file: ${err.message}`);
      try {
        await this.bot.deleteMessage(chatId, processMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, `❌ *Failed to retrieve voice file:* \`${err.message}\``);
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

export function parseDurationToMs(str: string): number | null {
  const clean = str.trim().toLowerCase();
  const match = clean.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  const unit = match[2] || 'm'; // default to minutes
  switch (unit) {
    case 'ms': return val;
    case 's': return val * 1000;
    case 'm': return val * 60 * 1000;
    case 'h': return val * 60 * 60 * 1000;
    case 'd': return val * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

export const botService = new BotService();
