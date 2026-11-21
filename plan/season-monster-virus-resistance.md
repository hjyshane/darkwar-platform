# Season monster virus resistance — penalty curve (client data, 2026-11-20)

Sources: `aps_monster` datatable (`C:\DW_data\gamedata\base`), `SeasonUtil.lua`
bytecode from `install_time_pack.apk` (`GetSeasonResistanceSelf/Other`), and
the server-sent `new_battle_config` captured in `live.db`.

## Formula

```
deficit = monster.monster_buff - my_virus_resistance        (<= 0 → no effect)
param   = aps_monster.monster_dmg_param = "0.0027;1000;6;0;400|0.2;1000;1;0"
          group = "a;b;n;c;upper"; first group applies while deficit < upper (400),
          last group applies beyond.

my damage  = max(1 - deficit / b, k22)        b = 1000, k22 = 0.01   → floor -99%
monster dmg = min((1 + a*deficit)^n + c, k24)                         k24 = 300  → cap +29900%
   deficit < 400 : (1 + 0.0027*d)^6
   deficit >= 400: 1 + 0.2*d
```

`new_battle_config` (server): k21=100, k22=0.01, k23=30, k24=300. k21/k23 did
not change either output over 0..9700 in sandbox runs.

Verified against screenshot: Lv.52 Booze Brute, 8,500/9,700 → -99.0% / +24000.0%.

## Curve (deficit = required - mine)

| deficit | my dmg | monster dmg |
|--------:|-------:|------------:|
| 0 | 0% | +0% |
| 10 | -1% | +17% |
| 50 | -5% | +114% |
| 100 | -10% | +320% |
| 200 | -20% | +1234% |
| 300 | -30% | +3416% |
| 400 | -40% | +7998% |
| 500 | -50% | +10000% |
| 700 | -70% | +14000% |
| 900 | -90% | +18000% |
| 990+ | -99% (floor) | +19800% |
| 1200 | -99% | +24000% |
| 1495+ | -99% | +29900% (cap) |

## Required resistance (`monster_buff`) by level

Rows with `world_season` `6;7` cover lv1-65 (shared); lv66-85 split by season 6 / 7.

| lv | Booze Brute | Rotting Oni | [Miasmified] Brute | [Miasmified] Oni |
|---:|---:|---:|---:|---:|
| 10 | 1000 | 1100 | 1500 | 1600 |
| 20 | 3300 | 2400 | 3800 | 2900 |
| 30 | 5800 | 3700 | 6300 | 4200 |
| 40 | 7800 | 5500 | 8300 | 6000 |
| 50 | 9500 | 7500 | 10000 | 8000 |
| 52 | 9700 | 8000 | 10200 | 8500 |
| 60 | 10500 | 10000 | 11000 | 10500 |
| 65 | 11500 | 11000 | 12000 | 11500 |
| 66 (s6/s7) | 11700 | 11200 | 12100 | 11700 |
| 70 | 12500 | 12000 | 12500 | 12500 |
| 80 (s6/s7) | 12920 / 12855 | 12870 / 12830 | 12920 / 12855 | 12920 / 12855 |
| 85 (s6/s7) | 13020 / 12930 | 13020 / 12930 | 13020 / 12930 | 13020 / 12930 |

## Lv 80-85: recommended power + required resistance

`recommend_power` is identical for plain and [Miasmified]; `force`=150 at 80+.

| lv | Booze Brute CP | Rotting Oni CP | buff s6 (Brute / Oni) | buff s7 (Brute / Oni) |
|---:|---:|---:|---:|---:|
| 80 | 2,118,000,000 | 850,300,000 | 12920 / 12870 | 12855 / 12830 |
| 81 | 2,196,000,000 | 878,700,000 | 12940 / 12900 | 12870 / 12850 |
| 82 | 2,275,000,000 | 907,400,000 | 12960 / 12930 | 12885 / 12870 |
| 83 | 2,354,000,000 | 941,700,000 | 12980 / 12960 | 12900 / 12890 |
| 84 | 2,420,000,000 | 971,100,000 | 13000 / 12990 | 12915 / 12910 |
| 85 | 2,501,000,000 | 1,001,000,000 | 13020 / 13020 | 12930 / 12930 |

Miasmified rows (`must_infect`=1) share the CP and, at 80+, the Brute buff ladder.
Booze Brute is `boss`=1 (rally); Rotting Oni `boss`=0 (single).
