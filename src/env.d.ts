/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

declare namespace App {
  interface Locals {
    lang: import('./lib/i18n').Lang;
    user: import('./lib/types').User | null;
  }
}
