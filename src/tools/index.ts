import { readFile, writeFile, editFile, listDirectory, searchCode, findFiles, readFiles, runInBackground, getTaskOutput } from './fs';
import { terminalManager } from '../terminal';
import { webSearch } from './search';
import { interactiveShell } from './shell';
import { manageTodos } from './todos';
import { askUserChoice } from '../events/interaction';

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
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search for a regex pattern within files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search' },
          basePath: { type: 'string', description: 'Optional path to search in (default is current)' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: 'Find files by glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          globPattern: { type: 'string', description: 'Glob pattern like src/**/*.ts' },
          basePath: { type: 'string', description: 'Optional base path' }
        },
        required: ['globPattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_files',
      description: 'Read contents of multiple files at once.',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Array of file paths' }
        },
        required: ['paths']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_in_background',
      description: 'Run a shell command in the background.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run' },
          cwd: { type: 'string', description: 'Optional working directory' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_task_output',
      description: 'Get the stdout and stderr of a background task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID' }
        },
        required: ['taskId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'interactive_shell',
      description: 'Run commands in a persistent stateful shell session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID (null for a new session)' },
          command: { type: 'string', description: 'Command to execute in the session' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_todos',
      description: 'Manage a persistent todo list for the agent.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'complete', 'delete'], description: 'Action to perform' },
          textOrId: { type: 'string', description: 'Text of todo for "add", or ID for "complete"/"delete"' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user_choice',
      description: 'Ask the user a multiple choice question and wait for their response.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask' },
          options: { type: 'array', items: { type: 'string' }, description: 'Array of choices/buttons' }
        },
        required: ['question', 'options']
      }
    }
  }
];

// Execute the tool based on the name and arguments
export async function executeTool(name: string, args: any, chatId?: number): Promise<string> {
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
      case 'search_code':
        const searchMatches = await searchCode(args.pattern, args.basePath);
        result = searchMatches.length > 0 ? searchMatches.join('\n') : 'No matches found.';
        break;
      case 'find_files':
        const globMatches = await findFiles(args.globPattern, args.basePath);
        result = globMatches.length > 0 ? globMatches.join('\n') : 'No files found.';
        break;
      case 'read_files':
        const fileContents = await readFiles(args.paths);
        result = args.paths.map((p: string, i: number) => `--- ${p} ---\n${fileContents[i]}\n`).join('\n');
        break;
      case 'run_in_background':
        const taskId = runInBackground(args.command, args.cwd);
        result = `Background task started with ID: ${taskId}`;
        break;
      case 'get_task_output':
        const taskOut = getTaskOutput(args.taskId);
        if (taskOut) {
          result = `Stdout:\n${taskOut.stdout}\n\nStderr:\n${taskOut.stderr}`;
        } else {
          result = `Error: Task ID ${args.taskId} not found.`;
        }
        break;
      case 'web_search':
        result = await webSearch(args.query);
        break;
      case 'interactive_shell':
        result = await interactiveShell(args.sessionId || null, args.command);
        break;
      case 'manage_todos':
        result = await manageTodos(args.action, args.textOrId);
        break;
      case 'ask_user_choice':
        if (!chatId) throw new Error('chatId is required for interactive user choice');
        result = await askUserChoice(chatId, args.question, args.options);
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
