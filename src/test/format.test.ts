import { describe, expect, it } from 'vitest';
import { buddhistYear, describeUserAgent, formatDate, initials } from '../lib/format';

// 2026-10-22T17:30:05Z is 23 Oct 2026 00:30:05 in Bangkok.
const ts = Date.UTC(2026, 9, 22, 17, 30, 5);

describe('formatDate', () => {
  it('uses Bangkok time and the Buddhist era in Thai', () => {
    expect(formatDate(ts, 'th')).toBe('23 ต.ค. 2569');
    expect(formatDate(ts, 'th', { time: true, seconds: true })).toBe('23 ต.ค. 2569 · 00:30:05');
  });
  it('uses the Gregorian year in English', () => {
    expect(formatDate(ts, 'en', { time: true })).toBe('23 Oct 2026 · 00:30');
  });
  it('rolls the document-number year over at Bangkok midnight', () => {
    expect(buddhistYear(Date.UTC(2026, 11, 31, 17, 0, 0))).toBe(2570);
    expect(buddhistYear(Date.UTC(2026, 11, 31, 16, 59, 0))).toBe(2569);
  });
});

describe('describeUserAgent', () => {
  it('names common browsers', () => {
    expect(
      describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36')
    ).toBe('Chrome 129 · macOS');
    expect(
      describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')
    ).toBe('Safari · iOS 18.1');
    expect(describeUserAgent(null)).toBe('—');
  });
});

describe('initials', () => {
  it('takes the first letter of two words', () => {
    expect(initials('ณัฐพล วงศ์ใหญ่', 'x@y.co')).toBe('ณว');
    expect(initials('', 'nattapol@pulselegal.co')).toBe('NA');
  });
});
