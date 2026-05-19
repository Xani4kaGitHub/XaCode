import fs from 'fs/promises';
import path from 'path';
import { securityManager } from '../security';
import { permissionSystem } from '../security/PermissionSystem';
import { memoryManager } from '../memory';
import { logger } from '../logger';

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
  
  memoryManager.addModifiedFile(resolvedPath);
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
  
  memoryManager.addModifiedFile(resolvedPath);
  logger.info(`Edited file: ${resolvedPath}`);

  return `File ${resolvedPath} successfully edited.`;
}

export async function listDirectory(targetPath: string): Promise<string[]> {
  const resolvedPath = path.resolve(targetPath);
  checkPathAccess(resolvedPath);

  logger.info(`Listing directory: ${resolvedPath}`);
  return await fs.readdir(resolvedPath);
}
