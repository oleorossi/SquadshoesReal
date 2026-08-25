import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const CONFIG = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
const TOMBSTONE = readFileSync(
  resolve(ROOT, 'supabase/functions/gc-probe-temp/index.ts'),
  'utf8',
);

describe('tombstone do probe fiscal órfão', () => {
  it('exige JWT no gateway e encerra chamadas com 410', () => {
    expect(CONFIG).toMatch(
      /\[functions\.gc-probe-temp\]\s*\nverify_jwt = true/,
    );
    expect(TOMBSTONE).toContain('status: 410');
    expect(TOMBSTONE).toContain('endpoint_retired');
    expect(TOMBSTONE).not.toContain('Access-Control-Allow-Origin": "*"');
  });

  it('não mantém cliente, segredo ou chamada ao provedor fiscal', () => {
    expect(TOMBSTONE).not.toMatch(/createClient|fetch\s*\(/);
    expect(TOMBSTONE).not.toMatch(
      /CLICKNOTAS|GESTAOCLICK|SUPABASE_SERVICE_ROLE_KEY|decrypted_secret/i,
    );
  });
});
