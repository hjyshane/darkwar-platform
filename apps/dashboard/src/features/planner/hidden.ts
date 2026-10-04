// Rows a reader has hidden in a planner list, per browser. A convenience
// only: a private window or cleared storage simply shows everything again.

import { useState } from 'react';

function load(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function useHidden(key: string): [ReadonlySet<string>, (id: string) => void] {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => load(key));
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    try {
      window.localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // Storage refused (private window): hidden for this visit only.
    }
  };
  return [hidden, toggle];
}
