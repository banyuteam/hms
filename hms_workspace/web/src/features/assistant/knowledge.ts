import type { KnowledgeRelease } from '@/api/assistantKnowledgeApi';
import { normalizeSearchText } from '@/api/patientSearch';

/**
 * Deterministic matching of the general-help release (no language model, no scoring): a message and the release's
 * example messages are normalised (case, accents, punctuation) and compared as whole words.
 *  - strong: the message equals an example, or contains an example of two or more words as a phrase;
 *  - weak:   the message contains a one-word example as a word ("hai", "bye", "bantuan").
 * Several matches: the longest example wins (most specific), then the release order. General help comes first in the
 * precedence (`rules.ts`, catalogue `knowledge`): strong, then weak, before advice refusal and the record topics.
 */
export interface KnowledgeMatch {
  tag: string;
  responses: Readonly<Record<string, string>>;
}

interface Example {
  tag: string;
  phrase: string;
  words: number;
  order: number;
  responses: Readonly<Record<string, string>>;
}

export interface Knowledge {
  strong: (text: string) => KnowledgeMatch | undefined;
  weak: (text: string) => KnowledgeMatch | undefined;
}

/** Normalised message: lower-case words separated by single spaces, other punctuation removed. */
export function normalizeMessage(text: string): string {
  return normalizeSearchText(text)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function best(examples: Example[]): KnowledgeMatch | undefined {
  const [top] = [...examples].sort(
    (a, b) => b.words - a.words || b.phrase.length - a.phrase.length || a.order - b.order,
  );
  return top ? { tag: top.tag, responses: top.responses } : undefined;
}

const compiled = new WeakMap<KnowledgeRelease, Knowledge>();

export function compileKnowledge(release: KnowledgeRelease): Knowledge {
  const cached = compiled.get(release);
  if (cached) return cached;
  const examples: Example[] = [];
  release.intents.forEach((intent, order) => {
    for (const p of intent.patterns) {
      const phrase = normalizeMessage(p);
      if (phrase)
        examples.push({
          tag: intent.tag,
          phrase,
          words: phrase.split(' ').length,
          order,
          responses: intent.responses,
        });
    }
  });
  const contains = (message: string, phrase: string) => ` ${message} `.includes(` ${phrase} `);
  const knowledge: Knowledge = {
    strong: (text) => {
      const m = normalizeMessage(text);
      return m
        ? best(examples.filter((e) => e.phrase === m || (e.words > 1 && contains(m, e.phrase))))
        : undefined;
    },
    weak: (text) => {
      const m = normalizeMessage(text);
      return m ? best(examples.filter((e) => e.words === 1 && contains(m, e.phrase))) : undefined;
    },
  };
  compiled.set(release, knowledge);
  return knowledge;
}
