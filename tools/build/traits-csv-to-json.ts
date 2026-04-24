/**
 * Build-time CSV → JSON transform for the 85-robot trait roster.
 *
 * Reads design/data/robots-traits.csv, validates it against the v1 contract,
 * and writes public/traits.json atomically (temp file + rename) so Vite never
 * sees a half-written artifact.
 *
 * Contract specified in design/gdd/build-deploy-pipeline.md Sections 3 + 5.
 *
 * IMPORTANT: This script does NOT import from src/. The output path
 * `public/traits.json` is hardcoded here and must align with
 * CONFIG.build.traitsJsonPath (`/traits.json`). Coordination is enforced
 * by code review (and a unit test in src/config/index.test.ts).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');

const INPUT_PATH = resolve(REPO_ROOT, 'design/data/robots-traits.csv');
const OUTPUT_PATH = resolve(REPO_ROOT, 'public/traits.json');
const TEMP_PATH = resolve(REPO_ROOT, 'public/.traits.json.tmp');

const EXPECTED_ROW_COUNT = 85;
const MAX_TRAIT_SUM = 100;
const REQUIRED_COLUMNS = [
  'id',
  'name',
  'full_send',
  'degen',
  'cipher',
  'doubter',
  'altruist',
] as const;

interface RobotRecord {
  id: number;
  name: string;
  full_send: number;
  degen: number;
  cipher: number;
  doubter: number;
  altruist: number;
}

function fail(message: string): never {
  process.stderr.write(`[build:traits] ${message}\n`);
  process.exit(1);
}

function readCsv(path: string): string {
  if (!existsSync(path)) {
    fail(`Cannot read file: ${path}`);
  }
  let raw = readFileSync(path, 'utf-8');
  // Strip UTF-8 BOM if present.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  // Detect UTF-16 (would have lots of null bytes after charCode 0xfeff/0xfffe).
  if (raw.length > 1 && raw.charCodeAt(0) === 0 && raw.charCodeAt(1) !== 0) {
    fail(`Expected UTF-8, got UTF-16 (or other multi-byte encoding) at ${path}. Re-export as UTF-8 CSV.`);
  }
  return raw;
}

function parseCsv(raw: string): { header: string[]; rows: string[][] } {
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) fail('CSV is empty.');
  const header = lines[0].split(',').map((cell) => cell.trim());
  const rows = lines.slice(1).map((line, i) => {
    const cells = line.split(',');
    if (cells.length !== header.length) {
      fail(`Row ${i + 2}: expected ${header.length} columns, found ${cells.length}.`);
    }
    return cells.map((cell) => cell.trim());
  });
  return { header, rows };
}

function validateHeader(header: string[]): void {
  for (const required of REQUIRED_COLUMNS) {
    if (!header.includes(required)) {
      fail(`Missing required column: '${required}'. Header was: [${header.join(', ')}]`);
    }
  }
}

function buildRecord(header: string[], cells: string[], rowIndex: number): RobotRecord {
  const get = (col: string): string => {
    const idx = header.indexOf(col);
    return cells[idx];
  };
  const num = (col: string): number => {
    const v = Number(get(col));
    if (!Number.isFinite(v)) {
      fail(`Row ${rowIndex + 2}: column '${col}' is not numeric (got '${get(col)}').`);
    }
    return v;
  };
  return {
    id: num('id'),
    name: get('name'),
    full_send: num('full_send'),
    degen: num('degen'),
    cipher: num('cipher'),
    doubter: num('doubter'),
    altruist: num('altruist'),
  };
}

function validateRecords(records: RobotRecord[]): void {
  if (records.length !== EXPECTED_ROW_COUNT) {
    fail(`Expected ${EXPECTED_ROW_COUNT} rows, found ${records.length}.`);
  }
  const seenIds = new Set<number>();
  for (const r of records) {
    if (seenIds.has(r.id)) fail(`Duplicate id: ${r.id}.`);
    seenIds.add(r.id);
    const sum = r.full_send + r.degen + r.cipher + r.doubter + r.altruist;
    if (sum > MAX_TRAIT_SUM) {
      fail(`Row id=${r.id}: trait sum is ${sum}, must be ≤ ${MAX_TRAIT_SUM}.`);
    }
  }
}

function writeAtomic(path: string, tempPath: string, contents: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Clean any leftover temp file from an interrupted prior run.
  if (existsSync(tempPath)) {
    try {
      writeFileSync(tempPath, '');
    } catch {
      // Ignored — rename will overwrite.
    }
  }
  writeFileSync(tempPath, contents, 'utf-8');
  renameSync(tempPath, path);
}

function main(): void {
  const raw = readCsv(INPUT_PATH);
  const { header, rows } = parseCsv(raw);
  validateHeader(header);
  const records = rows.map((cells, i) => buildRecord(header, cells, i));
  validateRecords(records);
  writeAtomic(OUTPUT_PATH, TEMP_PATH, JSON.stringify(records, null, 2) + '\n');
  process.stdout.write(`[build:traits] Wrote ${records.length} records → public/traits.json\n`);
}

main();
