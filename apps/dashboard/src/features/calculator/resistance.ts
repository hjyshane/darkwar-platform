/** What a virus-resistance shortfall costs against a season monster.
 *
 * The game's own rule, read out of the client on 2026-11-20
 * (`plan/season-monster-virus-resistance.md`): every season monster carries a
 * required resistance (`aps_monster.monster_buff`) and a penalty curve
 * (`aps_monster.monster_dmg_param`, the same string on all of them), and
 * `SeasonUtil.GetSeasonResistanceSelf/Other` turns the shortfall into the two
 * figures the attack panel draws — "-99.0% DMG" on your side and "+24000.0%"
 * on the monster's. Two clamps come from the server's `new_battle_config`
 * (k22, k24) rather than the client, so they are pinned here as constants.
 *
 * Nothing here touches the database: the ladders are the client's tables as
 * of that date, and the page is arithmetic on a typed figure.
 */

/** One piece of the curve: `(1 + a·deficit)^n + c` for the monster, and
 * `1 - deficit / b` for you, while the deficit is at most `upTo` (the last
 * piece has no ceiling; the client's own check is `<=`, so exactly 400 is
 * still on the curve). */
export interface PenaltyPiece {
  a: number;
  b: number;
  n: number;
  c: number;
  upTo: number | null;
}

/** `aps_monster.monster_dmg_param` — identical on every season monster. */
export const PENALTY_PARAM = '0.0027;1000;6;0;400|0.2;1000;1;0';

/** Your damage never drops below this share of normal: `new_battle_config.k22`. */
export const SELF_FLOOR = 0.01;
/** The monster's damage multiplier never exceeds this: `new_battle_config.k24`. */
export const MONSTER_CAP = 300;
/** How hard the shortfall inflates the panel's recommended power:
 * `battle_config.k26`, the exponent in `UIWorldPointCtrl`'s
 * `recommend_power × (monster ÷ yours)^k26`. */
export const POWER_EXPONENT = 0.5;

/** The pieces a param string names, in order. */
export function parsePenaltyParam(param: string): PenaltyPiece[] {
  return param.split('|').map((piece) => {
    const [a, b, n, c, upTo] = piece.split(';').map(Number);
    return {
      a: a ?? 0,
      b: b ?? 1,
      n: n ?? 1,
      c: c ?? 0,
      upTo: upTo === undefined || Number.isNaN(upTo) ? null : upTo,
    };
  });
}

const PIECES = parsePenaltyParam(PENALTY_PARAM);

export interface Penalty {
  /** Required minus yours; at or below zero nothing is lost. */
  deficit: number;
  /** Your damage as a share of normal: 1 is full, 0.01 the floor. */
  self: number;
  /** The monster's damage as a multiple of normal: 1 is normal, 300 the cap. */
  monster: number;
}

/** The game's `GetSeasonResistanceSelf` and `...Other`, as one call. */
export function penalty(mine: number, required: number, pieces = PIECES): Penalty {
  const deficit = required - mine;
  if (deficit <= 0) return { deficit, self: 1, monster: 1 };
  const piece =
    pieces.find((p) => p.upTo !== null && deficit <= p.upTo) ?? pieces[pieces.length - 1];
  if (piece === undefined) return { deficit, self: 1, monster: 1 };
  const self = Math.max(1 - deficit / piece.b, SELF_FLOOR);
  const monster = Math.min((1 + piece.a * deficit) ** piece.n + piece.c, MONSTER_CAP);
  return { deficit, self, monster };
}

/** The recommended power the attack panel draws: the table's figure while you
 * meet the requirement, and above it `power × (monster ÷ yours)^0.5` — so a
 * Lv.60 Rotting Oni's 490M reads 2.66G at 250 short (owner, 2026-11-21: the
 * panel said 2.6G where the table said 490M). The client skips the scaling
 * when the table has no power; null stays null. */
export function panelPower(power: number | null, result: Penalty): number | null {
  if (power === null) return null;
  if (result.deficit <= 0 || power <= 0) return power;
  return power * (result.monster / result.self) ** POWER_EXPONENT;
}

/** "-99.0%" / "+24000.0%": the attack panel's own wording, one decimal. */
export function percentChange(multiplier: number): string {
  const pct = (multiplier - 1) * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export type Verdict = 'sufficient' | 'insufficient' | 'defeat';

/** The panel's three states: enough; short but still dealing something; at the
 * floor, where the game itself says "Certain defeat". */
export function verdict(result: Penalty): Verdict {
  if (result.deficit <= 0) return 'sufficient';
  return result.self <= SELF_FLOOR ? 'defeat' : 'insufficient';
}

// --- the monsters ----------------------------------------------------------

/** The two internal season tables (`aps_monster.world_season` 6 and 7) share
 * one ladder to level 65 and part at 66. Game season 6 is the one our Season 4
 * plays (`seasons.ts` maps its buildings the same way); 7 is the next run of
 * this map. The page offers both, with 6 first. */
export type SeasonTable = '6' | '7';

export interface SeasonMonster {
  id: string;
  name: string;
  /** A rally target (`boss` = 1) rather than a single-march one. */
  rally: boolean;
  /** Recommended power by level, index = level - 1, levels 1-85. */
  power: readonly number[];
  /** Required resistance by level on table 6, index = level - 1. */
  required6: readonly number[];
  /** Levels 66-85 on table 7, index = level - 66. Below 66 the tables agree. */
  required7Tail: readonly number[];
}

export const MAX_MONSTER_LEVEL = 85;
const TABLE_SPLIT_LEVEL = 66;

// Plain and [Miasmified] share the power ladder of their base monster.
const POWER_BRUTE = [
  2500000, 3120000, 3900000, 4880000, 6110000, 7620000, 9620000, 11900000, 14950000, 18600000,
  27220000, 36040000, 44930000, 53700000, 62300000, 71000000, 79700000, 88800000, 97300000,
  106100000, 114800000, 123800000, 132400000, 141300000, 149900000, 169800000, 190000000, 209600000,
  229900000, 249600000, 269900000, 290100000, 310100000, 329900000, 349500000, 384600000, 419900000,
  454600000, 489500000, 524500000, 560300000, 595200000, 630100000, 664800000, 700300000, 734600000,
  769600000, 805300000, 839600000, 874500000, 910000000, 945100000, 979700000, 1014800000,
  1049300000, 1084400000, 1119900000, 1154800000, 1185600000, 1223700000, 1262300000, 1289500000,
  1328900000, 1368900000, 1397100000, 1437900000, 1466700000, 1508400000, 1537700000, 1580200000,
  1610200000, 1640300000, 1684000000, 1715000000, 1746000000, 1818000000, 1906000000, 1980000000,
  2056000000, 2118000000, 2196000000, 2275000000, 2354000000, 2420000000, 2501000000,
];

const POWER_ONI = [
  999000, 1249000, 1560000, 1950000, 2440000, 3050000, 3830000, 4770000, 6000000, 7450000, 10910000,
  14490000, 18000000, 21510000, 24970000, 28480000, 32020000, 35410000, 38930000, 42420000,
  46040000, 49400000, 53000000, 56400000, 60000000, 68000000, 76000000, 83900000, 92000000,
  100000000, 107900000, 115900000, 124100000, 131900000, 140000000, 153900000, 167900000, 182000000,
  195900000, 209900000, 224000000, 238000000, 251800000, 265900000, 279900000, 293900000, 307900000,
  322100000, 335900000, 349900000, 364100000, 377900000, 390700000, 407500000, 420800000, 434300000,
  447900000, 461700000, 475700000, 489900000, 504200000, 518800000, 533500000, 544000000, 559000000,
  574200000, 589600000, 600600000, 616300000, 632100000, 643400000, 659500000, 671100000, 687500000,
  699300000, 730600000, 762400000, 789600000, 822300000, 850300000, 878700000, 907400000, 941700000,
  971100000, 1001000000,
];

export const SEASON_MONSTERS: readonly SeasonMonster[] = [
  {
    id: 'brute',
    name: 'Booze Brute',
    rally: true,
    power: POWER_BRUTE,
    required6: [
      0, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1300, 1400, 1500, 1700, 1800, 2100, 2400,
      2700, 3000, 3300, 3600, 3900, 4200, 4500, 4800, 5000, 5200, 5400, 5600, 5800, 6000, 6200,
      6400, 6600, 6800, 7000, 7200, 7400, 7600, 7800, 8000, 8200, 8400, 8600, 8800, 9000, 9200,
      9300, 9400, 9500, 9600, 9700, 9800, 9900, 10000, 10100, 10200, 10300, 10400, 10500, 10700,
      10900, 11100, 11300, 11500, 11700, 11900, 12100, 12300, 12500, 12600, 12700, 12780, 12800,
      12820, 12840, 12860, 12880, 12900, 12920, 12940, 12960, 12980, 13000, 13020,
    ],
    required7Tail: [
      11700, 11900, 12100, 12300, 12500, 12600, 12700, 12750, 12765, 12780, 12795, 12810, 12825,
      12840, 12855, 12870, 12885, 12900, 12915, 12930,
    ],
  },
  {
    id: 'miasma-brute',
    name: '[Miasmified] Booze Brute',
    rally: true,
    power: POWER_BRUTE,
    required6: [
      500, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1800, 1900, 2000, 2200, 2300, 2600,
      2900, 3200, 3500, 3800, 4100, 4400, 4700, 5000, 5300, 5500, 5700, 5900, 6100, 6300, 6500,
      6700, 6900, 7100, 7300, 7500, 7700, 7900, 8100, 8300, 8500, 8700, 8900, 9100, 9300, 9500,
      9700, 9800, 9900, 10000, 10100, 10200, 10300, 10400, 10500, 10600, 10700, 10800, 10900, 11000,
      11200, 11400, 11600, 11800, 12000, 12100, 12200, 12300, 12400, 12500, 12600, 12700, 12780,
      12800, 12820, 12840, 12860, 12880, 12900, 12920, 12940, 12960, 12980, 13000, 13020,
    ],
    required7Tail: [
      12100, 12200, 12300, 12400, 12500, 12600, 12700, 12750, 12765, 12780, 12795, 12810, 12825,
      12840, 12855, 12870, 12885, 12900, 12915, 12930,
    ],
  },
  {
    id: 'oni',
    name: 'Rotting Oni',
    rally: false,
    power: POWER_ONI,
    required6: [
      0, 0, 0, 300, 500, 600, 700, 800, 1000, 1100, 1300, 1400, 1500, 1700, 1800, 1900, 2000, 2200,
      2300, 2400, 2500, 2700, 2800, 2900, 3000, 3200, 3300, 3400, 3500, 3700, 3800, 3900, 4000,
      4200, 4400, 4600, 4800, 5000, 5300, 5500, 5800, 6000, 6200, 6400, 6500, 6700, 6900, 7100,
      7300, 7500, 7800, 8000, 8300, 8600, 8900, 9100, 9400, 9600, 9800, 10000, 10200, 10400, 10600,
      10800, 11000, 11200, 11400, 11600, 11800, 12000, 12100, 12200, 12300, 12400, 12500, 12750,
      12780, 12810, 12840, 12870, 12900, 12930, 12960, 12990, 13020,
    ],
    required7Tail: [
      11200, 11400, 11600, 11800, 12000, 12100, 12200, 12300, 12400, 12500, 12750, 12770, 12790,
      12810, 12830, 12850, 12870, 12890, 12910, 12930,
    ],
  },
  {
    id: 'miasma-oni',
    name: '[Miasmified] Rotting Oni',
    rally: false,
    power: POWER_ONI,
    required6: [
      500, 500, 500, 800, 1000, 1100, 1200, 1300, 1500, 1600, 1800, 1900, 2000, 2200, 2300, 2400,
      2500, 2700, 2800, 2900, 3000, 3200, 3300, 3400, 3500, 3700, 3800, 3900, 4000, 4200, 4300,
      4400, 4500, 4700, 4900, 5100, 5300, 5500, 5800, 6000, 6300, 6500, 6700, 6900, 7000, 7200,
      7400, 7600, 7800, 8000, 8300, 8500, 8800, 9100, 9400, 9600, 9900, 10100, 10300, 10500, 10700,
      10900, 11100, 11300, 11500, 11700, 11900, 12100, 12300, 12500, 12600, 12700, 12780, 12800,
      12820, 12840, 12860, 12880, 12900, 12920, 12940, 12960, 12980, 13000, 13020,
    ],
    required7Tail: [
      11700, 11900, 12100, 12300, 12500, 12600, 12700, 12750, 12765, 12780, 12795, 12810, 12825,
      12840, 12855, 12870, 12885, 12900, 12915, 12930,
    ],
  },
];

/** The resistance a monster asks for at a level, or null off the ladder. */
export function requiredFor(
  monster: SeasonMonster,
  level: number,
  table: SeasonTable,
): number | null {
  if (!Number.isInteger(level) || level < 1 || level > MAX_MONSTER_LEVEL) return null;
  if (table === '7' && level >= TABLE_SPLIT_LEVEL) {
    return monster.required7Tail[level - TABLE_SPLIT_LEVEL] ?? null;
  }
  return monster.required6[level - 1] ?? null;
}

/** Recommended power at a level, or null off the ladder. */
export function powerFor(monster: SeasonMonster, level: number): number | null {
  if (!Number.isInteger(level) || level < 1 || level > MAX_MONSTER_LEVEL) return null;
  return monster.power[level - 1] ?? null;
}

/** Shortfalls worth a row in the reference strip: where the curve bends
 * (400, where the exponential piece hands over to the linear one), where
 * your damage hits its floor (990) and where the monster's hits its cap
 * (1495). */
export const CURVE_STEPS = [50, 100, 200, 300, 400, 500, 700, 990, 1200, 1495] as const;
