import { execSync } from 'child_process';

export interface GitOptions {
  action: 'status' | 'commit' | 'diff' | 'log';
  message?: string;
  path?: string;
  maxCount?: number;
}

export async function handleGit(args: GitOptions, basePath: string = process.cwd()): Promise<any> {
  const { action, message, path: targetPath, maxCount } = args;

  const runGit = (cmd: string) => {
    try {
      return execSync(`git ${cmd}`, { cwd: basePath, encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (e: any) {
      throw new Error(`Git command failed: ${e.message}\nOutput: ${e.stdout?.toString() || ''}\nError: ${e.stderr?.toString() || ''}`);
    }
  };

  if (action === 'status') {
    const branch = runGit('rev-parse --abbrev-ref HEAD');
    const statusLines = runGit('status -s').split('\n').filter(Boolean);
    
    const modified: string[] = [];
    const staged: string[] = [];
    const untracked: string[] = [];

    for (const line of statusLines) {
      const code = line.substring(0, 2);
      const file = line.substring(3).trim();
      
      if (code === '??') untracked.push(file);
      else if (code[0] !== ' ' && code[0] !== '?') staged.push(file);
      else if (code[1] !== ' ' && code[1] !== '?') modified.push(file);
    }

    let behind = 0;
    try {
      runGit('fetch'); // Might fail if no remote or offline, ignore error
      const tracking = runGit('rev-list --left-right --count HEAD...@{u}');
      behind = parseInt(tracking.split('\t')[1], 10);
    } catch (e) {}

    return { branch, modified, staged, untracked, behind };
  }

  if (action === 'commit') {
    if (!message) throw new Error("Commit message is required.");
    // This will commit all staged changes. If nothing is staged, we might want to stage all or fail.
    // Let's just run git commit. It assumes files are staged, or we can do git add . if user wants.
    // Since the prompt example showed: git_operation({ action: 'commit', message: 'fix: bug' })
    // It's safest to stage all modified files automatically if none are staged, or let the user stage via run_command.
    // We will do `git commit -a -m "message"` to automatically commit modified files.
    const out = runGit(`commit -a -m "${message.replace(/"/g, '\\"')}"`);
    return out;
  }

  if (action === 'diff') {
    const p = targetPath ? `"${targetPath}"` : '';
    return runGit(`diff HEAD ${p}`);
  }

  if (action === 'log') {
    const count = maxCount || 5;
    const logStr = runGit(`log -n ${count} --pretty=format:"%h|%an|%ar|%s"`);
    return logStr.split('\n').filter(Boolean).map(line => {
      const [hash, author, time, msg] = line.split('|');
      return { hash, author, time, message: msg };
    });
  }

  throw new Error("Invalid git action.");
}
