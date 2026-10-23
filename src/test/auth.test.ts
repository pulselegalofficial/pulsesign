import { describe, expect, it } from 'vitest';
import { cookie, isStaffEmail, readCookie } from '../lib/auth';

describe('isStaffEmail', () => {
  it('allows a whole domain with an @ rule', () => {
    expect(isStaffEmail('Nattapol@PulseLegal.co')).toBe(true);
    expect(isStaffEmail('someone@pulselegal.co.evil.com')).toBe(false);
    expect(isStaffEmail('x@notpulselegal.co')).toBe(false);
  });
  it('allows listed addresses exactly', () => {
    expect(isStaffEmail('partner@example.com')).toBe(true);
    expect(isStaffEmail('other@example.com')).toBe(false);
  });
  it('allows nobody when the list is empty', () => {
    expect(isStaffEmail('a@pulselegal.co', '')).toBe(false);
  });
});

describe('cookies', () => {
  it('builds HttpOnly Lax cookies and reads them back', () => {
    const c = cookie('ps_session', 'abc', 60, true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    const req = new Request('http://x', { headers: { cookie: 'lang=th; ps_session=abc=def' } });
    expect(readCookie(req, 'ps_session')).toBe('abc=def');
    expect(readCookie(req, 'missing')).toBeUndefined();
  });
});
