import { describe, it, expect } from 'vitest';
import { CANONICAL_ROUTINGS } from '../ConstructionConfigPanel';

/**
 * Toda rota canônica termina em Expedição (decisão do dono, 07/08/2026).
 *
 * O bug que este arquivo trava: as 6 listas de `ConstructionConfigPanel`
 * terminavam em 'Acabamento'. Escolher o modelo de produção de uma ficha
 * gravava `production_sectors` SEM a Expedição, e a rota da OP nasce daí
 * (`promote_sale_order_item`). Resultado medido em 07/08/2026: 16 das 53 fichas
 * sem a etapa e 29 OPs sem ela.
 *
 * O sintoma visível era o Kanban recusando o arrasto ("Esta OP não passa por
 * Expedição"). O estrago silencioso era maior: a OP virava 'Finalizado' no
 * Acabamento e nunca entrava no romaneio de Expedição.
 *
 * ⚠ O teste varre `CANONICAL_ROUTINGS` inteiro, não uma lista de nomes fixos —
 * lista NOVA já nasce coberta.
 */
describe('roteiros canônicos da ficha técnica', () => {
  it('todos terminam em Expedição', () => {
    for (const rota of CANONICAL_ROUTINGS) {
      expect(rota[rota.length - 1]).toBe('Expedição');
    }
  });

  it('nenhum repete a Expedição no meio do caminho', () => {
    for (const rota of CANONICAL_ROUTINGS) {
      expect(rota.filter(s => s === 'Expedição')).toHaveLength(1);
    }
  });

  it('todos passam pelo Acabamento logo antes da Expedição', () => {
    // A expedição é a última bancada; nada entra entre ela e o acabamento.
    for (const rota of CANONICAL_ROUTINGS) {
      expect(rota[rota.length - 2]).toBe('Acabamento');
    }
  });

  it('só usam nomes de setor que o servidor sabe ordenar', () => {
    // Espelha `canonical_stage_order()` no banco. Um nome fora desta lista cai
    // no ELSE 99 e a etapa vai parar no fim da rota, fora de ordem — foi assim
    // que a grafia morta 'Costura' sobreviveu em `resync_op_atomic`.
    const CONHECIDOS = new Set([
      'Corte Fibra', 'Corte Palmilha', 'Corte Forração', 'Corte Cabedal',
      'Costura Palmilha', 'Costura Cabedal', 'Aviamento', 'Silk',
      'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
    ]);
    for (const rota of CANONICAL_ROUTINGS) {
      for (const setor of rota) expect(CONHECIDOS).toContain(setor);
    }
  });
});
