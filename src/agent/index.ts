import { config } from '../config';
import { memoryManager, ChatMessage } from '../memory';
import { toolDefinitions, executeTool } from '../tools';
import { logger } from '../logger';
import { llmProvider } from '../llm/Provider';
import { agentStateMachine, AgentState } from './StateMachine';

export class AgentCore {
  private isExecuting: boolean = false;

  async handleTask(task: string, statusCallback: (msg: string) => void) {
    if (this.isExecuting) {
      statusCallback('Agent is already executing a task. Use /stop to cancel.');
      return;
    }

    this.isExecuting = true;
    agentStateMachine.reset();
    agentStateMachine.transition(AgentState.ANALYZING_TASK);
    memoryManager.setTask(task);
    statusCallback(`[Started] Task: ${task}\nAnalyzing...`);

    const systemPrompt = `You are XaCode, a production-ready AI coding agent.
You have access to a secure sandbox and can execute tools.
Think step by step. Use tools when necessary. Keep your codebase modifications minimal.
When the task is complete, return a clear summary and explicitly state that the task is complete.`;

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
      statusCallback(`[Error] Agent crashed: ${e.message}`);
      memoryManager.failTask();
    } finally {
      this.isExecuting = false;
      if (agentStateMachine.getState() !== AgentState.STOPPED) {
        agentStateMachine.transition(AgentState.IDLE);
      }
    }
  }

  private async runLoop(statusCallback: (msg: string) => void) {
    let loopCount = 0;
    const MAX_LOOPS = 15;

    while (loopCount < MAX_LOOPS && this.isExecuting && agentStateMachine.getState() !== AgentState.STOPPED) {
      loopCount++;
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
          tool_calls: response.toolCalls,
        });

        for (const toolCall of response.toolCalls) {
          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          
          statusCallback(`[Tool Call] ${functionName}\n${JSON.stringify(args)}`);
          logger.info(`Executing tool ${functionName}`, args);

          const toolResult = await executeTool(functionName, args);
          
          memoryManager.addMessage({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: toolResult
          });
        }
      } else {
        memoryManager.addMessage({ role: 'assistant', content: response.content || '' });
        statusCallback(`[Agent] ${response.content}`);

        // Decide if we should stop. A simple heuristic is if the agent says it's done or we don't have tools called.
        if (response.content?.toLowerCase().includes('task complete') || response.content?.toLowerCase().includes('task is complete')) {
          memoryManager.completeTask();
          statusCallback(`[Completed] Task finished.`);
          break;
        }

        // If no tool was called, we just wait for the user to respond, we break the auto-loop
        break;
      }
    }

    if (loopCount >= MAX_LOOPS) {
      statusCallback('[Warning] Maximum execution loops reached. Halting to prevent infinite loop.');
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
