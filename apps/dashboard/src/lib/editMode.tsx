// Edit mode: an admin's switch for changing names, order and visibility from
// the page itself, instead of from a settings screen.
//
// Only an admin ever has `canEdit`; a member's toggle is not drawn and the
// database refuses their writes anyway (0279). The switch lives for the
// session: reloading puts the page back to reading.

import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import { useSession } from './useSession';

interface EditMode {
  /** The viewer is an admin. */
  canEdit: boolean;
  /** Edit mode is on. Never true when `canEdit` is false. */
  editing: boolean;
  toggle: () => void;
}

const OFF: EditMode = { canEdit: false, editing: false, toggle: () => {} };

const EditModeContext = createContext<EditMode>(OFF);

export function EditModeProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const canEdit = session?.role === 'admin';
  const [on, setOn] = useState(false);
  const value = useMemo<EditMode>(
    () => ({ canEdit, editing: canEdit && on, toggle: () => setOn((current) => !current) }),
    [canEdit, on],
  );
  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

export function useEditMode(): EditMode {
  return useContext(EditModeContext);
}
