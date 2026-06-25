import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { securityManager } from '../security';
import fs from 'fs';
import path from 'path';
import { agentOrchestrator } from '../agent';
import { terminalManager } from '../terminal';
import { logger } from '../logger';
import { permissionSystem } from '../security/PermissionSystem';
import { interactionEmitter } from '../events/interaction';
import { pastieManager } from '../utils/pastie';
import { eventBus, EVENTS } from '../events/EventBus';
import { skillManager } from '../skills/SkillManager';
import { autoMemory } from '../memory';

export class BotService {
  private bot: TelegramBot;
  private pendingVoiceTasks = new Map<string, string>();
  private pendingCustomChoices = new Map<number, { requestId: string, question: string }>();
  private pendingCustomChoiceTexts = new Map<string, string>();

  constructor() {
    this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
    this.setupListeners();
    logger.info('Telegram Bot initialized.');
  }

  private setupListeners() {
    interactionEmitter.on('ask_choice', async ({ chatId, requestId, question, options }) => {
      const inlineKeyboard = options.map((opt: string, i: number) => [
        { text: opt, callback_data: `choice:${requestId}:${i}` }
      ]);
      inlineKeyboard.push([{ text: '✍️ Свой вариант', callback_data: `choice_custom:${requestId}` }]);
      await this.bot.sendMessage(chatId, `❓ *Agent asks:*\n${question}`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
    });

    interactionEmitter.on('send_document', async ({ chatId, filePath }) => {
      try {
        await this.bot.sendDocument(chatId, filePath);
      } catch (e: any) {
        logger.error(`Failed to send document: ${e.message}`);
      }
    });

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

      if (this.pendingCustomChoices.has(chatId)) {
        const { requestId, question } = this.pendingCustomChoices.get(chatId)!;
        this.pendingCustomChoices.delete(chatId);
        this.pendingCustomChoiceTexts.set(requestId, text);
        
        await this.bot.sendMessage(chatId, `Вы написали:\n_${text}_\n\nЧто с этим сделать?`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Отправить', callback_data: `choice_custom_send:${requestId}` }],
              [{ text: '🔄 Переписать', callback_data: `choice_custom_rewrite:${requestId}` }]
            ]
          }
        });
        return;
      }

      const pendingCfgPath = path.join(process.cwd(), '.xacode_pending_cfg.json');
      let pendingCfgKey = null;
      if (fs.existsSync(pendingCfgPath)) {
        try {
          const map = JSON.parse(fs.readFileSync(pendingCfgPath, 'utf8'));
          if (map[userId]) {
            pendingCfgKey = map[userId];
          }
        } catch (e) {}
      }

      if (pendingCfgKey && !text.startsWith('/')) {
        try {
          await this.handlePendingConfigInput(chatId, userId, text, pendingCfgKey);
        } catch (e: any) {
          logger.error(`Error in handlePendingConfigInput: ${e.message}`);
          await this.bot.sendMessage(chatId, `❌ Сталася помилка під час збереження налаштувань: ${e.message}`);
        }
        return;
      }

      if (text === '/pastes') {
        const pastes = pastieManager.getActivePastes();
        if (pastes.length === 0) {
          return this.bot.sendMessage(chatId, '📭 No active pastes right now.');
        }

        let msg = '📜 *Active Session Logs:*\n\n';
        for (const p of pastes) {
          const minutesLeft = Math.max(0, Math.round((p.expiresAt - Date.now()) / 60000));
          msg += `• Task: \`${p.taskId}\`\n  URL: ${p.url}\n  Expires in: ${minutesLeft} mins\n\n`;
        }

        const keyboard = {
          inline_keyboard: pastes.map(p => ([
            { text: `🗑 Delete ${p.taskId.substring(0, 15)}...`, callback_data: `delpaste_${p.url}` }
          ]))
        };

        return this.bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: keyboard, disable_web_page_preview: true });
      }

      // Handle Commands
      if (text.startsWith('/')) {
        await this.handleCommand(chatId, userId, text);
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

      agentOrchestrator.getSession(chatId).handleTask(text, statusCallback);
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

        logger.info('User allowed, processing callback...');

        if (query.data.startsWith('delpaste_')) {
          const url = query.data.replace('delpaste_', '');
          const success = await pastieManager.removePaste(url);
          
          if (success) {
            await this.bot.answerCallbackQuery(query.id, { text: '✅ Paste deleted early!' });
          } else {
            await this.bot.answerCallbackQuery(query.id, { text: '❌ Failed or already deleted.' });
          }
          
          // Refresh message
          const pastes = pastieManager.getActivePastes();
          if (pastes.length === 0) {
            await this.bot.editMessageText('📭 No active pastes right now.', { chat_id: chatId, message_id: query.message.message_id });
          } else {
            let msg = '📜 *Active Session Logs:*\n\n';
            for (const p of pastes) {
              const minutesLeft = Math.max(0, Math.round((p.expiresAt - Date.now()) / 60000));
              msg += `• Task: \`${p.taskId}\`\n  URL: ${p.url}\n  Expires in: ${minutesLeft} mins\n\n`;
            }
            const keyboard = {
              inline_keyboard: pastes.map(p => ([
                { text: `🗑 Delete ${p.taskId.substring(0, 15)}...`, callback_data: `delpaste_${p.url}` }
              ]))
            };
            await this.bot.editMessageText(msg, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: keyboard, disable_web_page_preview: true });
          }
          return;
        }

        if (query.data.startsWith('cfg:')) {
          await this.handleConfigCallback(query, chatId, userId);
        } else if (query.data.startsWith('model:')) {
          const selectedModel = query.data.split(':')[1];
          logger.info(`Selected model: ${selectedModel}`);
          
          // Update in memory and file
          const envPath = require('path').join(process.cwd(), '.env');
          let envContent = await fs.promises.readFile(envPath, 'utf8');
          if (!envContent.includes('DEEPSEEK_MODEL=')) {
            envContent += `\nDEEPSEEK_MODEL=${selectedModel}`;
          } else {
            envContent = envContent.replace(/DEEPSEEK_MODEL=.*/, `DEEPSEEK_MODEL=${selectedModel}`);
          }
          config.DEEPSEEK_MODEL = selectedModel;
          await fs.promises.writeFile(envPath, envContent);

          logger.info('Model switch complete, showing alert popup.');
          await this.bot.answerCallbackQuery(query.id, {
            text: `✅ Model switched to: ${selectedModel}`
          });
          
          try {
            await this.bot.editMessageReplyMarkup({
              inline_keyboard: [
                [
                  { text: selectedModel === 'deepseek-v4-pro' ? '✅ 🚀 V4 Pro' : '🚀 V4 Pro', callback_data: 'model:deepseek-v4-pro' },
                  { text: selectedModel === 'deepseek-v4-flash' ? '✅ ⚡ V4 Flash' : '⚡ V4 Flash', callback_data: 'model:deepseek-v4-flash' }
                ]
              ]
            }, {
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
          agentOrchestrator.getSession(chatId).handleTask(taskText, statusCallback);
          
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
        } else if (query.data.startsWith('choice:')) {
          const parts = query.data.split(':');
          const requestId = parts[1];
          const choiceIndex = parseInt(parts[2], 10);
          
          // Try to get text of the choice from the message's keyboard
          let chosenText = `Option ${choiceIndex + 1}`;
          if (query.message?.reply_markup?.inline_keyboard) {
            const row = query.message.reply_markup.inline_keyboard[choiceIndex];
            if (row && row[0]) chosenText = row[0].text;
          }
          
          interactionEmitter.emit(`choice_response_${requestId}`, chosenText);
          
          await this.bot.answerCallbackQuery(query.id, { text: `✅ Selected: ${chosenText}` });
          try {
            await this.bot.editMessageText(`❓ *Agent asks:*\n_${query.message?.text?.replace('❓ Agent asks:\\n', '')}_\n\n✅ *User selected:* ${chosenText}`, {
              chat_id: chatId,
              message_id: query.message?.message_id,
              parse_mode: 'Markdown'
            });
          } catch (e) {}
        } else if (query.data.startsWith('choice_custom:')) {
          const requestId = query.data.split(':')[1];
          const questionText = query.message?.text?.replace('❓ Agent asks:\n', '') || 'Пожалуйста, введите ваш вариант:';
          this.pendingCustomChoices.set(chatId, { requestId, question: questionText });
          
          await this.bot.answerCallbackQuery(query.id);
          try {
             await this.bot.editMessageText(`❓ *Agent asks:*\n_${questionText}_\n\n✍️ *Пожалуйста, напишите свой вариант ответным сообщением.*`, {
               chat_id: chatId,
               message_id: query.message?.message_id,
               parse_mode: 'Markdown'
             });
          } catch (e) {}
        } else if (query.data.startsWith('choice_custom_send:')) {
           const requestId = query.data.split(':')[1];
           const textToSend = this.pendingCustomChoiceTexts.get(requestId);
           if (!textToSend) {
             await this.bot.answerCallbackQuery(query.id, { text: '❌ Ошибка: текст утерян.', show_alert: true });
             return;
           }
           interactionEmitter.emit(`choice_response_${requestId}`, textToSend);
           this.pendingCustomChoiceTexts.delete(requestId);
           await this.bot.answerCallbackQuery(query.id, { text: '✅ Отправлено!' });
           try {
             await this.bot.editMessageText(`✅ *User selected (custom):*\n_${textToSend}_`, {
               chat_id: chatId,
               message_id: query.message?.message_id,
               parse_mode: 'Markdown'
             });
           } catch(e) {}
        } else if (query.data.startsWith('choice_custom_rewrite:')) {
           const requestId = query.data.split(':')[1];
           this.pendingCustomChoices.set(chatId, { requestId, question: 'Пожалуйста, напишите свой вариант ответа заново.' });
           await this.bot.answerCallbackQuery(query.id);
           try {
             await this.bot.editMessageText(`✍️ *Пожалуйста, напишите свой вариант ответным сообщением.*`, {
               chat_id: chatId,
               message_id: query.message?.message_id,
               parse_mode: 'Markdown'
             });
           } catch(e) {}
        } else {
          logger.warn(`Unknown callback data: ${query.data}`);
        }
      } catch (error: any) {
        logger.error(`Callback error: ${error.message}`);
        if (query.message) {
          await this.bot.sendMessage(query.message.chat.id, `❌ Error processing request: ${error.message}`);
        }
        await this.bot.answerCallbackQuery(query.id).catch(() => {});
      }
    });
  }

  private async handleConfigCallback(query: TelegramBot.CallbackQuery, chatId: number, userId: number) {
    const data = query.data!;
    const parts = data.split(':');
    const action = parts[1]; // toggle, set, refresh
    const key = parts[2];

    const envPath = require('path').join(process.cwd(), '.env');
    let envContent = await fs.promises.readFile(envPath, 'utf8');

    if (action === 'refresh') {
      await this.sendConfigMenu(chatId, query.message?.message_id);
      await this.bot.answerCallbackQuery(query.id);
      return;
    }

    if (action === 'toggle') {
      let isTrue = false;
      let envKey = '';
      if (key === 'reasoning') {
        isTrue = !config.SHOW_REASONING;
        envKey = 'SHOW_REASONING';
        config.SHOW_REASONING = isTrue;
      } else if (key === 'loop_limit') {
        isTrue = config.DISABLE_LOOP_LIMIT; // toggling DISABLE_LOOP_LIMIT (true means limit is OFF, so if we toggle LOOP_LIMIT ON, disable becomes false)
        envKey = 'DISABLE_LOOP_LIMIT';
        config.DISABLE_LOOP_LIMIT = !isTrue;
      } else if (key === 'whisper_enabled') {
        isTrue = !config.WHISPER_ENABLED;
        envKey = 'WHISPER_ENABLED';
        config.WHISPER_ENABLED = isTrue;
      } else if (key === 'always_full_access') {
        isTrue = !config.ALWAYS_FULL_ACCESS;
        envKey = 'ALWAYS_FULL_ACCESS';
        config.ALWAYS_FULL_ACCESS = isTrue;
      } else if (key === 'smart_memory_mode') {
        isTrue = !config.SMART_MEMORY_MODE;
        envKey = 'SMART_MEMORY_MODE';
        config.SMART_MEMORY_MODE = isTrue;
      }
      
      const writeVal = envKey === 'DISABLE_LOOP_LIMIT' ? (!isTrue).toString() : isTrue.toString();
      
      if (!envContent.includes(envKey + '=')) {
        envContent += `\n${envKey}=${writeVal}`;
      } else {
        const regex = new RegExp(`${envKey}=.*`);
        envContent = envContent.replace(regex, `${envKey}=${writeVal}`);
      }
      await fs.promises.writeFile(envPath, envContent);
      
      await this.bot.answerCallbackQuery(query.id, { text: `✅ Изменено: ${key} = ${isTrue}` });
      await this.sendConfigMenu(chatId, query.message?.message_id);
    } else if (action === 'set') {
      const pendingCfgPath = require('path').join(process.cwd(), '.xacode_pending_cfg.json');
      let map: any = {};
      try { if (fs.existsSync(pendingCfgPath)) map = JSON.parse(fs.readFileSync(pendingCfgPath, 'utf8')); } catch(e){}
      map[userId] = key;
      fs.writeFileSync(pendingCfgPath, JSON.stringify(map));

      await this.bot.answerCallbackQuery(query.id);
      
      const promptMap: Record<string, string> = {
        'max_context': '🧠 Введите новый лимит токенов контекста памяти (минимум 4000):',
        'loops': '🛡 Введите максимальное количество шагов агента:',
        'timeout': '⏳ Введите таймаут терминала в миллисекундах (например 30000):',
        'whisper_model': '🎙 Введите модель Whisper (tiny, base, small, medium, large):'
      };
      
      const promptText = promptMap[key] || `Введите новое значение для ${key}:`;
      
      await this.bot.sendMessage(chatId, `👇 *Ожидание ввода*\n────────────────────────\n${promptText}`, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cfg:refresh' }]]
        }
      });
    }
  }

  private async handlePendingConfigInput(chatId: number, userId: number, text: string, key: string) {
    const pendingCfgPath = require('path').join(process.cwd(), '.xacode_pending_cfg.json');
    try {
      if (fs.existsSync(pendingCfgPath)) {
        const map = JSON.parse(fs.readFileSync(pendingCfgPath, 'utf8'));
        delete map[userId];
        fs.writeFileSync(pendingCfgPath, JSON.stringify(map));
      }
    } catch(e){}
    
    const envPath = require('path').join(process.cwd(), '.env');
    let envContent = await fs.promises.readFile(envPath, 'utf8');
    const valStr = text.trim();
    let successMsg = '';

    if (key === 'loops') {
      const num = parseInt(valStr, 10);
      if (isNaN(num) || num <= 0) return this.bot.sendMessage(chatId, `❌ Неверное значение. Ожидается число > 0.`);
      config.MAX_LOOPS = num;
      envContent = this.updateEnv(envContent, 'MAX_LOOPS', num.toString());
      successMsg = `\`MAX_LOOPS\` установлен на ${num}`;
    } else if (key === 'max_context') {
      const num = parseInt(valStr, 10);
      if (isNaN(num) || num < 4000) return this.bot.sendMessage(chatId, `❌ Неверное значение. Ожидается число >= 4000.`);
      config.MAX_CONTEXT_TOKENS = num;
      envContent = this.updateEnv(envContent, 'MAX_CONTEXT_TOKENS', num.toString());
      successMsg = `\`MAX_CONTEXT_TOKENS\` установлен на ${num}`;
    } else if (key === 'timeout') {
      const num = parseInt(valStr, 10);
      if (isNaN(num) || num <= 0) return this.bot.sendMessage(chatId, `❌ Неверное значение. Ожидается число > 0.`);
      config.MAX_EXECUTION_TIMEOUT_MS = num;
      envContent = this.updateEnv(envContent, 'MAX_EXECUTION_TIMEOUT_MS', num.toString());
      successMsg = `\`MAX_EXECUTION_TIMEOUT_MS\` установлен на ${num} мс`;
    } else if (key === 'whisper_model') {
      const allowed = ['tiny', 'base', 'small', 'medium', 'large'];
      const v = valStr.toLowerCase();
      if (!allowed.includes(v)) return this.bot.sendMessage(chatId, `❌ Неверная модель. Используйте: tiny, base, small, medium, large.`);
      config.WHISPER_MODEL = v;
      envContent = this.updateEnv(envContent, 'WHISPER_MODEL', v);
      successMsg = `\`WHISPER_MODEL\` установлен на ${v}`;
    }

    await fs.promises.writeFile(envPath, envContent);
    await this.bot.sendMessage(chatId, `✅ *Настройка сохранена*\n────────────────────────\n• ${successMsg}`, { parse_mode: 'Markdown' });
    await this.sendConfigMenu(chatId);
  }

  private updateEnv(envContent: string, key: string, value: string): string {
    if (!envContent.includes(key + '=')) {
      return envContent + `\n${key}=${value}`;
    } else {
      const regex = new RegExp(`${key}=.*`);
      return envContent.replace(regex, `${key}=${value}`);
    }
  }

  private async sendConfigMenu(chatId: number, messageIdToEdit?: number) {
    const cfgMsg = `⚙️ *Настройки Системы XaCode*\n`
      + `━━━━━━━━━━━━━━━━━━━━━━━━\n`
      + `_Нажмите на кнопку, чтобы изменить значение_\n`;

    const inlineKeyboard = [
      [{ text: `🧠 Токены памяти: ${config.MAX_CONTEXT_TOKENS}`, callback_data: 'cfg:set:max_context' }],
      [{ text: `${config.SHOW_REASONING ? '🟢' : '🔴'} Показывать "мысли" ИИ`, callback_data: 'cfg:toggle:reasoning' }],
      [{ text: `🛡 Шагов на задачу: ${config.MAX_LOOPS}`, callback_data: 'cfg:set:loops' }],
      [{ text: `⏳ Таймаут терминала: ${config.MAX_EXECUTION_TIMEOUT_MS} мс`, callback_data: 'cfg:set:timeout' }],
      [{ text: `${!config.DISABLE_LOOP_LIMIT ? '🟢' : '🔴'} Защита от зацикливания`, callback_data: 'cfg:toggle:loop_limit' }],
      [{ text: `${!config.ALWAYS_FULL_ACCESS ? '🟢' : '🔴'} Режим Песочницы (Sandbox)`, callback_data: 'cfg:toggle:always_full_access' }],
      [{ text: `${config.WHISPER_ENABLED ? '🟢' : '🔴'} Голосовые (Whisper)`, callback_data: 'cfg:toggle:whisper_enabled' }],
      [{ text: `🎙 Модель Whisper: ${config.WHISPER_MODEL}`, callback_data: 'cfg:set:whisper_model' }],
      [{ text: `${config.SMART_MEMORY_MODE ? '🟢' : '🔴'} Розумне вікно пам'яті`, callback_data: 'cfg:toggle:smart_memory_mode' }],
      [{ text: '🔄 Обновить меню', callback_data: 'cfg:refresh' }]
    ];

    if (messageIdToEdit) {
      try {
        await this.bot.editMessageText(cfgMsg, {
          chat_id: chatId,
          message_id: messageIdToEdit,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } catch (e: any) {
        logger.warn(`Could not edit config menu: ${e.message}`);
      }
    } else {
      await this.bot.sendMessage(chatId, cfgMsg, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
    }
  }

  private async handleCommand(chatId: number, userId: number, text: string) {
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
          + `• \`/logs\` — Toggle Session Log generation\n`
          + `• \`/config\` — View and modify system limits\n`
          + `• \`/fullaccess <enable|disable>\` — Manage Full Access mode\n\n`
          + `🛠 *System*\n`
          + `• \`/sandbox clear\` — Wipe the sandbox directory\n`
          + `• \`/workspace\` — Show current workspace info\n`
          + `• \`/terminal\` — Info about background terminals\n\n`
          + `🛑 *Control*\n`
          + `• \`/stop\` — Abort current task immediately\n`
          + `• \`/reset\` — Clear bot memory and context\n`
          + `• \`/reload\` — Restart the XaCode systemd service\n`
          + `• \`/cd\` — Change agent's working directory`;
        await this.bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
        break;
      case '/plan': {
        const context = agentOrchestrator.getSession(chatId).memoryManager.getTaskContext();
        const planMsg = `📋 *Current Execution Plan*\n`
          + `────────────────────────\n`
          + `• *Task:* \`${context.originalRequest || 'None'}\`\n`
          + `• *Step:* \`${context.currentStep || 'Idle'}\``;
        await this.bot.sendMessage(chatId, planMsg, { parse_mode: 'Markdown' });
        break;
      }
      case '/status': {
        const session = agentOrchestrator.getSession(chatId);
        const ctx = session.memoryManager.getTaskContext();
        const memStats = session.memoryManager.contextManager.getMemoryStats();
        const agentState = session.stateMachine.getState();
        
        const statusMap: Record<string, string> = {
          'idle': '🟡 Ожидание (Idle)',
          'running': '🟢 В работе (Running)',
          'completed': '✅ Завершено (Completed)',
          'error': '🔴 Ошибка (Error)'
        };
        const st = statusMap[ctx.status] || ctx.status;
        const taskText = ctx.originalRequest ? (ctx.originalRequest.length > 40 ? ctx.originalRequest.substring(0, 40) + '...' : ctx.originalRequest) : 'Нет активной задачи';

        const os = require('os');
        const cp = require('child_process');
        
        const formatUptime = (seconds: number) => {
          const d = Math.floor(seconds / (3600*24));
          const h = Math.floor(seconds % (3600*24) / 3600);
          const m = Math.floor(seconds % 3600 / 60);
          return `${d}d ${h}h ${m}m`;
        };

        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : 'Unknown';
        const loadAvg = os.loadavg().map((l: number) => l.toFixed(2)).join(', ');
        const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(1);
        const freeMem = (os.freemem() / (1024 ** 3)).toFixed(1);
        const usedMem = (parseFloat(totalMem) - parseFloat(freeMem)).toFixed(1);
        const sysUptime = formatUptime(os.uptime());
        const botUptime = formatUptime(process.uptime());

        let diskInfo = 'N/A';
        try {
          if (os.platform() === 'linux' || os.platform() === 'darwin') {
             const df = cp.execSync('df -h /').toString().split('\\n')[1].trim().replace(/\\s+/g, ' ').split(' ');
             diskInfo = `${df[2]} / ${df[1]} (${df[4]})`;
          } else if (os.platform() === 'win32') {
             const diskOut = cp.execSync('wmic logicaldisk get size,freespace,caption').toString().split('\\n');
             for (const line of diskOut) {
                if (line.includes('C:')) {
                   const parts = line.trim().replace(/\\s+/g, ' ').split(' ');
                   const free = (parseInt(parts[1]) / (1024**3)).toFixed(1);
                   const total = (parseInt(parts[2]) / (1024**3)).toFixed(1);
                   const used = (parseFloat(total) - parseFloat(free)).toFixed(1);
                   diskInfo = `${used}G / ${total}G (${Math.round((parseFloat(used)/parseFloat(total))*100)}%)`;
                   break;
                }
             }
          }
        } catch(e) {}

        const statusMsg = `📊 *Агент XaCode*\n`
          + `────────────────────────\n`
          + `• *Состояние:* ${st} \`[${agentState}]\`\n`
          + `• *Задача:* \`${taskText}\`\n`
          + `• *Этап:* _${ctx.currentStep || 'Ожидание задачи...'}_\n`
          + `• *Токены памяти:* \`${memStats.usageTokens} / ${memStats.maxTokens}\`\n\n`
          + `💻 *Системный Дашборд (VPS)*\n`
          + `────────────────────────\n`
          + `• *CPU:* \`${cpus.length}x ${cpuModel}\`\n`
          + `• *Load Avg:* \`${loadAvg}\`\n`
          + `• *RAM:* \`${usedMem} GB / ${totalMem} GB\`\n`
          + `• *Disk (Root):* \`${diskInfo}\`\n`
          + `• *Node.js:* \`${process.version}\`\n`
          + `• *Uptime (Система):* \`${sysUptime}\`\n`
          + `• *Uptime (Бот):* \`${botUptime}\``;

        await this.bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
        break;
      }
      case '/stop': {
        agentOrchestrator.getSession(chatId).stop();
        terminalManager.killAll();
        const stopMsg = `🛑 *Execution Halted*\n`
          + `────────────────────────\n`
          + `Agent execution has been aborted immediately.\n`
          + `All active background processes have been terminated.`;
        await this.bot.sendMessage(chatId, stopMsg, { parse_mode: 'Markdown' });
        break;
      }
      case '/resume':
      case '/r': {
        const parts = text.split(' ');
        const sessionId = parts[1]; // undefined if not provided
        const statusCallback = async (updateMsg: string) => {
          try { await this.sendChunkedMessage(chatId, updateMsg); } catch (e) {}
        };
        await agentOrchestrator.getSession(chatId).resumeSession(sessionId, statusCallback);
        break;
      }
      case '/sessions':
      case '/s': {
        const sessions = await autoMemory.listSessions();
        if (sessions.length === 0) {
          await this.bot.sendMessage(chatId, '📋 No saved sessions found.');
        } else {
          const list = sessions.map((s, i) => `📅 ${i+1}. ${s.id} | ${s.status} | "${s.name || s.task}"`).join('\n');
          await this.bot.sendMessage(chatId, `📋 *Sessions:*\n${list}`, { parse_mode: 'Markdown' });
        }
        break;
      }
      case '/checkpoint':
      case '/cp': {
        const cpName = text.replace(cmd, '').trim();
        if (!cpName) {
           await this.bot.sendMessage(chatId, '❌ Usage: `/cp "name"`', { parse_mode: 'Markdown' });
           break;
        }
        const success = await autoMemory.saveCheckpoint(cpName.replace(/"/g, ''), 99999, 'Saved via Telegram');
        await this.bot.sendMessage(chatId, success ? '✅ Checkpoint saved!' : '❌ Failed to save checkpoint.');
        break;
      }
      case '/checkpoints':
      case '/cps': {
        const cps = await autoMemory.listCheckpoints();
        if (cps.length === 0) {
          await this.bot.sendMessage(chatId, '📋 No saved checkpoints found.');
        } else {
          const list = cps.map((c) => `🔖 ${c.id}. "${c.name}" (${new Date(c.savedAt).toLocaleString()})`).join('\n');
          await this.bot.sendMessage(chatId, `📋 *Checkpoints:*\n${list}`, { parse_mode: 'Markdown' });
        }
        break;
      }
      case '/goto':
      case '/g': {
        const parts = text.split(' ');
        const cpId = parseInt(parts[1], 10);
        if (isNaN(cpId)) {
          await this.bot.sendMessage(chatId, '❌ Usage: `/goto <id>`', { parse_mode: 'Markdown' });
          break;
        }
        const statusCallback = async (updateMsg: string) => {
          try { await this.sendChunkedMessage(chatId, updateMsg); } catch (e) {}
        };
        await agentOrchestrator.getSession(chatId).gotoCheckpoint(cpId, statusCallback);
        break;
      }
      case '/rename': {
        const match = text.match(/^\/rename\s+(\S+)\s+(.+)$/);
        if (!match) {
          await this.bot.sendMessage(chatId, '❌ Usage: `/rename <sessionId> "new name"`', { parse_mode: 'Markdown' });
          break;
        }
        const r = await autoMemory.renameSession(match[1], match[2].replace(/"/g, ''));
        await this.bot.sendMessage(chatId, r ? '✅ Session renamed.' : '❌ Session not found.');
        break;
      }
      case '/delete': {
        const parts = text.split(' ');
        const r = await autoMemory.deleteSession(parts[1]);
        await this.bot.sendMessage(chatId, r ? '✅ Session deleted.' : '❌ Session not found.');
        break;
      }
      case '/reset': {
        agentOrchestrator.getSession(chatId).memoryManager.resetSession('You are XaCode.');
        const resetMsg = `🧹 *Session Reset*\n`
          + `────────────────────────\n`
          + `Agent memory and context have been completely cleared.\n`
          + `Ready for a new task!`;
        await this.bot.sendMessage(chatId, resetMsg, { parse_mode: 'Markdown' });
        break;
      }
      case '/cd': {
        const targetDir = text.split(' ').slice(1).join(' ') || require('os').homedir();
        try {
          const path = require('path');
          const fs = require('fs');
          const resolvedDir = path.resolve(targetDir);
          
          if (!fs.existsSync(resolvedDir)) {
            await this.bot.sendMessage(chatId, `❌ Директория не найдена: \`${resolvedDir}\``, { parse_mode: 'Markdown' });
            break;
          }
          
          process.chdir(resolvedDir);
          const { securityManager } = require('../security');
          securityManager.setSandboxDir(resolvedDir);
          config.SANDBOX_DIR = resolvedDir;
          
          const envPath = path.join(path.resolve(__dirname, '..', '..'), '.env');
          if (fs.existsSync(envPath)) {
            let envContent = await fs.promises.readFile(envPath, 'utf8');
            if (!envContent.includes('SANDBOX_DIR=')) {
              envContent += `\nSANDBOX_DIR=${resolvedDir}`;
            } else {
              envContent = envContent.replace(/SANDBOX_DIR=.*/, `SANDBOX_DIR=${resolvedDir}`);
            }
            await fs.promises.writeFile(envPath, envContent);
          }
          
          await this.bot.sendMessage(chatId, `📂 Рабочая директория изменена на:\n\`${resolvedDir}\``, { parse_mode: 'Markdown' });
        } catch (e: any) {
          await this.bot.sendMessage(chatId, `❌ Ошибка смены директории: ${e.message}`);
        }
        break;
      }
      case '/reload': {
        const reloadMsg = `🔄 *Restarting XaCode Service*\n`
          + `────────────────────────\n`
          + `The bot will restart now. Please wait a few seconds before sending new commands.`;
        await this.bot.sendMessage(chatId, reloadMsg, { parse_mode: 'Markdown' });
        
        const cp = require('child_process');
        setTimeout(() => {
          cp.spawn('sudo', ['systemctl', 'restart', 'xacode'], { detached: true, stdio: 'ignore' }).unref();
        }, 1000);
        break;
      }
      case '/workspace': {
        const wsMsg = `📁 *Workspace Environment*\n`
          + `────────────────────────\n`
          + `• *Sandbox Path:* \`${config.SANDBOX_DIR}\`\n`
          + `• *Security Mode:* *${permissionSystem.isFullAccess() ? '⚠️ FULL ACCESS' : '🔒 RESTRICTED SANDBOX'}*`;
        await this.bot.sendMessage(chatId, wsMsg, { parse_mode: 'Markdown' });
        break;
      }
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
      case '/files': {
        const files = agentOrchestrator.getSession(chatId).memoryManager.getTaskContext().filesModified;
        const filesMsg = `📂 *Modified Files Log*\n`
          + `────────────────────────\n`
          + `${files.length > 0 ? files.map(f => `• \`${f}\``).join('\n') : '_No files modified in this session._'}`;
        await this.bot.sendMessage(chatId, filesMsg, { parse_mode: 'Markdown' });
        break;
      }
      case '/logs': {
        config.PASTE_LOGS_ENABLED = !config.PASTE_LOGS_ENABLED;
        const envPath = require('path').join(process.cwd(), '.env');
        let envContent = await fs.promises.readFile(envPath, 'utf8');
        
        if (!envContent.includes('PASTE_LOGS_ENABLED=')) {
          envContent += `\nPASTE_LOGS_ENABLED=${config.PASTE_LOGS_ENABLED}`;
        } else {
          envContent = envContent.replace(/PASTE_LOGS_ENABLED=.*/, `PASTE_LOGS_ENABLED=${config.PASTE_LOGS_ENABLED}`);
        }
        await fs.promises.writeFile(envPath, envContent);

        const logsMsg = `📝 *Session Logs Configuration*\n`
          + `────────────────────────\n`
          + `• Session Logs are now: *${config.PASTE_LOGS_ENABLED ? '✅ ENABLED' : '❌ DISABLED'}*\n\n`
          + `_(The setting has been saved to your .env file)_`;
        await this.bot.sendMessage(chatId, logsMsg, { parse_mode: 'Markdown' });
        break;
      }
      case '/model': {
        const modelArg = text.split(' ')[1];
        if (modelArg) {
          // Update in memory and file
          const envPath = require('path').join(process.cwd(), '.env');
          let envContent = await fs.promises.readFile(envPath, 'utf8');
          if (!envContent.includes('DEEPSEEK_MODEL=')) {
            envContent += `\nDEEPSEEK_MODEL=${modelArg}`;
          } else {
            envContent = envContent.replace(/DEEPSEEK_MODEL=.*/, `DEEPSEEK_MODEL=${modelArg}`);
          }
          config.DEEPSEEK_MODEL = modelArg;
          await fs.promises.writeFile(envPath, envContent);

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
                { text: config.DEEPSEEK_MODEL === 'deepseek-v4-pro' ? '✅ 🚀 V4 Pro' : '🚀 V4 Pro', callback_data: 'model:deepseek-v4-pro' },
                { text: config.DEEPSEEK_MODEL === 'deepseek-v4-flash' ? '✅ ⚡ V4 Flash' : '⚡ V4 Flash', callback_data: 'model:deepseek-v4-flash' }
              ]
            ]
          };

          await this.bot.sendMessage(chatId, modelMsg, { 
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
          });
        }
        break;
      }
      case '/sandbox': {
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
      }
      case '/cost': {
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
      }
      case '/terminal': {
        const termMsg = `💻 *Background Terminals*\n`
          + `────────────────────────\n`
          + `• *Active Processes:* *${terminalManager.getActiveProcessesCount()}*\n\n`
          + `_Background processes are monitored and closed automatically. Check logs for details._`;
        await this.bot.sendMessage(chatId, termMsg, { parse_mode: 'Markdown' });
        break;
      }
      case '/config': {
        const cfgSubcmd = text.split(' ')[1];
        const cfgValStr = text.split(' ')[2];
        if (cfgSubcmd && cfgValStr) {
          // Keep old manual text commands for backward compatibility
          await this.handlePendingConfigInput(chatId, userId, cfgValStr, cfgSubcmd);
        } else {
          // Clear any pending state if user just types /config
          const pendingCfgPath = require('path').join(process.cwd(), '.xacode_pending_cfg.json');
          try {
            if (fs.existsSync(pendingCfgPath)) {
              const map = JSON.parse(fs.readFileSync(pendingCfgPath, 'utf8'));
              delete map[userId];
              fs.writeFileSync(pendingCfgPath, JSON.stringify(map));
            }
          } catch(e){}
          
          await this.sendConfigMenu(chatId);
        }
        break;
      }
      default: {
        const skillName = cmd.substring(1); // remove '/'
        const skill = skillManager.getSkill(skillName);
        if (skill && skill.userInvocable !== false) {
          const body = skillManager.getSkillBody(skill.name);
          if (body) {
            const taskText = `[EXPLICIT SKILL INVOCATION: ${skill.name}]\nExecute the following skill instructions strictly:\n${body}\n\nUser Arguments: ${text.replace(cmd, '').trim()}`;
            const statusCallback = async (updateMsg: string) => {
              try {
                await this.sendChunkedMessage(chatId, updateMsg);
              } catch (err) {
                logger.error('Failed to send telegram msg:', err);
              }
            };
            agentOrchestrator.getSession(chatId).handleTask(taskText, statusCallback);
            return;
          }
        }
        await this.bot.sendMessage(chatId, '❓ *Unknown command.*\nType `/help` to see all available commands.', { parse_mode: 'Markdown' });
      }
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
      
      // Auto-detect available Python binary: prefer project venv, then system python3/python
      const venvPython = path.join(process.cwd(), '.venv', 'bin', 'python');
      let pythonBin = '';
      
      if (fs.existsSync(venvPython)) {
        pythonBin = venvPython;
      } else {
        try {
          execSync('python3 --version', { stdio: 'ignore' });
          pythonBin = 'python3';
        } catch {
          try {
            execSync('python --version', { stdio: 'ignore' });
            pythonBin = 'python';
          } catch {
            await this.bot.deleteMessage(chatId, processMsg.message_id).catch(() => {});
            await this.bot.sendMessage(chatId, `❌ *Transcription Error:*\n\`Python is not installed. Run update.sh to set up the venv.\``, { parse_mode: 'Markdown' });
            return;
          }
        }
      }
      
      const pythonCmd = `"${pythonBin}" "${scriptPath}" "${audioPath}" "${config.WHISPER_MODEL}"`;
      
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
