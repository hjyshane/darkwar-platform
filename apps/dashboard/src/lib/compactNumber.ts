// Big numbers the way the game writes them: K, M, G, T. Intl's compact
// notation says B for a billion; the game says G (1000M is 1G, never 1B), so
// every compact figure on the site goes through here instead of straight
// to Intl.

/** A drop-in for `new Intl.NumberFormat('en', { notation: 'compact', ... })`. */
export function compactNumber(maximumFractionDigits: number): { format(value: number): string } {
  const intl = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits });
  return {
    format: (value) => intl.format(value).replace(/B$/, 'G'),
  };
}
