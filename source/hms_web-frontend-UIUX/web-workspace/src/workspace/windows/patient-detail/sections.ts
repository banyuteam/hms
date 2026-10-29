/** Patient Detail navigation (PRD FR-18, Figma W10): header = identity & safety, tabs = clinical record, sidebar = profile & access. */
export const TAB_IDS = [
  'overview',
  'medicalRecord',
  'encounters',
  'orders',
  'results',
  'medications',
  'procedures',
  'billing',
  'documents',
  'carePlan',
  'referrals',
] as const;
export type TabId = (typeof TAB_IDS)[number];

export const PROFILE_IDS = ['personal', 'contact', 'guarantor', 'family', 'audit'] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

/** Only one place is active at a time (OQ-50): a tab or a profile page. */
export type Section = { type: 'tab'; id: TabId } | { type: 'profile'; id: ProfileId };

/** Tabs that have content in Phase 2; the rest are "coming in Phase 3" placeholders. */
export const BUILT_TABS: readonly TabId[] = ['overview', 'medicalRecord', 'encounters'];

/** Never show more than this many tabs; the rest go under "More ▾" (OQ-52). */
export const MAX_VISIBLE_TABS = 8;
