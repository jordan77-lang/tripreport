import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
// Build for server rendering only: no dev server, real account, or network calls.
await build({
  configFile: false, root: appRoot, envDir: false, logLevel: 'error',
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' },
  build: { ssr: 'tests/ui-smoke.jsx', outDir: 'node_modules/.cache/tripreport-qa', emptyOutDir: false },
});
globalThis.localStorage = { getItem: key => key === 'tr_user_id' ? 'qa-user' : null, setItem: () => {} };
await import('../node_modules/.cache/tripreport-qa/ui-smoke.js');
