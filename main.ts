// ai-excited-01 — "The Door the Ocean Pours Through"
// A giant weathered wooden door stands half-open in a jungle clearing, and a
// full ocean wave pours out of it — foam bursting through the frame, curling
// past the treetops and climbing into a bright blue sky.
//
// Run locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
copyFileSync(join(here, 'entry.png'), join(outDir, 'entry.png'));
