import '@testing-library/jest-dom/vitest';

// Defensive localStorage stub: if jsdom still doesn't expose localStorage
// (e.g. opaque-origin regression or a future environment change), install an
// in-memory shim so tests that call window.localStorage.clear() don't crash.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => { store.delete(k); },
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
    } satisfies Storage,
  });
}