import { describe, expect, it } from 'vitest';
import { detectLang, dict, fill } from '../lib/i18n';

describe('i18n', () => {
  it('has the same placeholders in both languages', () => {
    const en = dict('en') as Record<string, string>;
    const th = dict('th') as Record<string, string>;
    for (const key of Object.keys(en)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join(',');
      expect(vars(th[key]), key).toBe(vars(en[key]));
    }
  });
  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('Sent to {name} {x}', { name: 'A' })).toBe('Sent to A {x}');
  });
  it('prefers the cookie, then Accept-Language, then Thai', () => {
    expect(detectLang(new Request('http://x', { headers: { cookie: 'a=1; lang=en' } }))).toBe('en');
    expect(detectLang(new Request('http://x', { headers: { 'accept-language': 'en-US,en;q=0.9' } }))).toBe('en');
    expect(detectLang(new Request('http://x', { headers: { 'accept-language': 'th-TH,en;q=0.8' } }))).toBe('th');
    expect(detectLang(new Request('http://x'))).toBe('th');
  });
});
