import { useEffect, useId, useRef, useState } from 'react';
import { emrApi } from '@/api/emrApi';
import { emrKeys } from '@/api/hooks';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { RecordSearch } from '@/features/emr/components/RecordSearch';
import { cn } from '@/lib/cn';
import { resourceCache } from '@/lib/resource';
import { formatTime } from '@/locales/format';
import { useI18n, type Translate } from '@/locales/I18nProvider';
import { useAssistant, useAssistantActions, type ChatMessage } from '@/state/assistant';
import { ClaimResult } from './ClaimResult';
import {
  sectionTopic,
  subjectOf,
  TOPICS,
  type AssistantTag,
  type ReplyLine,
  type Subject,
  type Topic,
} from './rules';

const chipX =
  'inline-grid cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-inherit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-line-focus';
const chip =
  'type-caption-strong inline-flex items-center gap-4 rounded-full border border-ai-border bg-ai-bg py-2 pr-4 pl-8 text-ai-fg [font-variant-numeric:tabular-nums] data-[subject=true]:border-ai-accent data-[subject=true]:bg-surface';
const chipPick =
  'cursor-pointer rounded-full border-0 bg-transparent p-0 text-inherit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus';
const hint = 'type-caption m-0 text-ink-muted';

export function tagLabel(t: Translate, tag: AssistantTag): string {
  const base =
    tag.kind === 'patient' ? t('emr.identity.mrn', { mrn: tag.mrn ?? '—' }) : (tag.norawat ?? '—');
  return tag.section ? `${base} · ${t(`emr.ai.section.${tag.section}`)}` : base;
}

function Line({ line }: { line: ReplyLine }) {
  const { t } = useI18n();
  if ('raw' in line) return <li className="[font-variant-numeric:tabular-nums]">{line.raw}</li>;
  if ('claim' in line) return <ClaimResult evaluation={line.claim} />;
  if (line.id === 'emr.ai.reply.source')
    return (
      <li className="type-caption text-ink-muted [font-variant-numeric:tabular-nums]">
        {t(line.id, line.values)}
      </li>
    );
  if (line.id === 'emr.ai.reply.disclaimer')
    return (
      <li className="type-caption mt-4 border-t border-ai-border pt-4 text-ink-muted">
        {t(line.id)}
      </li>
    );
  return <li>{t(line.id, line.values)}</li>;
}

/** The answer is being checked on the server. */
function Checking() {
  const { t } = useI18n();
  return (
    <p className="type-caption m-0 flex items-center gap-8 text-ai-fg">
      <span className="flex gap-4" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-6 rounded-full bg-ai-accent motion-safe:animate-pulse" />
        ))}
      </span>
      {t('emr.claim.checking')}
    </p>
  );
}

/**
 * One chat bubble. The user's question sits on the right (primary colour) with the context it was asked about quoted on
 * top; the assistant answers on the left in the assistant colours with its avatar and name, so a machine reply is never
 * mistaken for record data. Both end with the time (HH:mm, Asia/Jakarta).
 */
function Bubble({ message: m }: { message: ChatMessage }) {
  const { t, locale } = useI18n();
  const sent = new Date(m.at);
  const time = (
    <time
      dateTime={sent.toISOString()}
      className={cn(
        'type-caption self-end [font-variant-numeric:tabular-nums]',
        m.role === 'assistant' && 'text-ink-muted',
      )}
    >
      {formatTime(sent, locale)}
    </time>
  );

  if (m.role === 'user')
    return (
      <li
        className="flex max-w-[80%] flex-col gap-4 self-end rounded-lg rounded-br-sm bg-action px-12 py-8 text-ink-on-action"
        data-role="user"
      >
        <span className="sr-only">{t('emr.ai.you')}</span>
        {m.tags.length > 0 && (
          <ul
            className="type-caption m-0 flex list-none flex-wrap gap-4 rounded-md border-l-2 border-ink-on-action bg-action-hover px-8 py-4 [font-variant-numeric:tabular-nums]"
            aria-label={t('emr.ai.context')}
          >
            {m.tags.map((tg, i) => (
              <li key={tg.id}>
                {tagLabel(t, tg)}
                {i < m.tags.length - 1 && ','}
              </li>
            ))}
          </ul>
        )}
        <p className="type-body m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {m.topic ? t(`emr.ai.topic.${m.topic}`) : m.text}
        </p>
        {time}
      </li>
    );

  return (
    <li className="flex max-w-[90%] items-end gap-8 self-start" data-role="assistant">
      <span className="grid size-icon-lg flex-none place-items-center rounded-full bg-ai-solid text-ink-on-action">
        <Icon name="assistant" size={16} />
      </span>
      <div className="type-body flex min-w-0 flex-col gap-4 rounded-lg rounded-bl-sm border border-ai-border bg-ai-bg px-12 py-8 text-ink">
        <span className="type-caption-strong text-ai-fg">{t('emr.ai.assistant')}</span>
        {m.pending && <Checking />}
        {m.lines && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0 [overflow-wrap:anywhere]">
            {m.lines.map((l, i) => (
              <Line key={i} line={l} />
            ))}
          </ul>
        )}
        {time}
      </div>
    </li>
  );
}

/**
 * Guided questions about the subject visit: one button per topic, the tagged section's topic first. With several visits
 * tagged and none chosen, it says to choose one instead (F-9).
 */
function Topics({ subject, onAsk }: { subject: Subject; onAsk: (topic: Topic) => void }) {
  const { t } = useI18n();
  if (subject.kind === 'ambiguous') return <p className={hint}>{t('emr.ai.chooseVisitHint')}</p>;
  if (subject.kind !== 'visit') return null;
  const suggested = sectionTopic(subject.tag);
  const order: Topic[] = suggested
    ? [suggested, ...TOPICS.filter((x) => x !== suggested)]
    : [...TOPICS];
  const label = t('emr.ai.topics', { label: tagLabel(t, subject.tag) });
  return (
    <div className="flex flex-col gap-4" role="group" aria-label={label}>
      <p className={hint}>{label}</p>
      <div className="flex flex-wrap gap-4">
        {order.map((topic) => (
          <Button key={topic} variant="ai" onClick={() => onAsk(topic)}>
            {t(`emr.ai.topic.${topic}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * App-shell assistant (rule-based, read-only, no medical advice; not presented as AI, F-10). Closed = a rail button on
 * the right edge (always discoverable), docked = side panel, maximized = full work area with a left "tag data" pane.
 * Everything lives in memory and is wiped on logout.
 */
export function AssistantPanel() {
  const { t } = useI18n();
  const { mode, tags, subject: chosen, messages } = useAssistant();
  const { setMode, tag, untag, choose, send, ask } = useAssistantActions();
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]); // also when a pending answer arrives

  if (mode === 'closed') {
    return (
      <div className="flex items-start border-l border-line-subtle bg-dock px-4 py-8">
        <button
          type="button"
          className="type-body-strong inline-flex cursor-pointer flex-col items-center justify-center gap-8 whitespace-nowrap rounded-md border border-ai-border bg-ai-bg px-4 py-8 text-ai-fg focus-visible:focus-ring"
          onClick={() => setMode('docked')}
          aria-label={t('emr.ai.openPanel')}
        >
          <Icon name="assistant" />
          <span className="type-caption-strong [writing-mode:vertical-rl]">
            {t('emr.ai.title')}
          </span>
        </button>
      </div>
    );
  }

  const subject = subjectOf(tags, chosen);
  // Choosing only matters when the tags name more than one visit.
  const pickable = new Set(tags.filter((x) => x.kind !== 'patient').map((x) => x.norawat)).size > 1;
  const tagEncounter = (norawat: string, mrn?: string | null) => {
    void resourceCache.prefetch(emrKeys.journey(norawat), () => emrApi.getJourney(norawat));
    tag({ id: `enc:${norawat}`, kind: 'encounter', norawat, mrn: mrn ?? undefined });
  };
  const submit = () => {
    send(draft);
    setDraft('');
  };

  // Docked, the picker shares a short column with the conversation and the composer: its results scroll inside a fixed
  // height so they never push the chips, topics and message box out of the panel. Maximized, its pane scrolls instead.
  const tagPicker = (
    <div className="flex flex-none">
      <RecordSearch
        scrollResults={mode === 'docked'}
        label={t('emr.ai.tagSearch')}
        onPick={(pick) =>
          pick.type === 'encounter' && tagEncounter(pick.item.no_rawat, pick.item.no_rkm_medis)
        }
      />
    </div>
  );

  return (
    <aside
      className="group/panel flex min-h-0 w-assistant-panel max-w-full flex-col border-l border-ai-border bg-surface shadow-window data-[mode=maximized]:absolute data-[mode=maximized]:inset-0 data-[mode=maximized]:z-popover data-[mode=maximized]:w-auto data-[mode=maximized]:border-l-0"
      data-mode={mode}
      aria-label={t('emr.ai.title')}
    >
      <header className="flex min-h-titlebar items-center gap-8 border-b border-ai-border bg-ai-bg pr-8 pl-12 text-ai-fg">
        <Icon name="assistant" size={16} />
        <h2 className="type-title-md m-0 text-ink">{t('emr.ai.title')}</h2>
        <div className="ml-auto flex">
          <Button
            variant="ghost"
            aria-label={t(mode === 'maximized' ? 'emr.ai.restore' : 'emr.ai.maximize')}
            onClick={() => setMode(mode === 'maximized' ? 'docked' : 'maximized')}
          >
            <Icon name={mode === 'maximized' ? 'restore' : 'maximize'} size={16} />
          </Button>
          <Button variant="ghost" aria-label={t('emr.ai.close')} onClick={() => setMode('closed')}>
            <Icon name="x" size={16} />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {mode === 'maximized' && (
          <div className="w-assistant-panel flex-none overflow-auto border-r border-line-subtle bg-surface-subtle p-16">
            {tagPicker}
          </div>
        )}
        {/* On a very short screen the column scrolls rather than painting past the panel over the dock. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-8 overflow-y-auto p-12 group-data-[mode=maximized]/panel:mx-auto group-data-[mode=maximized]/panel:max-w-home-content">
          <div
            ref={logRef}
            className="min-h-0 flex-1 overflow-auto rounded-md border border-line-subtle bg-canvas p-12 focus-visible:focus-ring"
            role="log"
            aria-live="polite"
            aria-label={t('emr.ai.conversation')}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable log must be keyboard reachable
            tabIndex={0}
          >
            <ol className="m-0 flex min-h-full list-none flex-col gap-12 p-0">
              {messages.length === 0 && (
                <li className="m-auto flex max-w-[80%] flex-col items-center gap-8 rounded-lg bg-surface p-16 text-center">
                  <span className="grid size-control place-items-center rounded-full bg-ai-bg text-ai-fg">
                    <Icon name="assistant" size={20} />
                  </span>
                  <p className="type-body m-0 text-ink-secondary">{t('emr.ai.empty')}</p>
                </li>
              )}
              {messages.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}
            </ol>
          </div>

          {mode === 'docked' && tagPicker}

          <div className="flex flex-none flex-col gap-6">
            {tags.length > 0 && (
              <ul
                className="m-0 flex list-none flex-wrap gap-4 p-0"
                aria-label={t('emr.ai.context')}
              >
                {tags.map((tg) => {
                  const label = tagLabel(t, tg);
                  const isSubject = subject.kind === 'visit' && subject.tag.id === tg.id;
                  return (
                    <li key={tg.id} className={chip} data-subject={pickable && isSubject}>
                      {pickable && tg.kind !== 'patient' ? (
                        <button
                          type="button"
                          className={chipPick}
                          aria-pressed={isSubject}
                          aria-label={t('emr.ai.subject', { label })}
                          onClick={() => choose(tg.id)}
                        >
                          {label}
                        </button>
                      ) : (
                        <span>{label}</span>
                      )}
                      <button
                        type="button"
                        className={chipX}
                        onClick={() => untag(tg.id)}
                        aria-label={t('emr.ai.untag', { label })}
                      >
                        <Icon name="x" size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Topics subject={subject} onAsk={ask} />
            <form
              className="flex items-end gap-8"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-1">
                <label htmlFor={inputId} className="sr-only">
                  {t('emr.ai.inputLabel')}
                </label>
                <textarea
                  id={inputId}
                  className="type-body flex-1 resize-none rounded-md border border-line p-8 font-base text-ink focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-line-focus"
                  rows={2}
                  value={draft}
                  placeholder={t('emr.ai.placeholder')}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={!draft.trim()}
                aria-label={t('emr.ai.send')}
              >
                <Icon name="send" size={16} />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
