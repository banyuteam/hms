import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { formStyles } from '@/components/formStyles';
import { ErrorState, LoadingState } from '@/components/QueryState';
import { StatusPill, type PillStatus } from '@/components/StatusPill';
import { cn } from '@/lib/cn';
import { useResource } from '@/lib/resource';
import { formatDate, formatDateTime } from '@/locales/format';
import { useI18n, type Translate } from '@/locales/I18nProvider';
import {
  ADMIN_ROLE,
  grantRole,
  listRoles,
  listUsers,
  revokeAssignment,
  setUserStatus,
  USER_STATUSES,
  type IamAssignment,
  type IamIdentity,
  type IamRole,
  type IamUser,
  type UserStatus,
} from './iamApi';
import { iamErrorKey, isForbidden } from './iamErrors';
import { ReasonForm } from './ReasonForm';

const STATUS_TONE: Record<UserStatus, PillStatus> = {
  active: 'success',
  suspended: 'warning',
  deactivated: 'neutral',
};
const heading = 'type-heading-sm mt-0 mb-8 text-ink';
const cell = 'border-b border-line-subtle px-12 py-8 text-left align-top';

export interface PanelProps {
  /** The signed-in person's user id: their own status and roles are not offered for change. */
  me: string;
  facilityId: string | null;
  can: { usersManage: boolean; assignmentsManage: boolean };
  /** Polite announcement after a change ("Change saved."). */
  announce: (message: string) => void;
}

export function identityLabel(t: Translate, i: IamIdentity): string {
  if (i.issuer === 'legacy-hms:dokter') return t('iam.identity.doctor', { id: i.subject });
  if (i.issuer === 'legacy-hms:pegawai') return t('iam.identity.employee', { id: i.subject });
  return t('iam.identity.oidc');
}

/** Users of the organization (left) and the selected user's access (right). */
export function UsersPanel({ me, facilityId, can, announce }: PanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const first = useResource(['iam', 'users', status], () => listUsers(status));
  const roles = useResource(['iam', 'roles'], listRoles);
  // Further pages ("Load more") stay local to this window and restart whenever the first page changes.
  const [more, setMore] = useState<{ users: IamUser[]; next?: string; error?: unknown }>({
    users: [],
  });
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => setMore({ users: [] }), [first.data]);

  if (first.isError && isForbidden(first.error)) return <Denied />;
  if (first.isError)
    return (
      <ErrorState
        title={t('iam.error.loadTitle')}
        message={t(iamErrorKey(first.error))}
        retryLabel={t('iam.retry')}
        onRetry={() => void first.refetch()}
      />
    );
  if (!first.data) return <LoadingState message={t('iam.users.loading')} />;

  const users = [...first.data.users, ...more.users];
  const next = more.users.length ? more.next : first.data.next_after;
  const current = users.find((u) => u.id === selected) ?? null;
  const refresh = async () => {
    await first.refetch();
  };
  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await listUsers(status, next);
      setMore((m) => ({ users: [...m.users, ...page.users], next: page.next_after }));
    } catch (error) {
      setMore((m) => ({ ...m, error }));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,400px)] gap-16 tablet:grid-cols-1">
      <section aria-labelledby="iam-users-heading" className="flex min-w-0 flex-col gap-12">
        <div className="flex items-end justify-between gap-12">
          <h2 id="iam-users-heading" className={heading}>
            {t('iam.tab.users')}
          </h2>
          <div className={cn(formStyles.field, 'w-[200px]')}>
            <label htmlFor="iam-status-filter">{t('iam.users.filter')}</label>
            <select
              id="iam-status-filter"
              className={cn(formStyles.input, 'px-8')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as UserStatus | '');
                setSelected(null);
              }}
            >
              <option value="">{t('iam.users.filter.all')}</option>
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`iam.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {users.length === 0 ? (
          <p className="type-body m-0 text-ink-muted">{t('iam.users.empty')}</p>
        ) : (
          <table className="type-body w-full border-collapse">
            <caption className="sr-only">{t('iam.tab.users')}</caption>
            <thead className="type-caption-strong text-ink-secondary">
              <tr>
                <th scope="col" className={cell}>
                  {t('iam.users.col.name')}
                </th>
                <th scope="col" className={cell}>
                  {t('iam.users.col.status')}
                </th>
                <th scope="col" className={cell}>
                  {t('iam.users.col.identities')}
                </th>
                <th scope="col" className={cell}>
                  {t('iam.users.col.roles')}
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={cn(u.id === selected && 'bg-selected')}>
                  <td className={cell}>
                    <button
                      type="button"
                      className="type-body-strong cursor-pointer border-0 bg-transparent p-0 text-left text-ink-link hover:underline focus-visible:focus-ring"
                      aria-pressed={u.id === selected}
                      onClick={() => setSelected(u.id)}
                    >
                      {u.display_name}
                    </button>
                  </td>
                  <td className={cell}>
                    <StatusPill status={STATUS_TONE[u.status]}>
                      {t(`iam.status.${u.status}`)}
                    </StatusPill>
                  </td>
                  <td className={cn(cell, 'text-ink-secondary')}>
                    {u.identities.map((i) => identityLabel(t, i)).join(', ')}
                  </td>
                  <td className={cn(cell, 'text-ink-secondary')}>
                    {u.assignments.length
                      ? [...new Set(u.assignments.map((a) => a.role_code))].join(', ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {more.error !== undefined && (
          <p role="alert" className={formStyles.errorText}>
            {t(iamErrorKey(more.error))}
          </p>
        )}
        {next && (
          <div>
            <Button onClick={() => void loadMore()} disabled={loadingMore}>
              {t('iam.users.more')}
            </Button>
          </div>
        )}
      </section>

      <section aria-label={t('iam.user.detail')} className="min-w-0">
        {current ? (
          <UserDetail
            key={current.id}
            user={current}
            roles={roles.data ?? []}
            me={me}
            facilityId={facilityId}
            can={can}
            onChanged={async (message) => {
              await refresh();
              announce(message);
            }}
          />
        ) : (
          <p className="type-body m-0 text-ink-muted">{t('iam.users.select')}</p>
        )}
      </section>
    </div>
  );
}

function Denied() {
  const { t } = useI18n();
  return <ErrorState title={t('iam.denied.title')} message={t('iam.denied.body')} />;
}

type Pending =
  | { kind: 'status'; to: UserStatus }
  | { kind: 'revoke'; assignment: IamAssignment }
  | null;

function UserDetail({
  user,
  roles,
  me,
  facilityId,
  can,
  onChanged,
}: {
  user: IamUser;
  roles: IamRole[];
  me: string;
  facilityId: string | null;
  can: PanelProps['can'];
  onChanged: (message: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState<Pending>(null);
  const self = user.id === me;
  const roleName = (a: IamAssignment) => roles.find((r) => r.id === a.role_id)?.name ?? a.role_code;
  const scope = (a: IamAssignment) =>
    a.facility_id === null
      ? t('iam.scope.org')
      : a.facility_id === facilityId
        ? t('iam.scope.facility')
        : t('iam.scope.other');
  const transitions: Record<UserStatus, UserStatus[]> = {
    active: ['suspended', 'deactivated'],
    suspended: ['active', 'deactivated'],
    deactivated: ['active'],
  };
  const lastSignIn = user.identities
    .map((i) => i.last_authenticated_at)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);

  return (
    <div className="flex flex-col gap-16">
      <header className="flex flex-col gap-6">
        <h3 className="type-title-md m-0">{user.display_name}</h3>
        <div className="flex flex-wrap items-center gap-8">
          <StatusPill status={STATUS_TONE[user.status]}>
            {t(`iam.status.${user.status}`)}
          </StatusPill>
          {user.identities.map((i) => (
            <span key={`${i.issuer}|${i.subject}`} className="type-caption text-ink-secondary">
              {identityLabel(t, i)}
            </span>
          ))}
        </div>
        {user.status !== 'active' && user.status_reason && (
          <p className="type-caption m-0 text-ink-secondary">
            {t('iam.user.reason', { reason: user.status_reason })}
          </p>
        )}
        <p className="type-caption m-0 text-ink-muted">
          {lastSignIn
            ? t('iam.user.lastSignIn', { when: formatDateTime(new Date(lastSignIn), locale) })
            : t('iam.user.neverSignedIn')}
        </p>
        {self && (
          <p className="type-caption m-0 rounded-md bg-info-bg p-8 text-info-fg">
            {t('iam.user.self')}
          </p>
        )}
      </header>

      {can.usersManage && !self && (
        <section aria-label={t('iam.users.col.status')} className="flex flex-col gap-8">
          {pending?.kind === 'status' ? (
            <ReasonForm
              label={t(`iam.action.${pending.to}`, { name: user.display_name })}
              effect={pending.to === 'active' ? undefined : t('iam.status.effect')}
              optional={pending.to === 'active'}
              onCancel={() => setPending(null)}
              onConfirm={async (reason) => {
                await setUserStatus(user.id, pending.to, reason);
                setPending(null);
                await onChanged(t('iam.done'));
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-8">
              {transitions[user.status].map((to) => (
                <Button key={to} onClick={() => setPending({ kind: 'status', to })}>
                  {t(`iam.action.${to}.short`)}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby={`iam-assign-${user.id}`} className="flex flex-col gap-8">
        <h4 id={`iam-assign-${user.id}`} className={heading}>
          {t('iam.assignments.title')}
        </h4>
        {user.assignments.length === 0 ? (
          <p className="type-body m-0 text-ink-muted">{t('iam.assignments.empty')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-8 p-0">
            {user.assignments.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-6 rounded-md border border-line-subtle p-8"
              >
                <div className="flex items-start justify-between gap-8">
                  <div className="flex flex-col">
                    <span className="type-body-strong">{roleName(a)}</span>
                    <span className="type-caption text-ink-secondary">
                      {scope(a)} ·{' '}
                      {a.valid_until
                        ? t('iam.until', { date: formatDate(new Date(a.valid_until), locale) })
                        : t('iam.until.none')}
                    </span>
                  </div>
                  {can.assignmentsManage && !self && pending?.kind !== 'revoke' && (
                    <Button
                      variant="ghost"
                      onClick={() => setPending({ kind: 'revoke', assignment: a })}
                    >
                      {t('iam.action.revoke')}
                    </Button>
                  )}
                </div>
                {pending?.kind === 'revoke' && pending.assignment.id === a.id && (
                  <ReasonForm
                    label={t('iam.action.revokeRole', { role: roleName(a) })}
                    onCancel={() => setPending(null)}
                    onConfirm={async (reason) => {
                      await revokeAssignment(a.id, reason);
                      setPending(null);
                      await onChanged(t('iam.done'));
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {can.assignmentsManage && !self && user.status === 'active' && (
        <GrantForm
          userId={user.id}
          roles={roles.filter((r) => r.status === 'active')}
          facilityId={facilityId}
          onGranted={() => onChanged(t('iam.done'))}
        />
      )}
    </div>
  );
}

const grantSchema = z.object({
  roleId: z.string().min(1, 'iam.grant.roleRequired'),
  scope: z.enum(['org', 'facility']),
  validUntil: z.string(),
  reason: z.string().trim().min(1, 'iam.reason.required').max(500, 'iam.reason.tooLong'),
});
type GrantValues = z.infer<typeof grantSchema>;

function GrantForm({
  userId,
  roles,
  facilityId,
  onGranted,
}: {
  userId: string;
  roles: IamRole[];
  facilityId: string | null;
  onGranted: () => Promise<void>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<GrantValues>({
    resolver: zodResolver(grantSchema),
    defaultValues: { roleId: '', scope: 'org', validUntil: '', reason: '' },
  });

  const onValid = async (v: GrantValues) => {
    // A date means "through the end of that day" in the browser's time zone.
    const until = v.validUntil ? new Date(`${v.validUntil}T23:59:59`) : null;
    if (until && until.getTime() <= Date.now()) {
      setError('validUntil', { message: 'iam.grant.untilPast' });
      return;
    }
    setServerError(null);
    try {
      await grantRole(userId, {
        roleId: v.roleId,
        facilityId: v.scope === 'facility' ? facilityId : null,
        validUntil: until ? until.toISOString() : null,
        reason: v.reason,
      });
      reset();
      await onGranted();
    } catch (e) {
      setServerError(iamErrorKey(e));
    }
  };

  const fieldError = (key?: string) =>
    key ? (
      <p role="alert" className={formStyles.errorText}>
        {t(key)}
      </p>
    ) : null;
  return (
    <form
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-12 rounded-md border border-line p-12"
      onSubmit={(e) => void handleSubmit(onValid)(e)}
      noValidate
    >
      <h4 id={`${id}-title`} className={heading}>
        {t('iam.grant.title')}
      </h4>
      <div className={formStyles.field}>
        <label htmlFor={`${id}-role`}>{t('iam.grant.role')}</label>
        <select id={`${id}-role`} className={cn(formStyles.input, 'px-8')} {...register('roleId')}>
          <option value="">{t('iam.grant.rolePlaceholder')}</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code === ADMIN_ROLE ? `${r.name} (${t('iam.roles.system')})` : r.name}
            </option>
          ))}
        </select>
        {fieldError(errors.roleId?.message)}
      </div>
      <fieldset className="m-0 flex flex-col gap-6 border-0 p-0">
        <legend className="type-caption-strong mb-6 p-0 text-ink-secondary">
          {t('iam.grant.scope')}
        </legend>
        <label className="type-body flex items-center gap-8">
          <input type="radio" value="org" {...register('scope')} />
          {t('iam.scope.org')}
        </label>
        {facilityId && (
          <label className="type-body flex items-center gap-8">
            <input type="radio" value="facility" {...register('scope')} />
            {t('iam.scope.facility')}
          </label>
        )}
      </fieldset>
      <div className={formStyles.field}>
        <label htmlFor={`${id}-until`}>{t('iam.grant.until')}</label>
        <input
          id={`${id}-until`}
          type="date"
          className={cn(formStyles.input, 'px-8')}
          {...register('validUntil')}
        />
        {fieldError(errors.validUntil?.message)}
      </div>
      <div className={formStyles.field}>
        <label htmlFor={`${id}-reason`}>{t('iam.reason')}</label>
        <input
          id={`${id}-reason`}
          className={cn(formStyles.input, 'px-12')}
          maxLength={500}
          {...register('reason')}
        />
        {fieldError(errors.reason?.message)}
      </div>
      {fieldError(serverError ?? undefined)}
      <div>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {t('iam.grant.submit')}
        </Button>
      </div>
    </form>
  );
}
