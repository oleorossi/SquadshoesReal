/**
 * PV-00195 (13/10/2026): o dono mudou só a NF-e e o CNPJ emitente e o save foi
 * recusado com "Existem OPs avançadas fora de cancel_op_ids".
 *
 * A escapatória documental da 20270101024100 estava viva e correta — nunca era
 * ALCANÇADA. `recoverEmptyStrapSnapshotsForSubmit` injeta `pv_origem` em toda
 * linha de tira sem a chave no topo de todo handleSubmit, e a neutralidade
 * comparava `strap_colors` por igualdade jsonb profunda. Uma chave derivável a
 * mais em UMA linha reprovava o payload inteiro como edição fabril.
 *
 * Estes testes travam o ARQUIVO. O corpo VIVO é travado por
 * saleOrderNeutralityLiveGuards.db.test.ts — a distinção é o ponto: foi um
 * contrato que lia arquivo que deixou esta classe passar.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  recoverEmptyStrapSnapshotsForSubmit,
  type StrapSnapshotItemLike,
  type StrapSnapshotReferenceLike,
} from '@/lib/strapSnapshotGuard';
import type { StrapSourcingMap } from '@/lib/strapSourcing';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const NEUTRALIDADE = read('supabase/migrations/20270101041000_neutralidade-ignora-pv-origem-derivavel.sql');
const LACUNAS = read('supabase/migrations/20270101041100_lacunas-de-pv-origem-visiveis.sql');
const CULPADO = read('supabase/migrations/20270101041200_bloqueio-de-neutralidade-nomeia-culpado.sql');
const GUARDS = read('supabase/migrations/20270101041300_guards-vivos-de-neutralidade.sql');
const HIDRATADOR = read('src/lib/strapSnapshotGuard.ts');

const LINHA_A = '11111111-1111-4111-8111-111111111111';
const REF = '99999999-9999-4999-8999-999999999999';

interface LinhaDeTira {
  technical_strap_line_id: string;
  pv_origem?: string | null;
}

const REFERENCIAS: StrapSnapshotReferenceLike[] = [{ id: REF }];

function itemCom(linha: LinhaDeTira, sourcing: StrapSourcingMap): StrapSnapshotItemLike {
  return { reference_id: REF, strap_colors: [linha], strap_sourcing: sourcing };
}

function origemDaPrimeiraLinha(item: StrapSnapshotItemLike): string | null | undefined {
  return ((item.strap_colors ?? []) as LinhaDeTira[])[0]?.pv_origem;
}

describe('neutralidade ignora pv_origem derivável (20270101041000)', () => {
  it('patcha o corpo VIVO por âncora em vez de recopiar a função', () => {
    // Recopiar é como a classe "guarda perdida em CREATE OR REPLACE" nasce.
    expect(NEUTRALIDADE).toContain('pg_get_functiondef');
    expect(NEUTRALIDADE).toContain('EXECUTE v_def');
    expect(NEUTRALIDADE).not.toContain(
      'CREATE OR REPLACE FUNCTION public.sale_order_update_is_production_neutral',
    );
  });

  it('aborta se a escapatória documental da 24100 tiver sumido do corpo vivo', () => {
    expect(NEUTRALIDADE).toContain("position('pv_header_save_skips_op_rewrite_20270101024100' IN v_def) = 0");
    expect(NEUTRALIDADE).toContain('RAISE EXCEPTION');
  });

  it('é idempotente pelo marcador', () => {
    expect(NEUTRALIDADE).toContain(
      "position('neutralidade_ignora_pv_origem_derivavel_20270101041000' IN v_def) > 0",
    );
  });

  it('normaliza os DOIS lados da comparação, não só o payload', () => {
    const chamadas = NEUTRALIDADE.match(/private\.strap_colors_neutrality_shape\(/g) ?? [];
    // 1 definição + 2 lados da comparação.
    expect(chamadas.length).toBeGreaterThanOrEqual(3);
    expect(NEUTRALIDADE).toContain('COALESCE(soi.strap_colors');
    expect(NEUTRALIDADE).toContain("proposed.value -> 'strap_colors'");
  });

  it('só identifica a linha por UUID, como technicalStrapLineId', () => {
    expect(NEUTRALIDADE).toContain("p_line ->> 'technical_strap_line_id'");
    expect(NEUTRALIDADE).toContain("p_line ->> 'id'");
    expect(NEUTRALIDADE).toContain('[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}');
  });
});

describe('espelho TS × SQL da derivação de pv_origem', () => {
  // Mudar um lado sem o outro recria a divergência que o bug explorou.
  const paresSql = [
    ["'buy_ready'", "'pv_origem', 'sku_acabado'"],
    ["'internal'", "'pv_origem', 'fabrica'"],
  ];

  it.each(paresSql)('o SQL mapeia %s', (modo, origem) => {
    expect(NEUTRALIDADE).toContain(`->> 'source_mode' = ${modo}`);
    expect(NEUTRALIDADE).toContain(`jsonb_build_object(${origem})`);
  });

  it('o TS mapeia os mesmos dois pares', () => {
    expect(HIDRATADOR).toContain("mode === 'buy_ready'");
    expect(HIDRATADOR).toContain("pv_origem: 'sku_acabado'");
    expect(HIDRATADOR).toContain("mode === 'internal'");
    expect(HIDRATADOR).toContain("pv_origem: 'fabrica'");
  });

  it('o hidratador do cliente realmente produz sku_acabado em buy_ready', () => {
    const { items, hydratedOrigem } = recoverEmptyStrapSnapshotsForSubmit(
      [itemCom(
        { technical_strap_line_id: LINHA_A },
        { [LINHA_A]: { source_mode: 'buy_ready' } },
      )],
      REFERENCIAS,
    );
    expect(hydratedOrigem).toBe(1);
    expect(origemDaPrimeiraLinha(items[0])).toBe('sku_acabado');
  });

  it('o hidratador NÃO toca pv_origem explícito — é o que o normalizador preserva', () => {
    const { items, hydratedOrigem } = recoverEmptyStrapSnapshotsForSubmit(
      [itemCom(
        { technical_strap_line_id: LINHA_A, pv_origem: 'prestador' },
        { [LINHA_A]: { source_mode: 'internal' } },
      )],
      REFERENCIAS,
    );
    expect(hydratedOrigem).toBe(0);
    expect(origemDaPrimeiraLinha(items[0])).toBe('prestador');
  });
});

describe('lacunas de pv_origem (20270101041100)', () => {
  it('NÃO faz backfill — a decisão foi deixar visível, não gravar', () => {
    // Um UPDATE em sale_order_items sobe order_version pelas costas e quebraria
    // o save do próprio dono por conflito de versão, além de reenfileirar
    // demanda de tira e invalidar reservas.
    expect(LACUNAS).not.toMatch(/UPDATE\s+public\.sale_order_items/i);
    expect(LACUNAS).toContain('trg_touch_sale_order_version_from_item');
  });

  it('registra por que internal não é derivável', () => {
    expect(LACUNAS).toContain('AMBÍGUO');
    expect(LACUNAS).toContain('prestador');
  });

  it('derivavel nunca sai NULL — senão filtro booleano esconde a maioria', () => {
    expect(LACUNAS).toContain('COALESCE(');
    expect(LACUNAS).toContain('false\n    ),');
  });
});

describe('mensagem nomeia o culpado (20270101041200)', () => {
  it('preserva a substring de que os contratos existentes dependem', () => {
    expect(CULPADO).toContain('Existem OPs avançadas fora de cancel_op_ids.');
    expect(CULPADO).toContain("'required_cancel_op_ids', to_jsonb(v_update_advanced_op_ids)");
    expect(CULPADO).toContain("'missing_cancel_op_ids', to_jsonb(v_update_missing_cancel_op_ids)");
  });

  it('recusa patch se a âncora do blocker não for única', () => {
    // O preflight tem DOIS ramos de cancel_op_ids (missing e invalid).
    expect(CULPADO).toContain('não é única');
  });

  it('nomeia campo e OPs com número e etapa', () => {
    expect(CULPADO).toContain('O que tornou a edição fabril: ');
    expect(CULPADO).toContain('OPs que precisam de decisão: ');
    expect(CULPADO).toContain('o.order_number');
    expect(CULPADO).toContain('st.stage_name');
  });

  it('a explicação usa os MESMOS predicados do portão', () => {
    for (const campo of [
      "v_header ? 'packaging_mode'",
      "v_header ? 'box_grouping'",
      "v_header ? 'packaging_product_id'",
      "v_header ? 'packaging_quantity'",
      "v_header ? 'outsource_to_contractor_id'",
      "v_header ? 'outsource_to_sector'",
    ]) {
      expect(CULPADO, `${campo} ausente na explicação`).toContain(campo);
    }
    // NF/OC/CNPJ emitente são documentais e não podem entrar na explicação.
    expect(CULPADO).not.toContain("v_header ? 'nfe'");
    expect(CULPADO).not.toContain("v_header ? 'company_id'");
  });
});

describe('guards vivos (20270101041300)', () => {
  it('cobre a regressão que um teste de arquivo não pegaria', () => {
    expect(GUARDS).toContain('pg_get_functiondef');
    expect(GUARDS).toContain('NOT public.sale_order_update_is_production_neutral');
    expect(GUARDS).toContain('neutralidade_nao_compara_strap_colors_cru');
  });
});
