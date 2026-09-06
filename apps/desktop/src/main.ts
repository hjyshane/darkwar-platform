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

async function waitForReader(): Promise<void> {
  // The window is up before the reader is, now, so it has to say which.
  // "starting" and "never going to start" look identical if we say nothing.
  //
  // AND IT NEVER STOPS ASKING. A first run unpacks a PyInstaller bundle with
  // antivirus reading every byte of it, which can take far longer than feels
  // reasonable. A loop that gave up after ten seconds would leave the reader
  // running and answering while the window claimed it had not started —
  // recoverable only by quitting and reopening, for the one case where the
  // user has done nothing wrong.
  let attempt = 0;
  for (;;) {
    try {
      const state = await invoke<{ state: string; message?: string }>('status');
      if (state.state === 'ready') {
        await showHealth();
        return;
      }
      if (state.state === 'failed') {
        say(statusEl, state.message ?? 'the reader did not start');
        return;
      }
    } catch (error) {
      say(statusEl, `could not ask about the reader: ${String(error)}`);
      return;
    }
    // Ten seconds of asking often, then keep asking quietly.
    const slow = attempt >= 100;
    say(
      statusEl,
      slow
        ? 'still starting the reader — the first run is slow while antivirus reads it'
        : 'starting the reader…',
    );
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, slow ? 1000 : 100));
  }
}

void waitForReader();
