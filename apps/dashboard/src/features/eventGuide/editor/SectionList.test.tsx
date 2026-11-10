import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scoreItemMapFrom } from '../scoreItems';
import type { GuideSection } from '../sections/index';
import { catalogueFrom } from '../sections/itemRef';
import { SectionList, type SectionListProps } from './SectionList';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const catalogue = catalogueFrom({ items: [{ item_id: '253042', name: 'Orange Hero Shard' }] });

function section(over: Partial<GuideSection> & { section_id: string }): GuideSection {
  return {
    guide_id: 'g',
    kind: 'notes',
    title: null,
    sort_order: 0,
    source: 'officer',
    payload: { text: 'Hold shards.', text_ko: null },
    ...over,
  };
}

const client = section({
  section_id: 'c1',
  kind: 'point_table',
  title: 'Training Day',
  source: 'client',
  payload: {
    day: null,
    theme: 'Training Day',
    rows: [{ score_id: '1000020101', action: 'Consume a shard', points: 300, per: 1 }],
  },
});

function view(sections: GuideSection[], over: Partial<SectionListProps> = {}) {
  const props: SectionListProps = {
    guideId: 'g',
    sections,
    scoreItems: scoreItemMapFrom([]),
    catalogue,
    iconSrc: new Map(),
    canDelete: true,
    onSaveSection: vi.fn().mockResolvedValue(undefined),
    onDeleteSection: vi.fn().mockResolvedValue(undefined),
    onSaveScoreItem: vi.fn().mockResolvedValue(undefined),
    onClearScoreItem: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return { ...render(<SectionList {...props} />), props };
}

describe('a client section', () => {
  it('is read-only: no field for its rows, and says who wrote it', () => {
    const { container } = view([client]);
    expect(container.textContent).toContain('Written by the importer. Re-import to refresh.');
    expect(container.textContent).toContain('Consume a shard');
    expect(container.querySelector('input[aria-label^="Action"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save section' })).toBeNull();
  });

  it('choosing an item for a row maps that score id', async () => {
    const search = vi
      .fn()
      .mockResolvedValue([{ ref: { kind: 'item', id: '253042' }, name: 'Orange Hero Shard' }]);
    const { props } = view([client], { search });
    fireEvent.change(screen.getByLabelText('Find an item'), { target: { value: 'shard' } });
    fireEvent.click(await screen.findByRole('button', { name: /Orange Hero Shard/ }));
    expect(props.onSaveScoreItem).toHaveBeenCalledWith('1000020101', {
      kind: 'item',
      id: '253042',
    });
  });

  it('clearing a mapped row removes the mapping', () => {
    const { props } = view([client], {
      scoreItems: scoreItemMapFrom([
        { score_id: '1000020101', item_ref: { kind: 'item', id: '253042' }, per: 1 },
      ]),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear item' }));
    expect(props.onClearScoreItem).toHaveBeenCalledWith('1000020101');
  });
});

describe('an officer section', () => {
  it('a new notes section cannot be saved until it has text, and says why', () => {
    view([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add notes section' }));
    const save = screen.getByRole('button', { name: 'Save section' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText('Notes need some text.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Now it has some.' } });
    expect(
      (screen.getByRole('button', { name: 'Save section' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('saves the typed payload with its title and order', () => {
    const { props } = view([section({ section_id: 'n1', title: 'Read me', sort_order: 20 })]);
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'Hold shards until day 2.' },
    });
    const save = screen.getByRole('button', { name: 'Save section' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(props.onSaveSection).toHaveBeenCalledWith({
      section_id: 'n1',
      guide_id: 'g',
      kind: 'notes',
      title: 'Read me',
      sort_order: 20,
      payload: { text: 'Hold shards until day 2.', text_ko: null },
    });
  });

  it('asks before it deletes, and only offers delete to somebody who may', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { props } = view([section({ section_id: 'n1' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete section' }));
    expect(confirm).toHaveBeenCalled();
    expect(props.onDeleteSection).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete section' }));
    expect(props.onDeleteSection).toHaveBeenCalledWith('n1');
    cleanup();
    view([section({ section_id: 'n1' })], { canDelete: false });
    expect(screen.queryByRole('button', { name: 'Delete section' })).toBeNull();
  });
});

describe('a section that does not parse', () => {
  it('says so and can still be deleted, so it can be replaced', () => {
    const { container } = view([
      section({ section_id: 'bad', kind: 'stages', payload: { groups: 'nope' } }),
    ]);
    expect(container.textContent).toContain('This section cannot be read.');
    expect(screen.getByRole('button', { name: 'Delete section' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save section' })).toBeNull();
  });
});

describe('adding a section', () => {
  it('starts a new draft of the chosen kind that saves without an id', () => {
    const { props } = view([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add sources section' }));
    const item = screen.getByRole('listitem');
    fireEvent.click(within(item).getByRole('button', { name: 'Save section' }));
    expect(props.onSaveSection).toHaveBeenCalledWith({
      guide_id: 'g',
      kind: 'sources',
      title: null,
      sort_order: 10,
      payload: { rows: [], total_cap: null, note: null },
    });
  });
});
