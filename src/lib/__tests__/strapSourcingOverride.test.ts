import { describe, expect, it } from 'vitest';
import {
  isCommittedStrapSourcingError,
  sameStrapSourcingSelection,
  strapSourcingErrorDetails,
} from '@/lib/strapSourcingOverride';

describe('override administrativo da origem de tiras', () => {
  it('detecta somente a recusa explícita por compromisso', () => {
    expect(isCommittedStrapSourcingError({
      message: 'Origem comprometida: use override_sale_order_item_strap_sourcing com motivo',
    })).toBe(true);
    expect(isCommittedStrapSourcingError({
      message: 'Edicao concorrente: revisao atual 3, esperada 2',
    })).toBe(false);
  });

  it('compara o mesmo mapa por UUID sem depender da ordem das chaves', () => {
    const before = {
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': { strap_variant_id: 'variant-b', source_mode: 'buy_ready' },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': { source_mode: 'internal', strap_variant_id: 'variant-a' },
    };
    const after = {
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': { strap_variant_id: 'variant-a', source_mode: 'internal' },
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': { source_mode: 'buy_ready', strap_variant_id: 'variant-b' },
    };
    expect(sameStrapSourcingSelection(before, after)).toBe(true);
    expect(sameStrapSourcingSelection(before, {
      ...after,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': { source_mode: 'internal', strap_variant_id: 'variant-b' },
    })).toBe(false);
  });

  it('preserva diagnóstico retornado pelo PostgREST', () => {
    expect(strapSourcingErrorDetails({ message: 'Bloqueado', details: 'custódia aberta' }))
      .toContain('custódia aberta');
  });

  it('traduz DETAIL 55000 em ação, bloqueios e fatos preservados', () => {
    const details = strapSourcingErrorDetails({
      code: '55000',
      message: 'Troca de origem bloqueada por saldo fisico/documental aberto',
      hint: 'Recebimento concluído é preservado',
      details: JSON.stringify({
        code: 'strap_source_override_blocked',
        required_action: 'Concilie custódia pelo fluxo documental',
        blocked_facts: [{ type: 'custody', entity_id: 'custody-id', detail: { balance_m: 2 } }],
        preserved_realized_facts: [{ type: 'receipt', entity_id: 'receipt-id' }],
      }),
    });
    expect(details).toContain('Ação necessária: Concilie custódia pelo fluxo documental');
    expect(details).toContain('custody · custody-id');
    expect(details).toContain('Fatos realizados preservados (1)');
    expect(details).toContain('receipt · receipt-id');
  });

  it('orienta reload em revisão concorrente sem tentar fallback', () => {
    expect(strapSourcingErrorDetails({ code: '40001', message: 'Edicao concorrente' }))
      .toMatch(/Recarregue o PV.*nenhum override foi aplicado/i);
  });
});
