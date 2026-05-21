import { readFile, writeFile, editFile, listDirectory } from './fs';
import { terminalManager } from '../terminal';

// Define the tools for DeepSeek (OpenAI compatible format)
export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file.',
      parameters: {
        type: 'object',
        properties: {
          targetPath: { type: 'string', description: 'The absolute or relative path to the file' }
        },
        required: ['targetPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write new content to a file (overwrites if exists).',
      parameters: {
        type: 'object',
        properties: {
          targetPath: { type: 'string', description: 'The path to the file' },
          content: { type: 'string', description: 'The exact content to write' }
        },
        required: ['targetPath', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file by replacing a specific string with another.',
      parameters: {
        type: 'object',
        properties: {
          targetPath: { type: 'string', description: 'The path to the file' },
          search: { type: 'string', description: 'The exact string to find and replace' },
          replace: { type: 'string', description: 'The new string to replace it with' }
        },
        required: ['targetPath', 'search', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the terminal.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          cwd: { type: 'string', description: 'Optional. The working directory' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List contents of a directory.',
      parameters: {
        type: 'object',
        properties: {
          targetPath: { type: 'string', description: 'The path to the directory' }
        },
        required: ['targetPath']
      }
    }
  }
];

// Execute the tool based on the name and arguments
export async function executeTool(name: string, args: any): Promise<string> {
  let result = '';
  try {
    switch (name) {
      case 'read_file':
        result = await readFile(args.targetPath);
        break;
      case 'write_file':
        result = await writeFile(args.targetPath, args.content);
        break;
      case 'edit_file':
        result = await editFile(args.targetPath, args.search, args.replace);
        break;
      case 'list_directory':
        const dir = await listDirectory(args.targetPath);
        result = dir.join('\n');
        break;
      case 'run_command':
        const termRes = await terminalManager.runCommand(args.command, args.cwd);
        result = `Exit Code: ${termRes.code}\nStdout:\n${termRes.stdout}\nStderr:\n${termRes.stderr}`;
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    result = `Error executing tool ${name}: ${error.message || String(error)}`;
  }
  
  // Truncate massively long tool outputs to prevent context explosion
  // We keep the first 2000 characters and the last 8000 characters so the agent can see both the start and the final errors.
  const MAX_LENGTH = 10000;
  if (result.length > MAX_LENGTH) {
    const startStr = result.substring(0, 2000);
    const endStr = result.substring(result.length - 8000);
    result = `${startStr}\n\n...[OUTPUT TRUNCATED: The result was too long (${result.length} chars). Middle section removed to save context memory]...\n\n${endStr}`;
  }
  
  return result;
}
