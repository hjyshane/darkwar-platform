import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { useSession } from '../../lib/useSession';
import { GuideForm } from '../eventGuide/editor/GuideForm';
import { SectionList } from '../eventGuide/editor/SectionList';
import {
  EMPTY_CATALOGUE,
  GUIDES_KEY,
  clearScoreItem,
  deleteGuide,
  deleteSection,
  saveGuide,
  saveScoreItem,
  saveSection,
  useBoardPosts,
  useGuideSections,
  useGuides,
  useRefCatalogue,
  useScoreItems,
} from '../eventGuide/guideData';
import { refsIn } from '../eventGuide/guides';
import { parseSections } from '../eventGuide/sections/index';
import '../eventGuide/guides.css';

/** Event guides (0310): the content the game's tables do not hold.
 *
 * Shared by every alliance, like the catalogue — a guide is a fact about the
 * game. What an officer writes here is a section with `source = officer`; the
 * importer's sections are shown read-only with an item column that writes the
 * score-to-item map, which every later event that reuses a score id inherits.
 * Who may do what is the 0078 guide.* grid; the database refuses the rest and
 * this screen reports what it answered. */
export function EventGuidesSetting() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const canDelete = isAllowed(permissions?.grants, session?.role, 'guide.delete');

  const guides = useGuides();
  const posts = useBoardPosts();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const guide = guides.data?.find((row) => row.guide_id === selected) ?? null;

  const sectionRows = useGuideSections(guide?.guide_id ?? null);
  const scoreItems = useScoreItems();
  const refs = useMemo(() => refsIn(parseSections(sectionRows.data ?? [])), [sectionRows.data]);
  const catalogue = useRefCatalogue(refs);

  const refresh = () => queryClient.invalidateQueries({ queryKey: GUIDES_KEY });

  if (guides.isPending) return <p className="empty loading">Loading…</p>;
  if (guides.error) {
    return <p className="error">Could not load the guides: {guides.error.message}</p>;
  }
  const rows = [...(guides.data ?? [])].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="setting eg-editor">
      <p className="note">
        One guide per event, built from sections. <strong>Imported</strong> guides are created by
        the collector from the game’s own tables, unpublished: add rewards, stages, a prepare-now
        list and notes here, map each scoring action to the item it uses, then publish.{' '}
        <strong>Festivals</strong> the game does not describe in that data are typed here whole.
        Members see published guides in the Guides tab of the Event guide.
      </p>

      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                Guide
              </th>
              <th scope="col">Address</th>
              <th scope="col">Source</th>
              <th scope="col">State</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.guide_id}>
                <td className="label">{row.title}</td>
                <td>
                  <code>{row.slug}</code>
                </td>
                <td>{row.activity_id === null ? 'typed' : `imported · ${row.activity_id}`}</td>
                <td>{row.published ? 'PUBLISHED' : 'DRAFT'}</td>
                <td>
                  <button
                    aria-pressed={selected === row.guide_id}
                    onClick={() => setSelected(row.guide_id)}
                    type="button"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p className="empty">
          No guide yet. The importer creates one for each event the collector has seen, or write one
          below.
        </p>
      )}
      <div className="eg-actions">
        <button className="primary" onClick={() => setSelected('new')} type="button">
          New guide
        </button>
      </div>

      {selected === 'new' && (
        <GuideForm
          canDelete={false}
          guide={null}
          key="new"
          onSave={async (input) => {
            const id = await saveGuide(input);
            await refresh();
            setSelected(id);
          }}
          posts={posts.data ?? []}
        />
      )}

      {guide && (
        <>
          <GuideForm
            canDelete={canDelete}
            guide={guide}
            key={`${guide.guide_id}:${guide.updated_at}`}
            onDelete={async () => {
              await deleteGuide(guide.guide_id);
              setSelected(null);
              await refresh();
            }}
            onSave={async (input) => {
              await saveGuide(input);
              await refresh();
            }}
            posts={posts.data ?? []}
          />
          <h3>Sections</h3>
          {sectionRows.isPending && <p className="empty loading">Loading…</p>}
          {sectionRows.error && (
            <p className="error">Could not load the sections: {sectionRows.error.message}</p>
          )}
          {sectionRows.data && (
            <SectionList
              canDelete={canDelete}
              catalogue={(catalogue.data ?? EMPTY_CATALOGUE).catalogue}
              guideId={guide.guide_id}
              iconSrc={(catalogue.data ?? EMPTY_CATALOGUE).iconSrc}
              onClearScoreItem={async (scoreId) => {
                await clearScoreItem(scoreId);
                await refresh();
              }}
              onDeleteSection={async (sectionId) => {
                await deleteSection(sectionId);
                await refresh();
              }}
              onSaveScoreItem={async (scoreId, ref) => {
                await saveScoreItem(scoreId, ref);
                await refresh();
              }}
              onSaveSection={async (input) => {
                await saveSection(input);
                await refresh();
              }}
              scoreItems={scoreItems.data ?? new Map()}
              sections={sectionRows.data}
            />
          )}
        </>
      )}
    </div>
  );
}
