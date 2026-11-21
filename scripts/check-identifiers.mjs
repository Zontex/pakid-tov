#!/usr/bin/env node
// Fails when a tracked file contains something that looks like a real person's
// identifier: a check-digit-valid Israeli ID number, an Israeli mobile number,
// or an email address outside the allowed domains. Fixtures must use the fake
// values listed in scripts/fake-identifiers.txt.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowed = new Set(
  readFileSync(new URL('./fake-identifiers.txt', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean),
);
const allowedEmailDomains = ['example.com', 'example.org', 'example.co.il', 'users.noreply.github.com'];
const skip = [/^LICENSE$/, /^package-lock\.json$/, /\.(png|jpe?g|gif|webp|pdf|ico|woff2?)$/i];

export function isValidIsraeliId(id) {
  if (!/^\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let v = Number(id[i]) * ((i % 2) + 1);
    if (v > 9) v -= 9;
    sum += v;
  }
  return sum % 10 === 0;
}

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !skip.some((re) => re.test(f)));

const problems = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<!\d)\d{9}(?!\d)/g)) {
      if (isValidIsraeliId(m[0]) && !allowed.has(m[0])) problems.push(`${file}:${i + 1} ID-like number ${m[0]}`);
    }
    for (const m of line.matchAll(/(?<!\d)05\d-?\d{7}(?!\d)/g)) {
      if (!allowed.has(m[0].replace('-', ''))) problems.push(`${file}:${i + 1} mobile-like number ${m[0]}`);
    }
    for (const m of line.matchAll(/[\w.+-]+@([\w-]+\.)+[\w-]{2,}/g)) {
      const domain = m[0].split('@')[1].toLowerCase();
      if (!allowedEmailDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
        problems.push(`${file}:${i + 1} email ${m[0]}`);
      }
    }
  });
}

if (problems.length) {
  console.error('Possible personal identifiers found. Use the fakes in scripts/fake-identifiers.txt:\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`Identifier check passed (${files.length} files).`);
