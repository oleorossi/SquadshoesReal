import { describe, expect, it } from 'vitest';
import { atelierDefaultKit, atelierSheetSupport } from '@/lib/atelier';

describe('atelierSheetSupport — espelho de atelier_sheet_supports_sector', () => {
  it('I704: sem cabedal, com tiras → só Aviamento', () => {
    const i704 = { upper_material: '', upper_consumption: 0, has_straps: true, aviamento_steps: [{}, {}] };
    expect(atelierSheetSupport(i704, 'costura_cabedal').ok).toBe(false);
    expect(atelierSheetSupport(i704, 'costura_cabedal').reason).toMatch(/material de cabedal/);
    expect(atelierSheetSupport(i704, 'aviamento').ok).toBe(true);
  });

  it('BT01: cabedal por grupo → Costura', () => {
    const bt01 = { upper_material: 'Suede EVA + Cacharrel', upper_material_group_id: 'g', upper_consumption: 22.83 };
    expect(atelierSheetSupport(bt01, 'costura_cabedal').ok).toBe(true);
    expect(atelierSheetSupport(bt01, 'aviamento').ok).toBe(false);
  });

  it('corte a fio não tem costura', () => {
    const r = atelierSheetSupport({ upper_material: 'NAPA', upper_corte_a_fio: true }, 'costura_cabedal');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/corte a fio/);
  });

  it('kit default espelha o SQL', () => {
    expect(atelierDefaultKit('costura_cabedal')).toEqual(['Cabedal', 'Forração']);
    expect(atelierDefaultKit('aviamento')).toEqual(['Componente Direto', 'BOM']);
  });
});
