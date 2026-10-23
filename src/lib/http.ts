/** Small helpers shared by the API routes. */

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export const fail = (error: string, status = 400) => json({ error }, status);
export const unauthorized = () => fail('unauthorized', 401);
export const notFound = () => fail('not_found', 404);

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Client IP and user agent, as recorded in the audit trail. */
export function clientInfo(request: Request): { ip: string; ua: string } {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  return { ip, ua: (request.headers.get('user-agent') || '').slice(0, 300) };
}

export function pdfResponse(body: ReadableStream | ArrayBuffer | Uint8Array, fileName: string, inline = true): Response {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return new Response(body as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'cache-control': 'private, no-store',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}

export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
