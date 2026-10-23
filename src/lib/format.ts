import type { Lang } from './i18n';

/**
 * Dates are always shown in Thailand time (UTC+7, no daylight saving),
 * whatever the server or browser time zone is. Thai uses the Buddhist era.
 */
const OFFSET_MS = 7 * 60 * 60 * 1000;
const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function bangkokParts(ts: number) {
  const d = new Date(ts + OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
  };
}

/** "22 ต.ค. 2569" / "22 Oct 2026", optionally with " · 14:20" or " · 14:20:05". */
export function formatDate(ts: number, lang: Lang, opts: { time?: boolean; seconds?: boolean } = {}): string {
  const p = bangkokParts(ts);
  const date = lang === 'th' ? `${p.day} ${MONTHS_TH[p.month]} ${p.year + 543}` : `${p.day} ${MONTHS_EN[p.month]} ${p.year}`;
  if (!opts.time) return date;
  return `${date} · ${pad(p.hours)}:${pad(p.minutes)}${opts.seconds ? ':' + pad(p.seconds) : ''}`;
}

/**
 * Date written into a signer's date field: DD/MM/YYYY, Gregorian year,
 * Bangkok time. The same for every signer, whatever their language.
 */
export function formatFieldDate(ts: number): string {
  const p = bangkokParts(ts);
  return `${pad(p.day)}/${pad(p.month + 1)}/${p.year}`;
}

/** Buddhist-era year in Thailand, used in document numbers. */
export const buddhistYear = (ts: number) => bangkokParts(ts).year + 543;

/** Short, human description of a user agent: "Chrome 129 · macOS". */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return '—';
  const os =
    /iPhone|iPad|iPod/.test(ua) ? `iOS ${(ua.match(/OS (\d+)[_.](\d+)/) || []).slice(1, 3).join('.')}`.trim()
    : /Android (\d+)/.test(ua) ? `Android ${ua.match(/Android (\d+)/)![1]}`
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  const browser =
    /Edg\/(\d+)/.test(ua) ? `Edge ${ua.match(/Edg\/(\d+)/)![1]}`
    : /SamsungBrowser\/(\d+)/.test(ua) ? `Samsung Internet ${ua.match(/SamsungBrowser\/(\d+)/)![1]}`
    : /Line\//.test(ua) ? 'LINE'
    : /CriOS\/(\d+)/.test(ua) ? `Chrome ${ua.match(/CriOS\/(\d+)/)![1]}`
    : /FxiOS\/(\d+)|Firefox\/(\d+)/.test(ua) ? `Firefox ${(ua.match(/(?:FxiOS|Firefox)\/(\d+)/) || [])[1]}`
    : /Chrome\/(\d+)/.test(ua) ? `Chrome ${ua.match(/Chrome\/(\d+)/)![1]}`
    : /Safari\//.test(ua) ? 'Safari'
    : ua.slice(0, 40);
  return [browser, os].filter(Boolean).join(' · ');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string, email: string): string {
  const src = (name || email).trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
