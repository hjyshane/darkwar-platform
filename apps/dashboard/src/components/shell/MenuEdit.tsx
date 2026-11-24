// The sidebar's edit controls, for an admin in edit mode (owner, 2026-11-24):
// rename, move up or down among its neighbours, hide or show again. What they
// save is lib/menuOverrides.ts's business; this only draws the buttons.
// English only, like every admin control (owner, 2026-11-24).

import { useIsMutating } from '@tanstack/react-query';
import { useState } from 'react';
import type { MenuEditRef } from '../../lib/menuOverrides';
import { labelProblem, moveKey, useSaveOverrides } from '../../lib/uiOverrides';

/** Every menu save shares this key: one in flight disables all the controls,
 * so each move is computed from the order the last one left. */
const MENU_SAVE = ['menu-edit'] as const;

function useMenuSave() {
  const save = useSaveOverrides(MENU_SAVE);
  const busy = useIsMutating({ mutationKey: [...MENU_SAVE] }) > 0;
  return { save, busy };
}

export function MenuEditControls({
  edit,
  label,
  hidden,
  siblings,
  canHide = true,
}: {
  edit: MenuEditRef;
  label: string;
  hidden: boolean;
  /** The keys of this entry and its neighbours, in the order drawn. Omitted
   * for something that has no order (a group's caption). */
  siblings?: readonly string[];
  canHide?: boolean;
}) {
  const { save, busy } = useMenuSave();
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const index = siblings?.indexOf(edit.key) ?? -1;

  function move(direction: -1 | 1) {
    if (siblings === undefined) return;
    const positions = moveKey(siblings, edit.key, direction);
    if (positions === null) return;
    save.mutate(
      Object.entries(positions).map(([key, position]) => ({
        scope: edit.scope,
        key,
        kind: 'order' as const,
        value: String(position),
      })),
    );
  }

  function rename() {
    if (draft === null) return;
    const message = labelProblem(draft);
    setProblem(message);
    if (message !== null) return;
    const text = draft.trim();
    save.mutate(
      [
        {
          scope: edit.scope,
          key: edit.key,
          kind: 'label' as const,
          // Back to the default is clearing, not storing the same text.
          value: text === edit.defaultLabel ? null : text,
        },
      ],
      { onSuccess: () => setDraft(null) },
    );
  }

  if (draft !== null) {
    return (
      <span className="menu-edit menu-edit-renaming">
        <input
          aria-label={`Name for ${label}`}
          // biome-ignore lint/a11y/noAutofocus: opened by the admin's own click
          autoFocus
          maxLength={60}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') rename();
            if (event.key === 'Escape') setDraft(null);
          }}
          value={draft}
        />
        <button disabled={busy} onClick={rename} type="button">
          Save
        </button>
        <button onClick={() => setDraft(null)} type="button">
          Cancel
        </button>
        {problem !== null && <span className="error">{problem}</span>}
      </span>
    );
  }

  return (
    <span className="menu-edit">
      <button
        aria-label={`Rename ${label}`}
        onClick={() => {
          setDraft(label);
          setProblem(null);
        }}
        title="Rename"
        type="button"
      >
        ✎
      </button>
      {siblings !== undefined && (
        <>
          <button
            aria-label={`Move ${label} up`}
            disabled={index <= 0 || busy}
            onClick={() => move(-1)}
            title="Move up"
            type="button"
          >
            ↑
          </button>
          <button
            aria-label={`Move ${label} down`}
            disabled={index < 0 || index >= siblings.length - 1 || busy}
            onClick={() => move(1)}
            title="Move down"
            type="button"
          >
            ↓
          </button>
        </>
      )}
      {canHide && (
        <button
          aria-label={`${hidden ? 'Show' : 'Hide'} ${label}`}
          disabled={busy}
          onClick={() =>
            save.mutate([
              {
                scope: edit.scope,
                key: edit.key,
                kind: 'hidden' as const,
                value: hidden ? null : 'true',
              },
            ])
          }
          title={hidden ? 'Show it to everyone again' : 'Hide it from everyone'}
          type="button"
        >
          {hidden ? 'Show' : 'Hide'}
        </button>
      )}
      {save.error && <span className="error">Not saved: {save.error.message}</span>}
    </span>
  );
}

/** The keys of the editable entries in a list, in the order drawn. */
export function editKeys(list: ReadonlyArray<{ edit?: MenuEditRef }>): string[] {
  return list.flatMap((entry) => (entry.edit === undefined ? [] : [entry.edit.key]));
}

/** Put every name, place and hidden entry of the menu back to the code's. */
export function ResetMenuButton({
  stored,
}: {
  stored: ReadonlyArray<{ scope: string; key: string }>;
}) {
  const { save, busy } = useMenuSave();
  if (stored.length === 0) return null;
  return (
    <button
      className="menu-reset"
      disabled={busy}
      onClick={() => {
        if (!window.confirm('Put every menu name, place and hidden entry back to the default?')) {
          return;
        }
        save.mutate(
          (['label', 'order', 'hidden'] as const).flatMap((kind) =>
            stored.map((ref) => ({ scope: ref.scope, key: ref.key, kind, value: null })),
          ),
        );
      }}
      type="button"
    >
      Reset the menu
    </button>
  );
}
