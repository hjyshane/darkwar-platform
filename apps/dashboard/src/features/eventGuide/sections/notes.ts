// `notes`: a block of text (0310). The UI is English; `text_ko` is data an
// officer may fill, not a switch.

import { isRecord, nullStr, str } from './common';

export interface NotesPayload {
  text: string;
  text_ko: string | null;
}

export function parseNotes(value: unknown): NotesPayload | null {
  if (!isRecord(value)) return null;
  const text = str(value.text);
  return text === null ? null : { text, text_ko: nullStr(value.text_ko) };
}
