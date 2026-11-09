import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
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
                  onClick={() => setSelected(r.id)}
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
            <Button onClick={() => setSelected('new')}>{t('iam.roles.new')}</Button>
          </div>
        )}
      </section>

      <section aria-label={t('iam.roles.detail')} className="min-w-0">
        {selected === 'new' ? (
          <NewRoleForm
            permissions={perms.data}
            onCreated={(role) => changed(t('iam.done'), role.id)}
            onCancel={() => setSelected(null)}
          />
        ) : current ? (
          <RolePermissions
            key={current.id}
            role={current}
            permissions={perms.data}
            canManage={canManage && !current.system}
            onSaved={() => changed(t('iam.done'))}
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
            <label htmlFor={`${id}-${p.code}`}>{p.code}</label>
            <span id={`${id}-${p.code}-desc`} className="type-caption text-ink-secondary">
              {p.description}
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
  onSaved,
}: {
  role: IamRole;
  permissions: IamPermission[];
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(role.permissions));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    checked.size !== role.permissions.length || role.permissions.some((p) => !checked.has(p));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setRolePermissions(role.id, [...checked].sort());
      await onSaved();
    } catch (e) {
      setError(iamErrorKey(e));
    } finally {
      setSaving(false);
    }
  };

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
        disabled={!canManage || saving}
        onToggle={(code) => setChecked((s) => toggle(s, code))}
      />
      {error && (
        <p role="alert" className={formStyles.errorText}>
          {t(error)}
        </p>
      )}
      {canManage && (
        <div>
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {t('iam.roles.save')}
          </Button>
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
