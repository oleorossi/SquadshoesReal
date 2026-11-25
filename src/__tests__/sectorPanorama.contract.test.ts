import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const MIG_DIR = resolve(ROOT, 'supabase/migrations');
const migName = readdirSync(MIG_DIR).find(f => f.endsWith('_gestao_setores_panorama.sql'))!;
const MIG = readFileSync(resolve(MIG_DIR, migName), 'utf8');
const HOOK = readFileSync(resolve(ROOT, 'src/hooks/useSectorPanorama.ts'), 'utf8');
const PAGE = readFileSync(resolve(ROOT, 'src/pages/ProducaoKanbanGestao.tsx'), 'utf8');
const UI = readFileSync(resolve(ROOT, 'src/components/production/kanban/SectorPanorama.tsx'), 'utf8');
const LIB = readFileSync(resolve(ROOT, 'src/lib/sectorPanorama.ts'), 'utf8');
const sqlBody = MIG.replace(/--.*$/gm, '');

describe('get_sector_panorama · contrato de leitura', () => {
  it('é STABLE + SECURITY INVOKER e só autenticado executa', () => {
    expect(sqlBody).toMatch(/\bstable\b/i);
    expect(sqlBody).toMatch(/security\s+invoker/i);
    expect(sqlBody).not.toMatch(/security\s+definer/i);
    expect(sqlBody).toMatch(/grant execute on function public\.get_sector_panorama\(date, integer\) to authenticated/i);
  });

  it('não escreve nada nem trava linha (PostgREST roda STABLE em read-only)', () => {
    expect(sqlBody).not.toMatch(/\bfor\s+update\b/i);
    expect(sqlBody).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate)\b/i);
    expect(sqlBody).not.toMatch(/\bperform\b/i);
  });

  it('consome a ordem do motor sem recalcular (não chama funções do motor)', () => {
    expect(sqlBody).toMatch(/from v_production_queue_detail/);
    expect(sqlBody).toMatch(/order by q\.queue_position/);
    for (const fn of ['list_production_sequence', 'impl_249', 'production_sequence_close_score', 'list_cabedal_motor_purchase_snapshot', 'recompute_production_schedule']) {
      expect(sqlBody).not.toContain(fn);
    }
  });

  it('expõe pares reais (remaining_pairs_net) e não a carga pares·setor', () => {
    expect(sqlBody).toContain("'remaining_pairs_net', q.remaining_pairs_net");
    expect(sqlBody).not.toMatch(/'remaining_pairs',/);
    expect(LIB).not.toMatch(/\.remaining_pairs\b/);
  });

  it('timestamp da migration na faixa reservada (≥ 20270101060000)', () => {
    expect(Number(migName.slice(0, 14))).toBeGreaterThanOrEqual(20270101060000);
  });
});

describe('Gestão · aba Setores', () => {
  it('hook chama o RPC único e entra na invalidação do motor', () => {
    expect(HOOK).toContain("SECTOR_PANORAMA_RPC = 'get_sector_panorama'");
    expect(HOOK).toContain("SECTOR_PANORAMA_KEY = 'sector_panorama'");
    expect(HOOK).toContain('queueRowVisibleOperationally');
  });

  it('a Central ganha a aba Setores sem tirar Chão e Fila', () => {
    expect(PAGE).toMatch(/TabsTrigger value="chao"/);
    expect(PAGE).toMatch(/TabsTrigger value="fila"/);
    expect(PAGE).toMatch(/TabsTrigger value="setores"/);
    expect(PAGE).toContain('<SectorPanorama onOpenOp={openOpInChao} />');
    // fluxos do quadro continuam montados
    for (const flow of ['<DropApontarDialog', '<BulkMoveDialog', '<QrScanDialog', '<CorteCabedalQueue />']) {
      expect(PAGE).toContain(flow);
    }
  });

  it('o painel é somente leitura: nenhuma mutação/RPC de escrita', () => {
    expect(UI).not.toMatch(/useMutation|useApontarProducao|usePinOrder|\.insert\(|\.update\(|\.rpc\(/);
  });
});
