import { useQuery } from '@tanstack/react-query';
import { fieldsOf } from '../../lib/memberFormulas';
import { useSession } from '../../lib/useSession';
import { fetchRoster } from '../roster/RosterPanel';
import { AnnouncementsSetting } from './AnnouncementsSetting';
import { FormulaSetting } from './FormulaSetting';
import { HeroesSetting } from './HeroesSetting';
import { MembersSetting } from './MembersSetting';
import { OverviewMetricsSetting } from './OverviewMetricsSetting';
import { OwnAllianceSetting } from './OwnAllianceSetting';
import { PermissionsSetting } from './PermissionsSetting';
import { PetsSetting } from './PetsSetting';

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
  // A member formula runs on one member, so the preview needs one. The
  // strongest is used because they are the row most likely to have every
  // figure filled in — a preview against somebody with three nulls says
  // "unknown" and teaches nothing.
  // Same query the Members tab runs, so the preview cannot drift from the
  // rows the formula will actually meet. The roster comes back strongest
  // first, and the strongest member is the row most likely to have every
  // figure filled in — previewing against somebody with three nulls says
  // "unknown" and teaches nothing.
  const { data: roster } = useQuery({ queryKey: ['roster'], queryFn: fetchRoster });
  const sample = roster?.[0] ?? null;

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

      <section aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        <MembersSetting />
      </section>

      <section aria-labelledby="permissions-heading">
        <h2 id="permissions-heading">Permissions</h2>
        <PermissionsSetting />
      </section>

      <section aria-labelledby="own-alliance-heading">
        <h2 id="own-alliance-heading">Our alliance</h2>
        <OwnAllianceSetting />
      </section>

      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading">Overview figures</h2>
        <OverviewMetricsSetting />
      </section>

      <section aria-labelledby="formulas-heading">
        <h2 id="formulas-heading">Member columns</h2>
        <FormulaSetting
          sampleName={sample?.current_name ?? null}
          values={sample === null ? {} : fieldsOf(sample)}
        />
      </section>

      <section aria-labelledby="notices-heading">
        <h2 id="notices-heading">Notices</h2>
        <AnnouncementsSetting />
      </section>

      <section aria-labelledby="heroes-heading">
        <h2 id="heroes-heading">Heroes</h2>
        <HeroesSetting />
      </section>

      <section aria-labelledby="pets-heading">
        <h2 id="pets-heading">Pets</h2>
        <PetsSetting />
      </section>
    </main>
  );
}
