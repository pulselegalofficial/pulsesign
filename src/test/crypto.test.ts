import { describe, expect, it } from 'vitest';
import { randomOtp, randomToken, safeEqual, sha256Hex } from '../lib/crypto';

describe('crypto helpers', () => {
  it('hashes with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('makes 6-digit codes', () => {
    for (let i = 0; i < 200; i++) expect(randomOtp()).toMatch(/^\d{6}$/);
  });
  it('makes URL-safe tokens with 256 bits', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });
  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});
