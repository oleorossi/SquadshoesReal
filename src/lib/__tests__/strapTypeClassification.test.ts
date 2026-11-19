import { describe, expect, it } from 'vitest';
import { classifyStrapGroups, strapRegistrationBlock } from '../strapTypeClassification';

const STRASS = '11111111-1111-4111-8111-111111111111';
const CHATA = '22222222-2222-4222-8222-222222222222';
const NAPA = '33333333-3333-4333-8333-333333333333';

describe('classificação de tira', () => {
  it('auto-classifica só strass sem origem e com SKU ativo', () => {
    const { auto, pending } = classifyStrapGroups(
      [
        { id: STRASS, name: 'TIRA STRASS 6MM' },
        { id: CHATA, name: 'TIRA CHATA 8MM' },
        { id: NAPA, name: 'NAPA SOFT' },
      ],
      [
        { id: 'a', group_id: STRASS, name: 'STRASS CRISTAL', unit: 'm', active: true },
        { id: 'b', group_id: CHATA, name: 'CHATA PRETO', unit: 'm', active: true },
      ],
    );
    expect(auto.map((row) => row.groupId)).toEqual([STRASS]);
    expect(pending.map((row) => row.groupId)).toEqual([CHATA]);
  });

  it('strass já marcado e comprada pronta sem SKU ficam fora do automático', () => {
    const { auto, pending } = classifyStrapGroups(
      [
        { id: STRASS, name: 'TIRA STRASS 6MM', strap_origin: 'comprar_pronto', is_artisanal_strap: true },
        { id: CHATA, name: 'TIRA STRASS 15MM', strap_origin: 'comprar_pronto', is_artisanal_strap: true },
      ],
      [{ id: 'a', group_id: STRASS, unit: 'm', active: true }],
    );
    expect(auto).toEqual([]);
    expect(pending.map((row) => row.name)).toEqual(['TIRA STRASS 15MM']);
  });

  it('SKU que não está em metros não torna o strass inequívoco', () => {
    const { auto, pending } = classifyStrapGroups(
      [{ id: STRASS, name: 'TIRA STRASS 6MM' }],
      [{ id: 'a', group_id: STRASS, unit: 'un', active: true }],
    );
    expect(auto).toEqual([]);
    expect(pending.map((row) => row.groupId)).toEqual([STRASS]);
  });

  it('bloqueia origem vazia, comprada pronta sem metro e artesanal sem rendimento', () => {
    expect(strapRegistrationBlock({
      isStrap: true, origin: null, meterSkuCount: 1, yieldCount: 0, yieldsKnown: true,
    })).toMatch(/artesanal ou comprada pronta/);
    expect(strapRegistrationBlock({
      isStrap: true, origin: 'comprar_pronto', meterSkuCount: 0, yieldCount: 0, yieldsKnown: true,
    })).toMatch(/SKU ativo em metros/);
    expect(strapRegistrationBlock({
      isStrap: true, origin: 'comprar_pronto', meterSkuCount: 1, yieldCount: 0, yieldsKnown: true,
    })).toBeNull();
    expect(strapRegistrationBlock({
      isStrap: true, origin: 'prestador', meterSkuCount: 0, yieldCount: 0, yieldsKnown: true,
    })).toMatch(/rendimento/);
    expect(strapRegistrationBlock({
      isStrap: true, origin: 'fabrica', meterSkuCount: 0, yieldCount: 1, yieldsKnown: true,
    })).toBeNull();
    expect(strapRegistrationBlock({
      isStrap: false, origin: null, meterSkuCount: 0, yieldCount: 0, yieldsKnown: true,
    })).toBeNull();
  });
});
