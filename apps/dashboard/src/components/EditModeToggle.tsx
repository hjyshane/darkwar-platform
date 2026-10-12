import { useEditMode } from '../lib/editMode';

/** The admin's switch for editing names, order and visibility from the page.
 * Not drawn for anybody else: the database refuses their writes regardless
 * (0279), so hiding it is about not offering something that cannot work. */
export function EditModeToggle() {
  const { canEdit, editing, toggle } = useEditMode();
  if (!canEdit) {
    return null;
  }
  return (
    <button
      aria-pressed={editing}
      className={editing ? 'btn-edit-on' : 'btn-edit-off'}
      onClick={toggle}
      title="Rename, reorder and hide tabs from the page itself"
      type="button"
    >
      {editing ? 'Done editing' : 'Edit pages'}
    </button>
  );
}
