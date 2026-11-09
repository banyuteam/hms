import { createContext, useContext, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { emrKeys } from '@/api/hooks';
import type { EncounterJourney } from '@/api/journey';
import { claimApi, claimErrorKind, claimKey, type ClaimEvaluation } from '@/api/claimApi';
import {
  recordAssistantEvent,
  resetAssistantEvents,
  type FallbackKind,
} from '@/api/assistantEvents';
import {
  ask as askTopic,
  claimErrorLines,
  claimLines,
  reply,
  subjectOf,
  TOPICS,
  type AssistantTag,
  type Intent,
  type Reply,
  type ReplyLine,
  type Topic,
} from '@/features/assistant/rules';
import { hashKey, resourceCache } from '@/lib/resource';

export type PanelMode = 'closed' | 'docked' | 'maximized';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  /** User text is kept as typed; a quick action stores its topic instead (shown in the current locale). */
  text?: string;
  topic?: Topic;
  /** Assistant text is i18n lines. */
  lines?: ReplyLine[];
  /** The context the question was about: the subject visit, or every tag when there was none. */
  tags: AssistantTag[];
  /** When it was sent or answered (epoch ms), shown as HH:mm. */
  at: number;
  /** An answer still being checked on the server; `request` matches it to its result. */
  pending?: boolean;
  request?: number;
}

/** In memory only; wiped by `useEndSession` with every other session state (no PHI in storage). */
export interface AssistantState {
  mode: PanelMode;
  tags: AssistantTag[];
  /** The visit tag the user chose to ask about when several visits are tagged (F-9). Never set automatically. */
  subject?: string;
  messages: ChatMessage[];
  seq: number;
}

interface Question {
  text?: string;
  topic?: Topic;
  tags: AssistantTag[];
  at: number;
}

export type AssistantAction =
  | { type: 'panel/modeChanged'; mode: PanelMode }
  | { type: 'tag/added'; tag: AssistantTag }
  | { type: 'tag/removed'; id: string }
  | { type: 'subject/chosen'; id: string }
  | ({ type: 'message/answered'; lines: ReplyLine[] } & Question)
  | ({ type: 'message/asked'; request: number } & Question)
  | { type: 'message/resolved'; request: number; lines: ReplyLine[]; at: number }
  | { type: 'session/reset' };

export const initialAssistantState: AssistantState = {
  mode: 'closed',
  tags: [],
  messages: [],
  seq: 1,
};

function question(s: AssistantState, q: Question): ChatMessage {
  return { id: s.seq, role: 'user', text: q.text, topic: q.topic, tags: q.tags, at: q.at };
}

export function assistantReducer(s: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case 'panel/modeChanged':
      return { ...s, mode: action.mode };
    case 'tag/added':
      // "Ask" from any window: adds the tag (deduplicated) and opens the docked panel. It does not change the subject.
      return {
        ...s,
        tags: s.tags.some((t) => t.id === action.tag.id) ? s.tags : [...s.tags, action.tag],
        mode: s.mode === 'closed' ? 'docked' : s.mode,
      };
    case 'tag/removed':
      return {
        ...s,
        tags: s.tags.filter((t) => t.id !== action.id),
        subject: s.subject === action.id ? undefined : s.subject,
      };
    case 'subject/chosen':
      return s.tags.some((t) => t.id === action.id && t.kind !== 'patient')
        ? { ...s, subject: action.id }
        : s;
    case 'message/answered':
      return {
        ...s,
        messages: [
          ...s.messages,
          question(s, action),
          {
            id: s.seq + 1,
            role: 'assistant',
            lines: action.lines,
            tags: action.tags,
            at: action.at,
          },
        ],
        seq: s.seq + 2,
      };
    case 'message/asked':
      return {
        ...s,
        messages: [
          ...s.messages,
          question(s, action),
          {
            id: s.seq + 1,
            role: 'assistant',
            tags: action.tags,
            at: action.at,
            pending: true,
            request: action.request,
          },
        ],
        seq: s.seq + 2,
      };
    case 'message/resolved':
      // A result for a conversation that was wiped (sign-out) finds no message and changes nothing.
      return {
        ...s,
        messages: s.messages.map((m) =>
          m.pending && m.request === action.request
            ? { ...m, lines: action.lines, at: action.at, pending: false }
            : m,
        ),
      };
    case 'session/reset':
      return initialAssistantState;
  }
}

export interface AssistantActions {
  setMode: (mode: PanelMode) => void;
  tag: (tag: AssistantTag) => void;
  untag: (id: string) => void;
  /** Makes a tagged visit the one questions are about. */
  choose: (id: string) => void;
  /**
   * Answers from the tagged records already loaded in the cache; a claim question is evaluated by hms_services instead
   * (the answer shows as pending until the result arrives).
   */
  send: (text: string) => void;
  /** A quick-action topic about the subject visit (same answers as typed text, without interpreting text). */
  ask: (topic: Topic) => void;
  /** Runs claim readiness again for a visit (a new, audited evaluation on the server). */
  recheck: (norawat: string) => void;
  reset: () => void;
}

const AssistantStateContext = createContext<AssistantState | null>(null);
const AssistantActionsContext = createContext<AssistantActions | null>(null);

/** Replies that ask back instead of answering, as interaction events name them (ADR-SVC-008 Decision 6). */
const FALLBACKS: Partial<Record<Intent, FallbackKind>> = {
  help: 'help',
  needTag: 'need_tag',
  needVisit: 'need_visit',
  chooseVisit: 'choose_visit',
  notLoaded: 'not_loaded',
  refuse: 'refused',
};

const isTopic = (i: Intent): i is Topic => (TOPICS as readonly string[]).includes(i);

/** Usage events for one question: the topic asked (button) or answered (typed), and any fallback shown. */
function recordUsage(r: Reply, button?: Topic) {
  if (button) recordAssistantEvent({ type: 'topic_selected', topic: button, input: 'button' });
  else if (isTopic(r.intent))
    recordAssistantEvent({ type: 'topic_selected', topic: r.intent, input: 'typed' });
  const fallback = FALLBACKS[r.intent];
  if (fallback) recordAssistantEvent({ type: 'fallback_shown', fallback_kind: fallback });
}

const journeyOf = (norawat: string) =>
  resourceCache.getData<EncounterJourney>(emrKeys.journey(norawat));

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(assistantReducer, initialAssistantState);
  // Replies need the current tags and subject; the actions object stays stable, so it reads them through a ref.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Never reset (not even on sign-out), so a late result can only ever match its own question.
  const requestRef = useRef(0);
  const actions = useMemo<AssistantActions>(() => {
    /** The context a question is quoted with: the subject visit, or every tag when there is none. */
    const quoted = (): AssistantTag[] => {
      const { tags, subject } = stateRef.current;
      const s = subjectOf(tags, subject);
      return s.kind === 'visit' ? [s.tag] : tags;
    };

    /** Runs claim readiness through the data cache, so an open Records window showing the visit gets the same result. */
    const evaluate = (norawat: string, q: Omit<Question, 'at'>) => {
      const request = (requestRef.current += 1);
      dispatch({ type: 'message/asked', ...q, request, at: Date.now() });
      const key = claimKey(norawat);
      void resourceCache
        .fetch(key, () => claimApi.evaluate(norawat))
        .then(() => {
          const entry = resourceCache.get<ClaimEvaluation>(hashKey(key));
          const lines =
            entry.status === 'success' && entry.data
              ? claimLines(norawat, entry.data)
              : claimErrorLines(norawat, claimErrorKind(entry.error));
          dispatch({ type: 'message/resolved', request, lines, at: Date.now() });
        });
    };

    const respond = (r: Reply, q: Omit<Question, 'at' | 'tags'>) => {
      const tags = quoted();
      if (r.evaluate) evaluate(r.evaluate, { ...q, tags });
      else dispatch({ type: 'message/answered', ...q, tags, lines: r.lines, at: Date.now() });
    };

    return {
      setMode: (mode) => dispatch({ type: 'panel/modeChanged', mode }),
      tag: (tag) => dispatch({ type: 'tag/added', tag }),
      untag: (id) => dispatch({ type: 'tag/removed', id }),
      choose: (id) => dispatch({ type: 'subject/chosen', id }),
      send: (text) => {
        const t = text.trim();
        if (!t) return;
        const { tags, subject } = stateRef.current;
        const r = reply(t, tags, journeyOf, subject);
        recordUsage(r);
        respond(r, { text: t });
      },
      ask: (topic) => {
        const { tags, subject } = stateRef.current;
        const r = askTopic(topic, tags, journeyOf, subject);
        recordUsage(r, topic);
        respond(r, { topic });
      },
      recheck: (norawat) => {
        const tagged = stateRef.current.tags.find(
          (t) => t.kind !== 'patient' && t.norawat === norawat,
        );
        evaluate(norawat, {
          topic: 'claim',
          tags: [tagged ?? { id: `enc:${norawat}`, kind: 'encounter', norawat }],
        });
      },
      reset: () => {
        resetAssistantEvents();
        dispatch({ type: 'session/reset' });
      },
    };
  }, []);
  return (
    <AssistantActionsContext.Provider value={actions}>
      <AssistantStateContext.Provider value={state}>{children}</AssistantStateContext.Provider>
    </AssistantActionsContext.Provider>
  );
}

export function useAssistant(): AssistantState {
  const ctx = useContext(AssistantStateContext);
  if (!ctx) throw new Error('useAssistant must be used inside <AssistantProvider>');
  return ctx;
}

export function useAssistantActions(): AssistantActions {
  const ctx = useContext(AssistantActionsContext);
  if (!ctx) throw new Error('useAssistantActions must be used inside <AssistantProvider>');
  return ctx;
}
