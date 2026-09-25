import { describe, expect, it } from 'vitest';
import {
  filterDupStoreCandidates,
  pickDuplicateItems,
  resolveSourceEconomicGroupId,
} from '@/lib/duplicateToStores';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

const clients = [
  { id: 'a', active: true, economic_group_id: 'g1', razao_social: 'Loja A', nome_fantasia: 'A', cnpj: '11' },
  { id: 'b', active: true, economic_group_id: 'g1', razao_social: 'Loja B', nome_fantasia: 'B', cnpj: '22' },
  { id: 'c', active: true, economic_group_id: 'g2', razao_social: 'Outro Grupo', nome_fantasia: 'C', cnpj: '33' },
  { id: 'd', active: false, economic_group_id: 'g1', razao_social: 'Inativa', nome_fantasia: 'D', cnpj: '44' },
  { id: 'src', active: true, economic_group_id: 'g1', razao_social: 'Origem', nome_fantasia: 'O', cnpj: '55' },
];

describe('filterDupStoreCandidates', () => {
  it('sem grupo e sem busca → lista vazia', () => {
    expect(
      filterDupStoreCandidates({
        clients,
        groupId: '',
        search: '',
        sourceClientId: 'src',
        alreadyCopiedClientIds: new Set(),
        matchesSearch: searchMatchesAllTerms,
      }),
    ).toEqual([]);
  });

  it('com grupo lista lojas do grupo exceto origem e já copiadas', () => {
    const rows = filterDupStoreCandidates({
      clients,
      groupId: 'g1',
      search: '',
      sourceClientId: 'src',
      alreadyCopiedClientIds: new Set(['b']),
      matchesSearch: searchMatchesAllTerms,
    });
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('sem grupo + busca encontra loja de outro grupo', () => {
    const rows = filterDupStoreCandidates({
      clients,
      groupId: '',
      search: 'Outro',
      sourceClientId: 'src',
      alreadyCopiedClientIds: new Set(),
      matchesSearch: searchMatchesAllTerms,
    });
    expect(rows.map((r) => r.id)).toEqual(['c']);
  });
});

describe('pickDuplicateItems', () => {
  const items = [
    { id: 'i1', reference_id: 'r1' },
    { id: 'i2', reference_id: 'r2' },
    { id: 'i3', reference_id: 'r3' },
  ];

  it('preserva ordem do origem e filtra pelo set', () => {
    expect(pickDuplicateItems(items, ['i3', 'i1']).map((i) => i.id)).toEqual(['i1', 'i3']);
  });

  it('vazio quando nada selecionado', () => {
    expect(pickDuplicateItems(items, [])).toEqual([]);
  });
});

describe('resolveSourceEconomicGroupId', () => {
  it('pré-preenche grupo do cliente origem', () => {
    expect(
      resolveSourceEconomicGroupId({
        sourceClientId: 'src',
        clients,
      }),
    ).toBe('g1');
  });

  it('vazio sem cliente', () => {
    expect(resolveSourceEconomicGroupId({ sourceClientId: null, clients })).toBe('');
  });
});
