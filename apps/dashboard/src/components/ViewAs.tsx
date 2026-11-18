import {
  PREVIEW_ROLES,
  type PreviewRole,
  previewLabel,
  setPreviewRole,
  usePreviewRole,
} from '../lib/previewRole';
import { useSession } from '../lib/useSession';
import { Select } from './ui/Select';

const ADMIN = 'admin';

/** The "View as" dropdown: Admin (yourself), Member, Officer, Community.
 * Renders nothing for anybody whose real role is not admin. */
export function ViewAsPicker({ goHome = false }: { goHome?: boolean }) {
  const { data: session } = useSession();
  const preview = usePreviewRole();
  const real = session?.realRole ?? session?.role;
  if (real !== 'admin') return null;
  return (
    <label className="view-as">
      <span>View as</span>
      <Select
        onChange={(value) => {
          setPreviewRole(value === ADMIN ? null : (value as PreviewRole));
          // From Settings, a member preview cannot stay on Settings (it is
          // admin-only), so it opens where a member lands.
          if (goHome && value !== ADMIN) window.location.hash = '#/';
        }}
        value={preview ?? ADMIN}
      >
        <option value={ADMIN}>Admin (you)</option>
        {PREVIEW_ROLES.map((role) => (
          <option key={role} value={role}>
            {previewLabel(role)}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** Shown on every screen while an admin previews another role, with the way
 * back — Settings itself is hidden from the previewed role. */
export function PreviewBanner() {
  const { data: session } = useSession();
  const preview = usePreviewRole();
  if (preview === null || session?.realRole !== 'admin') return null;
  return (
    <output className="preview-banner">
      <strong>{previewLabel(preview)}</strong>
      <span>
        Screens and menus as a {preview} sees them. Data is still read with your admin access, so
        some rows may show that a {preview} could not see.
      </span>
      <ViewAsPicker />
      <button
        onClick={() => {
          setPreviewRole(null);
          window.location.hash = '#/admin';
        }}
        type="button"
      >
        Exit preview
      </button>
    </output>
  );
}
