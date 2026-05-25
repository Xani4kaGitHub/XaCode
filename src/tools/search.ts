import * as cheerio from 'cheerio';

export async function webSearch(query: string): Promise<string> {
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch search results: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: string[] = [];

    $('.result').each((i, el) => {
      const title = $(el).find('.result__title').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      const link = $(el).find('.result__url').text().trim();
      
      if (title && snippet) {
        results.push(`[${i + 1}] ${title}\nURL: ${link}\nSnippet: ${snippet}\n`);
      }
    });

    if (results.length === 0) {
      return 'No results found.';
    }

    return results.join('\n');
  } catch (error: any) {
    return `Error during web search: ${error.message}`;
  }
}
