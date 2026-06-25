import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { MemoryManager, ChatMessage, autoMemory } from '../memory';
import { toolDefinitions, executeTool } from '../tools';
import { logger } from '../logger';
import { llmProvider } from '../llm/Provider';
import { StateMachine, AgentState } from './StateMachine';
import { terminalManager } from '../terminal';
import { metricsTracker } from '../metrics/MetricsTracker';
import { permissionSystem } from '../security/PermissionSystem';
import { pastieManager } from '../utils/pastie';
import { eventBus, EVENTS } from '../events/EventBus';
import { skillManager } from '../skills/SkillManager';

export class AgentSession {
  public chatId: number;
  public isExecuting: boolean = false;
  public memoryManager: MemoryManager;
  public stateMachine: StateMachine;

  constructor(chatId: number) {
    this.chatId = chatId;
    this.memoryManager = new MemoryManager();
    this.stateMachine = new StateMachine();

    eventBus.on(EVENTS.AGENT_STATE_CHANGED, async (payload: { chatId: number, state: AgentState }) => {
      if (payload.chatId !== this.chatId) return;
      if (payload.state === AgentState.COMPLETED || payload.state === AgentState.FAILED || payload.state === AgentState.STOPPED) {
        await this.saveSessionSnapshot(payload.state);
      }
    });
  }

  private async saveSessionSnapshot(state: AgentState) {
    const memoryObj = this.memoryManager.contextManager.getStructuredMemory();
    const taskCtx = this.memoryManager.getTaskContext();
    
    const errorsToSave = (state === AgentState.FAILED || state === AgentState.STOPPED) 
      ? memoryObj.errors 
      : [];

    const messages = this.memoryManager.getFullHistory ? this.memoryManager.getFullHistory() : this.memoryManager.getHistory();
    const metrics = metricsTracker.getMetrics();

    await autoMemory.saveSessionSnapshot({
      date: new Date().toISOString().split('T')[0],
      task: taskCtx.originalRequest,
      status: state,
      filesCreated: memoryObj.filesCreated,
      filesRead: memoryObj.filesRead,
      decisions: memoryObj.decisions,
      discoveries: memoryObj.discoveries,
      errors: errorsToSave
    }, messages, metrics);
  }

  async resumeSession(sessionId: string | undefined, statusCallback: (msg: string) => Promise<void> | void) {
    if (this.isExecuting) return;
    const session = await autoMemory.loadSession(sessionId);
    if (!session) {
      await statusCallback('❌ *Session not found.*');
      return;
    }
    
    let historyStr = session.messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
    const task = `[RESUMED SESSION — ${session.startedAt}]\nTask: ${session.task}\n\n${historyStr}\n\n--- [ПРОДОВЖЕННЯ] ---\nReview the previous session history above and continue the task from where it left off.`;
    
    // Pass task to handleTask, it will do the initialization
    await this.handleTask(task, statusCallback);
  }

  async gotoCheckpoint(checkpointId: number, statusCallback: (msg: string) => Promise<void> | void) {
    if (this.isExecuting) return;
    const cp = await autoMemory.getCheckpoint(checkpointId);
    if (!cp) {
      await statusCallback(`❌ *Checkpoint ${checkpointId} not found.*`);
      return;
    }
    const session = await autoMemory.loadSession(cp.sessionId);
    if (!session) {
      await statusCallback('❌ *Associated session not found.*');
      return;
    }
    
    const messages = session.messages.slice(0, cp.messageIndex + 1);
    let historyStr = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
    const task = `[RESTORED CHECKPOINT — ${cp.name}]\nOriginal Task: ${session.task}\n\n${historyStr}\n\n--- [ПРОДОВЖЕННЯ] ---\nReview the previous session history above up to checkpoint '${cp.name}' and continue from there.`;
    
    await this.handleTask(task, statusCallback);
  }

  async handleTask(task: string, statusCallback: (msg: string) => Promise<void> | void) {
    if (this.isExecuting) {
      // Mid-execution interruption support
      this.memoryManager.addMessage({ role: 'user', content: task });
      await statusCallback('⚠️ *Message added to ongoing task context.*');
      return;
    }

    this.isExecuting = true;
    this.stateMachine.reset();
    this.stateMachine.transition(AgentState.ANALYZING_TASK);
    this.memoryManager.setTask(task);
    await statusCallback(`🚀 *Task Started:*\n\`${task}\`\n\n🔍 *Analyzing...*`);

    const systemPrompt = `You are XaCode, an AI coding agent.
Execute tools to solve tasks step-by-step. Keep code modifications minimal. State clearly when tasks complete.

RULES:
1. SANDBOX: Restricted to 'sandbox/'. For outside access, ask user to run '/fullaccess enable'.
2. TERMINAL: NO interactive commands (add -y, otherwise it hangs).
3. TELEGRAM UI: 
   - NO Markdown headings (#). Use bold + emojis ("🎯 *Heading*").
   - NO Markdown tables (|---|). Use premium lists (e.g. 🌐 *Адрес:* \`URL\`).
   - Wrap code/values in single backticks (\`val\`). Clean spacing.
4. LANGUAGE: Reply in the exact same language as the user.`;

    if (this.memoryManager.getHistory().length === 0) {
      let extraInstructions = '';
      const cwd = process.cwd();
      
      const xacodeMdPath = path.join(cwd, 'XACODE.md');
      const localMdPath = path.join(cwd, 'XACODE.local.md');
      
      if (fs.existsSync(xacodeMdPath)) {
        extraInstructions += `\n\n[PROJECT INSTRUCTIONS]\n${await fs.promises.readFile(xacodeMdPath, 'utf8')}`;
      }
      
      const gitignorePath = path.join(cwd, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        const ignoreContent = await fs.promises.readFile(gitignorePath, 'utf8');
        if (!ignoreContent.includes('.xacode') && !ignoreContent.includes('XACODE.local')) {
          logger.warn('⚠️ XACODE.local.md detected but not in .gitignore. Add ".xacode*" to your .gitignore to avoid committing local config.');
        }
      }

      if (fs.existsSync(localMdPath)) {
        extraInstructions += `\n\n[PERSONAL INSTRUCTIONS]\n${await fs.promises.readFile(localMdPath, 'utf8')}`;
      }

      const pastMemory = await autoMemory.loadLastMemory();
      if (pastMemory) {
        extraInstructions += `\n\n${pastMemory}`;
      }
      
      const skillsCatalog = skillManager.getSkillsCatalog();
      if (skillsCatalog) {
        extraInstructions += `\n\n${skillsCatalog}`;
      }

      const finalSystemPrompt = systemPrompt + extraInstructions;
      this.memoryManager.resetSession(finalSystemPrompt, toolDefinitions as any);
    }
    
    // Programmatic Pre-filter (Layer 2)
    const preloadedSkills = skillManager.prefilterSkills(task);
    let skillContext = '';
    if (preloadedSkills.length > 0) {
      skillContext += '\n\n[PRE-LOADED SKILLS]\nBased on your request, the following skills might be relevant:\n';
      for (const skill of preloadedSkills) {
        const body = skillManager.getSkillBody(skill.name);
        if (body) {
          skillContext += `\n--- SKILL: ${skill.name} ---\n${body}\n-------------------\n`;
        }
      }
    }
    
    const accessText = permissionSystem.isFullAccess() ?
      "\n\n[SYSTEM NOTIFICATION]: You currently have FULL FILESYSTEM ACCESS. You are NOT restricted to the sandbox." :
      "\n\n[SYSTEM NOTIFICATION]: You are currently RESTRICTED to the 'sandbox/' directory. Do NOT attempt to read/write outside it.";

    this.memoryManager.addMessage({ role: 'user', content: task + accessText + skillContext });

    const startMetrics = metricsTracker.getMetrics();

    try {
      await this.runLoop(statusCallback);
      
      const endMetrics = metricsTracker.getMetrics();
      const tokensSpent = endMetrics.tokenUsage - startMetrics.tokenUsage;
      const costSpent = endMetrics.apiCost - startMetrics.apiCost;
      const memoryStats = this.memoryManager.contextManager.getMemoryStats();
      const remainingTokens = memoryStats.maxTokens - memoryStats.usageTokens;
      const percentUsed = Math.round((memoryStats.usageTokens / memoryStats.maxTokens) * 100);
      
      let pastieLink = '';
      if (config.PASTE_LOGS_ENABLED) {
        try {
          const history = this.memoryManager.getHistory();
          let logText = history.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n----------------------------------------\n\n');
          
          // Scrub sensitive information
          if (config.DEEPSEEK_API_KEY) {
            logText = logText.split(config.DEEPSEEK_API_KEY).join('[API_KEY_HIDDEN]');
          }
          if (config.TELEGRAM_BOT_TOKEN) {
            logText = logText.split(config.TELEGRAM_BOT_TOKEN).join('[BOT_TOKEN_HIDDEN]');
          }

          pastieLink = await pastieManager.uploadLog(task.substring(0, 50), logText);
        } catch (err: any) {
          pastieLink = `Error: ${err.message}`;
        }
      }

      const statsMsg = `📊 *Task Execution Metrics:*\n`
        + `────────────────────────\n`
        + `• *Tokens Spent (this run):* \`${tokensSpent.toLocaleString()}\`\n`
        + `• *Estimated Cost:* \`$${costSpent.toFixed(4)}\`\n`
        + `• *Context Usage:* \`${memoryStats.usageTokens} / ${memoryStats.maxTokens}\` tokens (${percentUsed}%)\n`
        + `• *Context Remaining:* \`${remainingTokens.toLocaleString()}\` tokens\n`
        + (config.PASTE_LOGS_ENABLED ? `• *Session Log:* ${pastieLink}` : '');
      
      await statusCallback(statsMsg);
    } catch (e: any) {
      logger.error('Agent loop crashed:', e);
      await statusCallback(`❌ *Agent crashed:*\n\`${e.message}\``);
      this.memoryManager.failTask();
      if (this.stateMachine.getState() !== AgentState.STOPPED) {
        this.stateMachine.transition(AgentState.FAILED);
      }
    } finally {
      this.isExecuting = false;
      if (this.stateMachine.getState() !== AgentState.STOPPED) {
        this.stateMachine.transition(AgentState.IDLE);
      }
    }
  }

  private async runLoop(statusCallback: (msg: string) => Promise<void> | void) {
    let loopCount = 0;
    const MAX_LOOPS = config.MAX_LOOPS;
    let recentActions: string[] = [];
    let recentToolResults: string[] = [];

    while ((config.DISABLE_LOOP_LIMIT || loopCount < MAX_LOOPS) && this.isExecuting && this.stateMachine.getState() !== AgentState.STOPPED) {
      loopCount++;
      await this.memoryManager.ensureCompressed();
      const msgs = this.memoryManager.getMessagesForLLM();

      const response = await llmProvider.chatComplete({
        messages: msgs,
        tools: toolDefinitions as any,
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        this.memoryManager.addMessage({
          role: 'assistant',
          content: response.content || '',
          reasoning_content: response.reasoningContent,
          tool_calls: response.toolCalls,
        });

        for (const toolCall of response.toolCalls) {
          const functionName = toolCall.function.name;
          let args: any;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e: any) {
            await statusCallback(`⚠️ *Tool Error:* JSON syntax error in arguments for \`${functionName}\`.`);
            logger.error(`JSON parse error for tool ${functionName}`, e);
            this.memoryManager.addMessage({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: functionName,
              content: 'Error: Invalid JSON syntax in tool call arguments. Please fix your JSON and try again.'
            });
            continue;
          }
          
          const actionHash = `${functionName}:${JSON.stringify(args)}`;
          recentActions.push(actionHash);
          if (recentActions.length > 5) recentActions.shift();
          
          const duplicateCount = recentActions.filter(a => a === actionHash).length;
          if (duplicateCount >= 3) {
            this.memoryManager.addMessage({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: functionName,
              content: '[SYSTEM WARNING] You have executed this exact same tool with these exact same arguments 3 times in a row. You are stuck in a loop. STOP doing this and try a completely different approach, or ask the user for help.'
            });
            continue;
          }
          
          const prettyArgs = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
          await statusCallback(`🛠 *Executing Tool:* \`${functionName}\`\n\`\`\`json\n${prettyArgs}\n\`\`\``);
          logger.info(`Executing tool ${functionName}`, args);

          const toolResult = await executeTool(functionName, args, this.chatId);
          
          if (functionName === 'write_file' || functionName === 'edit_file') {
            this.memoryManager.addModifiedFile(args.targetPath);
          }
          
          let finalResult = toolResult;
          if (toolResult && toolResult.trim().length > 0) {
            recentToolResults.push(toolResult.trim());
            if (recentToolResults.length > 5) recentToolResults.shift();
            
            const duplicateResultCount = recentToolResults.filter(r => r === toolResult.trim()).length;
            if (duplicateResultCount >= 3) {
              const warningMsg = `[SYSTEM WARNING] You have received this exact same output/error from your tools 3 times recently:\n${toolResult.substring(0, 300)}\n\nYou are repeating the same mistake or running into the same blocker. DO NOT keep trying the same command or similar failing actions. You must change your approach completely, investigate the cause of the failure, or ask the user for advice/help in your response.`;
              finalResult = `${toolResult}\n\n${warningMsg}`;
              await statusCallback(`⚠️ *Stuck Loop Warning:* Agent received the same error/result 3 times.`);
            }
          }

          this.memoryManager.addMessage({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: finalResult
          });
        }
      } else {
        this.memoryManager.addMessage({ 
          role: 'assistant', 
          content: response.content || '',
          reasoning_content: response.reasoningContent 
        });
        
        if (config.SHOW_REASONING && response.reasoningContent) {
          await statusCallback(`🧠 *Agent Reasoning:*\n_${response.reasoningContent}_`);
        }

        await statusCallback(`🤖 *Agent:* ${response.content}`);

        if (response.content?.toLowerCase().includes('task complete') || response.content?.toLowerCase().includes('task is complete')) {
          this.memoryManager.completeTask();
          await statusCallback(`✅ *Task completed successfully!*`);
          break;
        }

        break;
      }
    }

    if (!config.DISABLE_LOOP_LIMIT && loopCount >= MAX_LOOPS) {
      await statusCallback('⚠️ *Warning:* Maximum execution loops reached. Halting execution to prevent infinite loop.');
    }
  }

  stop() {
    this.isExecuting = false;
    if (this.stateMachine.getState() !== AgentState.STOPPED) {
      this.stateMachine.transition(AgentState.STOPPED);
    }
    this.memoryManager.failTask();
  }
}

export class AgentOrchestrator {
  private sessions = new Map<number, AgentSession>();

  getSession(chatId: number): AgentSession {
    if (!this.sessions.has(chatId)) {
      this.sessions.set(chatId, new AgentSession(chatId));
    }
    return this.sessions.get(chatId)!;
  }
}

export const agentOrchestrator = new AgentOrchestrator();
