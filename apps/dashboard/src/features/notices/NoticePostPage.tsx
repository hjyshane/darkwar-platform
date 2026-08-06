import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';
import { BoardPostPage } from '../board/BoardPost';
import { NOTICES } from '../board/board';
import {
  type NoticeDraft,
  NoticeEditor,
  toLocal,
  useSaveNotice,
  visibilityLabel,
} from './NoticesPanel';

/** One notice, at its own address. Reading is the shared `BoardPostPage`; what
 * is added is editing and removal, which are admin-only (RLS on
 * `announcements`, not this file). */
export function NoticePostPage({ noticeId }: { noticeId: string }) {
  const { data: session } = useSession();
  const isAdmin = session?.role === 'admin';
  const [draft, setDraft] = useState<NoticeDraft | null>(null);
  const save = useSaveNotice(() => setDraft(null));
  const queryClient = useQueryClient();

  const editable = useQuery({
    queryKey: ['notice-editable', noticeId],
    enabled: isAdmin,
    queryFn: async (): Promise<NoticeDraft | null> => {
      const { data, error } = await supabase
        .from('announcements')
        .select('announcement_id, title, body, starts_at, ends_at, pinned, visibility')
        .eq('announcement_id', noticeId)
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      if (data === null) {
        return null;
      }
      return {
        announcement_id: data.announcement_id,
        title: data.title,
        body: data.body,
        starts_at: toLocal(data.starts_at),
        ends_at: toLocal(data.ends_at),
        pinned: data.pinned,
        visibility: data.visibility === 'public' ? 'public' : 'member',
      };
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error, count } = await supabase
        .from('announcements')
        .delete({ count: 'exact' })
        .eq('announcement_id', noticeId);
      if (error) {
        throw new Error(error.message);
      }
      // A refused delete does not raise — RLS filters the rows the statement can
      // see, so a non-admin removes nothing and is told it worked.
      if (count === 0) {
        throw new Error('Nothing was removed. That needs an admin.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board', 'announcements'] });
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      window.location.hash = '#/notices';
    },
  });

  return (
    <BoardPostPage
      backHref="#/notices"
      backLabel="All notices"
      config={NOTICES}
      postId={noticeId}
      tagLabel={visibilityLabel}
    >
      {draft !== null ? (
        <NoticeEditor
          draft={draft}
          onCancel={() => setDraft(null)}
          onChange={setDraft}
          onSave={() => save.mutate(draft)}
          saving={save.isPending}
        />
      ) : (
        isAdmin && (
          <p className="row">
            {/* Disabled until the draft arrives rather than absent until then —
                same reason as the guide page. */}
            <button
              disabled={editable.data == null}
              onClick={() => editable.data != null && setDraft(editable.data)}
              type="button"
            >
              Edit
            </button>
            <button
              className="linklike"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              type="button"
            >
              delete
            </button>
          </p>
        )
      )}
      {save.error && <p className="error">{save.error.message}</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </BoardPostPage>
  );
}
