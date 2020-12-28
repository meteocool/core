import { writable, derived, get } from 'svelte/store';

function createMapStore(initial) {
  const store = writable(initial);
  const set = (key, value) => store.update((m) => ({ ...m, [key]: value }));
  const results = derived(store, (s) => ({
    keys: Object.keys(s),
    values: Object.values(s),
    entries: Object.entries(s),
    set(k, v) {
      store.update((s) => ({ ...s, [k]: v }));
    },
    remove(k) {
      store.update((s) => {
        delete s[k];
        return s;
      });
    },
  }));
  return {
    subscribe: results.subscribe,
    set: store.set,
  };
}

export const uiState = createMapStore({
  nowcastPlayback: false,
});
