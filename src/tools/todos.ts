import fs from 'fs/promises';
import path from 'path';

const TODOS_FILE = path.resolve(process.cwd(), '.xacode-todos.json');

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

async function loadTodos(): Promise<TodoItem[]> {
  try {
    const data = await fs.readFile(TODOS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
}

async function saveTodos(todos: TodoItem[]): Promise<void> {
  await fs.writeFile(TODOS_FILE, JSON.stringify(todos, null, 2), 'utf8');
}

export async function manageTodos(action: 'add' | 'list' | 'complete' | 'delete', textOrId?: string): Promise<string> {
  const todos = await loadTodos();

  switch (action) {
    case 'list':
      if (todos.length === 0) return 'Todo list is empty.';
      return todos.map(t => `${t.completed ? '✅' : '⬜'} [${t.id}] ${t.text}`).join('\n');
      
    case 'add':
      if (!textOrId) throw new Error('Text is required to add a todo');
      const newTodo: TodoItem = {
        id: Math.random().toString(36).substring(2, 6),
        text: textOrId,
        completed: false
      };
      todos.push(newTodo);
      await saveTodos(todos);
      return `Added todo: [${newTodo.id}] ${newTodo.text}`;
      
    case 'complete':
      if (!textOrId) throw new Error('ID is required to complete a todo');
      const todoToComplete = todos.find(t => t.id === textOrId);
      if (!todoToComplete) throw new Error(`Todo with id ${textOrId} not found`);
      todoToComplete.completed = true;
      await saveTodos(todos);
      return `Completed todo: [${todoToComplete.id}] ${todoToComplete.text}`;
      
    case 'delete':
      if (!textOrId) throw new Error('ID is required to delete a todo');
      const initialLength = todos.length;
      const filteredTodos = todos.filter(t => t.id !== textOrId);
      if (filteredTodos.length === initialLength) throw new Error(`Todo with id ${textOrId} not found`);
      await saveTodos(filteredTodos);
      return `Deleted todo: [${textOrId}]`;
      
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
