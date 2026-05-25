import { readFile, writeFile, editFile, listDirectory, searchCode, findFiles, readFiles, runInBackground, getTaskOutput, deleteFile, fileInfo, manageBackgroundTask } from './fs';
import { terminalManager } from '../terminal';
import { webSearch, readUrl } from './search';
import { interactiveShell } from './shell';
import { manageTodos } from './todos';
import { askUserChoice, sendTelegramDocument } from '../events/interaction';
import { httpRequest } from './http';

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
          command: { type: 'string', description: 'Command to execute in the session' },
          timeoutMs: { type: 'number', description: 'Optional wait time in ms (default 1500)' }
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
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Make an HTTP/API request using native fetch.',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE, etc.)' },
          url: { type: 'string', description: 'The URL to request' },
          headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Key-value pairs of headers' },
          body: { type: 'string', description: 'Optional request body string (JSON, etc.)' },
          timeoutMs: { type: 'number', description: 'Optional timeout in ms' }
        },
        required: ['method', 'url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file or directory recursively.',
      parameters: {
        type: 'object',
        properties: {
          targetPath: { type: 'string', description: 'The path to delete' }
        },
        required: ['targetPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_url',
      description: 'Fetch and extract readable text from a web page URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The web page URL' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_telegram_document',
      description: 'Send a file from the workspace to the user in Telegram.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'The path of the file to send' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_info',
      description: 'Check if a file exists and get its metadata (size, type).',
      parameters: {
        type: 'object',
        properties: {
          targetPath: { type: 'string', description: 'The path to the file or directory' }
        },
        required: ['targetPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_background_task',
      description: 'List, check status, or kill background tasks.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'kill', 'status'], description: 'Action to perform' },
          taskId: { type: 'string', description: 'The task ID (required for kill and status)' }
        },
        required: ['action']
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
      case 'http_request':
        const httpRes = await httpRequest(args.method, args.url, args.headers, args.body, args.timeoutMs);
        result = `Status: ${httpRes.status}\nHeaders: ${JSON.stringify(httpRes.headers)}\nBody:\n${httpRes.body}`;
        break;
      case 'delete_file':
        result = await deleteFile(args.targetPath);
        break;
      case 'read_url':
        result = await readUrl(args.url);
        break;
      case 'send_telegram_document':
        if (!chatId) throw new Error('chatId is required to send document');
        result = await sendTelegramDocument(chatId, args.filePath);
        break;
      case 'file_info':
        result = JSON.stringify(await fileInfo(args.targetPath), null, 2);
        break;
      case 'manage_background_task':
        result = manageBackgroundTask(args.action, args.taskId);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    result = `Error executing tool ${name}: ${error.message || String(error)}`;
  }
  
  // Truncate massively long tool outputs to prevent context explosion
  // We keep the first 10000 characters and the last 30000 characters so the agent can see both the start and the final errors.
  const MAX_LENGTH = 40000;
  if (result.length > MAX_LENGTH) {
    const startStr = result.substring(0, 10000);
    const endStr = result.substring(result.length - 30000);
    result = `${startStr}\n\n...[OUTPUT TRUNCATED: The result was too long (${result.length} chars). Middle section removed to save context memory]...\n\n${endStr}`;
  }
  
  return result;
}
