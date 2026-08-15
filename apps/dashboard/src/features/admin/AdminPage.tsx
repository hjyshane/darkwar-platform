import { useQuery } from '@tanstack/react-query';
import {
  canWriteAnything,
  describe,
  missingIn,
  sectionSlug,
  sectionsIn,
} from '../../lib/adminAccess';
import { fieldsOf } from '../../lib/memberFormulas';
import { usePermissions } from '../../lib/permissions';
import { ADMIN_GROUPS, type AdminGroup, adminHash } from '../../lib/route';
import { useSession } from '../../lib/useSession';
import { fetchRoster } from '../roster/RosterPanel';
import { ActivitySetting } from './ActivitySetting';
import { CollectorHealth } from './CollectorHealth';
import { DepartedSetting } from './DepartedSetting';
import { DiscoveryInbox } from './DiscoveryInbox';
import { FormulaSetting } from './FormulaSetting';
import { HeroesSetting } from './HeroesSetting';
import { JoinCodesSetting } from './JoinCodesSetting';
import { MembersSetting } from './MembersSetting';
import { NotificationsSetting } from './NotificationsSetting';
import { OverviewMetricsSetting } from './OverviewMetricsSetting';
import { OwnAllianceSetting } from './OwnAllianceSetting';
import { PermissionsSetting } from './PermissionsSetting';
import { PetsSetting } from './PetsSetting';
import { RankReportSetting } from './RankReportSetting';
import { RankTiersSetting } from './RankTiersSetting';
import { TableLayoutSetting } from './TableLayoutSetting';

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
 *
 * What that courtesy says is now per group. It used to be one sentence —
 * "saving needs an admin" — asked once for all five, and it had been wrong
 * since 0045 turned permissions into data: an officer holding
 * `members.manage` may edit members, the permission grid and the rank
 * column, and was told they could not. `lib/adminAccess.ts` holds the map of
 * section to requirement and why each one is shaped the way it is.
 */
export function AdminPage({ group, section }: { group: AdminGroup; section: string | null }) {
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const role = session?.role;
  const grants = permissions?.grants;
  const missing = missingIn(group, role, grants);
  // One panel per address. Every section in a group used to mount at once,
  // which meant opening Access ran five screens' worth of queries to read one
  // of them — and on a phone the answer you wanted was four scrolls down.
  // An unknown slug falls back to the first section rather than rendering an
  // empty group, the same way an unknown group falls back to the overview.
  const sections = sectionsIn(group);
  const open = sections.find((entry) => sectionSlug(entry) === section) ?? sections[0];
  const openSlug = open === undefined ? '' : sectionSlug(open);

  return (
    <main>
      <section aria-labelledby="admin-heading">
        <h2 id="admin-heading">Settings</h2>
        {session?.email == null ? (
          <p className="empty">
            <a href="#/login">Sign in</a> to change these.
          </p>
        ) : (
          missing.length > 0 && (
            <p className="empty">
              You are signed in as <strong>{role}</strong>.{' '}
              {canWriteAnything(group, role, grants)
                ? 'Some of this group needs '
                : 'Changing anything here needs '}
              {missing.map((requirement, index) => (
                <span key={describe(requirement, permissions?.capabilities)}>
                  {index > 0 && (index === missing.length - 1 ? ' and ' : ', ')}
                  <strong>{describe(requirement, permissions?.capabilities)}</strong>
                </span>
              ))}
              . Reading is fine, and the database refuses the write rather than this page.
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
        {/* The sections of this group, one of which is on screen. Same markup
            as the group bar above it, so the two selected states cannot drift
            apart. */}
        <nav aria-label={`${group} settings`} className="tabs subtabs">
          {sections.map((entry) => (
            <a
              key={entry.id}
              aria-current={sectionSlug(entry) === openSlug ? 'page' : undefined}
              className="tab"
              href={adminHash(group, sectionSlug(entry))}
            >
              {entry.heading}
            </a>
          ))}
        </nav>
      </section>

      {group === 'access' && <AccessGroup section={openSlug} />}
      {group === 'alliance' && <AllianceGroup section={openSlug} />}
      {group === 'display' && <DisplayGroup section={openSlug} />}
      {group === 'catalogue' && <CatalogueGroup section={openSlug} />}
      {group === 'operations' && <OperationsGroup section={openSlug} />}
    </main>
  );
}

/** Who is in, and what they may do once they are. */
function AccessGroup({ section }: { section: string }) {
  return (
    <>
      {section === 'members' && (
        <section aria-labelledby="members-heading">
          <h2 id="members-heading">Members</h2>
          <MembersSetting />
        </section>
      )}

      {section === 'join-codes' && (
        <section aria-labelledby="join-codes-heading">
          <h2 id="join-codes-heading">Invitations</h2>
          <JoinCodesSetting />
        </section>
      )}

      {/* Not on the roster. A departure is administrative tidying-up, and
          showing it where the whole alliance reads the member table turns it
          into an announcement nobody asked for. */}
      {section === 'departed' && (
        <section aria-labelledby="departed-heading">
          <h2 id="departed-heading">Left the alliance</h2>
          <DepartedSetting />
        </section>
      )}

      {/* Beside the member table rather than on the roster, for the same
          reason departures are: this is a record of who is paying attention,
          and putting it where the whole alliance reads turns a nudge into a
          public league table of effort. */}
      {section === 'activity' && (
        <section aria-labelledby="activity-heading">
          <h2 id="activity-heading">Activity this week</h2>
          <ActivitySetting />
        </section>
      )}

      {section === 'permissions' && (
        <section aria-labelledby="permissions-heading">
          <h2 id="permissions-heading">Permissions</h2>
          <PermissionsSetting />
        </section>
      )}
    </>
  );
}

/** Facts about our own alliance, and how it grades people. */
function AllianceGroup({ section }: { section: string }) {
  return (
    <>
      {section === 'own-alliance' && (
        <section aria-labelledby="own-alliance-heading">
          <h2 id="own-alliance-heading">Our alliance</h2>
          <OwnAllianceSetting />
        </section>
      )}

      {section === 'rank-tiers' && (
        <section aria-labelledby="rank-tiers-heading">
          <h2 id="rank-tiers-heading">How ranks are decided</h2>
          <RankTiersSetting />
        </section>
      )}

      {section === 'rank-report' && (
        <section aria-labelledby="rank-report-heading">
          <h2 id="rank-report-heading">Rank changes</h2>
          <RankReportSetting />
        </section>
      )}
    </>
  );
}

/** What the dashboard puts in front of everybody else. */
function DisplayGroup({ section }: { section: string }) {
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
      {section === 'metrics' && (
        <section aria-labelledby="metrics-heading">
          <h2 id="metrics-heading">Overview figures</h2>
          <OverviewMetricsSetting />
        </section>
      )}

      {section === 'formulas' && (
        <section aria-labelledby="formulas-heading">
          <h2 id="formulas-heading">Member columns</h2>
          <FormulaSetting
            sampleName={sample?.current_name ?? null}
            values={sample === null ? {} : fieldsOf(sample)}
          />
        </section>
      )}

      {section === 'table-layout' && (
        <section aria-labelledby="table-layout-heading">
          <h2 id="table-layout-heading">Table columns</h2>
          <TableLayoutSetting />
        </section>
      )}

      {/* Notices used to be edited here. Writing one is not configuring the
          dashboard, so it moved to the board it appears on (`#/notices`), where
          the draft sits among the notices it will join. */}
      {section === 'notices' && (
        <section aria-labelledby="notices-heading">
          <h2 id="notices-heading">Notices</h2>
          <p className="subtle">
            Posting and editing notices moved to the <a href="#/notices">Notices board</a>, which
            shows expired ones too.
          </p>
        </section>
      )}
    </>
  );
}

/** What the machinery underneath is doing, and the one thing it takes orders on.
 *
 * The first two screens are read-only: the collector writes those tables with
 * the service key and there is no cloud-side control that would change them, so
 * they answer questions rather than offering buttons.
 *
 * Notifications is the exception, and it belongs here rather than in Access even
 * though it holds a credential — what it configures is the collector's behaviour,
 * and "why did nobody get told" is a question asked next to "is the collector
 * running".
 */
function OperationsGroup({ section }: { section: string }) {
  return (
    <>
      {section === 'collectors' && (
        <section aria-labelledby="collectors-heading">
          {/* Not "Collectors": the section holds two tables and the first of
            them is already called that, so the same word twice running was
            the first thing visible on the screen. */}
          <h2 id="collectors-heading">Collector health</h2>
          <CollectorHealth />
        </section>
      )}

      {section === 'discovery' && (
        <section aria-labelledby="discovery-heading">
          <h2 id="discovery-heading">Unrecognized commands</h2>
          <DiscoveryInbox />
        </section>
      )}

      {/* In Operations rather than Access, even though it holds a credential.
          What it configures is the collector's behaviour — the same thing the two
          screens above report on — and an admin looking for "why did nobody get
          told" will look here. */}
      {section === 'notifications' && (
        <section aria-labelledby="notifications-heading">
          <h2 id="notifications-heading">Discord notifications</h2>
          <NotificationsSetting />
        </section>
      )}
    </>
  );
}

/** Reference data somebody types in, not settings that change behaviour —
 *  HeroesSetting's own docstring is what draws this line. */
function CatalogueGroup({ section }: { section: string }) {
  return (
    <>
      {section === 'heroes' && (
        <section aria-labelledby="heroes-heading">
          <h2 id="heroes-heading">Heroes</h2>
          <HeroesSetting />
        </section>
      )}

      {section === 'pets' && (
        <section aria-labelledby="pets-heading">
          <h2 id="pets-heading">Pets</h2>
          <PetsSetting />
        </section>
      )}
    </>
  );
}
