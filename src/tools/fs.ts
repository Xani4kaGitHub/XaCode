import fs from 'fs/promises';
import path from 'path';
import { securityManager } from '../security';
import { memoryManager } from '../memory';
import { logger } from '../logger';

export async function readFile(targetPath: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  if (!securityManager.isPathAllowed(resolvedPath)) {
    throw new Error(`Access to ${resolvedPath} is forbidden by sandbox.`);
  }

  logger.info(`Reading file: ${resolvedPath}`);
  return await fs.readFile(resolvedPath, 'utf8');
}

export async function writeFile(targetPath: string, content: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  if (!securityManager.isPathAllowed(resolvedPath)) {
    throw new Error(`Access to ${resolvedPath} is forbidden by sandbox.`);
  }

  // Create directories if they don't exist
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, 'utf8');
  
  memoryManager.addModifiedFile(resolvedPath);
  logger.info(`Wrote file: ${resolvedPath}`);
  
  return `File ${resolvedPath} successfully written.`;
}

export async function editFile(targetPath: string, search: string, replace: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath);
  if (!securityManager.isPathAllowed(resolvedPath)) {
    throw new Error(`Access to ${resolvedPath} is forbidden by sandbox.`);
  }

  const content = await fs.readFile(resolvedPath, 'utf8');
  if (!content.includes(search)) {
    throw new Error(`Search string not found in ${resolvedPath}.`);
  }

  const newContent = content.replace(search, replace);
  await fs.writeFile(resolvedPath, newContent, 'utf8');
  
  memoryManager.addModifiedFile(resolvedPath);
  logger.info(`Edited file: ${resolvedPath}`);

  return `File ${resolvedPath} successfully edited.`;
}

export async function listDirectory(targetPath: string): Promise<string[]> {
  const resolvedPath = path.resolve(targetPath);
  if (!securityManager.isPathAllowed(resolvedPath)) {
    throw new Error(`Access to ${resolvedPath} is forbidden by sandbox.`);
  }

  logger.info(`Listing directory: ${resolvedPath}`);
  return await fs.readdir(resolvedPath);
}
