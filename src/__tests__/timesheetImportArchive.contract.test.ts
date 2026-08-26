import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read('supabase/migrations/20270101003400_timesheet_import_archive_permanent.sql');
const BATCH_TEXT_MIGRATION = read('supabase/migrations/20270101013000_corrigir_batch_importacao_ponto_texto.sql');
const SYSTEM_SOURCE_MIGRATION = read('supabase/migrations/20270101004200_ponto_base_interna_incremental.sql');
const INTEGRITY_MIGRATION = read('supabase/migrations/20270101013400_integridade_importacao_ponto.sql');
const IMPORT_HOOK = read('src/hooks/useTimesheet.ts');
const HISTORY_HOOK = read('src/hooks/useTimeImportLogs.ts');
const HISTORY_PANEL = read('src/components/timesheet/ImportHistoryPanel.tsx');
const PAGE = read('src/pages/Timesheet.tsx');

describe('arquivo permanente das importações do relógio de ponto', () => {
  it('mantém o mesmo lote textual nas batidas, no protocolo e no arquivo', () => {
    expect(IMPORT_HOOK).toContain('createTimesheetImportBatchId(startDate, endDate)');
    expect(IMPORT_HOOK).toContain('import_batch: batchId');
    expect(IMPORT_HOOK).toContain('batch_id: batchId');
    expect(IMPORT_HOOK).toContain('`${batchId}/${safeName}`');
    expect(BATCH_TEXT_MIGRATION).toMatch(/ALTER COLUMN batch_id TYPE text\s+USING batch_id::text/);
    expect(BATCH_TEXT_MIGRATION).toContain('WHERE tr.import_batch = tif.batch_id');
    expect(BATCH_TEXT_MIGRATION).toContain('WITH (security_invoker = true)');
  });

  it('exige o original arquivado antes de aplicar qualquer batida', () => {
    const uploadPosition = IMPORT_HOOK.indexOf(".from('timesheet-imports')");
    const importPosition = IMPORT_HOOK.indexOf("'import_time_records_with_archive'");

    expect(uploadPosition).toBeGreaterThan(-1);
    expect(importPosition).toBeGreaterThan(uploadPosition);
    expect(IMPORT_HOOK).toContain('upsert: false');
    expect(IMPORT_HOOK).toContain("archive_status: 'available'");
    expect(IMPORT_HOOK).not.toContain('archived_at: new Date().toISOString()');
    expect(INTEGRITY_MIGRATION).toContain("OLD.archive_status = 'pending' AND NEW.archive_status = 'available'");
    expect(INTEGRITY_MIGRATION).toContain('NEW.archived_at := clock_timestamp()');
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
    expect(INTEGRITY_MIGRATION).toMatch(/BEFORE INSERT OR UPDATE OR DELETE ON public\.time_import_logs/);
    expect(INTEGRITY_MIGRATION).toContain("NEW.status IS DISTINCT FROM 'processing'");
    expect(INTEGRITY_MIGRATION).toContain("OLD.status IN ('success', 'partial', 'error')");
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
    expect(HISTORY_HOOK).toContain("queryKey: ['time_import_quarantine_history']");
    expect(HISTORY_PANEL).toContain('Histórico de vínculos e classificações');
    expect(HISTORY_PANEL).toContain('ignorados no processamento');
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

  it('não faz fallback de escrita parcial quando a RPC canônica falha', () => {
    expect(IMPORT_HOOK).toContain("supabase.rpc(\n          'import_time_records_with_archive'");
    expect(IMPORT_HOOK).not.toContain('falling back to chunked insert');
    expect(IMPORT_HOOK).not.toContain('mergeImportedTimePunches');
    expect(IMPORT_HOOK).not.toContain("supabase.from('time_records').insert(rec)");
    expect(IMPORT_HOOK).not.toContain('useDeleteBatch');
  });

  it('propaga ao protocolo as linhas inválidas descartadas pelo parser', () => {
    expect(PAGE).toContain('preSkipped: parsed.skippedRows');
    expect(PAGE).toContain('preSkipped: preview.preSkipped');
    expect(PAGE).toContain('Inválidos preservados no protocolo');
    expect(IMPORT_HOOK).toContain('skipped_count: 0');
    expect(IMPORT_HOOK).toContain('let skipped = preSkipped');
    expect(IMPORT_HOOK).toContain('p_pre_skipped: skipped');
    expect(IMPORT_HOOK).toContain('total_rows: uniqueRecords.length + preSkipped');
    expect(IMPORT_HOOK).toContain('missingExternalIdRows++');
    expect(IMPORT_HOOK).toContain('const preSkipped = parserSkipped + missingExternalIdRows');
    expect(PAGE).toContain('não entram na folha nem na quarentena vinculável');
  });

  it('exige declaração explícita de cobertura nos formatos sem cabeçalho confiável', () => {
    expect(PAGE).toContain('requiresCoverageConfirmation: true');
    expect(PAGE).toContain('Confirme o período coberto pela exportação');
    expect(PAGE).toContain('Confirmar período coberto');
    expect(PAGE).toContain('coverageConfirmed: !datedResult.requiresCoverageConfirmation');
    expect(PAGE).toContain('batchId: preview.batchId');
    expect(IMPORT_HOOK).toContain('params.batchId.startsWith');
    expect(PAGE).toContain('(preview.requiresCoverageConfirmation && preview.endDate > todayStr)');
  });

  it('exige escopo explícito e não transforma arquivo filtrado em cobertura global', () => {
    expect(PAGE).toContain('coverageScope: null');
    expect(PAGE).toContain('Todo o quadro de funcionários');
    expect(PAGE).toContain('Somente funcionários selecionados');
    expect(PAGE).toContain('coverageScope: preview.coverageScope');
    expect(IMPORT_HOOK).toContain("coverage_scope: params.coverageScope");
    expect(IMPORT_HOOK).toContain('covered_employee_external_ids: coveredEmployeeExternalIds');
    expect(IMPORT_HOOK).toContain("log.coverage_scope !== 'all_employees'");
    expect(IMPORT_HOOK).toContain("batchId.startsWith('manual_') || modernBatchIds.has(batchId)");
    expect(IMPORT_HOOK).toContain('protocol.coverage_scope === params.coverageScope');
    expect(IMPORT_HOOK).toContain('protocol.covered_employee_external_ids');
    expect(INTEGRITY_MIGRATION).toContain("coverage_scope = 'legacy_unverified'");
    expect(INTEGRITY_MIGRATION).toContain("NEW.coverage_scope NOT IN ('all_employees', 'listed_employees')");
    expect(INTEGRITY_MIGRATION).toContain('O payload contém matrícula fora do escopo imutável do protocolo');
    expect(INTEGRITY_MIGRATION).toContain('não contém todas as matrículas vigentes no período');
  });

  it('reutiliza o protocolo da prévia quando a resposta do servidor se perde', () => {
    expect(IMPORT_HOOK).toContain(".eq('batch_id', candidateBatchId)");
    expect(IMPORT_HOOK).toContain('protocolos processando/concluídos são sempre');
    expect(IMPORT_HOOK).toContain("const replay = await supabase.rpc('import_time_records_with_archive', rpcArgs)");
    expect(IMPORT_HOOK).toContain('processamento aguardando nova tentativa idempotente');
  });

  it('atualiza as coberturas dependentes e preserva o preview em erro', () => {
    expect(IMPORT_HOOK).toContain("queryKey: ['timesheet_coverage']");
    expect(IMPORT_HOOK).toContain("queryKey: ['payroll-comp-records']");
    expect(IMPORT_HOOK).toContain('result.inserted === 0 && result.updated > 0');

    const mutateStart = PAGE.indexOf('importRecords.mutate({');
    const successStart = PAGE.indexOf('onSuccess: () => {', mutateStart);
    const clearPreview = PAGE.indexOf('setPreview(null)', mutateStart);
    const mutateEnd = PAGE.indexOf('});', successStart);
    expect(mutateStart).toBeGreaterThan(-1);
    expect(clearPreview).toBeGreaterThan(successStart);
    expect(clearPreview).toBeLessThan(mutateEnd);
  });

  it('importa válidos e preserva matrículas sem vínculo na quarentena', () => {
    expect(PAGE).toContain('record.punches.length === 0) return false');
    expect(PAGE).toContain('recordDate,');
    expect(PAGE).toContain('allowNameFallback: false');
    expect(PAGE).toContain('irão para quarentena');
    expect(PAGE).toContain('unmatchedRecordCount >= importableRecordCount');
    expect(IMPORT_HOOK).toContain('unmatched: unmatchedCount');
  });

  it('não oferece lote de arquivo como filtro operacional', () => {
    expect(PAGE).not.toContain('Importação específica');
    expect(PAGE).toContain('Avaliação pela base do sistema');
    expect(PAGE).toContain('não é necessário editar o arquivo original');
  });
});
