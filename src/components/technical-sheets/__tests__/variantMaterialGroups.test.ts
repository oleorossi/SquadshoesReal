import { describe, it, expect } from 'vitest';
import {
  VARIANT_MATERIAL_SECTORS,
  isVariantMaterialGroup,
} from '../MaterialVariantsTab';

/**
 * O bug que este arquivo trava (20/08/2026): os quatro seletores do diálogo de
 * variante filtravam por UM setor cada — "Material principal" só aceitava
 * `sector = 'Cabedal'`, "Forro" só `'Forração da Palmilha'`, "Placa/EVA" só
 * `'Palmilha'`.
 *
 * Medido no banco no dia: as 3 napas que respondem por TODAS as 63 variantes
 * ativas moram em setores diferentes desses — GLOW METALIC em 'Componente',
 * NAPA SOFT em 'Palmilha', NAPA SUDANI em 'Forração da Palmilha'. Nenhuma
 * aparecia no "Material principal", então nenhuma variante nova podia ser
 * cadastrada pela tela; as existentes vieram de migration. Sintoma relatado
 * pelo dono: no PV, referências como DS22/EC23/EC111 só ofereciam NAPA SOFT ou
 * NAPA SUDANI, sem GLOW METALIC — e não havia caminho na ficha pra corrigir.
 *
 * A causa raiz é conceitual: `product_groups.sector` diz onde o grupo mora no
 * Estoque, NÃO o que ele pode virar. A mesma napa é cabedal, forração e
 * palmilha conforme a ficha — que é exatamente o que `variant_drives_*` faz.
 */
describe('grupos elegíveis como material de variante', () => {
  const grupo = (name: string, sector: string | null) => ({ name, sector });

  it('aceita as 3 napas reais, mesmo cada uma em um setor diferente', () => {
    // Setores conforme cadastrados em produção em 20/08/2026.
    expect(isVariantMaterialGroup(grupo('GLOW METALIC', 'Componente'))).toBe(true);
    expect(isVariantMaterialGroup(grupo('NAPA SOFT', 'Palmilha'))).toBe(true);
    expect(isVariantMaterialGroup(grupo('NAPA SUDANI', 'Forração da Palmilha'))).toBe(true);
    expect(isVariantMaterialGroup(grupo('NAPA TITANIUM', 'Cabedal'))).toBe(true);
  });

  it('recusa o que não é material cortado por par', () => {
    // Solado tem pin próprio na variante (`sole_material_product_id`).
    expect(isVariantMaterialGroup(grupo('SOLADO 01', 'Solado'))).toBe(false);
    expect(isVariantMaterialGroup(grupo('CAIXA COLMEIA', 'Embalagem'))).toBe(false);
    expect(isVariantMaterialGroup(grupo('COLA PU', 'Cola / Químico'))).toBe(false);
    expect(isVariantMaterialGroup(grupo('NAVALHA', 'Ferramentas'))).toBe(false);
    expect(isVariantMaterialGroup(grupo('FÔRMA 34', 'Fôrma'))).toBe(false);
  });

  it('cai na dedução por nome quando o setor está vazio (grupo legado)', () => {
    // sectorOfGroup → deriveCategoryFromGroup: 'napa' ⇒ Cabedal, 'solado' ⇒ Solado.
    expect(isVariantMaterialGroup(grupo('NAPA MADRID', null))).toBe(true);
    expect(isVariantMaterialGroup(grupo('NAPA MADRID', '   '))).toBe(true);
    expect(isVariantMaterialGroup(grupo('SOLADO 01', null))).toBe(false);
  });

  it('não engole entrada vazia', () => {
    expect(isVariantMaterialGroup(null)).toBe(false);
    expect(isVariantMaterialGroup(undefined)).toBe(false);
  });

  it('todo setor elegível é um setor que existe no cadastro', () => {
    // Espelha SECTOR_OPTIONS (categoryFromGroup.ts) — um valor fora dessa lista
    // nunca casaria com product_groups.sector, e o seletor ficaria vazio.
    const setoresValidos = [
      'Cabedal', 'Forração da Palmilha', 'Palmilha', 'Cola / Químico',
      'Componente', 'Embalagem', 'Solado', 'Ferramentas', 'Fôrma',
    ];
    for (const setor of VARIANT_MATERIAL_SECTORS) {
      expect(setoresValidos).toContain(setor);
    }
  });
});
