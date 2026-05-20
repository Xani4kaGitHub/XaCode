import { config } from '../config';
import { memoryManager, ChatMessage } from '../memory';
import { toolDefinitions, executeTool } from '../tools';
import { logger } from '../logger';
import { llmProvider } from '../llm/Provider';
import { agentStateMachine, AgentState } from './StateMachine';

export class AgentCore {
  private isExecuting: boolean = false;

  async handleTask(task: string, statusCallback: (msg: string) => Promise<void> | void) {
    if (this.isExecuting) {
      await statusCallback('⚠️ *Agent is already executing a task.* Use /stop to cancel.');
      return;
    }

    this.isExecuting = true;
    agentStateMachine.reset();
    agentStateMachine.transition(AgentState.ANALYZING_TASK);
    memoryManager.setTask(task);
    await statusCallback(`🚀 *Task Started:*\n\`${task}\`\n\n🔍 *Analyzing...*`);

    const systemPrompt = `You are XaCode, a production-ready AI coding agent.
You have access to a secure sandbox and can execute tools.
Think step by step. Use tools when necessary. Keep your codebase modifications minimal.
When the task is complete, return a clear summary and explicitly state that the task is complete.

CRITICAL RULES:
1. SANDBOX RESTRICTIONS: You are restricted to the 'sandbox/' directory. If you try to read/write outside it, you will get a forbidden error. If you MUST access project files outside the sandbox, ask the user to type '/fullaccess enable' first.
2. NON-INTERACTIVE COMMANDS ONLY: The terminal runs in the background. Never run interactive commands (like 'npm init', 'apt-get install' without '-y', or 'python -i'). Always provide '-y' flags or 'echo' piping, otherwise the terminal will hang and time out after 30 seconds.`;

    // Only reset memory if we don't want continuous context, but user wanted memory.
    // For now we assume continuous conversation memory unless /reset is called.
    if (memoryManager.getHistory().length === 0) {
      memoryManager.resetSession(systemPrompt, toolDefinitions as any);
    }
    
    memoryManager.addMessage({ role: 'user', content: task });

    try {
      await this.runLoop(statusCallback);
    } catch (e: any) {
      logger.error('Agent loop crashed:', e);
      await statusCallback(`❌ *Agent crashed:*\n\`${e.message}\``);
      memoryManager.failTask();
      if (agentStateMachine.getState() !== AgentState.STOPPED) {
        agentStateMachine.transition(AgentState.FAILED);
      }
    } finally {
      this.isExecuting = false;
      if (agentStateMachine.getState() !== AgentState.STOPPED) {
        agentStateMachine.transition(AgentState.IDLE);
      }
    }
  }

  private async runLoop(statusCallback: (msg: string) => Promise<void> | void) {
    let loopCount = 0;
    const MAX_LOOPS = config.MAX_LOOPS;
    let recentActions: string[] = [];
    let recentToolResults: string[] = [];

    while ((config.DISABLE_LOOP_LIMIT || loopCount < MAX_LOOPS) && this.isExecuting && agentStateMachine.getState() !== AgentState.STOPPED) {
      loopCount++;
      await memoryManager.ensureCompressed();
      const messages: any[] = memoryManager.getHistory();

      const response = await llmProvider.chatComplete({
        messages: messages,
        tools: toolDefinitions as any,
      });

      // DeepSeek/OpenAI compat structure
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Create an assistant message with the tool calls
        memoryManager.addMessage({
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
            memoryManager.addMessage({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: functionName,
              content: 'Error: Invalid JSON syntax in tool call arguments. Please fix your JSON and try again.'
            });
            continue;
          }
          
          // Infinite retry hallucination protection
          const actionHash = `${functionName}:${JSON.stringify(args)}`;
          recentActions.push(actionHash);
          if (recentActions.length > 5) recentActions.shift();
          
          const duplicateCount = recentActions.filter(a => a === actionHash).length;
          if (duplicateCount >= 3) {
            memoryManager.addMessage({
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

          const toolResult = await executeTool(functionName, args);
          
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

          memoryManager.addMessage({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: finalResult
          });
        }
      } else {
        memoryManager.addMessage({ 
          role: 'assistant', 
          content: response.content || '',
          reasoning_content: response.reasoningContent 
        });
        
        if (config.SHOW_REASONING && response.reasoningContent) {
          await statusCallback(`🧠 *Agent Reasoning:*\n_${response.reasoningContent}_`);
        }

        await statusCallback(`🤖 *Agent:* ${response.content}`);

        // Decide if we should stop. A simple heuristic is if the agent says it's done or we don't have tools called.
        if (response.content?.toLowerCase().includes('task complete') || response.content?.toLowerCase().includes('task is complete')) {
          memoryManager.completeTask();
          await statusCallback(`✅ *Task completed successfully!*`);
          break;
        }

        // If no tool was called, we just wait for the user to respond, we break the auto-loop
        break;
      }
    }

    if (!config.DISABLE_LOOP_LIMIT && loopCount >= MAX_LOOPS) {
      await statusCallback('⚠️ *Warning:* Maximum execution loops reached. Halting execution to prevent infinite loop.');
    }
  }

  stop() {
    this.isExecuting = false;
    if (agentStateMachine.getState() !== AgentState.STOPPED) {
      agentStateMachine.transition(AgentState.STOPPED);
    }
    memoryManager.failTask();
  }
}

export const agentCore = new AgentCore();
