import fs from 'fs/promises';
import path from 'path';
import { securityManager } from '../security';
import { permissionSystem } from '../security/PermissionSystem';
import { logger } from '../logger';
import { minimatch } from 'minimatch';
import { applyPatch } from 'diff';

function checkPathAccess(resolvedPath: string) {
  if (!permissionSystem.isFullAccess() && !securityManager.isPathAllowed(resolvedPath)) {
    throw new Error(`Access to ${resolvedPath} is forbidden by sandbox. Type /fullaccess enable to allow.`);
  }
}

async function backupFile(targetPath: string) {
  try {
    const resolvedPath = path.resolve(targetPath);
    const stats = await fs.stat(resolvedPath).catch(() => null);
    if (!stats || !stats.isFile()) return; // Nothing to backup
    
    // Create backup directory
    const workspaceDir = path.resolve('.'); // Assuming cwd is workspace
    const backupDir = path.join(workspaceDir, '.xacode', 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    const timestamp = Date.now();
    const safeName = path.relative(workspaceDir, resolvedPath).replace(/[\\/]/g, '_');
    const backupPath = path.join(backupDir, `${timestamp}_${safeName}`);
    
    await fs.copyFile(resolvedPath, backupPath);
    logger.debug(`Backed up ${resolvedPath} to ${backupPath}`);
  } catch (e) {
    logger.warn(`Failed to create backup for ${targetPath}: ${e}`);
  }
}

export async function undoFile(targetPath: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);
  
  const workspaceDir = path.resolve('.');
  const backupDir = path.join(workspaceDir, '.xacode', 'backups');
  const safeName = path.relative(workspaceDir, resolvedPath).replace(/[\\/]/g, '_');
  
  try {
    const files = await fs.readdir(backupDir);
    const backups = files.filter(f => f.endsWith(`_${safeName}`)).sort().reverse();
    
    if (backups.length === 0) {
      return `No backups found for ${targetPath}`;
    }
    
    const latestBackup = path.join(backupDir, backups[0]);
    await fs.copyFile(latestBackup, resolvedPath);
    logger.info(`Restored ${resolvedPath} from ${latestBackup}`);
    return `Restored ${targetPath} from backup successfully.`;
  } catch (e: any) {
    throw new Error(`Failed to restore backup: ${e.message}`);
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

  await backupFile(resolvedPath);

  // Create directories if they don't exist
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, 'utf8');
  logger.info(`Wrote file: ${resolvedPath}`);
  
  return `File ${resolvedPath} successfully written.`;
}

export async function deleteFile(targetPath: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  await fs.rm(resolvedPath, { recursive: true, force: true });
  logger.info(`Deleted path: ${resolvedPath}`);
  return `Path ${resolvedPath} successfully deleted.`;
}

export async function fileInfo(targetPath: string): Promise<any> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  try {
    const stats = await fs.stat(resolvedPath);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      sizeBytes: stats.size,
      created: stats.birthtime,
      modified: stats.mtime
    };
  } catch (e: any) {
    if (e.code === 'ENOENT') return { exists: false };
    throw e;
  }
}

export async function editFile(targetPath: string, search: string, replace: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  await backupFile(resolvedPath);

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

  // Create a regex from the normalized search string that matches either \r\n or \n for every newline
  const regexPattern = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n');
  const exactRegex = new RegExp(regexPattern);
  
  const newContent = content.replace(exactRegex, replace);
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
  const resolved = path.resolve(dir);
  checkPathAccess(resolved);
  
  try {
    const stats = await fs.stat(resolved);
    if (stats.isFile()) {
      await fileHandler(resolved);
      return;
    }
  } catch (e) {
    // If it doesn't exist or we can't access it, let readdir handle or throw
  }

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.xacode') continue;
    const fullPath = path.resolve(resolved, entry.name);
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
        const lines = content.split('\n');
        const lineRegex = new RegExp(pattern, 'g');
        lines.forEach((line, index) => {
          if (lineRegex.test(line)) {
            const relative = path.relative(path.resolve(basePath), fullPath).replace(/\\/g, '/');
            results.push(`${relative}:${index + 1}: ${line.trim()}`);
          }
        });
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

export function manageBackgroundTask(action: 'list' | 'kill' | 'status', taskId?: string): string {
  if (action === 'list') {
    if (taskRegistry.size === 0) return 'No active background tasks.';
    let output = 'Active background tasks:\n';
    for (const [id, info] of taskRegistry.entries()) {
      const status = info.process.exitCode === null ? 'Running' : `Exited (${info.process.exitCode})`;
      output += `- ${id}: ${status}\n`;
    }
    return output;
  }
  
  if (!taskId) return 'Error: taskId required for this action.';
  const info = taskRegistry.get(taskId);
  if (!info) return `Error: Task ID ${taskId} not found.`;

  if (action === 'kill') {
    info.process.kill();
    return `Task ${taskId} killed.`;
  }
  
  if (action === 'status') {
    const status = info.process.exitCode === null ? 'Running' : `Exited (${info.process.exitCode})`;
    return `Task ${taskId} Status: ${status}\nStdout Length: ${info.stdout.length}\nStderr Length: ${info.stderr.length}`;
  }

  return 'Unknown action.';
}

export async function applyPatchToFile(targetPath: string, patchString: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  await backupFile(resolvedPath);

  const oldContent = await fs.readFile(resolvedPath, 'utf8');
  // Handle carriage returns by normalizing before patching to avoid mismatch
  const normalizedOld = oldContent.replace(/\r\n/g, '\n');
  const normalizedPatch = patchString.replace(/\r\n/g, '\n');
  
  const result = applyPatch(normalizedOld, normalizedPatch);
  if (result === false) {
    throw new Error('Patch failed to apply — possible conflict. Ensure the patch context matches the file content.');
  }

  await fs.writeFile(resolvedPath, result, 'utf8');
  logger.info(`Patch applied to: ${resolvedPath}`);
  return `Patch successfully applied to ${resolvedPath}`;
}

export async function renameFile(from: string, to: string, overwrite: boolean = false): Promise<string> {
  const resolvedFrom = path.resolve(from);
  const resolvedTo = path.resolve(to);
  checkPathAccess(resolvedFrom);
  checkPathAccess(resolvedTo);

  if (!overwrite) {
    try {
      await fs.access(resolvedTo);
      throw new Error(`Target ${resolvedTo} already exists. Set overwrite: true to force.`);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  await fs.mkdir(path.dirname(resolvedTo), { recursive: true });
  try {
    await fs.rename(resolvedFrom, resolvedTo);
  } catch (e: any) {
    if (e.code === 'EXDEV') {
      // Fallback for cross-device link
      await fs.copyFile(resolvedFrom, resolvedTo);
      await fs.unlink(resolvedFrom);
    } else {
      throw e;
    }
  }
  logger.info(`Renamed ${resolvedFrom} to ${resolvedTo}`);
  return `Renamed ${resolvedFrom} → ${resolvedTo}`;
}

export async function createDirectory(targetPath: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);
  
  await fs.mkdir(resolvedPath, { recursive: true });
  logger.info(`Directory created: ${resolvedPath}`);
  return `Directory ${resolvedPath} created (or already exists).`;
}
