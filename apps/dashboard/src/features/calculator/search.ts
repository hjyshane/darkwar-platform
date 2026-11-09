// Subject search for the calculator: the UI is English, but a Korean query
// has to find the subject too, so both of the catalogue's names are matched
// (user decision 2026-11-08). No React.

export interface Named {
  name: string;
  nameKo: string | null;
}

function fold(text: string): string {
  // NFC so a decomposed Hangul typed on one keyboard matches the composed
  // form the client ships; lower-case for the Latin names.
  return text.normalize('NFC').toLowerCase();
}

/** Whether `query` is found in either name. An empty or blank query matches. */
export function matchesSubject(subject: Named, query: string): boolean {
  const needle = fold(query.trim());
  if (needle === '') return true;
  return (
    fold(subject.name).includes(needle) ||
    (subject.nameKo !== null && fold(subject.nameKo).includes(needle))
  );
}

/** The subjects matching `query`, in their given order. */
export function filterSubjects<T extends Named>(subjects: ReadonlyArray<T>, query: string): T[] {
  return subjects.filter((s) => matchesSubject(s, query));
}
