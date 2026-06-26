import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { config } from '../config';

const execAsync = promisify(exec);

export async function readLints(): Promise<any[]> {
  const tsconfigPath = path.resolve(process.cwd(), 'tsconfig.json');
  
  try {
    await fs.access(tsconfigPath);
  } catch {
    throw new Error('tsconfig.json not found in current directory. Cannot run TypeScript linting.');
  }

  try {
    // Run tsc --noEmit, use pretty false to make output parseable
    await execAsync('npx tsc --noEmit --pretty false', { cwd: process.cwd() });
    return []; // No errors
  } catch (error: any) {
    // exec throws an error when exit code is non-zero (which happens if there are compilation errors)
    const stdout = error.stdout || '';
    const lints: any[] = [];
    
    // Regex matches: src/file.ts(42,5): error TS123: Message
    const regex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
    let match;
    
    while ((match = regex.exec(stdout)) !== null) {
      lints.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4],
        code: match[5],
        message: match[6]
      });
    }

    if (lints.length === 0 && stdout) {
      // Unparseable output? Return raw stdout
      throw new Error(`Failed to parse tsc output:\n${stdout}`);
    }

    return lints;
  }
}
