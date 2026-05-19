export class Tokenizer {
  // A lightweight heuristic tokenizer for fallback when tiktoken is unavailable or not loaded
  // DeepSeek roughly aligns with OpenAI's cl100k_base.
  // On average, 1 token ≈ 4 characters in English code, or slightly fewer for Cyrillic.
  
  estimateTokenCount(text: string): number {
    if (!text) return 0;
    
    // Simple heuristic: length / 3.5 provides a safe upper bound
    return Math.ceil(text.length / 3.5);
  }

  estimateMessagesTokenCount(messages: any[]): number {
    let tokens = 0;
    for (const msg of messages) {
      // Base tokens per message (role + formatting overhead)
      tokens += 4;
      if (msg.content) {
        tokens += this.estimateTokenCount(msg.content);
      }
      if (msg.name) {
        tokens += this.estimateTokenCount(msg.name);
      }
      if (msg.tool_calls) {
        tokens += this.estimateTokenCount(JSON.stringify(msg.tool_calls));
      }
    }
    // Base tokens for completion overhead
    tokens += 3;
    return tokens;
  }
}

export const tokenizer = new Tokenizer();
