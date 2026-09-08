#!/usr/bin/env bun
/**
 * Runner da auditoria de status dos PVs.
 *
 * Preferência: rode o SQL em
 *   sql-scripts/audit-sale-order-status-transitions.sql
 * no SQL Editor (fonte da verdade, espelho do cancel).
 *
 * Este script replica a mesma lógica via PostgREST quando
 * SUPABASE_SERVICE_ROLE_KEY (ou sb_secret_*) estiver no ambiente —
 * útil pra gravar o resultado em artifacts sem colar SQL.
 *
 * Uso:
 *   SUPABASE_SERVICE_ROLE_KEY=... bun scripts/run-audit-sale-order-status.mjs
 *   # ou
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/run-audit-sale-order-status.mjs
 *
 * Saída: JSON em stdout + resumo em stderr.
 * Não grava nada no banco.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://ssvxfoybzmjlypnipqzn.supabase.co';
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  '';

if (!KEY) {
  console.error(
    'Falta SUPABASE_SERVICE_ROLE_KEY. Cole sql-scripts/audit-sale-order-status-transitions.sql no SQL Editor.',
  );
  process.exit(2);
}

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function allRows(table, select, extra = (q) => q) {
  const page = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    let q = sb.from(table).select(select).range(from, from + page - 1);
    q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return out;
}

async function allRowsInChunks(table, select, column, ids, chunkSize = 200) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    out.push(
      ...(await allRows(table, select, (q) => q.in(column, chunk))),
    );
  }
  return out;
}

const FINALIZED = new Set([
  'Finalizado',
  'FINALIZADO',
  'Concluído',
  'Concluido',
  'Concluída',
]);
const CANCELLED_OP = new Set(['Cancelada', 'Cancelado']);
const CANCEL_ALLOWED_PV = new Set([
  'Rascunho',
  'Pendente',
  'Aprovado',
  'Em Produção',
  'Faturado',
  'Cancelado',
]);
const VALID_TRANSITIONS = {
  Rascunho: ['Pendente', 'Aprovado', 'Em Produção', 'Cancelado'],
  Pendente: ['Aprovado', 'Em Produção', 'Cancelado', 'Rascunho'],
  Aprovado: ['Em Produção', 'Cancelado', 'Rascunho'],
  'Em Produção': ['Faturado', 'Finalizado s/ NF', 'Cancelado'],
  Faturado: ['Expedido', 'Cancelado'],
  Expedido: ['Concluído'],
  Concluído: [],
  'Finalizado s/ NF': [],
  Cancelado: ['Rascunho'],
};

function pendingish(status) {
  const s = String(status ?? '').toLowerCase();
  return s === '' || s === 'pendente' || s === 'pending';
}

function reservationFact(status) {
  const s = String(status ?? '').toLowerCase();
  return s === 'consumed' || s === 'converted' || s === 'pending_reconciliation';
}

const saleOrders = await allRows(
  'sale_orders',
  'id, order_number, status, client_name, client_order_number, total, nfe_required',
  (q) => q.is('deleted_at', null),
);
const items = await allRows('sale_order_items', 'sale_order_id, quantity');
const orders = await allRows(
  'orders',
  'id, order_number, status, sale_order_id',
  (q) => q.is('deleted_at', null).not('sale_order_id', 'is', null),
);
const nfe = await allRows(
  'nfe_emitidas',
  'sale_order_id, status',
  (q) => q.in('status', ['autorizada', 'processando', 'cancelando']),
);
const orderIds = orders.map((o) => o.id);
const stages = await allRowsInChunks(
  'order_stages',
  'order_id, quantity_processed, started_at, completed_at, status',
  'order_id',
  orderIds,
);
const lots = await allRowsInChunks(
  'order_lots',
  'order_id, started_at, completed_at, status',
  'order_id',
  orderIds,
);
const reservations = await allRowsInChunks(
  'material_reservations',
  'order_id, quantity_consumed, consumed_at, status',
  'order_id',
  orderIds,
);
const consumptionsRaw = await allRowsInChunks(
  'production_consumptions',
  'order_id, actual_quantity, superseded_at',
  'order_id',
  orderIds,
);
const consumptions = consumptionsRaw.filter((c) => c.superseded_at == null);

const paresByPv = new Map();
for (const it of items) {
  paresByPv.set(
    it.sale_order_id,
    (paresByPv.get(it.sale_order_id) ?? 0) + Number(it.quantity ?? 0),
  );
}
const nfeByPv = new Set(nfe.map((n) => n.sale_order_id));

const stageFact = new Set();
for (const s of stages) {
  if (
    Number(s.quantity_processed ?? 0) > 0 ||
    s.started_at != null ||
    s.completed_at != null ||
    !pendingish(s.status)
  ) {
    stageFact.add(s.order_id);
  }
}
const lotFact = new Set();
for (const l of lots) {
  if (l.started_at != null || l.completed_at != null || !pendingish(l.status)) {
    lotFact.add(l.order_id);
  }
}
const reservationFactIds = new Set();
for (const r of reservations) {
  if (
    Number(r.quantity_consumed ?? 0) > 0 ||
    r.consumed_at != null ||
    reservationFact(r.status)
  ) {
    reservationFactIds.add(r.order_id);
  }
}
const consumptionFact = new Set();
for (const c of consumptions) {
  if (Number(c.actual_quantity ?? 0) > 0) consumptionFact.add(c.order_id);
}

const opsByPv = new Map();
for (const o of orders) {
  if (!opsByPv.has(o.sale_order_id)) opsByPv.set(o.sale_order_id, []);
  opsByPv.get(o.sale_order_id).push(o);
}

const rows = saleOrders.map((so) => {
  const ops = opsByPv.get(so.id) ?? [];
  const hasFinalized = ops.some((o) => FINALIZED.has(o.status));
  const openOps = ops.filter(
    (o) => !CANCELLED_OP.has(o.status) && !FINALIZED.has(o.status),
  );
  const blocking = [];
  for (const o of openOps) {
    const kinds = [];
    if (stageFact.has(o.id)) kinds.push('stage');
    if (lotFact.has(o.id)) kinds.push('lot');
    if (reservationFactIds.has(o.id)) kinds.push('reservation');
    if (consumptionFact.has(o.id)) kinds.push('consumption');
    if (kinds.length) {
      blocking.push(`${o.order_number} (${o.id}) [${kinds.join('+')}]`);
    }
  }

  let cancel_block_code = 'ok';
  let cancel_block_detail = null;
  if (so.status === 'Cancelado') {
    cancel_block_code = 'ja_cancelado';
    cancel_block_detail = 'PV já cancelado';
  } else if (!CANCEL_ALLOWED_PV.has(so.status)) {
    cancel_block_code = 'PZ110_status';
    cancel_block_detail = `Status ${so.status} não permite transição para Cancelado`;
  } else if (nfeByPv.has(so.id)) {
    cancel_block_code = 'PZ112';
    cancel_block_detail =
      'PV possui NF-e ativa; cancele a NF-e antes de cancelar o pedido';
  } else if (hasFinalized) {
    cancel_block_code = 'PZ105_op_finalizada';
    cancel_block_detail =
      'PV possui OP concluída/finalizada; cancelamento automático recusado';
  } else if (blocking.length) {
    cancel_block_code = 'PZ105_fato_fisico';
    cancel_block_detail = blocking.join('; ');
  }

  return {
    sale_order_id: so.id,
    order_number: so.order_number,
    status: so.status,
    client_name: so.client_name,
    pares: paresByPv.get(so.id) ?? 0,
    total: so.total,
    nfe_ativa: nfeByPv.has(so.id),
    nfe_required: so.nfe_required,
    can_cancel: cancel_block_code === 'ok',
    can_revert_aprovado_to_rascunho:
      so.status === 'Aprovado' && cancel_block_code === 'ok',
    allowed_next_statuses: VALID_TRANSITIONS[so.status] ?? [],
    cancel_block_code,
    cancel_block_detail,
    blocking_op_count: blocking.length,
  };
});

const summary = {};
for (const r of rows) {
  const s = summary[r.cancel_block_code] ?? { qtd_pvs: 0, pares: 0 };
  s.qtd_pvs += 1;
  s.pares += Number(r.pares);
  summary[r.cancel_block_code] = s;
}

const payload = {
  generated_at: new Date().toISOString(),
  project: 'ssvxfoybzmjlypnipqzn',
  summary,
  rows: rows.sort((a, b) =>
    String(a.cancel_block_code).localeCompare(b.cancel_block_code) ||
    String(a.order_number).localeCompare(b.order_number),
  ),
};

const outDir = resolve('/opt/cursor/artifacts');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'audit-sale-order-status-transitions.json');
writeFileSync(outPath, JSON.stringify(payload, null, 2));

console.error('Resumo por cancel_block_code:');
for (const [code, s] of Object.entries(summary).sort()) {
  console.error(`  ${code}: ${s.qtd_pvs} PVs · ${s.pares} pares`);
}
console.error(`JSON: ${outPath}`);
console.log(JSON.stringify(payload));
