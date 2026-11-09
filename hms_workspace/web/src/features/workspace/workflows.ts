import type { WindowKind } from '@/state/home';

/**
 * Top-level workflow routes (`/{workflow}`, CLAUDE.md §3 Routing). A workflow slug names a window *kind* only — never a patient,
 * an MRN or an encounter number (no identifiers in URLs). Opening `/records` opens the blank Medical Records window; the record
 * itself is chosen inside the window and stays in memory.
 */
export const WORKFLOWS = {
  profile: 'emr-profile',
  records: 'emr-records',
  encounter: 'emr-encounter',
  diagnostics: 'emr-diagnostics',
  lab: 'lab',
  radiology: 'radiology',
  billing: 'billing',
  prescription: 'prescription',
  access: 'iam-admin',
  tariffs: 'tariffs',
} as const satisfies Record<string, WindowKind>;

export type WorkflowSlug = keyof typeof WORKFLOWS;

export function isWorkflowSlug(value: string | undefined): value is WorkflowSlug {
  return value !== undefined && Object.prototype.hasOwnProperty.call(WORKFLOWS, value);
}

export function slugOf(kind: WindowKind): WorkflowSlug {
  const hit = (Object.keys(WORKFLOWS) as WorkflowSlug[]).find((s) => WORKFLOWS[s] === kind);
  if (!hit) throw new Error(`No workflow route for window kind "${kind}"`);
  return hit;
}

export function workflowPath(kind: WindowKind | null): string {
  return kind ? `/${slugOf(kind)}` : '/';
}
