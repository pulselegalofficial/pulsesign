/** Client helpers shared by the interactive pages. */

export type Strings = Record<string, string>;

/** Translated strings rendered into the page by Base.astro. */
export function strings(): Strings {
  const el = document.getElementById('i18n');
  return el ? JSON.parse(el.textContent || '{}').t : {};
}

export function pageLang(): 'th' | 'en' {
  const el = document.getElementById('i18n');
  return el ? JSON.parse(el.textContent || '{}').lang : 'th';
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, error = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el!.hidden = true), 2600);
}

export async function api<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...(rest.headers || {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error || 'error', res.status);
  return data;
}

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined | null> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  // appendChild, not append: workers-types redeclares Element.append for HTMLRewriter.
  for (const c of children) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
