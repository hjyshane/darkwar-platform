import { useEditMode } from '../lib/editMode';
import { useT } from '../lib/i18n';

/** The admin's switch for editing names, order and visibility from the page.
 * Not drawn for anybody else: the database refuses their writes regardless
 * (0279), so hiding it is about not offering something that cannot work. */
export function EditModeToggle() {
  const { canEdit, editing, toggle } = useEditMode();
  const t = useT();
  if (!canEdit) {
    return null;
  }
  return (
    <button
      aria-pressed={editing}
      className={editing ? 'btn-edit-on' : 'btn-edit-off'}
      onClick={toggle}
      title={t('Rename, reorder and hide tabs from the page itself')}
      type="button"
    >
      {editing ? t('Done editing') : t('Edit pages')}
    </button>
  );
}
