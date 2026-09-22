import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CUTOVER_VERSION } from '../../scripts/check-supabase-migration-cutover.mjs';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const REPAIR_FILE = '20270101027300_remap_mcp_stamp_promote_op_on_first_pointing.sql';
const CANONICAL_FILE = '20270101027000_promote_op_on_first_pointing.sql';
const DUPLICATE_STAMP = '20260921193727';

describe('carimbo MCP promote_op_on_first_pointing abaixo do cutover', () => {
  it('não reintroduz o timestamp de calendário como arquivo local', () => {
    const files = readdirSync(MIGRATIONS).filter((file) =>
      file.startsWith(`${DUPLICATE_STAMP}_`),
    );
    expect(files).toEqual([]);
    expect(DUPLICATE_STAMP < CUTOVER_VERSION).toBe(true);
  });

  it('mantém o carimbo canônico 27000 e o UPDATE idempotente do duplicado', () => {
    expect(existsSync(resolve(MIGRATIONS, CANONICAL_FILE))).toBe(true);
    const sql = readFileSync(resolve(MIGRATIONS, REPAIR_FILE), 'utf8');
    expect(sql).toContain(`version = '${DUPLICATE_STAMP}'`);
    expect(sql).toContain("name = 'promote_op_on_first_pointing'");
    expect(sql).toContain("canonical.version = '20270101027000'");
    expect(sql).toMatch(/UPDATE supabase_migrations\.schema_migrations/i);
  });
});
