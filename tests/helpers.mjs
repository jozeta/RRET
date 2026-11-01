// Minimal in-memory localStorage with an optional quota, for DOM-free tests.
export function installFakeLocalStorage({ quotaChars = Infinity } = {}) {
  const store = new Map();
  const used = () => [...store.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      const s = String(v);
      const prev = store.has(k) ? k.length + store.get(k).length : 0;
      if (used() - prev + k.length + s.length > quotaChars) {
        const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
      }
      store.set(k, s);
    },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    _store: store
  };
  return globalThis.localStorage;
}
