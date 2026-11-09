import { createContext, useContext, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { emrKeys } from '@/api/hooks';
import type { EncounterJourney } from '@/api/journey';
import { claimApi, claimErrorKind, claimKey, type ClaimEvaluation } from '@/api/claimApi';
import {
  claimErrorLines,
  claimLines,
  reply,
  type AssistantTag,
  type ReplyLine,
} from '@/features/assistant/rules';
import { hashKey, resourceCache } from '@/lib/resource';

export type PanelMode = 'closed' | 'docked' | 'maximized';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  /** User text is kept as typed; assistant text is i18n lines. */
  text?: string;
  lines?: ReplyLine[];
  tags: AssistantTag[];
  /** When it was sent or answered (epoch ms), shown as HH:mm. */
  at: number;
  /** An answer still being checked on the server; `request` matches it to its result. */
  pending?: boolean;
  request?: number;
}

/** Attachment metadata only — files are NOT read or uploaded (no backend for the assistant yet). */
export interface Attachment {
  name: string;
  type: string;
  size: number;
}

/** In memory only; wiped by `useEndSession` with every other session state (no PHI in storage). */
export interface AssistantState {
  mode: PanelMode;
  tags: AssistantTag[];
  attachments: Attachment[];
  messages: ChatMessage[];
  seq: number;
}

export type AssistantAction =
  | { type: 'panel/modeChanged'; mode: PanelMode }
  | { type: 'tag/added'; tag: AssistantTag }
  | { type: 'tag/removed'; id: string }
  | { type: 'attachment/added'; files: Attachment[] }
  | { type: 'attachment/removed'; name: string }
  | { type: 'message/answered'; text: string; lines: ReplyLine[]; at: number }
  | { type: 'message/asked'; text: string; request: number; at: number }
  | { type: 'message/resolved'; request: number; lines: ReplyLine[]; at: number }
  | { type: 'session/reset' };

export const initialAssistantState: AssistantState = {
  mode: 'closed',
  tags: [],
  attachments: [],
  messages: [],
  seq: 1,
};

export function assistantReducer(s: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case 'panel/modeChanged':
      return { ...s, mode: action.mode };
    case 'tag/added':
      // "Ask AI" from any window: adds the tag (deduplicated) and opens the docked panel.
      return {
        ...s,
        tags: s.tags.some((t) => t.id === action.tag.id) ? s.tags : [...s.tags, action.tag],
        mode: s.mode === 'closed' ? 'docked' : s.mode,
      };
    case 'tag/removed':
      return { ...s, tags: s.tags.filter((t) => t.id !== action.id) };
    case 'attachment/added':
      return {
        ...s,
        attachments: [
          ...s.attachments,
          ...action.files.filter((f) => !s.attachments.some((a) => a.name === f.name)),
        ],
      };
    case 'attachment/removed':
      return { ...s, attachments: s.attachments.filter((a) => a.name !== action.name) };
    case 'message/answered':
      return {
        ...s,
        messages: [
          ...s.messages,
          { id: s.seq, role: 'user', text: action.text, tags: s.tags, at: action.at },
          { id: s.seq + 1, role: 'assistant', lines: action.lines, tags: s.tags, at: action.at },
        ],
        seq: s.seq + 2,
      };
    case 'message/asked':
      return {
        ...s,
        messages: [
          ...s.messages,
          { id: s.seq, role: 'user', text: action.text, tags: s.tags, at: action.at },
          {
            id: s.seq + 1,
            role: 'assistant',
            tags: s.tags,
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
  attach: (files: Attachment[]) => void;
  detach: (name: string) => void;
  /**
   * Answers from the tagged records already loaded in the cache; a claim question is evaluated by hms_services instead
   * (the answer shows as pending until the result arrives).
   */
  send: (text: string) => void;
  reset: () => void;
}

const AssistantStateContext = createContext<AssistantState | null>(null);
const AssistantActionsContext = createContext<AssistantActions | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(assistantReducer, initialAssistantState);
  // The reply needs the current tags; the actions object stays stable, so it reads them through a ref.
  const tagsRef = useRef(state.tags);
  tagsRef.current = state.tags;
  // Never reset (not even on sign-out), so a late result can only ever match its own question.
  const requestRef = useRef(0);
  const actions = useMemo<AssistantActions>(
    () => ({
      setMode: (mode) => dispatch({ type: 'panel/modeChanged', mode }),
      tag: (tag) => dispatch({ type: 'tag/added', tag }),
      untag: (id) => dispatch({ type: 'tag/removed', id }),
      attach: (files) => dispatch({ type: 'attachment/added', files }),
      detach: (name) => dispatch({ type: 'attachment/removed', name }),
      send: (text) => {
        const t = text.trim();
        if (!t) return;
        const r = reply(t, tagsRef.current, (norawat) =>
          resourceCache.getData<EncounterJourney>(emrKeys.journey(norawat)),
        );
        const norawat = r.evaluate;
        if (!norawat) {
          dispatch({ type: 'message/answered', text: t, lines: r.lines, at: Date.now() });
          return;
        }
        const request = (requestRef.current += 1);
        dispatch({ type: 'message/asked', text: t, request, at: Date.now() });
        // Through the data cache: an open Records window showing the same visit gets the same result.
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
      },
      reset: () => dispatch({ type: 'session/reset' }),
    }),
    [],
  );
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
