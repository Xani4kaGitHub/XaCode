import { logger } from '../logger';

export class ExecutionPolicy {
  private readonly policies = [
    'Minimize code changes. Only modify what is strictly necessary to solve the task.',
    'Preserve the existing architecture. Do not refactor unrelated files.',
    'Preserve the existing code style. Match indentation, quotes, and naming conventions.',
    'Avoid unnecessary rewrites. Prefer targeted patches (`edit_file`) over full file replacements (`write_file`) where possible.',
    'Always verify your edits by running tests or typechecks before considering the task complete.',
    'Automatically stop and return a summary immediately after successful completion.'
  ];

  getPolicyString(): string {
    return this.policies.map((p, i) => `${i + 1}. ${p}`).join('\n');
  }

  validateToolUsage(toolName: string, args: any): boolean {
    if (toolName === 'write_file') {
      // Very basic heuristic check: if write_file is used for a file that already exists
      // the agent should ideally use edit_file if it's a huge file. We just log a warning.
      logger.debug(`ExecutionPolicy check: write_file used for ${args.targetPath}. Ensure this wasn't better suited for edit_file.`);
    }
    return true;
  }
}

export const executionPolicy = new ExecutionPolicy();
