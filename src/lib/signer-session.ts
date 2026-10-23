import { cookie, readCookie } from './auth';
import { sha256Hex } from './crypto';
import { bySignerToken, hasSignerSession, type SignerContext } from './docs';

/**
 * A signer's browser session, issued after a correct OTP. The cookie name
 * includes the signer id so one browser can hold sessions for several
 * documents at once.
 */
export const signerCookieName = (signerId: string) => `ps_s_${signerId.replace(/[^A-Za-z0-9_-]/g, '')}`;

export function signerCookie(signerId: string, token: string, secure: boolean) {
  return cookie(signerCookieName(signerId), token, 2 * 60 * 60, secure);
}

export interface ResolvedSigner extends SignerContext {
  /** True when this browser passed the OTP check for this signer. */
  verified: boolean;
}

export async function resolveSigner(request: Request, token: string): Promise<ResolvedSigner | null> {
  const ctx = await bySignerToken(token);
  if (!ctx) return null;
  const value = readCookie(request, signerCookieName(ctx.signer.id));
  const verified = hasSignerSession(ctx.signer, value, value ? await sha256Hex(value) : null);
  return { ...ctx, verified };
}
