import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatSaleOrderCommandFailureMessage,
  formatUnknownSaleOrderUpdateError,
} from '@/lib/saleOrderCommand';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FIX = '20270101022900_fix_pv_edit_detach_cancelled_strap_po_item_fk.sql';

function readMigration(file: string): string {
  return readFileSync(resolve(MIGRATIONS, file), 'utf8');
}

function latestFinalizeMigration(): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes('CREATE OR REPLACE FUNCTION private.finalize_removed_sale_order_items')) {
      hit = { file, sql };
    }
  }
  if (!hit) {
    throw new Error('nenhuma migration redefine finalize_removed_sale_order_items');
  }
  return hit;
}

function sqlFunction(sql: string, name: string, schema = 'public'): string {
  const marker = `CREATE OR REPLACE FUNCTION ${schema}.${name}`;
  const start = sql.lastIndexOf(marker);
  expect(start, `${schema}.${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  const end = Math.max(tail.indexOf('\n$$;'), tail.indexOf('\n$function$;'));
  expect(end, `${schema}.${name} deve terminar`).toBeGreaterThanOrEqual(0);
  const closer = tail.indexOf('\n$$;') === end ? 4 : 12;
  return tail.slice(0, end + closer);
}

describe('PV edit — detach FK de OC ao cancelar contribuição (22900)', () => {
  const sql = readMigration(FIX);
  const latest = latestFinalizeMigration();

  it('introduziu o detach; finalize vivo preserva o contrato', () => {
    expect(FIX <= latest.file).toBe(true);
  });

  it('finalize destaca purchase_order_item_id ao cancelar contribuição', () => {
    const finalize = sqlFunction(
      latest.sql,
      'finalize_removed_sale_order_items',
      'private',
    );
    expect(finalize).toContain('pv_edit_detach_cancelled_po_fk_20270101022900');
    expect(finalize).toContain('superseded_purchase_order_item_id');
    expect(finalize).toContain('purchase_order_item_id = NULL');
    expect(finalize).toContain("status IN ('proposed', 'awaiting_approval', 'suspended')");
  });

  it('materialize destaca contribuições não-awaiting antes do DELETE de órfãos', () => {
    expect(sql).toContain('materialize_strap_purchase_orders(integer,uuid)');
    expect(sql).toContain('pv_edit_detach_cancelled_po_fk_20270101022900');
    expect(sql).toContain("c.status IS DISTINCT FROM 'awaiting_approval'");
    expect(sql).toContain('DELETE FROM public.purchase_order_items i');
  });
});

describe('formatUnknownSaleOrderUpdateError — PostgREST plain object', () => {
  it('não cai no genérico quando o RPC estoura 23503 de purchase_order_items', () => {
    const msg = formatUnknownSaleOrderUpdateError({
      code: '23503',
      message: 'update or delete on table "purchase_order_items" violates foreign key constraint "purchase_demand_contributions_purchase_order_item_id_fkey" on table "purchase_demand_contributions"',
      details: 'Key (id)=(b4794161-bf14-4ce9-982f-1ea88e548208) is still referenced from table "purchase_demand_contributions".',
      hint: null,
    });
    expect(msg).toContain('NÃO foi salvo');
    expect(msg.toLowerCase()).toContain('oc de tira');
    expect(msg).not.toBe('O pedido NÃO foi salvo. O servidor recusou a edição.');
  });

  it('mapeia o mesmo 23503 via formatSaleOrderCommandFailureMessage', () => {
    const msg = formatSaleOrderCommandFailureMessage(null, [
      'update or delete on table "purchase_order_items" violates foreign key constraint',
      '"purchase_demand_contributions_purchase_order_item_id_fkey"',
    ].join(' '));
    expect(msg.toLowerCase()).toContain('oc de tira');
  });
});
