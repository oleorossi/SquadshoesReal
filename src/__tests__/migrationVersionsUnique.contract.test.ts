import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations');

describe('histórico local de migrations', () => {
  it('usa uma única migration por versão', () => {
    const versions = readdirSync(MIGRATIONS)
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .map((name) => name.slice(0, 14));

    expect(new Set(versions).size).toBe(versions.length);
  });
});
