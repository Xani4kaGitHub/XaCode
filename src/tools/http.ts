export async function httpRequest(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: any,
  timeoutMs: number = 10000
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: RequestInit = {
      method: method.toUpperCase(),
      headers: headers || {},
      signal: controller.signal as any
    };

    if (body !== undefined && init.method !== 'GET' && init.method !== 'HEAD') {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      
      const reqHeaders = init.headers as Record<string, string>;
      if (typeof body !== 'string' && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, init);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = await response.text();
    
    return {
      status: response.status,
      headers: responseHeaders,
      body: responseBody
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
