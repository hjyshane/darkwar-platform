import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { guideHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';
import { BoardPostPage } from '../board/BoardPost';
import { GUIDES } from '../board/board';
import { type Draft, GuideEditor, categoryLabel, useSaveGuide } from './GuidesPanel';

/** One guide, at its own address.
 *
 * The reading is `BoardPostPage`, shared with notices. What is added here is the
 * editing, because which capability lets you edit differs between the boards:
 * a guide is `guide.edit` (officers have it), a notice is admin-only.
 */
export function GuidePostPage({ guideId }: { guideId: string }) {
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayEdit = isAllowed(permissions?.grants, session?.role, 'guide.edit');
  const mayDelete = isAllowed(permissions?.grants, session?.role, 'guide.delete');
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useSaveGuide(() => setDraft(null));
  const queryClient = useQueryClient();

  // Loaded again rather than passed down: arriving by a pasted link means there
  // is no list in front of this page to have loaded it. React Query dedupes the
  // two when there is.
  const editable = useQuery({
    queryKey: ['guide-editable', guideId],
    enabled: mayEdit,
    queryFn: async (): Promise<Draft | null> => {
      const { data, error } = await supabase
        .from('guides')
        .select('guide_id, title, body, category, pinned, published_at')
        .eq('guide_id', guideId)
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      if (data === null) {
        return null;
      }
      return {
        guide_id: data.guide_id,
        title: data.title,
        body: data.body,
        category: data.category ?? 'tip',
        pinned: data.pinned,
        publish: data.published_at !== null,
        published_at: data.published_at,
      };
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error, count } = await supabase
        .from('guides')
        .delete({ count: 'exact' })
        .eq('guide_id', guideId);
      if (error) {
        throw new Error(error.message);
      }
      // RLS filters rather than refusing, so a delete that removed nothing
      // reports success. The count is the only way to tell it apart.
      if (count === 0) {
        throw new Error('Nothing was removed. That needs the delete capability.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board', 'guides'] });
      window.location.hash = '#/guides';
    },
  });

  return (
    <BoardPostPage
      backHref="#/guides"
      backLabel="All guides"
      config={GUIDES}
      postId={guideId}
      hrefFor={guideHash}
      tagLabel={categoryLabel}
    >
      {draft !== null ? (
        <GuideEditor
          draft={draft}
          onCancel={() => setDraft(null)}
          onChange={setDraft}
          onSave={() => save.mutate(draft)}
          saving={save.isPending}
        />
      ) : (
        (mayEdit || mayDelete) && (
          <p className="row">
            {/* Rendered from the start and disabled until the draft arrives,
                rather than appearing when it does. A page that shows "delete"
                and grows an Edit button a beat later reads as having loaded
                wrong. */}
            {mayEdit && (
              <button
                disabled={editable.data == null}
                onClick={() => editable.data != null && setDraft(editable.data)}
                type="button"
              >
                Edit
              </button>
            )}
            {mayDelete && (
              <button
                className="linklike"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
                type="button"
              >
                delete
              </button>
            )}
          </p>
        )
      )}
      {save.error && <p className="error">{save.error.message}</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </BoardPostPage>
  );
}
