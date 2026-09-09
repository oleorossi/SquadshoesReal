import { describe, expect, it } from 'vitest';
import type { Tables } from '@/integrations/supabase/types';
import { normalizeSupplier } from '@/hooks/useSuppliers';

function supplierRow(
  overrides: Partial<Tables<'suppliers'>> = {},
): Tables<'suppliers'> {
  return {
    active: true,
    address: null,
    avg_lead_time_days: null,
    certifications: null,
    city: null,
    cnpj: null,
    contact_name: null,
    created_at: '2026-08-24T00:00:00Z',
    delivery_rating: null,
    email: null,
    homologation_status: null,
    id: 'supplier-1',
    ie: null,
    is_own_manufacturing: null,
    last_purchase_date: null,
    lead_time_days: null,
    min_order_quantity: 0,
    name: 'Fornecedor teste',
    notes: null,
    on_time_rate: null,
    payment_terms: null,
    payment_terms_structured: null,
    phone: null,
    price_rating: null,
    quality_rating: null,
    search_norm: null,
    service_rating: null,
    state: null,
    supplier_category: null,
    trade_name: null,
    updated_at: '2026-08-24T00:00:00Z',
    zip_code: null,
    ...overrides,
  };
}

describe('normalizeSupplier', () => {
  it('mantém o contrato da UI quando colunas opcionais chegam nulas', () => {
    expect(normalizeSupplier(supplierRow())).toMatchObject({
      trade_name: '',
      cnpj: '',
      ie: '',
      contact_name: '',
      phone: '',
      email: '',
      address: '',
      city: '',
      state: '',
      zip_code: '',
      payment_terms: '',
      payment_terms_structured: null,
      lead_time_days: 0,
      notes: '',
      is_own_manufacturing: false,
    });
  });

  it('aceita somente parcelas e enums válidos vindos do JSON', () => {
    const supplier = normalizeSupplier(supplierRow({
      payment_terms_structured: [
        { days: 30, percentage: 60 },
        { days: '60', percentage: '40' },
        { days: 'inválido', percentage: 10 },
      ],
      supplier_category: 'servico',
      homologation_status: 'ativo',
    }));

    expect(supplier.payment_terms_structured).toEqual([
      { days: 30, percentage: 60 },
      { days: 60, percentage: 40 },
    ]);
    expect(supplier.supplier_category).toBe('servico');
    expect(supplier.homologation_status).toBe('ativo');
  });

  it('não deixa valores desconhecidos escaparem como enums da aplicação', () => {
    const supplier = normalizeSupplier(supplierRow({
      supplier_category: 'categoria_legada',
      homologation_status: 'status_legado',
    }));

    expect(supplier.supplier_category).toBeNull();
    expect(supplier.homologation_status).toBeNull();
  });
});
