// Writes packages/core/test-vectors.json: fixed inputs, seeds and the output the core gives for them.
// Every copy of the engine (the Raycast extension and the classic InDesign script) must reproduce these
// exactly. Run `npm run test-vectors` only after an intended change to the algorithm.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [path.join(root, "packages", "core", "src", "scramble-text.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
});
const core = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const cases = [
  { inputs: ["Stories deserve more than a template."], seed: 1 },
  { inputs: ["We shape complex ideas into clear, compelling worlds."], seed: "studio" },
  { inputs: ["Quiet confidence. Human texture. A little bit of magic."], seed: 2026 },
  { inputs: ["SHAPE Shape shape — sHaPe"], seed: "case" },
  { inputs: ["Café résumé naïve, crème brûlée and a façade."], seed: "accents" },
  { inputs: ["Café résumé naïve, crème brûlée and a façade.".normalize("NFD")], seed: "accents" },
  { inputs: ["Đặng Việt · Ångström · Łódź · Ñandú · São Paulo"], seed: 7 },
  { inputs: ["ǅuro İstanbul ıi ß Æsir Œuvre"], seed: 8 },
  { inputs: ["한국어 東京 Ελληνικά Русский עברית"], seed: 9 },
  { inputs: ["Edition 2026 · ２０２６ · ٢٠٢٦ · ۲۰۲۶ · २०२६ · 𝟚𝟘𝟚𝟞 · Ⅷ ½ ²"], seed: 10 },
  { inputs: ["Edition 2026, page 14 of 120."], seed: 10, scrambleNumbers: false },
  { inputs: ["Watch the reflect toSource unwatch constructor valueOf __proto__ hasOwnProperty prototype"], seed: "es3" },
  { inputs: ["Sloane met Ruby in Lisbon.", "RUBY and SLOANE, 2026", "", "  — ✦\n\t…  "], seed: "deck" },
  { inputs: ["A quiet title\n\nDesign\twith soul — always.\nhello@example.com · 2026 ✦"], seed: 0 },
];

const vectors = cases.map(({ inputs, seed, scrambleNumbers }) => {
  const options = scrambleNumbers === undefined ? { seed } : { seed, scrambleNumbers };
  return { inputs, options, outputs: core.scrambleTexts(inputs, options) };
});

await writeFile(path.join(root, "packages", "core", "test-vectors.json"), JSON.stringify(vectors, null, 2) + "\n");
console.log(`Wrote ${vectors.length} test vectors.`);
