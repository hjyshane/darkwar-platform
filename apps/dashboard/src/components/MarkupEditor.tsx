import { useRef, useState } from 'react';
import {
  type Applied,
  type MarkupAction,
  type Selection,
  applyColour,
  applyMarkup,
  insertImage,
  insertText,
  toggleImageWidth,
} from '../lib/markupActions';
import { COLOUR_NAMES, type ColourName } from '../lib/richText';
import { ALLOWED_TYPES, uploadPostImage } from '../lib/uploadImage';
import { EmojiPalette } from './EmojiPalette';
import { RichText, RichTitle } from './RichText';

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
/** The toolbar, in groups. The dividers are the point: nine unlabelled buttons
 * in one row read as a wall, and the writer has to check every one. Grouped by
 * what they do to the text — emphasis, then structure — a reader finds bold
 * without reading the rest. */
const GROUPS: { action: MarkupAction; label: string; title: string }[][] = [
  [
    { action: 'bold', label: 'B', title: 'Bold' },
    { action: 'italic', label: 'I', title: 'Italic' },
    { action: 'code', label: '</>', title: 'Code' },
    { action: 'link', label: '🔗', title: 'Link' },
  ],
  [
    { action: 'bullet', label: '•', title: 'Bullet list' },
    { action: 'indent', label: '→', title: 'Indent — makes a sub-bullet' },
    { action: 'outdent', label: '←', title: 'Outdent' },
    { action: 'heading2', label: 'H2', title: 'Heading' },
    { action: 'heading3', label: 'H3', title: 'Sub-heading' },
  ],
];

/** What each colour is FOR, said in the tooltip.
 *
 * A row of swatches with no names is a guessing game, and the names are what
 * end up in the body text anyway (`[text]{red}`), so the writer may as well
 * learn them from the button they pressed.
 */
const COLOUR_TITLES: Record<ColourName, string> = {
  red: 'Red — urgent',
  orange: 'Orange — careful',
  green: 'Green — done, good',
  blue: 'Blue — informational',
  purple: 'Purple',
  grey: 'Grey — an aside',
  mark: 'Highlight',
};

/** The colour buttons, shared by the body editor and the title field. */
function ColourButtons({ onPick }: { onPick: (colour: ColourName) => void }) {
  return (
    <div className="colour-buttons">
      {COLOUR_NAMES.map((colour) => (
        <button
          aria-label={COLOUR_TITLES[colour]}
          className={`colour-swatch ink-${colour}`}
          key={colour}
          onClick={() => onPick(colour)}
          title={COLOUR_TITLES[colour]}
          type="button"
        >
          A
        </button>
      ))}
    </div>
  );
}

/** The title, with the emphasis the body already had.
 *
 * A title is one line, so it gets the inline half of the subset and nothing
 * else — bold, italic, colour, emoji. The same `applyMarkup` runs on it,
 * because a second implementation of "wrap the selection" is a second thing to
 * get wrong.
 *
 * The preview is the rendered title at the size it will appear. A writer
 * picking a colour for a heading is choosing how it will LOOK, and markers in
 * a text box do not answer that.
 */
export function TitleField({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function edit(change: (body: string, at: Selection) => Applied): void {
    const box = ref.current;
    const at =
      box === null
        ? { start: value.length, end: value.length }
        : { start: box.selectionStart ?? value.length, end: box.selectionEnd ?? value.length };
    const applied = change(value, at);
    onChange(applied.body);
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(applied.selection.start, applied.selection.end);
    });
  }

  return (
    <div className="title-field">
      <div className="markup-toolbar markup-toolbar-compact">
        <div className="markup-group">
          <button
            onClick={() => edit((body, at) => applyMarkup(body, at, 'bold'))}
            title="Bold"
            type="button"
          >
            B
          </button>
          <button
            onClick={() => edit((body, at) => applyMarkup(body, at, 'italic'))}
            title="Italic"
            type="button"
          >
            I
          </button>
        </div>
        <ColourButtons onPick={(colour) => edit((body, at) => applyColour(body, at, colour))} />
        <EmojiPalette onPick={(emoji) => edit((body, at) => insertText(body, at, emoji))} />
      </div>
      <input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        ref={ref}
        value={value}
      />
      {/* Only once there is something to preview, and only when it carries
          markup — echoing a plain title back at the writer is noise. */}
      {/\*\*|\*|\]\{/.test(value) && (
        <p className="title-preview">
          <RichTitle title={value} />
        </p>
      )}
    </div>
  );
}

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** Upload the chosen file and drop the markup in at the caret.
   *
   * The file input is hidden behind a button because a bare `<input type="file">`
   * cannot be styled and reads as an afterthought beside the other controls. It is
   * still a real input, so the keyboard and a screen reader reach it through the
   * label.
   */
  async function upload(file: File): Promise<void> {
    const box = ref.current;
    setUploadError(null);
    setUploading(true);
    try {
      const url = await uploadPostImage(file);
      const at =
        box === null
          ? { start: value.length, end: value.length }
          : {
              start: box.selectionStart,
              end: box.selectionEnd,
            };
      const applied = insertImage(value, at, url);
      onChange(applied.body);
      requestAnimationFrame(() => {
        box?.focus();
        box?.setSelectionRange(applied.selection.start, applied.selection.end);
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setUploading(false);
      // Cleared so choosing the SAME file again fires `change` a second time —
      // otherwise a failed upload cannot be retried without picking something else
      // first.
      if (fileRef.current !== null) {
        fileRef.current.value = '';
      }
    }
  }

  /** Run a pure edit against the current selection and put the caret back.
   *
   * Writing `value` to a controlled textarea moves the caret to the end, so
   * every button would send the cursor to the bottom of the guide. The offsets
   * come back from the edit and are restored after React has written the value.
   */
  function edit(change: (body: string, at: Selection) => Applied): void {
    const box = ref.current;
    const at =
      box === null
        ? { start: value.length, end: value.length }
        : { start: box.selectionStart, end: box.selectionEnd };
    const applied = change(value, at);
    onChange(applied.body);
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(applied.selection.start, applied.selection.end);
    });
  }

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
        {GROUPS.map((group) => (
          <div className="markup-group" key={group[0]?.action}>
            {group.map((button) => (
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
        ))}
        <ColourButtons onPick={(colour) => edit((body, at) => applyColour(body, at, colour))} />
        <EmojiPalette onPick={(emoji) => edit((body, at) => insertText(body, at, emoji))} />
        <div className="markup-group">
          <button
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            title="Add a picture — PNG, JPEG, WebP or GIF, up to 5MB"
            type="button"
          >
            {uploading ? '⏳ Uploading…' : '🖼 Image'}
          </button>
          {/* Width is the author's call, not only the reader's. A map or a
              comparison table is unreadable at thumbnail size, and asking every
              reader to press it is asking 94 people to do what the writer could
              decide once. Pressing it again puts the picture back. */}
          <button
            onClick={() => edit(toggleImageWidth)}
            title="Full width — for the picture the caret is on"
            type="button"
          >
            ↔ Wide
          </button>
        </div>
        <input
          accept={ALLOWED_TYPES.join(',')}
          aria-label="Choose a picture to upload"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              void upload(file);
            }
          }}
          ref={fileRef}
          type="file"
        />
      </div>
      <textarea
        id={id}
        onChange={(event) => onChange(event.target.value)}
        ref={ref}
        rows={rows}
        value={value}
      />
      {uploadError !== null && <p className="error">{uploadError}</p>}
      <p className="subtle">
        Emoji work as they are. Nothing is rendered as HTML, so a tag you type shows as a tag.
      </p>
      {/* Said at the point of upload rather than in a runbook nobody writing a
          guide will read. It said "pictures are public" until 0083 closed the
          bucket — a claim to 94 people about where their screenshots end up has to
          track what the schema actually does. */}
      <p className="subtle">
        <strong>Pictures are alliance-only.</strong> They are not public: a link copied out of the
        page stops working within the hour. When a guide is published, the picture is uploaded to
        the Discord channel as a file — so anybody in that channel can see and re-share it.
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
