import { ApiError } from '@/api/liveApi';

/**
 * Message id for a failed IAM request. The server's stable error codes (iam-admin-v1) map to localized text; its own
 * message is never shown. Permission, conflict and stale-data errors are worded distinctly.
 */
export function iamErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'iam.error.unavailable'; // includes an answer that broke the contract
  switch (error.code) {
    case 'forbidden':
      return 'iam.error.forbidden';
    case 'self_change_not_allowed':
      return 'iam.error.self';
    case 'last_admin':
      return 'iam.error.lastAdmin';
    case 'system_role':
      return 'iam.error.systemRole';
    case 'conflict':
      return 'iam.error.conflict';
    case 'not_found':
      return 'iam.error.notFound';
    case 'invalid_request':
      return 'iam.error.invalid';
    default:
      return 'iam.error.unavailable';
  }
}

/** A 403 `forbidden` on a read means the whole screen is not available to this person. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === 'forbidden';
}
