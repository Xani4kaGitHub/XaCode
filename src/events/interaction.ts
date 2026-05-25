import { EventEmitter } from 'events';

export const interactionEmitter = new EventEmitter();

// Helper for tools to wait for a choice
export function askUserChoice(chatId: number, question: string, options: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    
    // We emit an event that BotService should listen to
    interactionEmitter.emit('ask_choice', {
      chatId,
      requestId,
      question,
      options
    });

    const timeout = setTimeout(() => {
      interactionEmitter.removeAllListeners(`choice_response_${requestId}`);
      reject(new Error('User did not respond in time (timeout after 5 minutes)'));
    }, 5 * 60 * 1000); // 5 mins timeout

    // Listen for the response
    interactionEmitter.once(`choice_response_${requestId}`, (choice: string) => {
      clearTimeout(timeout);
      resolve(choice);
    });
  });
}

export async function sendTelegramDocument(chatId: number, filePath: string): Promise<string> {
  interactionEmitter.emit('send_document', { chatId, filePath });
  return `Requested to send document: ${filePath}`;
}
