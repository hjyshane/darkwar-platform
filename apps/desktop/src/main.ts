import { invoke } from '@tauri-apps/api/core';

interface Tile {
  gameUid: string;
  serverId: number;
  name: string | null;
  x: number;
  y: number;
  hqLevel: number | null;
  capturedAt: string;
}

const statusEl = document.querySelector<HTMLParagraphElement>('#status');
const needleEl = document.querySelector<HTMLInputElement>('#needle');
const goEl = document.querySelector<HTMLButtonElement>('#go');
const outEl = document.querySelector<HTMLPreElement>('#out');

function say(target: HTMLElement | null, text: string): void {
  // TEXTCONTENT, NEVER innerHTML. Everything below came out of the journal,
  // and a player's name is chosen by that player — it is somebody else's
  // input arriving on our screen. `csp: null` means there is no second line
  // of defence behind this.
  if (target !== null) {
    target.textContent = text;
  }
}

async function showHealth(): Promise<void> {
  try {
    const state = await invoke<{ ok: boolean; state: string; journal: string }>('health');
    say(
      statusEl,
      state.ok
        ? `reading ${state.journal}`
        : `no journal yet at ${state.journal} — run the collector first`,
    );
  } catch (error) {
    say(statusEl, `could not reach the reader: ${String(error)}`);
  }
}

function line(tile: Tile): string {
  const level = tile.hqLevel === null ? '' : ` · HQ ${tile.hqLevel}`;
  return `${tile.name ?? 'unnamed'} — ${tile.x}, ${tile.y} on ${tile.serverId}${level}\n    uid ${tile.gameUid} · seen ${tile.capturedAt}`;
}

async function search(): Promise<void> {
  const typed = needleEl?.value.trim() ?? '';
  if (typed === '') {
    return;
  }
  say(outEl, 'reading…');
  try {
    const answer = await invoke<{ matches: Tile[] }>('find', { needle: typed });
    say(
      outEl,
      answer.matches.length === 0
        ? `nothing matching ${typed}`
        : answer.matches.map(line).join('\n'),
    );
  } catch (error) {
    say(outEl, String(error));
  }
}

goEl?.addEventListener('click', () => {
  void search();
});
needleEl?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    void search();
  }
});
void showHealth();
