import { useQuery } from '@tanstack/react-query';
import { fieldsOf } from '../../lib/memberFormulas';
import { ADMIN_GROUPS, type AdminGroup, adminHash } from '../../lib/route';
import { useSession } from '../../lib/useSession';
import { fetchRoster } from '../roster/RosterPanel';
import { AnnouncementsSetting } from './AnnouncementsSetting';
import { CollectorHealth } from './CollectorHealth';
import { DiscoveryInbox } from './DiscoveryInbox';
import { FormulaSetting } from './FormulaSetting';
import { HeroesSetting } from './HeroesSetting';
import { JoinCodesSetting } from './JoinCodesSetting';
import { MembersSetting } from './MembersSetting';
import { OverviewMetricsSetting } from './OverviewMetricsSetting';
import { OwnAllianceSetting } from './OwnAllianceSetting';
import { PermissionsSetting } from './PermissionsSetting';
import { PetsSetting } from './PetsSetting';
import { RankReportSetting } from './RankReportSetting';
import { RankTiersSetting } from './RankTiersSetting';

/** Settings an admin can change without a deploy.
 *
 * One group per screen rather than twelve sections stacked. Stacking meant
 * twelve queries fired to read one setting, and no way to send somebody to
 * the setting you meant — the address said `#/admin` whichever one you were
 * looking at. Only the open group mounts, so only its queries run.
 *
 * The role check here is a courtesy, not the boundary. RLS refuses the write
 * whatever this component renders, and each section reports what the
 * database said rather than hiding the control and leaving a non-admin
 * wondering. Telling someone why they cannot do a thing beats pretending the
 * thing does not exist.
 */
export function AdminPage({ group }: { group: AdminGroup }) {
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
        {/* Same markup and the same aria-current as the main nav, so the
            selected state cannot drift between the two bars. */}
        <nav aria-label="Settings groups" className="tabs subtabs">
          {ADMIN_GROUPS.map((entry) => (
            <a
              key={entry.group}
              aria-current={entry.group === group ? 'page' : undefined}
              className="tab"
              href={adminHash(entry.group)}
            >
              {entry.label}
            </a>
          ))}
        </nav>
      </section>

      {group === 'access' && <AccessGroup />}
      {group === 'alliance' && <AllianceGroup />}
      {group === 'display' && <DisplayGroup />}
      {group === 'catalogue' && <CatalogueGroup />}
      {group === 'operations' && <OperationsGroup />}
    </main>
  );
}

/** Who is in, and what they may do once they are. */
function AccessGroup() {
  return (
    <>
      <section aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        <MembersSetting />
      </section>

      <section aria-labelledby="join-codes-heading">
        <h2 id="join-codes-heading">Invitations</h2>
        <JoinCodesSetting />
      </section>

      <section aria-labelledby="permissions-heading">
        <h2 id="permissions-heading">Permissions</h2>
        <PermissionsSetting />
      </section>
    </>
  );
}

/** Facts about our own alliance, and how it grades people. */
function AllianceGroup() {
  return (
    <>
      <section aria-labelledby="own-alliance-heading">
        <h2 id="own-alliance-heading">Our alliance</h2>
        <OwnAllianceSetting />
      </section>

      <section aria-labelledby="rank-tiers-heading">
        <h2 id="rank-tiers-heading">How ranks are decided</h2>
        <RankTiersSetting />
      </section>

      <section aria-labelledby="rank-report-heading">
        <h2 id="rank-report-heading">Rank changes</h2>
        <RankReportSetting />
      </section>
    </>
  );
}

/** What the dashboard puts in front of everybody else. */
function DisplayGroup() {
  // A member formula runs on one member, so the preview needs one. Same
  // query the Members tab runs, so the preview cannot drift from the rows
  // the formula will actually meet. The roster comes back strongest first,
  // and the strongest member is the row most likely to have every figure
  // filled in — previewing against somebody with three nulls says "unknown"
  // and teaches nothing.
  //
  // It lives here rather than on the page because opening Access is no
  // reason to fetch a hundred members.
  const { data: roster } = useQuery({ queryKey: ['roster'], queryFn: fetchRoster });
  const sample = roster?.[0] ?? null;

  return (
    <>
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
    </>
  );
}

/** Not settings at all — what the machinery underneath is doing.
 *
 * Both screens are read-only. The collector writes these tables with the
 * service key and there is no cloud-side control that would change them, so
 * this group answers questions rather than offering buttons.
 */
function OperationsGroup() {
  return (
    <>
      <section aria-labelledby="collectors-heading">
        {/* Not "Collectors": the section holds two tables and the first of
            them is already called that, so the same word twice running was
            the first thing visible on the screen. */}
        <h2 id="collectors-heading">Collector health</h2>
        <CollectorHealth />
      </section>

      <section aria-labelledby="discovery-heading">
        <h2 id="discovery-heading">Unrecognized commands</h2>
        <DiscoveryInbox />
      </section>
    </>
  );
}

/** Reference data somebody types in, not settings that change behaviour —
 *  HeroesSetting's own docstring is what draws this line. */
function CatalogueGroup() {
  return (
    <>
      <section aria-labelledby="heroes-heading">
        <h2 id="heroes-heading">Heroes</h2>
        <HeroesSetting />
      </section>

      <section aria-labelledby="pets-heading">
        <h2 id="pets-heading">Pets</h2>
        <PetsSetting />
      </section>
    </>
  );
}
