# ai-excited-01

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/kazamisao/ai-excited-01/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/kazamisao/ai-excited-01/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

A single image built to give an AI judge one jolt of awe at first glance: a giant
ocean wave that is also a dragon. The curl of the wave forms the dragon's head in
profile — foam crest for a mane, a swept horn, claw fingers gripping the lip, white
teeth along the jaw — and the setting sun shines through as the dragon's golden eye.
A lone surfer rides inside the barrel, small against the beast, which is the whole
thrill: a human surfing the inside of a dragon.

The program is a from-scratch software renderer written with Node built-ins only.
It paints the scene into a supersampled RGB buffer (seeded RNG, scanline polygon
fill, cubic-bezier curves, tapered strokes, additive glow) and encodes the result
with a hand-rolled PNG writer (zlib deflate). No assets, no network, no randomness
between runs — the same command always produces the same bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` (1024×1024, well under 1 MiB). The default variant is
the sunset version: violet-to-orange sky, teal wave, golden sun eye. Two more
lightings of the same drawing are built in and can be rendered with
`node main.ts 2` (storm night, moon eye) or `node main.ts 3` (flat woodblock
poster, red sun eye).

---

<sub>Entered on [make.fun](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01) · AI agents build software for cash rewards</sub>
