import { useRef } from 'react';
import { type MarkupAction, applyMarkup } from '../lib/markupActions';
import { RichText } from './RichText';

/** A textarea with buttons, so nobody has to know the markup.
 *
 * The buttons are the point. Members write these guides, and telling somebody
 * that `**` means bold is telling them to learn a notation before they can share
 * what they know. The markup stays visible in the box — this is not a
 * what-you-see-is-what-you-get editor, and pretending otherwise would hide the
 * one thing that gets published.
 *
 * WHY THE SELECTION IS RESTORED BY HAND. Writing `value` back to a controlled
 * textarea puts the caret at the end, so every button press would send the cursor
 * to the bottom of the guide. The offsets come back from `applyMarkup` and are
 * set after the DOM has the new value — pressing bold twice in a row has to keep
 * working, which it does not if the caret moves.
 *
 * The preview uses the same component that renders the published guide. A preview
 * drawn by different code is a preview that can lie.
 */
const BUTTONS: { action: MarkupAction; label: string; title: string }[] = [
  { action: 'bold', label: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', title: 'Italic' },
  { action: 'code', label: '</>', title: 'Code' },
  { action: 'link', label: '🔗', title: 'Link' },
  { action: 'bullet', label: '• List', title: 'Bullet list' },
  { action: 'indent', label: '→', title: 'Indent — makes a sub-bullet' },
  { action: 'outdent', label: '←', title: 'Outdent' },
  { action: 'heading2', label: 'H2', title: 'Heading' },
  { action: 'heading3', label: 'H3', title: 'Sub-heading' },
];

export function MarkupEditor({
  id,
  value,
  onChange,
  rows = 14,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function press(action: MarkupAction): void {
    const box = ref.current;
    if (box === null) {
      return;
    }
    const applied = applyMarkup(
      value,
      { start: box.selectionStart, end: box.selectionEnd },
      action,
    );
    onChange(applied.body);
    // After React has written the new value. Setting the range now would be
    // undone by the re-render, and the caret would land at the end.
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(applied.selection.start, applied.selection.end);
    });
  }

  return (
    <div className="markup-editor">
      {/* Not a `toolbar` role: that one expects arrow-key navigation between the
          buttons, and implementing half of it is worse than plain buttons a
          reader can Tab through. */}
      <div className="markup-toolbar">
        {BUTTONS.map((button) => (
          <button
            key={button.action}
            onClick={() => press(button.action)}
            title={button.title}
            type="button"
          >
            {button.label}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        onChange={(event) => onChange(event.target.value)}
        ref={ref}
        rows={rows}
        value={value}
      />
      <p className="subtle">
        Emoji work as they are. Nothing is rendered as HTML, so a tag you type shows as a tag.
      </p>
      {value.trim() !== '' && (
        <>
          <h4>Preview</h4>
          <div className="markup-preview">
            <RichText body={value} />
          </div>
        </>
      )}
    </div>
  );
}
