import { useRef, useState } from 'react';
import { type MarkupAction, applyMarkup, insertImage } from '../lib/markupActions';
import { ALLOWED_TYPES, uploadPostImage } from '../lib/uploadImage';
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
        <button
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          title="Add a picture — PNG, JPEG, WebP or GIF, up to 5MB"
          type="button"
        >
          {uploading ? '⏳ Uploading…' : '🖼 Image'}
        </button>
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
          guide will read. The bucket has to be public for Discord to show the
          picture in the channel, and public means public. */}
      <p className="subtle">
        <strong>Pictures are public.</strong> They have to be, or Discord cannot show them in the
        channel — anybody with the link can open one, signed in or not. Screenshots of the roster,
        anyone's power, or the member list do not belong here.
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
