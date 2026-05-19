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
  try {
    switch (name) {
      case 'read_file':
        return await readFile(args.targetPath);
      case 'write_file':
        return await writeFile(args.targetPath, args.content);
      case 'edit_file':
        return await editFile(args.targetPath, args.search, args.replace);
      case 'list_directory':
        const dir = await listDirectory(args.targetPath);
        return dir.join('\n');
      case 'run_command':
        const result = await terminalManager.runCommand(args.command, args.cwd);
        return `Exit Code: ${result.code}\nStdout:\n${result.stdout}\nStderr:\n${result.stderr}`;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return `Error executing tool ${name}: ${error.message || String(error)}`;
  }
}
