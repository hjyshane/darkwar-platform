import { describe, expect, it } from 'vitest';
import {
  ALLIANCE_TABS,
  BOARD_TABS,
  EVENTS_HUB_TABS,
  EVENT_TABS,
  NAV_TABS,
  OVERVIEW_TABS,
  OWN_ALLIANCE_TABS,
  RANKING_TABS,
  routeFromHash,
} from './route';
import { ALL_ROUTES, routeDef } from './routeTable';
import { TABS } from './tabVisibility';

describe('the route table', () => {
  it('opens each route at its own address and at every old one', () => {
    for (const route of ALL_ROUTES) {
      const def = routeDef(route);
      for (const hash of [def.hash, ...(def.aliases ?? [])]) {
        if (hash !== null) expect([hash, routeFromHash(hash)]).toEqual([hash, route]);
      }
    }
  });

  it('agrees with every sidebar list on where each screen lives', () => {
    const lists = [
      NAV_TABS,
      OVERVIEW_TABS,
      OWN_ALLIANCE_TABS,
      ALLIANCE_TABS,
      EVENTS_HUB_TABS,
      EVENT_TABS,
      BOARD_TABS,
      RANKING_TABS,
    ];
    for (const tab of lists.flat()) {
      expect([tab.hash, routeFromHash(tab.hash)]).toEqual([tab.hash, tab.route]);
    }
  });

  it('publishes exactly four screens outside the wall', () => {
    expect(ALL_ROUTES.filter((route) => routeDef(route).standalone === true).sort()).toEqual([
      'login',
      'monthCards',
      'privacy',
      'terms',
    ]);
  });

  it('files each screen under a Tab visibility choice that exists, and the hub screens under theirs', () => {
    const keys = new Set(TABS.map((tab) => tab.key));
    for (const route of ALL_ROUTES) {
      const key = routeDef(route).tabKey;
      if (key !== null) expect([route, keys.has(key)]).toEqual([route, true]);
    }
    for (const tab of EVENTS_HUB_TABS) expect(routeDef(tab.route).tabKey).toBe('events');
    for (const tab of RANKING_TABS) expect(routeDef(tab.route).tabKey).toBe('rankings');
  });

  it('lets an account that owes a character open only the way in and the legal pages', () => {
    expect(ALL_ROUTES.filter((route) => routeDef(route).whilePicking === true).sort()).toEqual([
      'login',
      'privacy',
      'terms',
    ]);
  });
});
