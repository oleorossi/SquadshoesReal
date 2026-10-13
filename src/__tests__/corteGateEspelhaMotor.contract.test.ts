import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrato do gate de material de corte DEPOIS de 13/10/2026.
 *
 * ⚠ Aponta para as migrations que definem as funções AGORA.
 * `productionSequenceCorteMaterialGate.contract.test.ts` lê o arquivo
 * `20270101031200` e continua verde mesmo que a função viva mude — é a armadilha
 * descrita no CLAUDE.md ("contrato lendo arquivo superado passa verde enquanto a
 * função viva perde uma guarda"). Ao redefinir estas funções outra vez, mova
 * ESTE arquivo para a migration nova.
 */

const GATE = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101041400_gate-corte-espelha-motor.sql'),
  'utf8',
);

const ENQUEUE = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101041500_pre-voo-corte-no-enqueue.sql'),
  'utf8',
);

const LOOKAHEAD = readFileSync(
  resolve(__dirname, '../lib/corteLookahead.ts'),
  'utf8',
);

/**
 * Tira as linhas de comentário antes de asserção NEGATIVA.
 *
 * O cabeçalho destas migrations CITA o código antigo para explicar o bug, então
 * um `not.toMatch` sobre o arquivo cru casa a prosa e acusa um defeito que não
 * existe — a mesma armadilha do `scripts/ia-inventory.mjs`, cujo regex não pula
 * comentário e corrompe o inventário. Asserção negativa olha CÓDIGO.
 */
function semComentarios(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !/^\s*--/.test(line))
    .join('\n');
}

const GATE_CODE = semComentarios(GATE);
const ENQUEUE_CODE = semComentarios(ENQUEUE);

describe('gate de corte: fonte única = resolvedores do motor (contrato)', () => {
  it('delega aos TRÊS resolvedores do motor', () => {
    expect(GATE).toContain('public.resolve_upper_material_for_variant(');
    expect(GATE).toContain('public.resolve_lining_material_for_variant(');
    expect(GATE).toContain('public.resolve_insole_material_for_variant(');
  });

  it('NÃO reimplementa a precedência de material', () => {
    // As três divergências que o gate tinha, cada uma capaz de barrar um PV:
    // 1) COALESCE(variante, ficha) no grupo, sem conhecer main_material_group_id
    expect(GATE_CODE).not.toMatch(/COALESCE\(\s*v_var_upper_gid\s*,\s*v_sheet\.upper_material_group_id\s*\)/);
    // 2) pin da ficha à frente do grupo da variante
    expect(GATE_CODE).not.toMatch(/COALESCE\(\s*v_var_upper_pid\s*,\s*v_sheet\.upper_material_product_id\s*\)/);
    expect(GATE_CODE).not.toMatch(/COALESCE\(\s*v_var_lining_pid\s*,\s*v_sheet\.lining_material_product_id\s*\)/);
    // 3) cor comparada sem unaccent (os resolvedores normalizam)
    expect(GATE_CODE).not.toMatch(/lower\(trim\(COALESCE\(p\.color, ''\)\)\)\s*=\s*v_color/);
  });

  it('color_mismatch barra — é cadastro incompleto, não material resolvido', () => {
    expect(GATE).toContain("<> 'color_mismatch'");
  });

  it('mensagem diz ONDE cadastrar a cor', () => {
    expect(GATE).toContain('não cadastrada no grupo');
  });

  it('palmilha NÃO ganha ramo main (variant_drives_insole não existe mais)', () => {
    // Só a sobrecarga de 4 argumentos: a de 5 recebe p_sole_group_id, que o gate
    // não conhece — passá-lo adivinhado seria inventar cadastro.
    const insoleCall = GATE_CODE.slice(GATE_CODE.indexOf('resolve_insole_material_for_variant('));
    expect(insoleCall).not.toContain('variant_drives_insole');
    expect(GATE_CODE).not.toContain('v_sheet.variant_drives_insole');
  });

  it('não lê colunas inexistentes na ficha', () => {
    expect(GATE_CODE).not.toMatch(/v_sheet\.lining_material_group_id/);
    expect(GATE_CODE).not.toMatch(/v_sheet\.insole_material_group_id/);
    expect(GATE_CODE).not.toMatch(/v_sheet\.insole_material_product_id/);
  });

  it('não usa variável `record` para o resultado do resolvedor', () => {
    // Atribuir NULL a `record` em PL/pgSQL dá "record is not assigned yet", e o
    // corpo não é checado na criação: o erro só apareceria com o gate rodando.
    expect(GATE_CODE).not.toMatch(/v_res\s+record;/);
    expect(GATE).toContain('v_res_pid uuid;');
  });

  it('mantém a conversão dm² e o cálculo de livre por reserva de OUTRO PV', () => {
    expect(GATE).toContain('get_material_conversion_info');
    expect(GATE).toContain('dm2_per_unit');
    expect(GATE).toContain("mr.status IN ('reserved', 'pending_reconciliation')");
    expect(GATE).toContain('IS DISTINCT FROM v_item.sale_order_id');
  });

  it('a listagem do selo é fechada a PUBLIC/anon antes de conceder', () => {
    const revoke = GATE.indexOf('REVOKE ALL ON FUNCTION public.list_sale_order_factory_gate_blocks');
    const grant = GATE.indexOf('GRANT EXECUTE ON FUNCTION public.list_sale_order_factory_gate_blocks');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(GATE).toContain('FROM PUBLIC, anon');
    expect(GATE).toContain('public.is_approved_user()');
  });
});

describe('pré-voo de corte no enqueue (contrato)', () => {
  it('usa o FACTORY gate, não o gate de corte cru', () => {
    // É o factory gate que rebaixa 'falta %' a não-bloqueio; chamar o de corte
    // direto recusaria aprovação por falta de ESTOQUE, decisão tomada em contrário.
    expect(ENQUEUE).toContain('public.sale_order_item_factory_gate_block_reason(v_item.item_id)');
    expect(ENQUEUE_CODE).not.toContain('sale_order_item_corte_material_gate_block_reason');
  });

  it('espelha o v_active_count = 0 do motor — não barra PV que já tem OPs', () => {
    expect(ENQUEUE).toContain('production_excluded_at IS NULL');
    expect(ENQUEUE).toMatch(/NOT EXISTS \([\s\S]*?FROM public\.orders o[\s\S]*?o\.sale_order_item_id = soi\.id/);
    expect(ENQUEUE).toContain("'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',");
  });

  it('só confirm/promote; cancel e transition ficam fora', () => {
    const blocks = ENQUEUE_CODE.match(/IF v_command IN \('confirm', 'promote'\) THEN/g) ?? [];
    expect(blocks.length).toBe(2); // tiras + corte
  });

  it('falha de LEITURA do diagnóstico não inventa pendência', () => {
    expect(ENQUEUE).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*?v_gap_text := NULL;/);
  });

  // A cópia do corpo é o risco: cópia que perde uma guarda não quebra teste
  // nenhum (lição do napaBaseWidthProfileAutoProvision).
  it.each([
    ['portão de papel lido DIRETO em user_roles', 'FROM public.user_roles ur'],
    ['guarda de can_edit', "can_execute_sale_order_command('edit')"],
    ['teto de 200 da idempotency_key', 'NOT BETWEEN 8 AND 200'],
    ['pré-voo de tiras', 'diagnose_sale_order_internal_strap_readiness'],
    ['replay de materialização em andamento', "'replayed', true"],
    ['guarda de transition', 'transition na fila só cobre'],
    ['checagem de order_version', 'Versão do PV desatualizada'],
    ['wake do worker', 'trigger_sale_order_materialization_worker'],
  ])('a cópia preservou: %s', (_label, needle) => {
    expect(ENQUEUE).toContain(needle);
  });
});

describe('Fila de Corte espelha a mesma precedência (contrato)', () => {
  it('conhece main_material_group_id e as duas flags de delegação', () => {
    expect(LOOKAHEAD).toContain('main_material_group_id');
    expect(LOOKAHEAD).toContain('variant_drives_upper');
    expect(LOOKAHEAD).toContain('variant_drives_lining');
  });

  it('não declara no tipo da FICHA colunas que não existem no banco', () => {
    const start = LOOKAHEAD.indexOf('export function resolveCorteMaterialPins');
    const sheetShape = LOOKAHEAD.slice(start, LOOKAHEAD.indexOf('variant?:', start));
    expect(sheetShape).not.toContain('lining_material_group_id');
    expect(sheetShape).not.toContain('insole_material_group_id');
    expect(sheetShape).not.toContain('insole_material_product_id');
  });
});
