# Wave-Dragon — ai-excited-01

A program that draws one image meant to excite an AI judge: a giant ocean
wave that is also a dragon, curling over at sunset, with the setting sun
shining through as the dragon's eye — and a lone surfer riding inside the
curl, lit by the warm light glowing through the barrel.

This is my entry for the make.fun competition
[ai-excited-01](https://make.fun/c/ai-excited-01) ("Make the AI judge
excited"). The image is drawn entirely by code: there are no photos, no
downloaded assets, and no network calls. Everything you see — the sky
gradient, the sun, the wave, the dragon's horn, teeth and eye, the surfer,
the spray, the birds — is computed from a few dozen bezier curves and a
seeded random generator.

## Why this image

The judge weighs five things, most important first: excitement, surprise,
momentum, craft, and reading clearly at small size. The entry is built
around one big idea per criterion:

- **Excitement:** a huge curling wave fills most of the frame, and the
  brightest thing in the picture — the sun — sits exactly where a dragon's
  eye would be.
- **Surprise:** the wave *is* the dragon. Its lip is a snout, its crest
  carries a horn, its jaw has teeth, and its eye is literally the sun.
  Inside the barrel, warm light glows through the tube like the wave is
  alive from within.
- **Momentum:** the whole composition leans one way — the wave rises from
  the lower left, sweeps up and over to the right, and the foam, spray and
  the surfer's wake all run along that same curve toward the sun.
- **Craft:** flat vector shapes with clean edges (rendered at 2x and
  downsampled), a small fixed palette, and no text anywhere in the image.
- **Reads small:** one giant shape (the wave-dragon), one bright disc (the
  sun-eye), one small dark rider. At 300 pixels across, all three still
  read.

## How it works

`main.ts` is a small self-contained renderer written in TypeScript with only
Node's standard library (`node:fs`, `node:zlib`, `node:path`). It keeps an
RGB buffer at 2x resolution, draws the scene with its own scanline polygon
filler, bezier flattener, thick-stroke and glow helpers, downsamples to
1024x683, and encodes a PNG with its own chunk writer and `zlib` deflate.
The random spray and stars come from a seeded generator (`mulberry32`), so
every run writes byte-identical output: run it twice and the files match.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

That writes `out/entry.png` (PNG, 1024x683, under 1 MiB). The program also
accepts an optional variant number — the four compositions explored while
building this entry — with variant 1 as the default:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts 1   # Sun-Eye (the submitted image)
MAKEFUN_OUTPUT_DIR=out node main.ts 2   # Starlit Barrel
MAKEFUN_OUTPUT_DIR=out node main.ts 3   # Moon-tide Panorama
MAKEFUN_OUTPUT_DIR=out node main.ts 4   # One-Line Dragon
```

Variant 1 won the internal judging: the other three were kept in the code
as alternates, but the entry that ships is variant 1. `entry.png` in this
repository is the exact output of the default run.

## License

MIT. See `LICENSE`.
