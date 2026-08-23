import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read('supabase/migrations/20270101003400_timesheet_import_archive_permanent.sql');
const SYSTEM_SOURCE_MIGRATION = read('supabase/migrations/20270101004200_ponto_base_interna_incremental.sql');
const IMPORT_HOOK = read('src/hooks/useTimesheet.ts');
const HISTORY_HOOK = read('src/hooks/useTimeImportLogs.ts');
const HISTORY_PANEL = read('src/components/timesheet/ImportHistoryPanel.tsx');
const PAGE = read('src/pages/Timesheet.tsx');

describe('arquivo permanente das importações do relógio de ponto', () => {
  it('exige o original arquivado antes de aplicar qualquer batida', () => {
    const uploadPosition = IMPORT_HOOK.indexOf(".from('timesheet-imports')");
    const importPosition = IMPORT_HOOK.indexOf("'import_time_records_with_archive'");

    expect(uploadPosition).toBeGreaterThan(-1);
    expect(importPosition).toBeGreaterThan(uploadPosition);
    expect(IMPORT_HOOK).toContain('upsert: false');
    expect(IMPORT_HOOK).toContain("archive_status: 'available'");
    expect(IMPORT_HOOK).toContain('nenhuma batida foi aplicada');
  });

  it('fecha o protocolo e as batidas na mesma transação do banco', () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.import_time_records_with_archive/);
    expect(MIGRATION).toMatch(/archive_status = 'available'/);
    expect(MIGRATION).toMatch(/v_result := public\.import_time_records_safe/);
    expect(MIGRATION).toMatch(/UPDATE public\.time_import_logs[\s\S]*status = 'success'/);
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION public\.import_time_records_with_archive[\s\S]*FROM PUBLIC, anon/);
  });

  it('impede exclusão e substituição do histórico permanente', () => {
    expect(MIGRATION).toMatch(/BEFORE UPDATE OR DELETE ON public\.time_import_logs/);
    expect(MIGRATION).toMatch(/O histórico de arquivos de ponto é permanente/);
    expect(MIGRATION).toMatch(/\(tif\.archive_status = 'available'\) AS has_archived_file/);
    expect(MIGRATION).toMatch(/DROP POLICY IF EXISTS "approved_delete" ON public\.time_import_logs/);
    expect(MIGRATION).toMatch(/DROP POLICY IF EXISTS "timesheet_imports_authenticated_delete" ON storage\.objects/);
    expect(IMPORT_HOOK).toContain('upsert: false');
    expect(HISTORY_PANEL).not.toContain('DeleteConfirmButton');
  });

  it('lista todo o histórico e força download do binário original', () => {
    expect(HISTORY_HOOK).toContain('.range(from, from + PAGE_SIZE - 1)');
    expect(HISTORY_HOOK).not.toContain('.limit(200)');
    expect(HISTORY_HOOK).toContain(".download(filePath)");
    expect(HISTORY_HOOK).toContain('anchor.download = fileName');
  });

  it('expõe os arquivos em uma aba própria do módulo de ponto', () => {
    expect(PAGE).toContain("values: ['records', 'manual', 'ausencias', 'arquivos', 'config']");
    expect(PAGE).toContain("calendario: 'records'");
    expect(PAGE).not.toContain('value="calendario"');
    expect(PAGE).toContain("value: 'arquivos'");
    expect(PAGE).toContain('<TabsContent value="arquivos"><ImportHistoryPanel /></TabsContent>');
    expect(HISTORY_PANEL).toContain('Os documentos não podem ser excluídos');
    expect(HISTORY_PANEL).toContain('Baixar original');
  });

  it('reimporta dias existentes e deixa as lacunas para o calendário interno', () => {
    expect(IMPORT_HOOK).toContain('const toInsert = uniqueRecords');
    expect(IMPORT_HOOK).not.toContain('const toInsert = uniqueRecords.filter');
    expect(IMPORT_HOOK).toContain('rec.punches.length === 0) continue');
    expect(SYSTEM_SOURCE_MIGRATION).toContain('upd_count := upd_count + 1');
    expect(SYSTEM_SOURCE_MIGRATION).toContain("jsonb_array_length(rec->'punches') = 0");
    expect(SYSTEM_SOURCE_MIGRATION).toContain('merge_time_record_punches');
  });

  it('não oferece lote de arquivo como filtro operacional', () => {
    expect(PAGE).not.toContain('Importação específica');
    expect(PAGE).toContain('Avaliação pela base do sistema');
    expect(PAGE).toContain('não é necessário editar o arquivo original');
  });
});
