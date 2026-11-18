import { describe, expect, it } from 'vitest';
import {
  atelierCanReassign,
  atelierContractorCanTake,
  atelierRateSector,
} from '@/lib/atelierAdmin';

const aberto = { id: 'c1', active: true, payment_days: 30 };
const setores = [
  { contractor_id: 'c1', sector: 'costura_cabedal', active: true },
];

describe('atelierContractorCanTake', () => {
  it('aceita quem ainda não declarou setor', () => {
    expect(atelierContractorCanTake(aberto, 'aviamento', [])).toBe(true);
  });

  it('restringe quem já declarou um setor', () => {
    expect(atelierContractorCanTake(aberto, 'costura_cabedal', setores)).toBe(true);
    expect(atelierContractorCanTake(aberto, 'aviamento', setores)).toBe(false);
  });

  it('recusa inativo e prazo de fábrica', () => {
    expect(atelierContractorCanTake({ ...aberto, active: false }, 'costura_cabedal', [])).toBe(false);
    expect(atelierContractorCanTake({ ...aberto, payment_days: 999 }, 'costura_cabedal', [])).toBe(false);
  });

  it('desligar o setor fecha a casa nesse setor', () => {
    expect(atelierContractorCanTake(aberto, 'costura_cabedal', [
      { contractor_id: 'c1', sector: 'costura_cabedal', active: false },
    ])).toBe(false);
    expect(atelierContractorCanTake(aberto, 'aviamento', [
      { contractor_id: 'c1', sector: 'costura_cabedal', active: false },
    ])).toBe(false);
  });
});

describe('padrão da fila', () => {
  it('tarifa de aviamento lê o setor mesa', () => {
    expect(atelierRateSector('aviamento')).toBe('mesa');
    expect(atelierRateSector('costura_cabedal')).toBe('costura');
    expect(atelierRateSector('corte_cabedal')).toBeNull();
  });

  it('só troca de mão até o corte', () => {
    expect(atelierCanReassign({ sector: 'costura_cabedal', pipeline_status: 'cut' })).toBe(true);
    expect(atelierCanReassign({ sector: 'costura_cabedal', pipeline_status: 'sent_to_contractor' })).toBe(false);
    expect(atelierCanReassign({ sector: 'corte_cabedal', pipeline_status: 'cut' })).toBe(false);
  });
});
