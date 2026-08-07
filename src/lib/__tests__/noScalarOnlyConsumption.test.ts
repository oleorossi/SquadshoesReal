import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCALAR_CONSUMPTION = /\b(?:upper|lining|insole)_consumption\b/;
const PER_SIZE_CONSUMPTION = /\b(?:upper|lining|insole)_consumption_per_size\b/;
const CANONICAL_RPC = /\b(?:calculate_order_consumption_by_grade|compute_materials_per_pv)\b/;

const collectTsxFiles = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTsxFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) files.push(path);
  }
  return files;
};

describe('guard contra consumo baseado somente em escalar', () => {
  it('proíbe leitores escalares sem per-size ou RPC canônico em components/pages', () => {
    const root = process.cwd();
    const files = [
      ...collectTsxFiles(resolve(root, 'src/components')),
      ...collectTsxFiles(resolve(root, 'src/pages')),
    ];

    const offenders = files
      .filter(file => {
        const source = readFileSync(file, 'utf8');
        return SCALAR_CONSUMPTION.test(source)
          && !PER_SIZE_CONSUMPTION.test(source)
          && !CANONICAL_RPC.test(source);
      })
      .map(file => relative(root, file))
      .sort();

    expect(
      offenders,
      `Arquivos que leem consumo escalar sem per-size/RPC canônico:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
