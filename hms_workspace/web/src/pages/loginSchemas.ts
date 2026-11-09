import { z } from 'zod';

/**
 * Sign-in form schemas. Messages are i18n message ids (rendered with `t()` by the form), so validation text follows the locale.
 * Client validation is a convenience only: the demo check and hms_services decide.
 */
export const demoLoginSchema = z.object({
  username: z.string().trim().min(1, 'login.error.required'),
  password: z.string().min(1, 'login.error.required'),
});
export type DemoLoginValues = z.infer<typeof demoLoginSchema>;

/** Same shape as the hms_services user ID check (auth-v1 sign-in request). */
export const STAFF_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;

export const liveLoginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'login.khanza.error.required')
    // Generic on purpose: a malformed ID gets the same answer as a wrong one.
    .regex(STAFF_ID, 'login.khanza.error.invalid'),
  password: z.string().min(1, 'login.khanza.error.required').max(128, 'login.khanza.error.invalid'),
});
export type LiveLoginValues = z.infer<typeof liveLoginSchema>;
