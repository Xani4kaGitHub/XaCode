import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config();

export interface Config {
  TELEGRAM_BOT_TOKEN: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_MODEL: string;
  DEEPSEEK_BASE_URL: string;
  LLM_PROVIDER: string;
  ALLOWED_USER_IDS: number[];
  SANDBOX_DIR: string;
  MAX_EXECUTION_TIMEOUT_MS: number;
  MAX_LOOPS: number;
  MAX_CONTEXT_TOKENS: number;
  SHOW_REASONING: boolean;
  DISABLE_LOOP_LIMIT: boolean;
  WHISPER_ENABLED: boolean;
  WHISPER_MODEL: string;
  ALWAYS_FULL_ACCESS: boolean;
  PASTE_LOGS_ENABLED: boolean;
  PASTE_LOGS_EXPIRY_MINUTES: number;
  SMART_MEMORY_MODE: boolean;
  STUCK_LOOP_THRESHOLD: number;
}

export const config: Config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  LLM_PROVIDER: process.env.LLM_PROVIDER || 'deepseek',
  ALLOWED_USER_IDS: (process.env.ALLOWED_USER_IDS || '').split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)),
  SANDBOX_DIR: process.env.SANDBOX_DIR || path.resolve(process.cwd(), 'sandbox'),
  MAX_EXECUTION_TIMEOUT_MS: parseInt(process.env.MAX_EXECUTION_TIMEOUT_MS || '30000', 10),
  MAX_LOOPS: parseInt(process.env.MAX_LOOPS || '30', 10),
  MAX_CONTEXT_TOKENS: parseInt(process.env.MAX_CONTEXT_TOKENS || '32000', 10),
  SHOW_REASONING: process.env.SHOW_REASONING === 'true',
  DISABLE_LOOP_LIMIT: process.env.DISABLE_LOOP_LIMIT === 'true',
  WHISPER_ENABLED: process.env.WHISPER_ENABLED === 'true',
  WHISPER_MODEL: process.env.WHISPER_MODEL || 'tiny',
  ALWAYS_FULL_ACCESS: process.env.ALWAYS_FULL_ACCESS === 'true',
  PASTE_LOGS_ENABLED: process.env.PASTE_LOGS_ENABLED === 'true', // default false
  PASTE_LOGS_EXPIRY_MINUTES: parseInt(process.env.PASTE_LOGS_EXPIRY_MINUTES || '10', 10),
  SMART_MEMORY_MODE: process.env.SMART_MEMORY_MODE !== 'false', // default true
  STUCK_LOOP_THRESHOLD: parseInt(process.env.STUCK_LOOP_THRESHOLD || '3', 10),
};

export function validateConfig() {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is missing in environment variables');
  }
  if (!config.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is missing in environment variables');
  }
  if (config.ALLOWED_USER_IDS.length === 0) {
    console.warn('WARNING: ALLOWED_USER_IDS is empty. No one will be able to use the bot.');
  }
}
