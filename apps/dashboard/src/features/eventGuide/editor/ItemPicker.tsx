import { useEffect, useState } from 'react';
import { Chip } from '../../../components/console/Chip';
import { GameIcon } from '../../../lib/gameIcons';
import { type PickerResult, searchItems } from '../guideData';
import { type ItemCatalogue, type ItemRef, itemRefKey, resolveItemRef } from '../sections/itemRef';
import { searchFilter } from './drafts';
import '../guides.css';

export interface ItemPickerProps {
  value: ItemRef | null | undefined;
  onChange: (next: ItemRef | null) => void;
  catalogue: ItemCatalogue;
  iconSrc: ReadonlyMap<string, string>;
  id: string;
  /** Injected so a test needs no network; the page uses the catalogue search. */
  search?: (filter: string) => Promise<PickerResult[]>;
}

const DELAY_MS = 200;

/** Choose an item or resource by name, in either language. Shows the chosen
 * one as a chip with its icon when the viewer may read it. */
export function ItemPicker({
  value,
  onChange,
  catalogue,
  iconSrc,
  id,
  search = searchItems,
}: ItemPickerProps) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<PickerResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A name picked here is not in the page's catalogue until it reloads.
  const [pickedName, setPickedName] = useState<string | null>(null);
  const filter = searchFilter(text);

  useEffect(() => {
    if (filter === null) {
      setResults([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      search(filter)
        .then((found) => {
          if (!current) return;
          setError(null);
          setResults(found);
        })
        .catch((failure: Error) => {
          if (current) setError(failure.message);
        });
    }, DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [filter, search]);

  if (value) {
    const resolved = resolveItemRef(value, catalogue);
    const src = iconSrc.get(itemRefKey(value));
    return (
      <span className="eg-pick-chosen">
        <Chip
          icon={src ? <GameIcon size={12} src={src} /> : undefined}
          label={
            catalogue.names.has(itemRefKey(value)) ? resolved.label : (pickedName ?? resolved.label)
          }
          suffix={value.kind}
        />
        <button
          aria-label="Clear item"
          onClick={() => {
            setPickedName(null);
            onChange(null);
          }}
          type="button"
        >
          Clear
        </button>
      </span>
    );
  }

  return (
    <div className="eg-pick">
      <input
        aria-label="Find an item"
        id={id}
        onChange={(event) => setText(event.target.value)}
        placeholder="Name, English or Korean"
        type="search"
        value={text}
      />
      {error && <p className="error">Search failed: {error}</p>}
      {results.length > 0 && (
        <ul className="eg-pick-results">
          {results.map((result) => (
            <li key={itemRefKey(result.ref)}>
              <button
                onClick={() => {
                  setPickedName(result.name);
                  setText('');
                  setResults([]);
                  onChange(result.ref);
                }}
                type="button"
              >
                <span>{result.name}</span>
                <span className="eg-kind">{result.ref.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
