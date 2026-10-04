// Rename a pack (0225): officers and admins only. The name is saved under
// the offer's key (0227) — name key, price, rubies and contents — so every id
// and reissue of that offer reads the same, and another pack that only shares
// its name does not; an empty name puts the game's back.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type PackGroup, savePackName } from './data';

export function PackRename({ pack }: { pack: PackGroup }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (name: string) => savePackName(pack.rename_keys, name),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['shop-packs'] });
    },
  });

  if (draft === null) {
    return (
      <button
        aria-label={`Rename ${pack.name}`}
        className="link-button muted pack-rename-button"
        onClick={() => setDraft(pack.renamed ? pack.name : '')}
        title={pack.renamed ? `Game name: ${pack.game_name}` : 'Rename this pack'}
        type="button"
      >
        rename
      </button>
    );
  }
  return (
    <form
      className="pack-rename"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <input
        aria-label={`New name for ${pack.game_name}`}
        // biome-ignore lint/a11y/noAutofocus: the field the reader just asked for
        autoFocus
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={pack.game_name}
        value={draft}
      />
      <button disabled={save.isPending} type="submit">
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
      <button disabled={save.isPending} onClick={() => setDraft(null)} type="button">
        Cancel
      </button>
      <span className="muted"> empty = the game's name</span>
      {save.error && <span className="error"> {save.error.message}</span>}
    </form>
  );
}
