import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Small in-memory data cache for the repository functions in `src/api` (replaces TanStack Query; CLAUDE.md §2/§5).
 * PHI rules: memory only, never persisted, entries are dropped 5 min after the last subscriber leaves, and `clear()` is called
 * on sign-out / idle lock (`useEndSession`). No retries: a failure is shown with a Retry button instead.
 * Fetchers run outside React render and outside reducers.
 */
export type ResourceKey = readonly unknown[];
export type ResourceStatus = 'pending' | 'success' | 'error';

interface Entry<T = unknown> {
  status: ResourceStatus;
  data: T | undefined;
  error: unknown;
  fetching: boolean;
  updatedAt: number;
}

const STALE_MS = 30_000;
const GC_MS = 5 * 60_000;
const EMPTY: Entry = {
  status: 'pending',
  data: undefined,
  error: null,
  fetching: false,
  updatedAt: 0,
};

export function hashKey(key: ResourceKey): string {
  return JSON.stringify(key);
}

class ResourceCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<void>>();
  private listeners = new Map<string, Set<() => void>>();
  private gcTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Bumped by `clear()`: a request that started before a sign-out can never write into the next session. */
  private generation = 0;

  get<T>(hash: string): Entry<T> {
    return (this.entries.get(hash) as Entry<T> | undefined) ?? (EMPTY as Entry<T>);
  }

  getData<T>(key: ResourceKey): T | undefined {
    return this.get<T>(hashKey(key)).data;
  }

  set<T>(hash: string, patch: Partial<Entry<T>>): void {
    this.entries.set(hash, { ...this.get<T>(hash), ...patch } as Entry);
    this.listeners.get(hash)?.forEach((l) => l());
  }

  subscribe(hash: string, listener: () => void): () => void {
    let set = this.listeners.get(hash);
    if (!set) {
      set = new Set();
      this.listeners.set(hash, set);
    }
    set.add(listener);
    const timer = this.gcTimers.get(hash);
    if (timer) clearTimeout(timer);
    this.gcTimers.delete(hash);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(hash);
        this.gcTimers.set(
          hash,
          setTimeout(() => {
            this.entries.delete(hash);
            this.gcTimers.delete(hash);
          }, GC_MS),
        );
      }
    };
  }

  isStale(hash: string): boolean {
    const e = this.entries.get(hash);
    return !e || e.status !== 'success' || Date.now() - e.updatedAt > STALE_MS;
  }

  /** Runs `fetcher` once per key at a time; concurrent callers share the request. */
  fetch<T>(key: ResourceKey, fetcher: () => Promise<T>): Promise<void> {
    const hash = hashKey(key);
    const running = this.inflight.get(hash);
    if (running) return running;
    const gen = this.generation;
    this.set<T>(hash, { fetching: true });
    const p = fetcher()
      .then(
        (data) => {
          if (gen !== this.generation) return;
          this.set<T>(hash, {
            status: 'success',
            data,
            error: null,
            fetching: false,
            updatedAt: Date.now(),
          });
        },
        (error: unknown) => {
          if (gen !== this.generation) return;
          this.set<T>(hash, { status: 'error', error, fetching: false });
        },
      )
      .finally(() => {
        if (this.inflight.get(hash) === p) this.inflight.delete(hash);
      });
    this.inflight.set(hash, p);
    return p;
  }

  /** Loads into the cache without subscribing (e.g. the assistant warming an encounter it was asked about). */
  prefetch<T>(key: ResourceKey, fetcher: () => Promise<T>): Promise<void> {
    return this.isStale(hashKey(key)) ? this.fetch(key, fetcher) : Promise.resolve();
  }

  /** Sign-out / idle lock: wipes every entry (PHI) and notifies mounted readers. */
  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.inflight.clear();
    this.gcTimers.forEach((t) => clearTimeout(t));
    this.gcTimers.clear();
    this.listeners.forEach((set) => set.forEach((l) => l()));
  }
}

export const resourceCache = new ResourceCache();

export interface ResourceResult<T> {
  data: T | undefined;
  error: unknown;
  status: ResourceStatus;
  /** No data yet (also true while disabled). */
  isPending: boolean;
  /** First load in progress. */
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  /** `keepPrevious`: the rows on screen belong to the previous key while the new one loads. */
  isPlaceholderData: boolean;
  refetch: () => Promise<void>;
}

export interface ResourceOptions {
  enabled?: boolean;
  /** Keep the last successful data on screen while a new key loads (search-as-you-type never flashes empty). */
  keepPrevious?: boolean;
}

function useEntry<T>(hash: string): Entry<T> {
  const subscribe = useCallback((l: () => void) => resourceCache.subscribe(hash, l), [hash]);
  const snapshot = useCallback(() => resourceCache.get<T>(hash), [hash]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Reads `key` from the cache, fetching it when missing or stale. `fetcher` must be stable for a given key. */
export function useResource<T>(
  key: ResourceKey,
  fetcher: () => Promise<T>,
  { enabled = true, keepPrevious = false }: ResourceOptions = {},
): ResourceResult<T> {
  const hash = hashKey(key);
  const entry = useEntry<T>(hash);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!enabled) return;
    if (resourceCache.isStale(hash))
      void resourceCache.fetch(keyRef.current, () => fetcherRef.current());
  }, [hash, enabled]);

  const previous = useRef<T | undefined>(undefined);
  if (entry.status === 'success') previous.current = entry.data;
  const placeholder = keepPrevious && entry.status === 'pending' && previous.current !== undefined;
  const data = placeholder ? previous.current : entry.data;
  const status: ResourceStatus = placeholder ? 'success' : entry.status;

  const refetch = useCallback(
    () => resourceCache.fetch(keyRef.current, () => fetcherRef.current()),
    [],
  );

  return {
    data,
    error: entry.error,
    status,
    isPending: status === 'pending',
    isLoading: status === 'pending' && entry.fetching,
    isFetching: entry.fetching,
    isError: status === 'error',
    isSuccess: status === 'success',
    isPlaceholderData: placeholder,
    refetch,
  };
}

export interface Pages<P> {
  pages: P[];
}

export interface InfiniteResult<P> extends Omit<ResourceResult<Pages<P>>, 'isPlaceholderData'> {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** The last "Load more" failed; the pages already shown stay, and `fetchNextPage` retries. */
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<void>;
}

/** Cursor pagination ("Load more"): pages are appended in memory; cursors are never persisted or put in a URL. */
export function useInfiniteResource<P, C>(
  key: ResourceKey,
  fetchPage: (cursor: C | undefined) => Promise<P>,
  getNextCursor: (last: P) => C | undefined,
  { enabled = true }: { enabled?: boolean } = {},
): InfiniteResult<P> {
  const hash = hashKey(key);
  const entry = useEntry<Pages<P>>(hash);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const nextRef = useRef(getNextCursor);
  nextRef.current = getNextCursor;
  const keyRef = useRef(key);
  keyRef.current = key;
  const moreKey = [...key, '__more'] as const;

  const loadFirst = useCallback(
    () =>
      resourceCache.fetch(
        keyRef.current,
        async (): Promise<Pages<P>> => ({
          pages: [await fetchRef.current(undefined)],
        }),
      ),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    if (resourceCache.isStale(hash)) void loadFirst();
  }, [hash, enabled, loadFirst]);

  const last = entry.data?.pages[entry.data.pages.length - 1];
  const nextCursor = last === undefined ? undefined : nextRef.current(last);
  const more = useEntry<Pages<P>>(hashKey(moreKey));

  const fetchNextPage = useCallback(async () => {
    const current = resourceCache.get<Pages<P>>(hash).data;
    const tail = current?.pages[current.pages.length - 1];
    const cursor = tail === undefined ? undefined : nextRef.current(tail);
    if (!current || cursor === undefined) return;
    await resourceCache.fetch([...keyRef.current, '__more'], async () => {
      const page = await fetchRef.current(cursor);
      const latest = resourceCache.get<Pages<P>>(hash).data ?? current;
      resourceCache.set<Pages<P>>(hash, { data: { pages: [...latest.pages, page] } });
      return latest;
    });
  }, [hash]);

  return {
    data: entry.data,
    error: entry.error,
    status: entry.status,
    isPending: entry.status === 'pending',
    isLoading: entry.status === 'pending' && entry.fetching,
    isFetching: entry.fetching || more.fetching,
    isError: entry.status === 'error',
    isSuccess: entry.status === 'success',
    refetch: loadFirst,
    hasNextPage: nextCursor !== undefined,
    isFetchingNextPage: more.fetching,
    isFetchNextPageError: more.status === 'error' && !more.fetching,
    fetchNextPage,
  };
}
