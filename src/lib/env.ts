import { env as cfEnv } from 'cloudflare:workers';

/** Typed access to the bindings and variables declared in wrangler.toml. */
export interface Bindings {
  DB: D1Database;
  FILES: R2Bucket;
  APP_URL?: string;
  ORG_NAME?: string;
  STAFF_EMAILS?: string;
  EMAIL_FROM?: string;
  /**
   * Where PDFs are read and stamped. "browser" (default) keeps the Worker
   * within the Free plan's 10 ms of CPU per request: the staff member's
   * browser checks uploads and builds the final signed PDF. "server" does it
   * all in the Worker and needs Workers Paid.
   */
  PDF_MODE?: string;
  /** Secret. When unset, emails are printed to the console instead of sent. */
  RESEND_API_KEY?: string;
}

export const env = () => cfEnv as unknown as Bindings;
export const db = () => env().DB;
export const files = () => env().FILES;
export const orgName = () => env().ORG_NAME || 'Pulse Legal';
export const pdfMode = (): 'browser' | 'server' => (env().PDF_MODE === 'server' ? 'server' : 'browser');

/**
 * Base URL for links in emails: APP_URL, except when running locally, where
 * links must point back at the dev server.
 */
export function appUrl(request?: Request): string {
  const configured = env().APP_URL?.replace(/\/+$/, '');
  if (request) {
    const origin = new URL(request.url).origin;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || !configured) return origin;
  }
  return configured || 'http://localhost:4321';
}
