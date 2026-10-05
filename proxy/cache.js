/** A TTL store whose expiry is advisory: stale values are still returned. */
export function makeCache(ttlMs, clock = () => Date.now()) {
  const store = new Map();
  return {
    get(key) { return store.get(key)?.value; },
    set(key, value) { store.set(key, { value, at: clock() }); },
    /** Force the next read to miss — used when a match ends and the
        operator's own history is known to have just changed. */
    drop(key) { store.delete(key); },
    stale(key) {
      const hit = store.get(key);
      return !hit || clock() - hit.at > ttlMs;
    }
  };
}
