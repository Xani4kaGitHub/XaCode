import { config, validateConfig } from './config';
import { logger } from './logger';
import { botService } from './bot';
import { pastieManager } from './utils/pastie';
import { ipcServer } from './ipc/IPCServer';

async function bootstrap() {
  try {
    logger.info('Starting XaCode Agent...');
    
    // 1. Validate environment
    validateConfig();

    // 2. Start IPC Server for CLI communication
    await ipcServer.start();

    // 3. BotService initializes automatically when imported, starting the Telegram listener
    // We just reference it to ensure it stays in memory
    const bot = botService;
    
    // 4. Start cleanup timer for pasties
    pastieManager.startCleanupTimer();
    
    logger.info('XaCode Agent successfully started and listening for Telegram messages.');
  } catch (error: any) {
    console.error('CRASH ERROR:', error);
    logger.error('Failed to start XaCode Agent:', error);
    process.exit(1);
  }
}

bootstrap();
