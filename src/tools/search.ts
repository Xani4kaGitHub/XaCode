export async function webSearch(query: string): Promise<string> {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
  ];
  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': ua }
    });

    const cheerio = await import('cheerio');
    let results: string[] = [];

    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);
      $('.result').each((i, el) => {
        const title = $(el).find('.result__title').text().trim();
        const snippet = $(el).find('.result__snippet').text().trim();
        const link = $(el).find('.result__url').text().trim();
        if (title && snippet) results.push(`[${i + 1}] ${title}\nURL: ${link}\nSnippet: ${snippet}\n`);
      });
    }

    if (results.length === 0) {
      // Fallback to Google
      const gRes = await fetch(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': ua }
      });
      if (gRes.ok) {
        const gHtml = await gRes.text();
        const $g = cheerio.load(gHtml);
        $g('div.g').each((i, el) => {
          const title = $g(el).find('h3').text().trim();
          const snippet = $g(el).find('div.VwiC3b').text().trim();
          const link = $g(el).find('a').attr('href');
          if (title && snippet && link) results.push(`[${i + 1}] ${title}\nURL: ${link}\nSnippet: ${snippet}\n`);
        });
      }
    }

    if (results.length === 0) {
      return 'No results found from DuckDuckGo or Google.';
    }

    return results.join('\n\n');
  } catch (error: any) {
    throw new Error(`Web search failed: ${error.message}`);
  }
}

export async function readUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    const html = await response.text();
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    
    // Remove scripts and styles
    $('script, style').remove();
    
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return text;
  } catch (error: any) {
    throw new Error(`Failed to read URL: ${error.message}`);
  }
}
