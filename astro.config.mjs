// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Every page is rendered on demand: documents, signers and the audit trail
// live in D1 and change on every request.
export default defineConfig({
  output: 'server',
  devToolbar: { enabled: false },
  adapter: cloudflare({
    // Makes the D1/R2 bindings in wrangler.toml available to `astro dev`
    // (backed by local SQLite and a local bucket under .wrangler/).
    platformProxy: { enabled: true },
    imageService: 'passthrough',
    // Astro sessions are unused (auth has its own cookie). Naming a binding
    // stops the adapter from provisioning a KV namespace nobody reads.
    sessionKVBindingName: 'SESSION',
  }),
  security: {
    // Mutating API routes check Origin themselves in src/middleware.ts.
    checkOrigin: false,
  },
});
