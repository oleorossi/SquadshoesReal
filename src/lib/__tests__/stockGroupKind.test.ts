import { describe, expect, it } from 'vitest';
import {
  addColorActionLabel,
  addColorModeForGroup,
  isArtisanalStrapGroup,
  isReadyMadeStrapGroup,
  subgroupTechnicalLabel,
} from '@/lib/stockGroupKind';

describe('modo de nova cor no subgrupo', () => {
  it('trata Strass como tira pronta, mesmo com "TIRA" no nome', () => {
    const strass = { name: 'TIRA STRASS 6MM', is_artisanal_strap: false, strap_origin: 'comprar_pronto' as const };
    expect(isReadyMadeStrapGroup(strass)).toBe(true);
    expect(isArtisanalStrapGroup(strass)).toBe(false);
    expect(addColorModeForGroup(strass)).toBe('quick-color');
    expect(addColorActionLabel(strass)).toBe('Nova cor');
    expect(subgroupTechnicalLabel({ ...strass, dimensions_width: 6, sector: 'Componente' })).toBe(
      '6 mm · tira pronta · Componente',
    );
  });

  it('mantém tira artesanal no fluxo de napa + receita', () => {
    const overlock = { name: 'TIRA OVERLOCK 5MM', is_artisanal_strap: true, strap_origin: 'fabrica' as const };
    expect(addColorModeForGroup(overlock)).toBe('artisanal-strap');
    expect(subgroupTechnicalLabel({ ...overlock, dimensions_width: 5, sector: 'Material Base' })).toBe(
      '5 mm · artesanal · fábrica · Material Base',
    );
  });

  it('não usa o nome para classificar napa ou componente comum', () => {
    expect(addColorModeForGroup({ is_artisanal_strap: false, strap_origin: null })).toBe('generic-product');
    expect(addColorModeForGroup({ is_artisanal_strap: false, strap_origin: null }, { hasTemplate: true })).toBe('quick-color');
  });
});
