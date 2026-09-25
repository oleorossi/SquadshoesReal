import { describe, expect, it } from 'vitest';
import {
  createEmptyBatch,
  expandBatchesToJobs,
  filterDupStoreCandidates,
  pickDuplicateItems,
  removeClientsFromBatches,
  resolveSourceEconomicGroupId,
  sortDuplicateItemsByReference,
  storesTakenByOtherBatches,
  validateDupBatches,
  type DupBatch,
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

  it('excludeClientIds remove lojas de outros lotes', () => {
    const rows = filterDupStoreCandidates({
      clients,
      groupId: 'g1',
      search: '',
      sourceClientId: 'src',
      alreadyCopiedClientIds: new Set(),
      excludeClientIds: new Set(['a']),
      matchesSearch: searchMatchesAllTerms,
    });
    expect(rows.map((r) => r.id)).toEqual(['b']);
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

describe('sortDuplicateItemsByReference', () => {
  it('agrupa mesma referência juntas e ordena cores', () => {
    const refs = {
      g1: { code: 'G01', name: 'G01' },
      g2: { code: 'G02', name: 'G02' },
      g3: { code: 'G03', name: 'G03' },
    };
    const items = [
      { id: '1', reference_id: 'g1', color: 'DÁLIA' },
      { id: '2', reference_id: 'g1', color: 'OFF WHITE' },
      { id: '3', reference_id: 'g2', color: 'PRATA' },
      { id: '4', reference_id: 'g3', color: 'OFF WHITE' },
      { id: '5', reference_id: 'g2', color: 'COBRE' },
    ];
    expect(sortDuplicateItemsByReference(items, refs).map((i) => i.id)).toEqual([
      '1', '2', '5', '3', '4',
    ]);
  });
});

describe('multi-lote helpers', () => {
  const batch = (partial: Partial<DupBatch> & { id: string; label: string }): DupBatch => ({
    economicGroupId: '',
    clientIds: [],
    itemIds: [],
    ...partial,
  });

  it('createEmptyBatch inicia sem lojas/itens e label Lote N', () => {
    const b = createEmptyBatch({ index: 0, id: 'b1', economicGroupId: 'g1' });
    expect(b).toEqual({
      id: 'b1',
      label: 'Lote 1',
      economicGroupId: 'g1',
      clientIds: [],
      itemIds: [],
    });
    expect(createEmptyBatch({ index: 2, id: 'b3' }).label).toBe('Lote 3');
  });

  it('storesTakenByOtherBatches ignora o lote ativo', () => {
    const batches = [
      batch({ id: '1', label: 'Lote 1', clientIds: ['a', 'b'] }),
      batch({ id: '2', label: 'Lote 2', clientIds: ['c'] }),
    ];
    expect([...storesTakenByOtherBatches(batches, '2')].sort()).toEqual(['a', 'b']);
    expect([...storesTakenByOtherBatches(batches, '1')]).toEqual(['c']);
  });

  it('validateDupBatches exige lojas e itens em cada lote', () => {
    const errors = validateDupBatches([
      batch({ id: '1', label: 'Lote 1', clientIds: ['a'], itemIds: ['i1'] }),
      batch({ id: '2', label: 'Lote 2', clientIds: [], itemIds: [] }),
    ]);
    expect(errors.map((e) => e.message)).toEqual([
      'Lote 2: sem lojas',
      'Lote 2: sem itens',
    ]);
  });

  it('expandBatchesToJobs gera 1 job por loja com itemIds do lote', () => {
    const jobs = expandBatchesToJobs([
      batch({ id: '1', label: 'Lote 1', clientIds: ['a', 'b'], itemIds: ['i1'] }),
      batch({ id: '2', label: 'Lote 2', clientIds: ['c'], itemIds: ['i2', 'i3'] }),
    ]);
    expect(jobs).toEqual([
      { clientId: 'a', itemIds: ['i1'], batchId: '1', batchLabel: 'Lote 1' },
      { clientId: 'b', itemIds: ['i1'], batchId: '1', batchLabel: 'Lote 1' },
      { clientId: 'c', itemIds: ['i2', 'i3'], batchId: '2', batchLabel: 'Lote 2' },
    ]);
  });

  it('removeClientsFromBatches tira lojas ok após falha parcial', () => {
    const next = removeClientsFromBatches(
      [
        batch({ id: '1', label: 'Lote 1', clientIds: ['a', 'b'], itemIds: ['i1'] }),
        batch({ id: '2', label: 'Lote 2', clientIds: ['c'], itemIds: ['i2'] }),
      ],
      ['a', 'c'],
    );
    expect(next[0].clientIds).toEqual(['b']);
    expect(next[1].clientIds).toEqual([]);
  });
});
