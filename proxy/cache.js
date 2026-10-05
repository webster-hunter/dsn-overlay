/** A TTL store whose expiry is advisory: stale values are still returned. */
export function makeCache(ttlMs, clock = () => Date.now()) {
  const store = new Map();
  return {
    get(key) { return store.get(key)?.value; },
    set(key, value) { store.set(key, { value, at: clock() }); },
    stale(key) {
      const hit = store.get(key);
      return !hit || clock() - hit.at > ttlMs;
    }
  };
}
