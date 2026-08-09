import { useState } from 'react';

/** The emoji people actually reach for on an alliance board.
 *
 * A short curated list, not a picker over the whole Unicode table. The full
 * set needs search, categories, skin-tone variants and a virtualised grid —
 * that is a component, not a button — and nobody writing "rally at 9" needs
 * 3,600 choices. These are grouped by what a notice is usually about: calling
 * people, timing, fighting, building, and reacting.
 *
 * Everything here is a plain character. It goes into the body as text, so it
 * survives the trip to Discord unchanged and needs no rendering support at
 * all — which is the whole reason not to invent a `:shortcode:` syntax.
 */
const GROUPS: { name: string; emoji: string[] }[] = [
  { name: 'Calling', emoji: ['📢', '🔔', '❗', '‼️', '⚠️', '👀', '🙏', '🆘', '📌', '✅'] },
  { name: 'Time', emoji: ['⏰', '⌛', '📅', '🕘', '🔁', '🆕', '⏳', '🌙', '☀️'] },
  { name: 'War', emoji: ['⚔️', '🛡️', '🔥', '💥', '🏹', '🚩', '🏆', '💀', '🎯', '🤝'] },
  { name: 'Base', emoji: ['🏰', '🔧', '⚙️', '🧪', '💎', '💰', '📦', '🚚', '⛏️', '🌾'] },
  { name: 'Faces', emoji: ['😀', '😅', '😎', '😭', '😱', '🤔', '👍', '👎', '🎉', '❤️'] },
];

/** A button that opens a grid of emoji and inserts the one pressed.
 *
 * Closes after a choice. Somebody adding three in a row pays two extra
 * clicks — which is better than a panel that stays open over the text they are
 * trying to read, and better than guessing which behaviour they wanted.
 */
export function EmojiPalette({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="emoji-palette">
      <button aria-expanded={open} onClick={() => setOpen(!open)} title="Emoji" type="button">
        🙂
      </button>
      {open && (
        // A fieldset, which is the element for "these controls belong
        // together" — the same thing `role="group"` says, without asserting a
        // role onto a div. Not a `dialog`: it does not trap focus and it should
        // not, since Tab out of it lands back in the text, which is where
        // somebody who changed their mind wants to be.
        <fieldset aria-label="Emoji" className="emoji-grid">
          {GROUPS.map((group) => (
            <div className="emoji-group" key={group.name}>
              <span className="emoji-group-name">{group.name}</span>
              <div className="emoji-row">
                {group.emoji.map((emoji) => (
                  <button
                    aria-label={emoji}
                    key={emoji}
                    onClick={() => {
                      onPick(emoji);
                      setOpen(false);
                    }}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      )}
    </div>
  );
}
