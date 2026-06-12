import { describe, it, expect } from 'vitest';
import { soleGroupKey } from '../soleGroupKey';

describe('soleGroupKey — agrupamento por MODELO de solado nos maços de impressão', () => {
  it('cores diferentes do MESMO solado (mesmo group_id) caem no MESMO grupo — regressão do "setor duplicado" (2026-06-12)', () => {
    // PV com cabedal PRETO → "Solado Tratorado - Preto" (pid-1) e cabedal
    // OFF WHITE → "Solado Tratorado - Caramelo" (pid-2), ambos do grupo g-1.
    const preto = soleGroupKey({ productId: 'pid-1', groupId: 'g-1' }, '', 'sheet-A');
    const caramelo = soleGroupKey({ productId: 'pid-2', groupId: 'g-1' }, '', 'sheet-A');
    expect(preto).toBe(caramelo);
    expect(preto).toBe('grp::g-1');
  });

  it('solados de grupos diferentes NÃO se fundem', () => {
    const a = soleGroupKey({ productId: 'pid-1', groupId: 'g-1' }, '', 'sheet-A');
    const b = soleGroupKey({ productId: 'pid-9', groupId: 'g-2' }, '', 'sheet-A');
    expect(a).not.toBe(b);
  });

  it('produto sem grupo usa o próprio produto como identidade', () => {
    expect(soleGroupKey({ productId: 'pid-7', groupId: null }, '', 'sheet-A')).toBe('pid::pid-7');
    expect(soleGroupKey({ productId: 'pid-7' }, '', 'sheet-A'))
      .not.toBe(soleGroupKey({ productId: 'pid-8' }, '', 'sheet-A'));
  });

  it('fallback textual (sole_material) é POR FICHA — fichas distintas com o mesmo label "01" não se fundem (SP117/SP119, 2026-05-19)', () => {
    const sp117 = soleGroupKey(null, '01', 'sheet-117');
    const sp119 = soleGroupKey(null, '01', 'sheet-119');
    expect(sp117).toBe('txt::sheet-117');
    expect(sp117).not.toBe(sp119);
  });

  it('sem produto e sem texto → "none" (Sem Solado, grupo único)', () => {
    expect(soleGroupKey(null, '', 'sheet-A')).toBe('none');
    expect(soleGroupKey(undefined, null, null)).toBe('none');
  });
});
