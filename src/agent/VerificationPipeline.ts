import fs from 'fs/promises';
import path from 'path';
import { terminalManager } from '../terminal';
import { logger } from '../logger';
import { eventBus, EVENTS } from '../events/EventBus';

export enum Framework {
  NPM = 'NPM',
  PNPM = 'PNPM',
  YARN = 'YARN',
  BUN = 'BUN',
  CARGO = 'CARGO',
  GO = 'GO',
  PYTEST = 'PYTEST',
  UNKNOWN = 'UNKNOWN'
}

export class VerificationPipeline {
  async detectFramework(workspaceRoot: string): Promise<Framework> {
    try {
      const files = await fs.readdir(workspaceRoot);
      if (files.includes('pnpm-lock.yaml')) return Framework.PNPM;
      if (files.includes('yarn.lock')) return Framework.YARN;
      if (files.includes('bun.lockb')) return Framework.BUN;
      if (files.includes('package.json')) return Framework.NPM;
      if (files.includes('Cargo.toml')) return Framework.CARGO;
      if (files.includes('go.mod')) return Framework.GO;
      if (files.includes('pytest.ini') || files.includes('requirements.txt')) return Framework.PYTEST;
    } catch (e) {
      logger.warn('Failed to detect framework, falling back to UNKNOWN');
    }
    return Framework.UNKNOWN;
  }

  getVerificationCommands(framework: Framework): { lint: string, test: string } {
    switch (framework) {
      case Framework.PNPM: return { lint: 'pnpm run lint --if-present', test: 'pnpm test --if-present' };
      case Framework.YARN: return { lint: 'yarn lint', test: 'yarn test' };
      case Framework.BUN: return { lint: 'bun run lint', test: 'bun test' };
      case Framework.NPM: return { lint: 'npm run lint --if-present', test: 'npm test --if-present' };
      case Framework.CARGO: return { lint: 'cargo clippy', test: 'cargo test' };
      case Framework.GO: return { lint: 'go vet ./...', test: 'go test ./...' };
      case Framework.PYTEST: return { lint: 'flake8 .', test: 'pytest' };
      default: return { lint: 'echo "No lint configured"', test: 'echo "No test configured"' };
    }
  }

  async runVerification(workspaceRoot: string): Promise<{ success: boolean, output: string }> {
    logger.info('Starting verification pipeline...');
    const framework = await this.detectFramework(workspaceRoot);
    const cmds = this.getVerificationCommands(framework);

    let output = '';
    
    // Run Lint
    logger.info(`Running lint for ${framework}: ${cmds.lint}`);
    const lintResult = await terminalManager.runCommand(cmds.lint, workspaceRoot);
    output += `[LINT]\n${lintResult.stdout}\n${lintResult.stderr}\n`;
    
    if (lintResult.code !== 0 && !lintResult.stdout.includes('No lint configured')) {
      logger.warn('Verification failed at LINT stage');
      eventBus.emit(EVENTS.VERIFICATION_FAILED, { stage: 'lint', output });
      return { success: false, output };
    }

    // Run Tests
    logger.info(`Running tests for ${framework}: ${cmds.test}`);
    const testResult = await terminalManager.runCommand(cmds.test, workspaceRoot);
    output += `[TEST]\n${testResult.stdout}\n${testResult.stderr}\n`;

    if (testResult.code !== 0 && !testResult.stdout.includes('No test configured')) {
      logger.warn('Verification failed at TEST stage');
      eventBus.emit(EVENTS.VERIFICATION_FAILED, { stage: 'test', output });
      return { success: false, output };
    }

    logger.info('Verification pipeline completed successfully.');
    return { success: true, output };
  }
}

export const verificationPipeline = new VerificationPipeline();
