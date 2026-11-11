import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { formStyles } from '@/components/formStyles';
import { ErrorState, LoadingState } from '@/components/QueryState';
import { StatusPill } from '@/components/StatusPill';
import { cn } from '@/lib/cn';
import { useResource } from '@/lib/resource';
import { useI18n } from '@/locales/I18nProvider';
import {
  createRole,
  listPermissions,
  listRoles,
  setRolePermissions,
  type IamPermission,
  type IamRole,
} from './iamApi';
import { useReportUnsaved } from '@/features/workspace/windowGuard';
import { iamErrorKey, isForbidden } from './iamErrors';

const heading = 'type-heading-sm mt-0 mb-8 text-ink';

/** Roles and the permissions they contain. Editing needs iam.roles.manage; the iam-admin system role is read-only. */
export function RolesPanel({
  canManage,
  announce,
}: {
  canManage: boolean;
  announce: (message: string) => void;
}) {
  const { t } = useI18n();
  const roles = useResource(['iam', 'roles'], listRoles);
  const perms = useResource(['iam', 'permissions'], listPermissions);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  // Unsaved ticks in the open role: switching away asks first (they would be lost).
  const [dirty, setDirty] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | 'new' | null>(null);
  const select = (next: string | 'new') => {
    if (next === selected) return;
    if (dirty) setSwitchTo(next);
    else setSelected(next);
  };

  const error = roles.error ?? perms.error;
  if ((roles.isError || perms.isError) && isForbidden(error))
    return <ErrorState title={t('iam.denied.title')} message={t('iam.denied.body')} />;
  if (roles.isError || perms.isError)
    return (
      <ErrorState
        title={t('iam.error.loadTitle')}
        message={t(iamErrorKey(error))}
        retryLabel={t('iam.retry')}
        onRetry={() => {
          void roles.refetch();
          void perms.refetch();
        }}
      />
    );
  if (!roles.data || !perms.data) return <LoadingState message={t('iam.roles.loading')} />;

  const current = roles.data.find((r) => r.id === selected) ?? null;
  const switchName = (to: string | 'new') =>
    to === 'new' ? t('iam.roles.new') : (roles.data?.find((r) => r.id === to)?.name ?? '');
  const changed = async (message: string, id?: string) => {
    await roles.refetch();
    if (id) setSelected(id);
    announce(message);
  };

  return (
    <div className="grid min-h-0 grid-cols-[minmax(240px,320px)_minmax(0,1fr)] gap-16 tablet:grid-cols-1">
      <section aria-labelledby="iam-roles-heading" className="flex flex-col gap-8">
        <h2 id="iam-roles-heading" className={heading}>
          {t('iam.tab.roles')}
        </h2>
        {roles.data.length === 0 ? (
          <p className="type-body m-0 text-ink-muted">{t('iam.roles.empty')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-6 p-0">
            {roles.data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={r.id === selected}
                  onClick={() => select(r.id)}
                  className={cn(
                    'flex w-full cursor-pointer flex-col items-start gap-2 rounded-md border border-line-subtle bg-surface p-8 text-left hover:bg-hover focus-visible:focus-ring',
                    r.id === selected && 'border-line-selected bg-selected',
                  )}
                >
                  <span className="flex items-center gap-8">
                    <span className="type-body-strong">{r.name}</span>
                    {r.system && <StatusPill status="info">{t('iam.roles.system')}</StatusPill>}
                    {r.status === 'retired' && <StatusPill>{t('iam.roles.retired')}</StatusPill>}
                  </span>
                  <span className="type-caption text-ink-secondary">
                    {r.code} · {t('iam.roles.permissionCount', { count: r.permissions.length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div>
            <Button onClick={() => select('new')}>{t('iam.roles.new')}</Button>
          </div>
        )}
      </section>

      <section aria-label={t('iam.roles.detail')} className="flex min-w-0 flex-col gap-12">
        {switchTo !== null && current && (
          <div
            role="alert"
            className="flex flex-col gap-8 rounded-md border border-line bg-warning-bg p-12 text-warning-fg"
          >
            <p className="type-body m-0">
              {t('iam.roles.unsaved', { role: current.name, next: switchName(switchTo) })}
            </p>
            <div className="flex flex-wrap gap-8">
              <Button variant="primary" onClick={() => setSwitchTo(null)}>
                {t('iam.roles.unsavedKeep')}
              </Button>
              <Button
                onClick={() => {
                  setSelected(switchTo);
                  setSwitchTo(null);
                  setDirty(false);
                }}
              >
                {t('iam.roles.unsavedDiscard')}
              </Button>
            </div>
          </div>
        )}
        {selected === 'new' ? (
          <NewRoleForm
            permissions={perms.data}
            onCreated={(role) => changed(t('iam.done.roleCreated', { role: role.name }), role.id)}
            onCancel={() => setSelected(null)}
          />
        ) : current ? (
          <RolePermissions
            key={current.id}
            role={current}
            permissions={perms.data}
            canManage={canManage && !current.system}
            onDirtyChange={setDirty}
            onSaved={() => changed(t('iam.done.rolePermissions', { role: current.name }))}
          />
        ) : (
          <p className="type-body m-0 text-ink-muted">{t('iam.roles.select')}</p>
        )}
      </section>
    </div>
  );
}

function PermissionChecks({
  permissions,
  checked,
  disabled,
  onToggle,
}: {
  permissions: IamPermission[];
  checked: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (code: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <fieldset className="m-0 flex flex-col gap-6 border-0 p-0" disabled={disabled}>
      <legend className="type-caption-strong mb-6 p-0 text-ink-secondary">
        {t('iam.roles.permissions')}
      </legend>
      {permissions.map((p) => (
        <div key={p.code} className="type-body flex items-start gap-8">
          <input
            id={`${id}-${p.code}`}
            type="checkbox"
            className="mt-2"
            checked={checked.has(p.code)}
            aria-describedby={`${id}-${p.code}-desc`}
            onChange={() => onToggle(p.code)}
          />
          <span className="flex flex-col">
            <label htmlFor={`${id}-${p.code}`}>{p.description || p.code}</label>
            <span
              id={`${id}-${p.code}-desc`}
              className="type-caption text-ink-muted [font-variant-numeric:tabular-nums]"
            >
              {p.code}
            </span>
          </span>
        </div>
      ))}
    </fieldset>
  );
}

function toggle(set: ReadonlySet<string>, code: string): Set<string> {
  const next = new Set(set);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  return next;
}

function RolePermissions({
  role,
  permissions,
  canManage,
  onDirtyChange,
  onSaved,
}: {
  role: IamRole;
  permissions: IamPermission[];
  canManage: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(role.permissions));
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const added = permissions.filter(
    (p) => checked.has(p.code) && !role.permissions.includes(p.code),
  );
  const removed = permissions.filter(
    (p) => !checked.has(p.code) && role.permissions.includes(p.code),
  );
  const dirty =
    checked.size !== role.permissions.length || role.permissions.some((p) => !checked.has(p));
  // Closing the window, or switching to another role, with unsaved ticks asks first.
  useReportUnsaved(dirty);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (reviewing) reviewRef.current?.focus();
  }, [reviewing]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setRolePermissions(role.id, [...checked].sort());
      setReviewing(false);
      await onSaved();
    } catch (e) {
      setError(iamErrorKey(e));
    } finally {
      setSaving(false);
    }
  };
  const changeList = (list: IamPermission[], key: string) =>
    list.length > 0 && (
      <>
        <h5 className="type-caption-strong m-0 text-ink-secondary">{t(key)}</h5>
        <ul className="m-0 flex flex-col gap-2 pl-16">
          {list.map((p) => (
            <li key={p.code} className="type-body">
              {p.description || p.code}{' '}
              <span className="type-caption text-ink-muted">({p.code})</span>
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h3 className="type-title-md m-0">{role.name}</h3>
        <p className="type-caption m-0 text-ink-secondary">{role.code}</p>
        {role.description && <p className="type-body mt-6 mb-0">{role.description}</p>}
      </header>
      {role.system && (
        <p className="type-caption m-0 rounded-md bg-info-bg p-8 text-info-fg">
          {t('iam.roles.systemNote')}
        </p>
      )}
      <PermissionChecks
        permissions={permissions}
        checked={checked}
        disabled={!canManage || saving || reviewing}
        onToggle={(code) => setChecked((s) => toggle(s, code))}
      />
      {reviewing && (
        <section
          aria-labelledby={`${id}-review`}
          className="flex flex-col gap-8 rounded-md border border-line bg-surface-subtle p-12"
        >
          <h4
            id={`${id}-review`}
            ref={reviewRef}
            tabIndex={-1}
            className="type-body-strong m-0 outline-none"
          >
            {t('iam.roles.reviewTitle', { role: role.name })}
          </h4>
          {changeList(added, 'iam.roles.added')}
          {changeList(removed, 'iam.roles.removed')}
          <p className="type-caption m-0 rounded-md bg-warning-bg p-8 text-warning-fg">
            {t('iam.roles.reviewEffect', { role: role.name })}
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className={formStyles.errorText}>
          {t(error)}
        </p>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-8">
          {reviewing ? (
            <>
              <Button variant="primary" disabled={saving} onClick={() => void save()}>
                {t('iam.roles.save')}
              </Button>
              <Button disabled={saving} onClick={() => setReviewing(false)}>
                {t('iam.roles.editAgain')}
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={!dirty} onClick={() => setReviewing(true)}>
              {t('iam.roles.review')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const newRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_-]{1,63}$/, 'iam.roles.codeInvalid')
    .refine((c) => c !== 'iam-admin', 'iam.error.systemRole'),
  name: z.string().trim().min(1, 'iam.roles.nameRequired').max(200, 'iam.roles.nameRequired'),
  description: z.string().trim().max(1000, 'iam.reason.tooLong'),
});
type NewRoleValues = z.infer<typeof newRoleSchema>;

function NewRoleForm({
  permissions,
  onCreated,
  onCancel,
}: {
  permissions: IamPermission[];
  onCreated: (role: IamRole) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewRoleValues>({
    resolver: zodResolver(newRoleSchema),
    defaultValues: { code: '', name: '', description: '' },
  });

  const onValid = async (v: NewRoleValues) => {
    setServerError(null);
    try {
      const role = await createRole({ ...v, permissions: [...checked].sort() });
      await onCreated(role);
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
      className="flex flex-col gap-12"
      onSubmit={(e) => void handleSubmit(onValid)(e)}
      noValidate
    >
      <h3 id={`${id}-title`} className="type-title-md m-0">
        {t('iam.roles.new')}
      </h3>
      <div className={formStyles.field}>
        <label htmlFor={`${id}-code`}>{t('iam.roles.code')}</label>
        <input
          id={`${id}-code`}
          className={cn(formStyles.input, 'px-12')}
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${id}-code-hint`}
          {...register('code')}
        />
        <span id={`${id}-code-hint`} className="type-caption text-ink-muted">
          {t('iam.roles.codeHint')}
        </span>
        {fieldError(errors.code?.message)}
      </div>
      <div className={formStyles.field}>
        <label htmlFor={`${id}-name`}>{t('iam.roles.name')}</label>
        <input id={`${id}-name`} className={cn(formStyles.input, 'px-12')} {...register('name')} />
        {fieldError(errors.name?.message)}
      </div>
      <div className={formStyles.field}>
        <label htmlFor={`${id}-desc`}>{t('iam.roles.description')}</label>
        <input
          id={`${id}-desc`}
          className={cn(formStyles.input, 'px-12')}
          {...register('description')}
        />
        {fieldError(errors.description?.message)}
      </div>
      <PermissionChecks
        permissions={permissions}
        checked={checked}
        disabled={isSubmitting}
        onToggle={(code) => setChecked((s) => toggle(s, code))}
      />
      {fieldError(serverError ?? undefined)}
      <div className="flex gap-8">
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {t('iam.roles.create')}
        </Button>
        <Button onClick={onCancel} disabled={isSubmitting}>
          {t('iam.action.cancel')}
        </Button>
      </div>
    </form>
  );
}
