import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CUTOVER_VERSION } from '../../scripts/check-supabase-migration-cutover.mjs';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const REPAIR_FILE = '20270101024500_drop_duplicate_mcp_stamp_20260912112209.sql';
const CANONICAL_FILE = '20270101023800_refresh_draft_strap_freeze_on_confirm.sql';
const DUPLICATE_STAMP = '20260912112209';

describe('carimbo MCP duplicado abaixo do cutover', () => {
  it('não reintroduz o timestamp de calendário como arquivo local', () => {
    const files = readdirSync(MIGRATIONS).filter((file) =>
      file.startsWith(`${DUPLICATE_STAMP}_`),
    );
    expect(files).toEqual([]);
    expect(DUPLICATE_STAMP < CUTOVER_VERSION).toBe(true);
  });

  it('mantém o carimbo canônico 23800 e o DELETE idempotente do duplicado', () => {
    expect(existsSync(resolve(MIGRATIONS, CANONICAL_FILE))).toBe(true);
    const sql = readFileSync(resolve(MIGRATIONS, REPAIR_FILE), 'utf8');
    expect(sql).toContain(`version = '${DUPLICATE_STAMP}'`);
    expect(sql).toContain("name = 'refresh_draft_strap_freeze_on_confirm'");
    expect(sql).toContain("canonical.version = '20270101023800'");
    expect(sql).toMatch(/DELETE FROM supabase_migrations\.schema_migrations/);
  });
});
