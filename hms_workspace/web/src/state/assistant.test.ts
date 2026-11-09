import { describe, expect, it } from 'vitest';
import { assistantReducer, initialAssistantState, type AssistantState } from './assistant';

const tag = {
  id: 'enc:2026/10/26/000123',
  kind: 'encounter' as const,
  norawat: '2026/10/26/000123',
};

describe('assistantReducer', () => {
  it('adds a tag once and opens the docked panel from closed', () => {
    let s = assistantReducer(initialAssistantState, { type: 'tag/added', tag });
    expect(s.mode).toBe('docked');
    s = assistantReducer(s, { type: 'tag/added', tag });
    expect(s.tags).toEqual([tag]);
  });

  it('keeps a maximized panel maximized when tagging', () => {
    const s = assistantReducer(
      { ...initialAssistantState, mode: 'maximized' },
      { type: 'tag/added', tag },
    );
    expect(s.mode).toBe('maximized');
  });

  it('removes a tag', () => {
    const s = assistantReducer(
      { ...initialAssistantState, tags: [tag] },
      { type: 'tag/removed', id: tag.id },
    );
    expect(s.tags).toEqual([]);
  });

  it('dedupes attachments by name and detaches them', () => {
    const f = { name: 'a.pdf', type: 'application/pdf', size: 10 };
    let s = assistantReducer(initialAssistantState, { type: 'attachment/added', files: [f] });
    s = assistantReducer(s, { type: 'attachment/added', files: [f, { ...f, name: 'b.pdf' }] });
    expect(s.attachments.map((a) => a.name)).toEqual(['a.pdf', 'b.pdf']);
    s = assistantReducer(s, { type: 'attachment/removed', name: 'a.pdf' });
    expect(s.attachments.map((a) => a.name)).toEqual(['b.pdf']);
  });

  it('appends the question and the answer with consecutive ids and the current tags', () => {
    const start: AssistantState = { ...initialAssistantState, tags: [tag] };
    let s = assistantReducer(start, {
      type: 'message/answered',
      text: 'hi',
      lines: [{ raw: 'x' }],
      at: 1000,
    });
    s = assistantReducer(s, { type: 'message/answered', text: 'again', lines: [], at: 2000 });
    expect(s.messages.map((m) => [m.id, m.role, m.at])).toEqual([
      [1, 'user', 1000],
      [2, 'assistant', 1000],
      [3, 'user', 2000],
      [4, 'assistant', 2000],
    ]);
    expect(s.messages[0]?.tags).toEqual([tag]);
    expect(s.seq).toBe(5);
  });

  it('a question checked on the server waits as pending, then gets exactly its own answer', () => {
    let s = assistantReducer(
      { ...initialAssistantState, tags: [tag] },
      { type: 'message/asked', text: 'klaim?', request: 7, at: 1000 },
    );
    expect(s.messages.map((m) => [m.role, m.pending ?? false])).toEqual([
      ['user', false],
      ['assistant', true],
    ]);
    s = assistantReducer(s, {
      type: 'message/resolved',
      request: 8,
      lines: [{ raw: 'x' }],
      at: 2000,
    });
    expect(s.messages[1]?.pending).toBe(true);
    s = assistantReducer(s, {
      type: 'message/resolved',
      request: 7,
      lines: [{ raw: 'y' }],
      at: 2000,
    });
    expect(s.messages[1]).toMatchObject({ pending: false, lines: [{ raw: 'y' }], at: 2000 });
  });

  it('an answer arriving after sign-out changes nothing', () => {
    let s = assistantReducer(initialAssistantState, {
      type: 'message/asked',
      text: 'klaim?',
      request: 1,
      at: 1000,
    });
    s = assistantReducer(s, { type: 'session/reset' });
    s = assistantReducer(s, { type: 'message/resolved', request: 1, lines: [{ raw: 'x' }], at: 2 });
    expect(s).toEqual(initialAssistantState);
  });

  it('reset wipes everything', () => {
    const s = assistantReducer(
      { ...initialAssistantState, mode: 'docked', tags: [tag], seq: 9 },
      { type: 'session/reset' },
    );
    expect(s).toEqual(initialAssistantState);
  });
});
