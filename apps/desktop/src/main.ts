import { type MapMarker, formatCoordinate } from '@dw/ui';
import { invoke } from '@tauri-apps/api/core';
import { createMapView, renderMarkers } from './mapView';
import { ViewRegistry } from './views';

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
const mapRootEl = document.querySelector<HTMLDivElement>('#map-root');

// The map is NOT registered with the view registry below. There is no
// "map" tab — it is nested inside, and always rendered with, the search
// view, exactly as it was before this refactor. Giving it its own registry
// entry would mean either a third tab that does not exist today (out of
// scope — see CLAUDE.md, no new screen in this task) or showing it outside
// of any tab click, which the registry has no hook for. So it stays a
// plain child of #map-root, mounted once at module load, same as before.
if (mapRootEl !== null) {
  mapRootEl.appendChild(createMapView());
}

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
    // The text list stays — it carries the uid and the capture time, which a
    // pin on the map does not. The map is the second, complementary view.
    renderMarkers(answer.matches.map(tileToMarker));
  } catch (error) {
    say(outEl, String(error));
  }
}

function tileToMarker(tile: Tile): MapMarker {
  return {
    at: { x: tile.x, y: tile.y },
    label: tile.name ?? formatCoordinate({ x: tile.x, y: tile.y }),
  };
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

// --- Settings screen -------------------------------------------------
//
// Everything a player can see here came from somewhere that is not us:
// adapter labels came out of `dumpcap -D` (this machine has Korean adapter
// names), dumpcap's stderr came from a process, and the sidecar's own error
// sentences are strings built around whatever the player typed. `csp: null`
// (see `tauri.conf.json`) means there is no second line of defence — every
// one of those has to land on screen through `textContent`, never through
// `innerHTML`/`outerHTML`/`insertAdjacentHTML`/a template string turned into
// markup.

interface SettingsPayload {
  journalPath: string;
  captureDir: string;
  interface: string;
  dumpcapPath: string;
  serverId: number;
  gamePort: number;
  collectorId: string;
  pinnedByEnvironment: string[];
}

interface AdapterEntry {
  device: string;
  label: string;
}

interface AdaptersPayload {
  // "ready" | "no-dumpcap" | "failed" | "no-adapters"
  state: string;
  adapters: AdapterEntry[];
  detail: string;
}

interface CaptureStatusPayload {
  capture: {
    // "stopped" | "running" | "failed"
    state: string;
    pid: number | null;
    returncode: number | null;
    stderr: string;
  };
  ingest: {
    // "idle" | "running" | "stopping" | "stopped" | "died"
    state: string;
    filesSeen: number;
    filesIngested: number;
    rowsWritten: number;
    error: string;
  };
  files: number;
  rows: number;
}

//: The environment variable behind each field the settings screen can pin —
//: shown in the note beside a disabled field so a player knows what to
//: change, not just that they can't.
const ENV_VAR_NAMES: Record<string, string> = {
  journalPath: 'DW_SQLITE_PATH',
  captureDir: 'DW_CAPTURE_DIR',
  interface: 'DW_CAPTURE_NPF_DEVICE',
  serverId: 'DW_COLLECTOR_SERVER_ID',
  gamePort: 'DW_CAPTURE_PORT',
  collectorId: 'DW_COLLECTOR_ID',
};

const tabSearchEl = document.querySelector<HTMLButtonElement>('#tab-search');
const tabSettingsEl = document.querySelector<HTMLButtonElement>('#tab-settings');
const viewSearchEl = document.querySelector<HTMLElement>('#view-search');
const viewSettingsEl = document.querySelector<HTMLElement>('#view-settings');
const settingsRootEl = document.querySelector<HTMLDivElement>('#settings-root');

let statusPollHandle: number | undefined;
let settingsLoadToken = 0;

function clearChildren(el: HTMLElement | null): void {
  if (el === null) {
    return;
  }
  while (el.firstChild !== null) {
    el.removeChild(el.firstChild);
  }
}

function stopStatusPolling(): void {
  if (statusPollHandle !== undefined) {
    window.clearInterval(statusPollHandle);
    statusPollHandle = undefined;
  }
}

// Search and settings are the two tab-switched screens. The settings status
// poll used to be started/stopped by hand in showSettingsView/showSearchView
// — easy to forget once more screens copy this pattern. Now it is settings'
// own onEnter/onExit, so it is impossible to switch away from settings
// without stopping the poll, regardless of which other view is shown next.
const views = new ViewRegistry();

if (viewSearchEl !== null && viewSettingsEl !== null) {
  views.register({ id: 'search', el: viewSearchEl });
  views.register({
    id: 'settings',
    el: viewSettingsEl,
    onEnter: () => {
      void loadSettingsView();
    },
    onExit: stopStatusPolling,
  });
  views.show('search');
}

tabSearchEl?.addEventListener('click', () => views.show('search'));
tabSettingsEl?.addEventListener('click', () => views.show('settings'));

function labeledRow(labelText: string, control: HTMLElement): HTMLDivElement {
  const row = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  row.appendChild(label);
  row.appendChild(document.createElement('br'));
  row.appendChild(control);
  return row;
}

function noteEl(text: string): HTMLParagraphElement {
  const note = document.createElement('p');
  note.textContent = text;
  return note;
}

function pinnedNote(field: string): HTMLParagraphElement {
  const envVar = ENV_VAR_NAMES[field] ?? 'an environment variable';
  return noteEl(`Set by your environment (${envVar}). Change it there, not here.`);
}

function buildAdapterField(
  adapters: AdaptersPayload | null,
  adaptersError: string | null,
  currentInterface: string,
  pinned: boolean,
): HTMLDivElement {
  const select = document.createElement('select');
  select.id = 'settings-interface';

  if (adaptersError !== null) {
    select.disabled = true;
    const row = labeledRow('Capture adapter', select);
    row.appendChild(noteEl(`Could not list adapters: ${adaptersError}`));
    return row;
  }
  if (adapters === null) {
    select.disabled = true;
    return labeledRow('Capture adapter', select);
  }

  if (adapters.state === 'no-dumpcap') {
    select.disabled = true;
    const row = labeledRow('Capture adapter', select);
    row.appendChild(
      noteEl(
        'Npcap is not installed, so dumpcap cannot see any adapters. Install Npcap ' +
          '(it ships with Wireshark, https://npcap.com) and reopen this screen.',
      ),
    );
    return row;
  }
  if (adapters.state === 'failed') {
    select.disabled = true;
    const row = labeledRow('Capture adapter', select);
    row.appendChild(noteEl(`dumpcap could not list adapters: ${adapters.detail}`));
    return row;
  }
  if (adapters.state === 'no-adapters') {
    select.disabled = true;
    const row = labeledRow('Capture adapter', select);
    row.appendChild(noteEl('dumpcap did not report any capture adapters on this machine.'));
    return row;
  }

  // "ready" — a real dropdown, never a free-text field. A hand-typed
  // \Device\NPF_{GUID} is the single most likely thing to be wrong, and a
  // wrong adapter captures nothing while looking completely healthy.
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— choose an adapter —';
  select.appendChild(blank);
  for (const adapter of adapters.adapters) {
    const option = document.createElement('option');
    option.value = adapter.device;
    option.textContent = adapter.label;
    select.appendChild(option);
  }
  select.value = currentInterface;
  select.disabled = pinned;
  const row = labeledRow('Capture adapter', select);
  if (pinned) {
    row.appendChild(pinnedNote('interface'));
  }
  return row;
}

function buildTextField(
  elementId: string,
  labelText: string,
  value: string,
  field: string,
  pinned: boolean,
): HTMLDivElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.id = elementId;
  input.value = value;
  input.disabled = pinned;
  const row = labeledRow(labelText, input);
  if (pinned) {
    row.appendChild(pinnedNote(field));
  }
  return row;
}

function buildCollectorIdField(value: string, pinned: boolean): HTMLDivElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'settings-collector-id';
  input.value = value;
  input.readOnly = true;
  input.disabled = true;
  const row = labeledRow('Collector id', input);
  row.appendChild(noteEl('Identifies this install. Not editable here.'));
  if (pinned) {
    row.appendChild(pinnedNote('collectorId'));
  }
  return row;
}

function captureSummaryText(status: CaptureStatusPayload): string {
  return (
    `dumpcap: ${status.capture.state} · files: ${status.files} · rows: ${status.rows}` +
    ` · ingest: ${status.ingest.state}`
  );
}

/// Renders the whole settings screen from scratch. Called on first entering
/// the view and after every save, so the fields shown always match what the
/// sidecar actually holds (including what the environment overrode).
async function loadSettingsView(): Promise<void> {
  const token = ++settingsLoadToken;
  clearChildren(settingsRootEl);
  if (settingsRootEl === null) {
    return;
  }

  const loadingNote = noteEl('Loading settings…');
  settingsRootEl.appendChild(loadingNote);

  let settings: SettingsPayload | null = null;
  let settingsError: string | null = null;
  try {
    settings = await invoke<SettingsPayload>('get_settings');
  } catch (error) {
    settingsError = String(error);
  }

  let adapters: AdaptersPayload | null = null;
  let adaptersError: string | null = null;
  try {
    adapters = await invoke<AdaptersPayload>('get_adapters');
  } catch (error) {
    adaptersError = String(error);
  }

  // Another load started (the player switched away and back) while these
  // two requests were in flight — let that newer call own the screen.
  if (token !== settingsLoadToken) {
    return;
  }

  clearChildren(settingsRootEl);

  if (settings === null) {
    settingsRootEl.appendChild(
      noteEl(`Could not read settings: ${settingsError ?? 'unknown error'}`),
    );
    return;
  }

  const pinned = new Set(settings.pinnedByEnvironment);
  const form = document.createElement('div');

  form.appendChild(
    buildAdapterField(adapters, adaptersError, settings.interface, pinned.has('interface')),
  );
  form.appendChild(
    buildTextField(
      'settings-capture-dir',
      'Capture directory',
      settings.captureDir,
      'captureDir',
      pinned.has('captureDir'),
    ),
  );
  form.appendChild(
    buildTextField(
      'settings-journal-path',
      'Journal path',
      settings.journalPath,
      'journalPath',
      pinned.has('journalPath'),
    ),
  );
  form.appendChild(
    buildTextField(
      'settings-server-id',
      'Server id',
      String(settings.serverId),
      'serverId',
      pinned.has('serverId'),
    ),
  );
  form.appendChild(buildCollectorIdField(settings.collectorId, pinned.has('collectorId')));

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = 'Save settings';
  const saveStatusEl = document.createElement('p');
  saveButton.addEventListener('click', () => {
    void saveSettings(saveStatusEl);
  });
  form.appendChild(saveButton);
  form.appendChild(saveStatusEl);

  settingsRootEl.appendChild(form);

  // --- Capture controls ---
  const captureHeading = document.createElement('h2');
  captureHeading.textContent = 'Capture';
  settingsRootEl.appendChild(captureHeading);

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.textContent = 'Start';
  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.textContent = 'Stop';
  const captureControls = document.createElement('div');
  captureControls.appendChild(startButton);
  captureControls.appendChild(stopButton);
  settingsRootEl.appendChild(captureControls);

  const captureErrorEl = document.createElement('p');
  settingsRootEl.appendChild(captureErrorEl);

  const captureSummaryEl = document.createElement('p');
  settingsRootEl.appendChild(captureSummaryEl);
  const captureStderrEl = document.createElement('pre');
  settingsRootEl.appendChild(captureStderrEl);
  const ingestErrorEl = document.createElement('pre');
  settingsRootEl.appendChild(ingestErrorEl);

  startButton.addEventListener('click', () => {
    void (async () => {
      say(captureErrorEl, '');
      try {
        await invoke('capture_start');
      } catch (error) {
        say(captureErrorEl, String(error));
      }
      await refreshCaptureStatus(captureSummaryEl, captureStderrEl, ingestErrorEl);
    })();
  });
  stopButton.addEventListener('click', () => {
    void (async () => {
      say(captureErrorEl, '');
      try {
        await invoke('capture_stop');
      } catch (error) {
        say(captureErrorEl, String(error));
      }
      await refreshCaptureStatus(captureSummaryEl, captureStderrEl, ingestErrorEl);
    })();
  });

  await refreshCaptureStatus(captureSummaryEl, captureStderrEl, ingestErrorEl);

  // Poll while this view is open so files/rows climb visibly. Stopped by
  // the settings view's onExit (see ViewRegistry, above) when the player
  // switches away. Also stopped-and-restarted here, since a save
  // re-invokes loadSettingsView while settings is still the active view —
  // show() only runs onExit when actually leaving the view.
  stopStatusPolling();
  statusPollHandle = window.setInterval(() => {
    void refreshCaptureStatus(captureSummaryEl, captureStderrEl, ingestErrorEl);
  }, 1500);
}

async function refreshCaptureStatus(
  summaryEl: HTMLElement,
  stderrEl: HTMLElement,
  ingestErrorEl: HTMLElement,
): Promise<void> {
  try {
    const status = await invoke<CaptureStatusPayload>('capture_status');
    say(summaryEl, captureSummaryText(status));
    say(
      stderrEl,
      status.capture.state === 'failed' && status.capture.stderr !== ''
        ? `dumpcap said:\n${status.capture.stderr}`
        : '',
    );
    say(
      ingestErrorEl,
      status.ingest.state === 'died' && status.ingest.error !== ''
        ? `ingest stopped: ${status.ingest.error}`
        : '',
    );
  } catch (error) {
    say(summaryEl, `could not read capture status: ${String(error)}`);
  }
}

async function saveSettings(saveStatusEl: HTMLElement): Promise<void> {
  const interfaceEl = document.querySelector<HTMLSelectElement>('#settings-interface');
  const captureDirEl = document.querySelector<HTMLInputElement>('#settings-capture-dir');
  const journalPathEl = document.querySelector<HTMLInputElement>('#settings-journal-path');
  const serverIdEl = document.querySelector<HTMLInputElement>('#settings-server-id');

  const parsedServerId = serverIdEl !== null ? Number.parseInt(serverIdEl.value, 10) : Number.NaN;

  const payload: Record<string, string | number> = {};
  if (interfaceEl !== null && !interfaceEl.disabled) {
    payload.interface = interfaceEl.value;
  }
  if (captureDirEl !== null && !captureDirEl.disabled) {
    payload.captureDir = captureDirEl.value;
  }
  if (journalPathEl !== null && !journalPathEl.disabled) {
    payload.journalPath = journalPathEl.value;
  }
  if (serverIdEl !== null && !serverIdEl.disabled && Number.isFinite(parsedServerId)) {
    payload.serverId = parsedServerId;
  }

  say(saveStatusEl, 'saving…');
  try {
    await invoke('save_settings', { settings: payload });
    say(saveStatusEl, 'saved');
  } catch (error) {
    say(saveStatusEl, String(error));
    return;
  }
  await loadSettingsView();
}
