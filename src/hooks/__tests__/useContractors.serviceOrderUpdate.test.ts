import { describe, expect, it } from 'vitest';
import {
  sanitizeServiceOrderUpdate,
  type ServiceOrder,
} from '@/hooks/useContractors';

describe('sanitizeServiceOrderUpdate', () => {
  it('envia somente as colunas editáveis pelo formulário', () => {
    const result = sanitizeServiceOrderUpdate({
      contractor_id: 'contractor-1',
      description: 'Costura externa',
      status: 'Em Andamento',
      quantity: 120,
      unit_price: 4.5,
      total_value: 540,
      materials_sent: [
        { material: 'Napa', color: 'Preto', meters: 8, completed: true },
      ],
      target_sector: 'Costura Cabedal',
      selected_sale_order_item_ids: ['item-1'],
      signed_photo_url: null,
    });

    expect(result).toEqual({
      contractor_id: 'contractor-1',
      description: 'Costura externa',
      status: 'Em Andamento',
      quantity: 120,
      unit_price: 4.5,
      total_value: 540,
      materials_sent: [
        { material: 'Napa', color: 'Preto', meters: 8, completed: true },
      ],
      target_sector: 'Costura Cabedal',
      selected_sale_order_item_ids: ['item-1'],
      signed_photo_url: null,
    });
  });

  it('remove embeds, derivados e campos administrados pelo servidor', () => {
    const updates: Partial<ServiceOrder> = {
      notes: 'Observação permitida',
      order_number: 'OS-001',
      contractors: {
        id: 'contractor-1',
        name: 'Facção',
        trade_name: '',
        cnpj_cpf: '',
        phone: '',
        email: '',
        address: '',
        city: '',
        state: '',
        service_type: '',
        notes: '',
        active: true,
        payment_days: 30,
        created_at: '2026-08-24T00:00:00Z',
        updated_at: '2026-08-24T00:00:00Z',
      },
      service_order_items: [{ id: 'line-1' }],
      is_canonical_strap: true,
      material_requirements: {
        version: 1,
        items: [{ material: 'Napa', quantity: 1, unit: 'm' }],
      },
      artisanal_stock_entry_done: true,
      receipt_generated_at: '2026-08-24T00:00:00Z',
      receipt_number: 'REC-1',
      provider_capacity_pairs_per_day: 120,
      planning_source: 'reverse_schedule',
      dispatch_tracked: true,
    };

    expect(sanitizeServiceOrderUpdate(updates)).toEqual({
      notes: 'Observação permitida',
    });
  });
});
