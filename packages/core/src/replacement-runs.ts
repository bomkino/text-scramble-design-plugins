export interface ReplacementRun {
  characterIndex: number;
  start: number;
  end: number;
  replacement: string;
}

export function buildReplacementRuns(source: string, output: string): ReplacementRun[] {
  const sourceCharacters = Array.from(source);
  const outputCharacters = Array.from(output);

  if (sourceCharacters.length !== outputCharacters.length) {
    throw new Error("Scrambled text must preserve the source character structure.");
  }

  const runs: ReplacementRun[] = [];
  let start = 0;

  sourceCharacters.forEach((character, characterIndex) => {
    const end = start + character.length;
    const replacement = outputCharacters[characterIndex];

    if (character !== replacement) {
      runs.push({ characterIndex, start, end, replacement });
    }

    start = end;
  });

  return runs;
}
