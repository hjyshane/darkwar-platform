// The tab strip above Black Gold, Frankie, Participation and the season boards.
//
// Those are pages of their own, each with its own address, and this strip is
// what makes them one place: the sidebar has a single Events entry, and every
// page behind it carries these tabs so a reader can hop between them without
// going back to the sidebar. Plain links, not state: the address is the tab,
// so back, reload and a pasted link all land where they should.
//
// In edit mode an admin renames, reorders or hides a tab right here (0279).
// That changes what is drawn and nothing else: addresses never move.

import { useState } from 'react';
import { useEditMode } from '../../lib/editMode';
import { EVENTS_HUB_TABS, type NavTab, type Route } from '../../lib/route';
import { FALLBACK_SEASONS, currentSeason, pastSeason, useSeasons } from '../../lib/seasons';
import {
  type Overrides,
  arrange,
  isHidden,
  labelOf,
  labelProblem,
  moveKey,
  useResetScope,
  useSaveOverrides,
  useUiOverrides,
} from '../../lib/uiOverrides';
import { useSession } from '../../lib/useSession';

/** The override scope for this strip's tabs; the key is the tab's route. */
export const EVENTS_SCOPE = 'events-hub';

export interface ShownTab extends NavTab {
  shownLabel: string;
  hidden: boolean;
}

/** The tabs as drawn: arranged, with the admin's names, hidden ones left out
 * unless `showHidden`. Pure so it can be tested and the sidebar can follow it. */
export function eventsTabs(
  tabs: readonly NavTab[],
  defaults: Readonly<Record<string, string | undefined>>,
  o: Overrides,
  showHidden: boolean,
): ShownTab[] {
  return arrange(tabs, (tab) => tab.route, o, EVENTS_SCOPE)
    .map((tab) => ({
      ...tab,
      shownLabel: labelOf(o, EVENTS_SCOPE, tab.route, defaults[tab.hash] ?? tab.label),
      hidden: isHidden(o, EVENTS_SCOPE, tab.route),
    }))
    .filter((tab) => showHidden || !tab.hidden);
}

export function EventsTabs({ route }: { route: Route }) {
  const { data: session } = useSession();
  const seasons = useSeasons();
  const overrides = useUiOverrides();
  const { editing } = useEditMode();
  const save = useSaveOverrides();
  const reset = useResetScope();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const list = seasons.data ?? FALLBACK_SEASONS;
  const now = new Date();
  const isAdmin = session?.role === 'admin';
  const defaults: Record<string, string | undefined> = {
    '#/season': currentSeason(list, now)?.name,
    '#/season2': pastSeason(list, now)?.name,
  };
  const offered = EVENTS_HUB_TABS.filter((tab) => tab.route !== 'season2' || isAdmin);
  const tabs = eventsTabs(offered, defaults, overrides, editing);
  const shown = tabs.filter((tab) => !tab.hidden);
  // `events` is the bare address and shows the first tab.
  const active = route === 'events' ? shown[0]?.route : route;
  const order = tabs.map((tab) => tab.route);

  function move(key: string, direction: -1 | 1) {
    const positions = moveKey(order, key, direction);
    if (positions === null) return;
    save.mutate(
      Object.entries(positions).map(([k, position]) => ({
        scope: EVENTS_SCOPE,
        key: k,
        kind: 'order' as const,
        value: String(position),
      })),
    );
  }

  function commitRename(tab: ShownTab) {
    const message = labelProblem(draft);
    setProblem(message);
    if (message !== null) return;
    const text = draft.trim();
    // Back to the default is clearing, not storing the same text.
    const fallback = defaults[tab.hash] ?? tab.label;
    save.mutate(
      [
        {
          scope: EVENTS_SCOPE,
          key: tab.route,
          kind: 'label' as const,
          value: text === fallback ? null : text,
        },
      ],
      { onSuccess: () => setRenaming(null) },
    );
  }

  function toggleHidden(tab: ShownTab) {
    // Never hide the last tab: the strip would have nothing to open.
    if (!tab.hidden && shown.length <= 1) return;
    save.mutate([
      {
        scope: EVENTS_SCOPE,
        key: tab.route,
        kind: 'hidden' as const,
        value: tab.hidden ? null : 'true',
      },
    ]);
  }

  if (!editing) {
    return (
      <nav aria-label="Events" className="tabs row">
        {shown.map((tab) => (
          <a
            aria-current={tab.route === active ? 'page' : undefined}
            className={`tab ${tab.route === active ? 'tab-active' : ''}`}
            href={tab.hash}
            key={tab.hash}
          >
            {tab.shownLabel}
          </a>
        ))}
      </nav>
    );
  }

  return (
    <div className="edit-strip">
      <nav aria-label="Events (editing)" className="tabs row">
        {tabs.map((tab, index) => (
          <span className={`tab edit-tab ${tab.hidden ? 'muted' : ''}`} key={tab.hash}>
            {renaming === tab.route ? (
              <>
                <input
                  aria-label={`Name for ${tab.shownLabel}`}
                  maxLength={60}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename(tab);
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                  value={draft}
                />
                <button onClick={() => commitRename(tab)} type="button">
                  Save
                </button>
                <button onClick={() => setRenaming(null)} type="button">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <a href={tab.hash}>{tab.shownLabel}</a>
                <button
                  aria-label={`Rename ${tab.shownLabel}`}
                  onClick={() => {
                    setRenaming(tab.route);
                    setDraft(tab.shownLabel);
                    setProblem(null);
                  }}
                  title="Rename"
                  type="button"
                >
                  ✎
                </button>
                <button
                  aria-label={`Move ${tab.shownLabel} left`}
                  disabled={index === 0 || save.isPending}
                  onClick={() => move(tab.route, -1)}
                  title="Move left"
                  type="button"
                >
                  ◀
                </button>
                <button
                  aria-label={`Move ${tab.shownLabel} right`}
                  disabled={index === tabs.length - 1 || save.isPending}
                  onClick={() => move(tab.route, 1)}
                  title="Move right"
                  type="button"
                >
                  ▶
                </button>
                <button
                  aria-label={`${tab.hidden ? 'Show' : 'Hide'} ${tab.shownLabel}`}
                  disabled={save.isPending || (!tab.hidden && shown.length <= 1)}
                  onClick={() => toggleHidden(tab)}
                  title={tab.hidden ? 'Show this tab' : 'Hide this tab'}
                  type="button"
                >
                  {tab.hidden ? 'Show' : 'Hide'}
                </button>
              </>
            )}
          </span>
        ))}
        <button
          disabled={reset.isPending}
          onClick={() => reset.mutate({ scope: EVENTS_SCOPE, keys: order })}
          type="button"
        >
          Reset to default
        </button>
      </nav>
      {problem !== null && <p className="error">{problem}</p>}
      {(save.error ?? reset.error) && (
        <p className="error">Could not save: {(save.error ?? reset.error)?.message}</p>
      )}
      <p className="note">
        Edit mode: names, order and visibility are saved for everyone. Addresses do not change.
      </p>
    </div>
  );
}
