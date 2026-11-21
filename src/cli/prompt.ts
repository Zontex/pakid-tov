import { createInterface } from 'node:readline';

export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/** Reads a line without echoing it (card numbers, passphrases). */
export function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const internal = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
  let prompted = false;
  internal._writeToOutput = (s: string) => {
    if (!prompted) {
      internal.output.write(s);
      prompted = true;
    }
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

/** ["a=1", "b=2"] -> { a: "1", b: "2" } */
export function parsePairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i < 1) throw new Error(`Expected key=value, got "${p}"`);
    out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}
