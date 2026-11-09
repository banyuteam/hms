import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Live data (README "Live data"): with VITE_DATA_SOURCE=bff the dev server forwards /api to hms-services, so the browser
// stays same-origin (its session cookie never crosses origins and there is no CORS). hms-services must be on loopback; only
// this dev server may face the LAN, and then only over HTTPS (README "Testing from other machines"). In production the
// ingress serves the built files and forwards /api.
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|::1)$/;

/** The address `vite --host [address]` asks for: undefined = the loopback host below; true = every interface. */
function cliHost(argv: string[]): string | true | undefined {
  const i = argv.findIndex((a) => a === '--host' || a.startsWith('--host='));
  if (i < 0) return undefined;
  const arg = argv[i] ?? '';
  if (arg.startsWith('--host=')) return arg.slice('--host='.length);
  const next = argv[i + 1];
  return next && !next.startsWith('-') ? next : true;
}

// Static SPA. Source maps are off: no PHI/source leakage in production bundles.
export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const live = env.VITE_DATA_SOURCE === 'bff';
  const target = env.HMS_SERVICES_TARGET || 'http://127.0.0.1:8080';
  if (live && !LOOPBACK.test(target)) {
    throw new Error(`HMS_SERVICES_TARGET must be a loopback address in dev (got ${target}).`);
  }
  // Dev HTTPS from local certificate files (paths, not VITE_*: never in the bundle). Both or neither.
  const tlsCert = env.HMS_DEV_TLS_CERT;
  const tlsKey = env.HMS_DEV_TLS_KEY;
  if (Boolean(tlsCert) !== Boolean(tlsKey)) {
    throw new Error('Set both HMS_DEV_TLS_CERT and HMS_DEV_TLS_KEY, or neither.');
  }
  const https =
    tlsCert && tlsKey ? { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) } : undefined;
  // Staff passwords, the session cookie and patient data never cross the network in plain text.
  const host = cliHost(process.argv);
  const onLan = host !== undefined && !(typeof host === 'string' && LOOPBACK_HOST.test(host));
  if (live && command === 'serve' && !isPreview && onLan && !https) {
    throw new Error(
      'Live data on the network needs HTTPS: set HMS_DEV_TLS_CERT and HMS_DEV_TLS_KEY (README).',
    );
  }
  // hms-services checks that Origin equals its PUBLIC_ORIGIN (http://127.0.0.1:5174 in dev), so Host/Origin pass unchanged.
  const toServices = { target, changeOrigin: false };
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: { sourcemap: false, target: 'es2022' },
    server: {
      host: '127.0.0.1',
      port: 5174,
      // Fail instead of silently moving to another port (another app on 5174 would be mistaken for this one).
      strictPort: true,
      https,
      proxy: live ? { '/api': toServices } : undefined,
    },
    preview: { host: '127.0.0.1', port: 4174 },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      // Tests always start on synthetic data, whatever a developer's .env selects for the dev server; a test that
      // needs the live client stubs VITE_DATA_SOURCE itself.
      env: { VITE_DATA_SOURCE: 'synthetic' },
    },
  };
});
