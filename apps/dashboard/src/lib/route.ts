// Not a router — a gate. The month-card page is deliberately unlinked from
// the dashboard: you get there by typing the address. The address is NOT
// the security boundary (RLS on player_month_cards is; a non-admin who
// finds the URL sees an empty page) — keeping it out of the dashboard just
// keeps finance out of the room where gameplay is discussed.
//
// Hash-based so it works on any static host with zero rewrite config.

export type Route = 'dashboard' | 'monthCards';

export function routeFromHash(hash: string): Route {
  return hash === '#/month-cards' ? 'monthCards' : 'dashboard';
}
