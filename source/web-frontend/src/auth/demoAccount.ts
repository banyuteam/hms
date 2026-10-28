/**
 * STATIC DEMO ACCOUNT — login/logout demonstration only. NOT authentication.
 *
 * - Enabled only when `VITE_DEMO_AUTH=true` is set at build/dev time. Because Vite replaces
 *   `import.meta.env.*` statically, the credentials below are dead-code-eliminated from builds
 *   that do not enable the flag (checked in the README "Verify" section).
 * - Credentials are fake and public by design (shown on the login screen). Never reuse them,
 *   never add real users here. Real sign-in goes through the BFF (separate ADR).
 */
export interface DemoAccount {
  username: string;
  password: string;
}

export function isDemoAuthEnabled(): boolean {
  return import.meta.env.VITE_DEMO_AUTH === 'true';
}

export function getDemoAccount(): DemoAccount | null {
  if (import.meta.env.VITE_DEMO_AUTH !== 'true') return null;
  return { username: 'demo.dokter', password: 'Demo#2026' };
}

/** Length-independent comparison so the demo check does not short-circuit on the first mismatch. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function checkDemoCredentials(username: string, password: string): boolean {
  const demo = getDemoAccount();
  if (!demo) return false;
  const u = safeEqual(username.trim(), demo.username);
  const p = safeEqual(password, demo.password);
  return u && p;
}
