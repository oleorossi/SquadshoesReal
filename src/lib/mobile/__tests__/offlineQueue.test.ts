import { describe, expect, it } from 'vitest';
import {
  enqueueOrder,
  mobileCurrentDraftKey,
  mobileOwnerStorageKey,
} from '../offlineQueue';

describe('isolamento dos dados offline por usuário', () => {
  it('materializa namespaces distintos para fila, rascunho e catálogo', () => {
    expect(mobileOwnerStorageKey('vendedor-1', 'pedido-1')).toBe('vendedor-1:pedido-1');
    expect(mobileOwnerStorageKey('vendedor-2', 'pedido-1')).toBe('vendedor-2:pedido-1');
    expect(mobileCurrentDraftKey('vendedor-1')).toBe('mobile-current-draft-id:vendedor-1');
    expect(mobileCurrentDraftKey('vendedor-2')).toBe('mobile-current-draft-id:vendedor-2');
  });

  it('recusa payload de outro dono antes de abrir o IndexedDB', async () => {
    await expect(enqueueOrder('vendedor-1', {
      ownerId: 'vendedor-2',
      order: {
        client_request_id: 'pedido-1',
        client_name: 'Cliente',
        client_cnpj: '',
        client_contact: '',
        client_order_number: '',
        representative: '',
        payment_condition: '',
        delivery_deadline: '',
        delivery_week: '',
        delivery_month: '',
        notes: '',
        status: 'Rascunho',
        nfe: '',
        remessa: '',
        is_factoring: false,
        factoring_config_id: '',
        packaging_mode: 'colmeia',
      },
      items: [],
    })).rejects.toThrow('outro usuário');
  });

  it('recusa status fora de Rascunho antes de abrir o IndexedDB', async () => {
    await expect(enqueueOrder('vendedor-1', {
      ownerId: 'vendedor-1',
      order: {
        client_request_id: 'pedido-aprovado',
        client_name: 'Cliente',
        client_cnpj: '',
        client_contact: '',
        client_order_number: '',
        representative: '',
        payment_condition: '',
        delivery_deadline: '',
        delivery_week: '',
        delivery_month: '',
        notes: '',
        status: 'Aprovado',
        nfe: '',
        remessa: '',
        is_factoring: false,
        factoring_config_id: '',
        packaging_mode: 'colmeia',
      },
      items: [],
    })).rejects.toThrow('somente pedidos em Rascunho');
  });
});
