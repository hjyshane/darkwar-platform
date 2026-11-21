# Virus Resistance — infosheet copy

Source: game client tables + server battle config, read 2026-11-20.
Calculator: cbfw.us → Calculator → Virus resistance.

## Headline

**Short on virus resistance? You hit for less and the monster hits for far more.
Both come from one number: how many points short you are.**

## The rule

- **Your damage:** −0.1% for every point short. Floor −99%.
- **Monster damage:** climbs on a curve. Short by 100 → ×4. Short by 400 → ×81.
  Past 400 it is +20% per point short. Cap ×300 (+29,900%).
- **At or above the requirement: no penalty at all.** Extra resistance does nothing.

## What a shortfall costs

| Short by | Your damage | Monster damage |
|---:|---:|---:|
| 50 | −5% | +114% |
| 100 | −10% | +320% |
| 200 | −20% | +1,234% |
| 300 | −30% | +3,416% |
| 400 | −40% | +7,998% |
| 500 | −50% | +10,000% |
| 700 | −70% | +14,000% |
| 990 | −99% | +19,800% |
| 1,200 | −99% | +24,000% |
| 1,495+ | −99% | +29,900% (cap) |

Rule of thumb: **100 short is already a losing fight. 300 short is a wipe.**

## What each monster asks for

Required virus resistance by level (Table A / Table B where they differ).

| Lv | Booze Brute (rally) | Rotting Oni (single) | Miasmified Brute | Miasmified Oni |
|---:|---:|---:|---:|---:|
| 30 | 5,800 | 3,700 | 6,300 | 4,200 |
| 40 | 7,800 | 5,500 | 8,300 | 6,000 |
| 50 | 9,500 | 7,500 | 10,000 | 8,000 |
| 60 | 10,500 | 10,000 | 11,000 | 10,500 |
| 65 | 11,500 | 11,000 | 12,000 | 11,500 |
| 70 | 12,500 | 12,000 | 12,500 | 12,500 |
| 75 | 12,820 / 12,765 | 12,500 / 12,500 | 12,820 / 12,765 | 12,820 / 12,765 |
| 80 | 12,920 / 12,855 | 12,870 / 12,830 | 12,920 / 12,855 | 12,920 / 12,855 |
| 85 | 13,020 / 12,930 | 13,020 / 12,930 | 13,020 / 12,930 | 13,020 / 12,930 |

Miasmified versions want about +500 more at low levels and the same at 70+.

## Top end: Lv 80–85

| Lv | Booze Brute CP | Rotting Oni CP | Resistance (A / B) |
|---:|---:|---:|---:|
| 80 | 2.12G | 850M | 12,920 / 12,855 |
| 81 | 2.20G | 879M | 12,940 / 12,870 |
| 82 | 2.28G | 907M | 12,960 / 12,885 |
| 83 | 2.35G | 942M | 12,980 / 12,900 |
| 84 | 2.42G | 971M | 13,000 / 12,915 |
| 85 | 2.50G | 1.00G | 13,020 / 12,930 |

CP = the game's recommended power. Same for plain and Miasmified.

## Takeaways

1. Resistance is a hard gate, not a stat to balance. Meet it, then stop.
2. Check the attack panel: "8,500 / 9,700" means 1,200 short → −99% / +24,000%.
3. Target ≈13,000 to clear every Lv 85 on either table.
4. Virus Lab is the only source that scales. Build and upgrade it first on contaminated tiles.
