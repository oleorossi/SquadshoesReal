import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const CONFIG = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
const TOMBSTONE = readFileSync(
  resolve(ROOT, 'supabase/functions/gc-probe-temp/index.ts'),
  'utf8',
);

const DIAGNOSTIC_TOMBSTONE = readFileSync(
  resolve(ROOT, 'supabase/functions/gc-diag/index.ts'),
  'utf8',
);
const CERTIFICATE_TOMBSTONE = readFileSync(
  resolve(ROOT, 'supabase/functions/setup-nfe-certificate/index.ts'),
  'utf8',
);

const FISCAL_TOMBSTONES = [
  ['gc-probe-temp', TOMBSTONE],
  ['gc-diag', DIAGNOSTIC_TOMBSTONE],
  ['setup-nfe-certificate', CERTIFICATE_TOMBSTONE],
] as const;

describe('tombstones dos utilitários fiscais órfãos', () => {
  it('exigem JWT no gateway e encerram chamadas com 410', () => {
    for (const [slug, source] of FISCAL_TOMBSTONES) {
      expect(CONFIG).toMatch(
        new RegExp(`\\[functions\\.${slug}\\]\\s*\\nverify_jwt = true`),
      );
      expect(source).toContain('status: 410');
      expect(source).toContain('endpoint_retired');
      expect(source).not.toMatch(
        /Access-Control-Allow-Origin["']?\s*:\s*["']\*/,
      );
    }
  });

  it('não mantém cliente, segredo ou chamada ao provedor fiscal', () => {
    for (const [, source] of FISCAL_TOMBSTONES) {
      expect(source).not.toMatch(/createClient|fetch\s*\(/);
      expect(source).not.toMatch(
        /CLICKNOTAS|GESTAOCLICK|SUPABASE_SERVICE_ROLE_KEY|decrypted_secret/i,
      );
    }
  });
});
