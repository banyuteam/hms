import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useRef, useState } from 'react';
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
  // Focus goes back to the button that opened a confirmation (or, when that button is gone after the change, to the
  // section it was in) instead of falling to the page.
  const triggers = useRef(new Map<string, HTMLElement>());
  const statusRef = useRef<HTMLElement>(null);
  const assignmentsRef = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<{ key: string; fallback: 'status' | 'assignments' } | null>(null);
  const setTrigger = (key: string) => (el: HTMLElement | null) => {
    if (el) triggers.current.set(key, el);
    else triggers.current.delete(key);
  };
  const openPending = (next: NonNullable<Pending>, key: string) => {
    returnTo.current = { key, fallback: next.kind === 'status' ? 'status' : 'assignments' };
    setPending(next);
  };
  useEffect(() => {
    if (pending !== null || !returnTo.current) return;
    const { key, fallback } = returnTo.current;
    returnTo.current = null;
    (
      triggers.current.get(key) ??
      (fallback === 'status' ? statusRef.current : assignmentsRef.current)
    )?.focus();
  }, [pending]);
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
        <section
          ref={statusRef}
          tabIndex={-1}
          aria-label={t('iam.users.col.status')}
          className="flex flex-col gap-8 outline-none"
        >
          {pending?.kind === 'status' ? (
            <ReasonForm
              title={t(`iam.action.${pending.to}`, { name: user.display_name })}
              effect={t(pending.to === 'active' ? 'iam.status.effectActive' : 'iam.status.effect', {
                name: user.display_name,
              })}
              confirmLabel={t(`iam.action.${pending.to}.short`)}
              optional={pending.to === 'active'}
              onCancel={() => setPending(null)}
              onConfirm={async (reason) => {
                await setUserStatus(user.id, pending.to, reason);
                setPending(null);
                await onChanged(
                  t('iam.done.status', {
                    name: user.display_name,
                    status: t(`iam.status.${pending.to}`),
                  }),
                );
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-8">
              {transitions[user.status].map((to) => (
                <Button
                  key={to}
                  ref={setTrigger(`status:${to}`)}
                  onClick={() => openPending({ kind: 'status', to }, `status:${to}`)}
                >
                  {t(`iam.action.${to}.short`)}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby={`iam-assign-${user.id}`} className="flex flex-col gap-8">
        <h4
          id={`iam-assign-${user.id}`}
          ref={assignmentsRef}
          tabIndex={-1}
          className={cn(heading, 'outline-none')}
        >
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
                      ref={setTrigger(`revoke:${a.id}`)}
                      onClick={() =>
                        openPending({ kind: 'revoke', assignment: a }, `revoke:${a.id}`)
                      }
                    >
                      {t('iam.action.revoke')}
                    </Button>
                  )}
                </div>
                {pending?.kind === 'revoke' && pending.assignment.id === a.id && (
                  <ReasonForm
                    title={t('iam.action.revokeRoleFrom', {
                      role: roleName(a),
                      name: user.display_name,
                    })}
                    effect={t('iam.revoke.effect', {
                      name: user.display_name,
                      role: roleName(a),
                      scope: scope(a),
                    })}
                    confirmLabel={t('iam.action.revokeConfirm')}
                    onCancel={() => setPending(null)}
                    onConfirm={async (reason) => {
                      await revokeAssignment(a.id, reason);
                      setPending(null);
                      await onChanged(
                        t('iam.done.revoke', { role: roleName(a), name: user.display_name }),
                      );
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
          userName={user.display_name}
          roles={roles.filter((r) => r.status === 'active')}
          facilityId={facilityId}
          onGranted={(role) => onChanged(t('iam.done.grant', { role, name: user.display_name }))}
        />
      )}
    </div>
  );
}

const grantSchema = z
  .object({
    roleId: z.string().min(1, 'iam.grant.roleRequired'),
    scope: z.enum(['org', 'facility']),
    // No default: how long the access lasts is chosen, not inherited ("no end date" is the widest choice).
    duration: z.string().refine((d) => ['until', 'none'].includes(d), 'iam.grant.durationRequired'),
    validUntil: z.string(),
    reason: z.string().trim().min(1, 'iam.reason.required').max(500, 'iam.reason.tooLong'),
  })
  .superRefine((v, ctx) => {
    if (v.duration === 'until' && !v.validUntil)
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'iam.grant.untilRequired' });
  });
type GrantValues = z.infer<typeof grantSchema>;

/**
 * Grant a role in two steps: fill in, then review a plain summary (who, which role, where, until when, why) and grant.
 * The scope starts at this facility when there is one (least privilege); the end date is an explicit choice; the
 * iam-admin system role carries an extra warning. The server re-checks everything (ADR-SVC-002).
 */
function GrantForm({
  userId,
  userName,
  roles,
  facilityId,
  onGranted,
}: {
  userId: string;
  userName: string;
  roles: IamRole[];
  facilityId: string | null;
  onGranted: (roleName: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const [serverError, setServerError] = useState<string | null>(null);
  const [review, setReview] = useState<GrantValues | null>(null);
  const [granting, setGranting] = useState(false);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    watch,
    formState: { errors },
  } = useForm<GrantValues>({
    resolver: zodResolver(grantSchema),
    defaultValues: {
      roleId: '',
      scope: facilityId ? 'facility' : 'org',
      duration: '',
      validUntil: '',
      reason: '',
    },
  });
  const duration = watch('duration');

  useEffect(() => {
    if (review) reviewRef.current?.focus();
  }, [review]);

  // A date means "through the end of that day" in the browser's time zone.
  const untilOf = (v: GrantValues) =>
    v.duration === 'until' && v.validUntil ? new Date(`${v.validUntil}T23:59:59`) : null;

  const onValid = (v: GrantValues) => {
    const until = untilOf(v);
    if (until && until.getTime() <= Date.now()) {
      setError('validUntil', { message: 'iam.grant.untilPast' }, { shouldFocus: true });
      return;
    }
    setServerError(null);
    setReview(v);
  };

  const grant = async (v: GrantValues) => {
    setGranting(true);
    setServerError(null);
    try {
      const until = untilOf(v);
      await grantRole(userId, {
        roleId: v.roleId,
        facilityId: v.scope === 'facility' ? facilityId : null,
        validUntil: until ? until.toISOString() : null,
        reason: v.reason,
      });
      setReview(null);
      reset();
      await onGranted(roles.find((r) => r.id === v.roleId)?.name ?? '');
    } catch (e) {
      setServerError(iamErrorKey(e));
    } finally {
      setGranting(false);
    }
  };

  const errorId = (name: string) => `${id}-${name}-error`;
  const fieldError = (name: string, key?: string) =>
    key ? (
      <p id={errorId(name)} role="alert" className={formStyles.errorText}>
        {t(key)}
      </p>
    ) : null;
  const invalid = (name: keyof GrantValues) =>
    errors[name] ? { 'aria-invalid': true as const, 'aria-describedby': errorId(name) } : {};

  const role = review ? roles.find((r) => r.id === review.roleId) : undefined;
  const until = review ? untilOf(review) : null;

  return (
    <div className="flex flex-col gap-12 rounded-md border border-line p-12">
      <form
        aria-labelledby={`${id}-title`}
        className="flex flex-col gap-12"
        hidden={review !== null}
        onSubmit={(e) => void handleSubmit(onValid)(e)}
        noValidate
      >
        <h4 id={`${id}-title`} className={heading}>
          {t('iam.grant.title')}
        </h4>
        <div className={formStyles.field}>
          <label htmlFor={`${id}-role`}>{t('iam.grant.role')}</label>
          <select
            id={`${id}-role`}
            className={cn(formStyles.input, 'px-8')}
            {...invalid('roleId')}
            {...register('roleId')}
          >
            <option value="">{t('iam.grant.rolePlaceholder')}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code === ADMIN_ROLE ? `${r.name} (${t('iam.roles.system')})` : r.name}
              </option>
            ))}
          </select>
          {fieldError('roleId', errors.roleId?.message)}
        </div>
        <fieldset className="m-0 flex flex-col gap-6 border-0 p-0">
          <legend className="type-caption-strong mb-6 p-0 text-ink-secondary">
            {t('iam.grant.scope')}
          </legend>
          {facilityId && (
            <label className="type-body flex items-center gap-8">
              <input type="radio" value="facility" {...register('scope')} />
              {t('iam.scope.facility')}
            </label>
          )}
          <label className="type-body flex items-center gap-8">
            <input type="radio" value="org" {...register('scope')} />
            {t('iam.scope.org')}
          </label>
        </fieldset>
        <fieldset
          className="m-0 flex flex-col gap-6 border-0 p-0"
          aria-describedby={errors.duration ? errorId('duration') : undefined}
        >
          <legend className="type-caption-strong mb-6 p-0 text-ink-secondary">
            {t('iam.grant.duration')}
          </legend>
          <label className="type-body flex items-center gap-8">
            <input type="radio" value="until" {...register('duration')} />
            {t('iam.grant.durationUntil')}
          </label>
          {duration === 'until' && (
            <div className={cn(formStyles.field, 'pl-24')}>
              <label htmlFor={`${id}-until`}>{t('iam.grant.until')}</label>
              <input
                id={`${id}-until`}
                type="date"
                className={cn(formStyles.input, 'px-8')}
                {...invalid('validUntil')}
                {...register('validUntil')}
              />
              {fieldError('validUntil', errors.validUntil?.message)}
            </div>
          )}
          <label className="type-body flex items-center gap-8">
            <input type="radio" value="none" {...register('duration')} />
            {t('iam.until.none')}
          </label>
          {fieldError('duration', errors.duration?.message)}
        </fieldset>
        <div className={formStyles.field}>
          <label htmlFor={`${id}-reason`}>{t('iam.reason')}</label>
          <input
            id={`${id}-reason`}
            className={cn(formStyles.input, 'px-12')}
            maxLength={500}
            aria-invalid={Boolean(errors.reason) || undefined}
            aria-describedby={[`${id}-reason-hint`, errors.reason ? errorId('reason') : null]
              .filter(Boolean)
              .join(' ')}
            {...register('reason')}
          />
          <span id={`${id}-reason-hint`} className="type-caption text-ink-muted">
            {t('iam.reason.hint')}
          </span>
          {fieldError('reason', errors.reason?.message)}
        </div>
        <div>
          <Button type="submit" variant="primary">
            {t('iam.grant.review')}
          </Button>
        </div>
      </form>

      {review && (
        <section aria-labelledby={`${id}-review`} className="flex flex-col gap-12">
          <h4
            id={`${id}-review`}
            ref={reviewRef}
            tabIndex={-1}
            className={cn(heading, 'outline-none')}
          >
            {t('iam.grant.reviewTitle', { role: role?.name ?? '—', name: userName })}
          </h4>
          <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12 gap-y-6">
            <dt className="type-caption text-ink-muted">{t('iam.grant.scope')}</dt>
            <dd className="type-body m-0">
              {t(review.scope === 'facility' ? 'iam.scope.facility' : 'iam.scope.org')}
            </dd>
            <dt className="type-caption text-ink-muted">{t('iam.grant.duration')}</dt>
            <dd className="type-body m-0">
              {until ? t('iam.until', { date: formatDate(until, locale) }) : t('iam.until.none')}
            </dd>
            <dt className="type-caption text-ink-muted">{t('iam.reason')}</dt>
            <dd className="type-body m-0 [overflow-wrap:anywhere]">{review.reason}</dd>
            {role && (
              <>
                <dt className="type-caption text-ink-muted">{t('iam.roles.permissions')}</dt>
                <dd className="type-body m-0">
                  {t('iam.roles.permissionCount', { count: role.permissions.length })}
                </dd>
              </>
            )}
          </dl>
          {(review.scope === 'org' || !until) && (
            <p className="type-caption m-0 rounded-md bg-warning-bg p-8 text-warning-fg">
              {t('iam.grant.wideWarning')}
            </p>
          )}
          {role?.code === ADMIN_ROLE && (
            <p className="type-body-strong m-0 rounded-md bg-danger-bg p-8 text-danger-fg">
              {t('iam.grant.adminWarning', { name: userName })}
            </p>
          )}
          {serverError && (
            <p role="alert" className={formStyles.errorText}>
              {t(serverError)}
            </p>
          )}
          <div className="flex flex-wrap gap-8">
            <Button variant="primary" disabled={granting} onClick={() => void grant(review)}>
              {t('iam.grant.submit')}
            </Button>
            <Button
              disabled={granting}
              onClick={() => {
                setReview(null);
                setServerError(null);
                // The form shows again with what was entered; focus goes back to its first field.
                setTimeout(() => setFocus('roleId'));
              }}
            >
              {t('iam.grant.edit')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
