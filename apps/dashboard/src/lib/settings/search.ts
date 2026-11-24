// Finding a setting by name across every group of Settings (2026-11-24).
//
// Settings has five groups and some thirty sections; a value like "pack
// categories" lives in a section whose name does not say so. The search looks
// at section headings and at each registry entry's label and help text.

import { type AdminSection, sectionSlug } from '../adminAccess';
import { ADMIN_GROUPS, adminHash } from '../route';
import type { AnySiteSetting } from './registry';

export interface SearchHit {
  key: string;
  label: string;
  /** Where it is: "Shared › Site values". */
  where: string;
  href: string;
}

const SITE_VALUES = { group: 'catalogue', slug: 'site-values' } as const;

function groupLabel(group: string): string {
  return ADMIN_GROUPS.find((entry) => entry.group === group)?.label ?? group;
}

/** Hits for `query`, sections first, at most `limit`. Every word must match,
 * in any order, ignoring case. An empty query finds nothing. */
export function searchSettings(
  query: string,
  sections: readonly AdminSection[],
  settings: readonly AnySiteSetting[],
  limit = 8,
): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = (text: string) => {
    const haystack = text.toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  const siteValues = sections.find(
    (section) => section.group === SITE_VALUES.group && sectionSlug(section) === SITE_VALUES.slug,
  );

  const fromSections = sections
    .filter((section) => matches(`${section.heading} ${groupLabel(section.group)}`))
    .map((section) => ({
      key: section.id,
      label: section.heading,
      where: groupLabel(section.group),
      href: adminHash(section.group, sectionSlug(section)),
    }));
  // A registry entry is only a hit for somebody who may open Site values.
  const fromSettings =
    siteValues === undefined
      ? []
      : settings
          .filter((setting) => matches(`${setting.label} ${setting.help} ${setting.usedOn.label}`))
          .map((setting) => ({
            key: setting.key,
            label: setting.label,
            where: `${groupLabel(SITE_VALUES.group)} › ${siteValues.heading}`,
            href: adminHash(SITE_VALUES.group, SITE_VALUES.slug),
          }));
  return [...fromSections, ...fromSettings].slice(0, limit);
}
