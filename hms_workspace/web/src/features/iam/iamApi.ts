import { z } from 'zod';
import { liveGet, liveSend, seg } from '@/api/liveApi';

/**
 * IAM administration client (contract `hms_services/contracts/api/iam-admin-v1.openapi.yaml`, ADR-SVC-002). Every answer
 * is validated here: a shape the contract does not promise is an error, never silently trusted. hms_services authorizes
 * every request; the permissions below only decide what the UI offers.
 */
export const PERMISSIONS = {
  usersRead: 'iam.users.read',
  usersManage: 'iam.users.manage',
  rolesManage: 'iam.roles.manage',
  assignmentsManage: 'iam.assignments.manage',
} as const;

/** The system role created by bootstrap-admin; the server refuses to change it through the API. */
export const ADMIN_ROLE = 'iam-admin';

export const USER_STATUSES = ['active', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

const identity = z.object({
  issuer: z.string(),
  subject: z.string(),
  last_authenticated_at: z.string().nullable(),
});

const assignment = z.object({
  id: z.string(),
  role_id: z.string(),
  role_code: z.string(),
  facility_id: z.string().nullable(),
  valid_from: z.string(),
  valid_until: z.string().nullable(),
  granted_at: z.string(),
});

const user = z.object({
  id: z.string(),
  display_name: z.string(),
  status: z.enum(USER_STATUSES),
  status_reason: z.string().nullable(),
  created_at: z.string(),
  identities: z.array(identity),
  assignments: z.array(assignment),
});

const role = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['active', 'retired']),
  system: z.boolean(),
  permissions: z.array(z.string()),
});

const permission = z.object({ code: z.string(), description: z.string(), status: z.string() });

export type IamUser = z.infer<typeof user>;
export type IamIdentity = z.infer<typeof identity>;
export type IamAssignment = z.infer<typeof assignment>;
export type IamRole = z.infer<typeof role>;
export type IamPermission = z.infer<typeof permission>;

const userPage = z.object({ users: z.array(user), next_after: z.string().optional() });
export type UserPage = z.infer<typeof userPage>;

export const PAGE_SIZE = 100;

export async function listUsers(status: UserStatus | '', after?: string): Promise<UserPage> {
  return userPage.parse(
    await liveGet('/iam/users', { status: status || undefined, after, limit: PAGE_SIZE }),
  );
}

export async function getUser(id: string): Promise<IamUser> {
  return user.parse(await liveGet(`/iam/users/${seg(id)}`));
}

export async function setUserStatus(
  id: string,
  status: UserStatus,
  reason: string,
): Promise<IamUser> {
  return user.parse(
    await liveSend('PATCH', `/iam/users/${seg(id)}`, {
      status,
      ...(status === 'active' ? {} : { reason }),
    }),
  );
}

export async function listRoles(): Promise<IamRole[]> {
  return z.object({ roles: z.array(role) }).parse(await liveGet('/iam/roles')).roles;
}

export async function listPermissions(): Promise<IamPermission[]> {
  return z.object({ permissions: z.array(permission) }).parse(await liveGet('/iam/permissions'))
    .permissions;
}

export async function createRole(input: {
  code: string;
  name: string;
  description: string;
  permissions: string[];
}): Promise<IamRole> {
  return role.parse(await liveSend('POST', '/iam/roles', input));
}

export async function setRolePermissions(roleId: string, permissions: string[]): Promise<IamRole> {
  return role.parse(
    await liveSend('PUT', `/iam/roles/${seg(roleId)}/permissions`, { permissions }),
  );
}

export async function grantRole(
  userId: string,
  input: { roleId: string; facilityId: string | null; validUntil: string | null; reason: string },
): Promise<string> {
  const res = z.object({ id: z.string() }).parse(
    await liveSend('POST', `/iam/users/${seg(userId)}/role-assignments`, {
      role_id: input.roleId,
      facility_id: input.facilityId,
      valid_until: input.validUntil,
      reason: input.reason,
    }),
  );
  return res.id;
}

export async function revokeAssignment(assignmentId: string, reason: string): Promise<void> {
  await liveSend('POST', `/iam/role-assignments/${seg(assignmentId)}/revoke`, { reason });
}
