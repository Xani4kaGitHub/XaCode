import fs from 'fs/promises';
import path from 'path';

// A lightweight BM25 / TF-IDF style lexical indexer for zero-dependency local smart context retrieval
export class SmartRetrieval {
  private fileIndex: Map<string, Set<string>> = new Map(); // filepath -> Set of words
  private workspaceRoot: string = '';

  setWorkspace(root: string) {
    this.workspaceRoot = root;
    this.fileIndex.clear();
  }

  async indexDirectory(dirPath: string) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          // Ignore heavy/build directories
          if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            await this.indexDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          // Only index text files roughly based on extension
          if (/\.(ts|js|json|md|txt|sh|py|java|go|rs|c|cpp|h|css|html)$/i.test(entry.name)) {
            await this.indexFile(fullPath);
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to index directory ${dirPath}`, e);
    }
  }

  private async indexFile(filePath: string) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const words = new Set(content.toLowerCase().match(/\w+/g) || []);
      this.fileIndex.set(filePath, words);
    } catch (e) {
      // Ignore read errors (e.g. binaries)
    }
  }

  search(query: string, topK: number = 5): string[] {
    const queryWords = query.toLowerCase().match(/\w+/g) || [];
    if (queryWords.length === 0) return [];

    const scores: { filePath: string, score: number }[] = [];

    for (const [filePath, words] of this.fileIndex.entries()) {
      let score = 0;
      for (const qw of queryWords) {
        if (words.has(qw)) {
          score++;
        }
      }
      if (score > 0) {
        scores.push({ filePath, score });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.filePath);
  }
}

export const smartRetrieval = new SmartRetrieval();
