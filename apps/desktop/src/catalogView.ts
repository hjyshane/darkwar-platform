// Command catalog screen: every command the journal has seen, in either
// direction — how often, whether a parser claims it, which screen of a UI
// routine is expected to produce it, and what the capture-sweep runbook
// concluded. Plain DOM, textContent only (see rosterView.ts for why): shapes
// and verdict text come from the journal and a document, not from us.
//
// LOCAL ONLY. Request payloads are masked before they are stored, but the
// screen reads this machine's journal and nothing here is sent anywhere.
import { invoke } from '@tauri-apps/api/core';

export interface CatalogEntry {
  command: string;
  responses: number;
  lastSeen: string | null;
  requests: number;
  paired: number;
  parser: boolean;
  tables: string[];
  screens: string[];
  verdictStatus: string | null;
  verdict: string | null;
  note: string | null;
  responseShape: unknown;
  requestShape: unknown;
}

export interface CatalogResponse {
  commands: CatalogEntry[];
}

export interface CatalogView {
  readonly el: HTMLElement;
  load: () => Promise<void>;
}

export function matches(entry: CatalogEntry, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (q === '') {
    return true;
  }
  return [entry.command, entry.verdictStatus ?? '', ...entry.screens, ...entry.tables].some(
    (field) => field.toLowerCase().includes(q),
  );
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function shapeCell(label: string, shape: unknown): HTMLElement {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.appendChild(summary);
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(shape, null, 2);
  details.appendChild(pre);
  return details;
}

export function renderCatalog(entries: CatalogEntry[], needle = ''): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'catalog-table';
  const head = document.createElement('tr');
  for (const label of [
    'Command',
    'Responses',
    'Requests',
    'Paired',
    'Parser',
    'Screens',
    'Verdict',
    'Shapes',
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    head.appendChild(th);
  }
  const thead = document.createElement('thead');
  thead.appendChild(head);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const entry of entries.filter((e) => matches(e, needle))) {
    const row = document.createElement('tr');
    row.appendChild(cell(entry.command));
    row.appendChild(cell(entry.responses.toLocaleString('en-US')));
    row.appendChild(cell(entry.requests.toLocaleString('en-US')));
    row.appendChild(cell(entry.requests === 0 ? '—' : String(entry.paired)));
    row.appendChild(cell(entry.parser ? entry.tables.join(', ') || 'yes' : '—'));
    row.appendChild(cell(entry.screens.join('; ')));
    row.appendChild(cell(entry.verdictStatus ?? '—'));
    const shapes = document.createElement('td');
    if (entry.requestShape !== null && entry.requestShape !== undefined) {
      shapes.appendChild(shapeCell('request', entry.requestShape));
    }
    if (entry.responseShape !== null && entry.responseShape !== undefined) {
      shapes.appendChild(shapeCell('response', entry.responseShape));
    }
    row.appendChild(shapes);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

export function createCatalogView(): CatalogView {
  const root = document.createElement('div');
  root.className = 'catalog-view';
  const statusEl = document.createElement('p');
  const filterEl = document.createElement('input');
  filterEl.placeholder = 'command, screen, table or verdict';
  const bodyEl = document.createElement('div');
  root.append(statusEl, filterEl, bodyEl);

  let entries: CatalogEntry[] = [];
  const draw = (): void => {
    while (bodyEl.firstChild !== null) {
      bodyEl.removeChild(bodyEl.firstChild);
    }
    bodyEl.appendChild(renderCatalog(entries, filterEl.value));
  };
  filterEl.addEventListener('input', draw);

  async function load(): Promise<void> {
    statusEl.textContent = 'reading…';
    try {
      const response = await invoke<CatalogResponse>('get_catalog');
      entries = response.commands;
      statusEl.textContent = `${entries.length} commands`;
      draw();
    } catch (error) {
      statusEl.textContent = String(error);
    }
  }

  return { el: root, load };
}
