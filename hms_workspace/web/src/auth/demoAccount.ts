/**
 * STATIC DEMO ACCOUNT — login/logout demonstration only. NOT authentication.
 *
 * - Enabled only when `VITE_DEMO_AUTH=true` is set at build/dev time. Because Vite replaces
 *   `import.meta.env.*` statically, the credentials below are dead-code-eliminated from builds
 *   that do not enable the flag (checked in the README "Verify" section).
 * - Credentials are fake and public by design (shown on the login screen). Never reuse them,
 *   never add real users here. Real sign-in is hms_services auth-v1 (ADR-SVC-001).
 */
/** The two demo roles (`doctor` | `employee`). Live sessions carry permission codes from hms_services instead. */
export type Role = 'doctor' | 'employee';

export interface DemoAccount {
  username: string;
  password: string;
  role: Role;
}

export function isDemoAuthEnabled(): boolean {
  return import.meta.env.VITE_DEMO_AUTH === 'true';
}

export function getDemoAccount(): DemoAccount | null {
  return getDemoAccounts()[0] ?? null;
}

/** Doctor first (the original demo account), then the employee/nurse account (view only). */
export function getDemoAccounts(): DemoAccount[] {
  if (import.meta.env.VITE_DEMO_AUTH !== 'true') return [];
  return [
    { username: 'demo.dokter', password: 'Demo#2026', role: 'doctor' },
    { username: 'demo.perawat', password: 'Demo#2026', role: 'employee' },
  ];
}

/** Length-independent comparison so the demo check does not short-circuit on the first mismatch. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Role of the matching demo account, or `null`. Every account is compared (no early exit). */
export function demoRoleFor(username: string, password: string): Role | null {
  let role: Role | null = null;
  for (const demo of getDemoAccounts()) {
    const u = safeEqual(username.trim(), demo.username);
    const p = safeEqual(password, demo.password);
    if (u && p) role = demo.role;
  }
  return role;
}

export function checkDemoCredentials(username: string, password: string): boolean {
  return demoRoleFor(username, password) !== null;
}
