#!/usr/bin/env bun
/**
 * Runner da auditoria de status dos PVs.
 *
 * Preferência 1 — Management API (mesmo endpoint do workflow supabase-db-exec):
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_ID=ssvxfoybzmjlypnipqzn \
 *     bun scripts/run-audit-sale-order-status.mjs
 *   → executa sql-scripts/audit-sale-order-status-transitions.sql de verdade.
 *
 * Preferência 2 — PostgREST com service role (replica a lógica em TS):
 *   SUPABASE_SERVICE_ROLE_KEY=... bun scripts/run-audit-sale-order-status.mjs
 *
 * Sem credencial: cole o SQL no SQL Editor.
 *
 * Saída: JSON em stdout + resumo em stderr + artifact em
 * /opt/cursor/artifacts/audit-sale-order-status-transitions.json
 * Não grava nada no banco.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ID =
  process.env.SUPABASE_PROJECT_ID || 'ssvxfoybzmjlypnipqzn';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  `https://${PROJECT_ID}.supabase.co`;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  '';

const SQL_PATH = resolve(
  import.meta.dirname,
  '../sql-scripts/audit-sale-order-status-transitions.sql',
);
const OUT_DIR = resolve('/opt/cursor/artifacts');
const OUT_PATH = resolve(OUT_DIR, 'audit-sale-order-status-transitions.json');

function writePayload(payload) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  const summary = payload.summary || {};
  console.error('Resumo por cancel_block_code:');
  for (const [code, s] of Object.entries(summary).sort()) {
    console.error(`  ${code}: ${s.qtd_pvs} PVs · ${s.pares} pares`);
  }
  console.error(`JSON: ${OUT_PATH}`);
  console.log(JSON.stringify(payload));
}

async function runViaManagementApi() {
  const query = readFileSync(SQL_PATH, 'utf8');
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Management API HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text);
  // A Management API devolve o resultset do SELECT (array de rows) ou
  // um envelope com rows — normalizar.
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.rows)
      ? data.rows
      : Array.isArray(data?.[0])
        ? data[0]
        : data;

  const list = Array.isArray(rows) ? rows : [];
  const summary = {};
  const detalhe = [];
  for (const r of list) {
    if (r.secao === 'resumo' || r.secao === 'summary') {
      summary[r.cancel_block_code] = {
        qtd_pvs: Number(r.qtd_pvs ?? 0),
        pares: Number(r.pares ?? 0),
      };
    } else {
      detalhe.push(r);
      if (!summary[r.cancel_block_code]) {
        summary[r.cancel_block_code] = { qtd_pvs: 0, pares: 0 };
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    project: PROJECT_ID,
    source: 'management_api_sql',
    sql_path: 'sql-scripts/audit-sale-order-status-transitions.sql',
    summary,
    rows: detalhe,
    raw_row_count: list.length,
  };
}

async function allRows(sb, table, select, extra = (q) => q) {
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

async function allRowsInChunks(sb, table, select, column, ids, chunkSize = 200) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    out.push(
      ...(await allRows(sb, table, select, (q) => q.in(column, chunk))),
    );
  }
  return out;
}

async function runViaServiceRole() {
  const sb = createClient(URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
    return (
      s === 'consumed' || s === 'converted' || s === 'pending_reconciliation'
    );
  }

  const saleOrders = await allRows(
    sb,
    'sale_orders',
    'id, order_number, status, client_name, client_order_number, total, nfe_required',
    (q) => q.is('deleted_at', null),
  );
  const items = await allRows(sb, 'sale_order_items', 'sale_order_id, quantity');
  const orders = await allRows(
    sb,
    'orders',
    'id, order_number, status, sale_order_id',
    (q) => q.is('deleted_at', null).not('sale_order_id', 'is', null),
  );
  const nfe = await allRows(
    sb,
    'nfe_emitidas',
    'sale_order_id, status',
    (q) => q.in('status', ['autorizada', 'processando', 'cancelando']),
  );
  const orderIds = orders.map((o) => o.id);
  const stages = await allRowsInChunks(
    sb,
    'order_stages',
    'order_id, quantity_processed, started_at, completed_at, status',
    'order_id',
    orderIds,
  );
  const lots = await allRowsInChunks(
    sb,
    'order_lots',
    'order_id, started_at, completed_at, status',
    'order_id',
    orderIds,
  );
  const reservations = await allRowsInChunks(
    sb,
    'material_reservations',
    'order_id, quantity_consumed, consumed_at, status',
    'order_id',
    orderIds,
  );
  const consumptionsRaw = await allRowsInChunks(
    sb,
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
    if (
      l.started_at != null ||
      l.completed_at != null ||
      !pendingish(l.status)
    ) {
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

  return {
    generated_at: new Date().toISOString(),
    project: PROJECT_ID,
    source: 'service_role_postgrest',
    summary,
    rows: rows.sort(
      (a, b) =>
        String(a.cancel_block_code).localeCompare(b.cancel_block_code) ||
        String(a.order_number).localeCompare(b.order_number),
    ),
  };
}

if (ACCESS_TOKEN) {
  writePayload(await runViaManagementApi());
} else if (SERVICE_KEY) {
  writePayload(await runViaServiceRole());
} else {
  console.error(
    [
      'Falta credencial pra ler o banco.',
      '  • SUPABASE_ACCESS_TOKEN (+ SUPABASE_PROJECT_ID) → roda o SQL via Management API',
      '  • SUPABASE_SERVICE_ROLE_KEY → replica via PostgREST',
      '  • Ou cole sql-scripts/audit-sale-order-status-transitions.sql no SQL Editor:',
      '    https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new',
    ].join('\n'),
  );
  process.exit(2);
}
