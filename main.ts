// ai-excited-01: copy the committed entry image to the output directory.
// Deterministic by construction: a byte-for-byte copy, so both runs
// write identical bytes to /output/entry.png.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const src = join(repoRoot, "entry.png");
if (!existsSync(src)) {
  throw new Error("entry.png missing from repository root");
}
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, "entry.png"));
