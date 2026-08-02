import { useSession } from '../../lib/useSession';
import { AnnouncementsSetting } from './AnnouncementsSetting';
import { OverviewMetricsSetting } from './OverviewMetricsSetting';
import { OwnAllianceSetting } from './OwnAllianceSetting';

/** Settings an admin can change without a deploy.
 *
 * One section per setting, so the next one — the overview's metric list, the
 * announcement — lands underneath without this page being rearranged.
 *
 * The role check here is a courtesy, not the boundary. RLS refuses the write
 * whatever this component renders, and the section below reports what the
 * database said rather than hiding the control and leaving a non-admin
 * wondering. Telling someone why they cannot do a thing beats pretending the
 * thing does not exist.
 */
export function AdminPage() {
  const { data: session } = useSession();
  const isAdmin = session?.role === 'admin';

  return (
    <main>
      <section aria-labelledby="admin-heading">
        <h2 id="admin-heading">Settings</h2>
        {session?.email == null ? (
          <p className="empty">
            <a href="#/login">Sign in</a> as an admin to change these.
          </p>
        ) : (
          !isAdmin && (
            <p className="empty">
              You are signed in as <strong>{session.role}</strong>. Reading these is fine; saving
              needs an admin, and the database will refuse it rather than this page.
            </p>
          )
        )}
      </section>

      <section aria-labelledby="own-alliance-heading">
        <h2 id="own-alliance-heading">Our alliance</h2>
        <OwnAllianceSetting />
      </section>

      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading">Overview figures</h2>
        <OverviewMetricsSetting />
      </section>

      <section aria-labelledby="notices-heading">
        <h2 id="notices-heading">Notices</h2>
        <AnnouncementsSetting />
      </section>
    </main>
  );
}
