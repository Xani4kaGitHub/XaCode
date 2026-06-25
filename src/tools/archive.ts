import { execSync } from 'child_process';
import path from 'path';

export interface ArchiveOptions {
  action: 'extract' | 'compress';
  source?: string;
  sources?: string[];
  destination?: string;
  output?: string;
  format?: 'zip' | 'tar.gz';
}

export async function handleArchive(args: ArchiveOptions, basePath: string = process.cwd()): Promise<any> {
  const { action, source, sources, destination, output, format } = args;

  if (action === 'extract') {
    if (!source) throw new Error("Source file is required for extraction.");
    const ext = path.extname(source).toLowerCase();
    const dest = destination || '.';
    let command = '';

    if (ext === '.zip') {
      command = `unzip -o "${source}" -d "${dest}"`;
    } else if (source.endsWith('.tar.gz') || source.endsWith('.tgz')) {
      command = `mkdir -p "${dest}" && tar -xzf "${source}" -C "${dest}"`;
    } else {
      throw new Error("Unsupported archive format. Only .zip and .tar.gz are supported.");
    }

    try {
      execSync(command, { cwd: basePath, stdio: 'pipe', encoding: 'utf8' });
      return { status: 'success', message: `Extracted ${source} to ${dest}` };
    } catch (e: any) {
      throw new Error(`Extraction failed: ${e.message}`);
    }
  } else if (action === 'compress') {
    if (!sources || sources.length === 0) throw new Error("Sources are required for compression.");
    if (!output) throw new Error("Output file name is required for compression.");
    
    const ext = format || (output.endsWith('.zip') ? 'zip' : 'tar.gz');
    const sourcesStr = sources.map(s => `"${s}"`).join(' ');
    let command = '';

    if (ext === 'zip') {
      command = `zip -r "${output}" ${sourcesStr}`;
    } else if (ext === 'tar.gz') {
      command = `tar -czf "${output}" ${sourcesStr}`;
    } else {
      throw new Error("Unsupported compression format. Use zip or tar.gz.");
    }

    try {
      execSync(command, { cwd: basePath, stdio: 'pipe', encoding: 'utf8' });
      return { status: 'success', message: `Compressed files to ${output}` };
    } catch (e: any) {
      throw new Error(`Compression failed: ${e.message}`);
    }
  }

  throw new Error("Invalid action. Must be 'extract' or 'compress'.");
}
