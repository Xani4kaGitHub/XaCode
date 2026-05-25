import fs from 'fs/promises';
import path from 'path';
import { securityManager } from '../security';
import { permissionSystem } from '../security/PermissionSystem';
import { logger } from '../logger';
import { minimatch } from 'minimatch';

function checkPathAccess(resolvedPath: string) {
  if (!permissionSystem.isFullAccess() && !securityManager.isPathAllowed(resolvedPath)) {
    throw new Error(`Access to ${resolvedPath} is forbidden by sandbox. Type /fullaccess enable to allow.`);
  }
}

export async function readFile(targetPath: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  logger.info(`Reading file: ${resolvedPath}`);
  return await fs.readFile(resolvedPath, 'utf8');
}

export async function writeFile(targetPath: string, content: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  // Create directories if they don't exist
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, 'utf8');
  logger.info(`Wrote file: ${resolvedPath}`);
  
  return `File ${resolvedPath} successfully written.`;
}

export async function editFile(targetPath: string, search: string, replace: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  let content = await fs.readFile(resolvedPath, 'utf8');
  
  // Normalize CRLF to LF for both content and search string to avoid mismatch on Windows
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const normalizedSearch = search.replace(/\r\n/g, '\n');

  if (!normalizedContent.includes(normalizedSearch)) {
    throw new Error(`Search string not found in ${resolvedPath}. Make sure it exactly matches the file content.`);
  }

  const parts = normalizedContent.split(normalizedSearch);
  if (parts.length > 2) {
    throw new Error(`Error: Multiple matches found (${parts.length - 1} times). Please provide a more unique search string or more surrounding context.`);
  }

  // Use the exact match to preserve original file's newline characters if they were different
  const exactSearchIndex = normalizedContent.indexOf(normalizedSearch);
  const exactSearchInFile = content.substring(exactSearchIndex, exactSearchIndex + search.length);
  
  const newContent = content.replace(exactSearchInFile, replace);
  await fs.writeFile(resolvedPath, newContent, 'utf8');
  logger.info(`Edited file: ${resolvedPath}`);

  return `File ${resolvedPath} successfully edited.`;
}

export async function listDirectory(targetPath: string): Promise<string[]> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  logger.info(`Listing directory: ${resolvedPath}`);
  return await fs.readdir(resolvedPath);
}

// Additional utility functions for enhanced developer experience

/**
 * Recursively search for a pattern within files under a given directory.
 * Returns an array of file paths where the pattern is found.
 */


/**
 * Internal helper to recursively walk directories with permission checks.
 */
async function walkWithCheck(dir: string, fileHandler: (fullPath: string) => Promise<void>) {
  checkPathAccess(path.resolve(dir));
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await walkWithCheck(fullPath, fileHandler);
    } else if (entry.isFile()) {
      await fileHandler(fullPath);
    }
  }
}

/**
 * Updated searchCode implementation using walkWithCheck
 */
export async function searchCode(pattern: string, basePath: string = '.'): Promise<string[]> {
  const results: string[] = [];
  const regex = new RegExp(pattern, 'gm');
  await walkWithCheck(path.resolve(basePath), async (fullPath) => {
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      if (regex.test(content)) {
        results.push(fullPath);
      }
    } catch (e) {
      // ignore errors
    }
  });
  return results;
}

/**
 * Updated findFiles implementation using walkWithCheck
 */
export async function findFiles(globPattern: string, basePath: string = '.'): Promise<string[]> {
  const matches: string[] = [];
  await walkWithCheck(path.resolve(basePath), async (fullPath) => {
    const relative = path.relative(basePath, fullPath).replace(/\\/g, '/');
    if (minimatch(relative, globPattern)) {
      matches.push(fullPath);
    }
  });
  return matches;
}

/**
 * Batch read multiple files at once.
 */
export async function readFiles(paths: string[]): Promise<string[]> {
  return Promise.all(paths.map(p => readFile(p)));
}

/**
 * Atomically edit multiple files. If any edit fails, all changes are rolled back.
 */
export async function editFiles(edits: { path: string; search: string; replace: string }[]): Promise<void> {
  // Preserve original contents
  const originalMap = new Map<string, string>();
  for (const edit of edits) {
    const content = await readFile(edit.path);
    originalMap.set(edit.path, content);
  }
  try {
    for (const edit of edits) {
      await editFile(edit.path, edit.search, edit.replace);
    }
  } catch (e) {
    // Rollback all changes
    for (const [filePath, original] of originalMap.entries()) {
      await writeFile(filePath, original);
    }
    throw e; // re‑throw after rollback
  }
}

/**
 * Run a command in the background, returning a task id.
 * The task manager is a simple in‑memory map; callers can later query stdout/stderr via getTaskOutput.
 */
import { spawn } from 'child_process';
interface TaskInfo {
  process: ReturnType<typeof spawn>;
  stdout: string;
  stderr: string;
}
const taskRegistry = new Map<string, TaskInfo>();
export function runInBackground(command: string, cwd: string = process.cwd()): string {
  const [cmd, ...args] = command.split(' ');
  const child = spawn(cmd, args, { cwd, shell: true });
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const info: TaskInfo = { process: child, stdout: '', stderr: '' };
  child.stdout.on('data', data => { info.stdout += data.toString(); });
  child.stderr.on('data', data => { info.stderr += data.toString(); });
  child.on('close', () => {
    // Keep the output; callers can retrieve it later.
  });
  taskRegistry.set(taskId, info);
  return taskId;
}
export function getTaskOutput(taskId: string): { stdout: string; stderr: string } | undefined {
  const info = taskRegistry.get(taskId);
  return info ? { stdout: info.stdout, stderr: info.stderr } : undefined;
}
