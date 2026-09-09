#!/usr/bin/env bun
/**
 * Runner da auditoria do PV-00194 (consumo vs ficha viva).
 *
 * Preferência 1 — Management API:
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_ID=ssvxfoybzmjlypnipqzn \
 *     bun scripts/run-audit-pv-00194.mjs
 *
 * Preferência 2 — PostgREST service role (RPC + selects):
 *   SUPABASE_SERVICE_ROLE_KEY=... bun scripts/run-audit-pv-00194.mjs
 *
 * Somente leitura. Saída: JSON em stdout + artifact em
 * /opt/cursor/artifacts/audit-pv-00194-consumo-ficha.json
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
  '../sql-scripts/audit-pv-00194-consumo-ficha.sql',
);
const OUT_DIR = resolve('/opt/cursor/artifacts');
const OUT_PATH = resolve(OUT_DIR, 'audit-pv-00194-consumo-ficha.json');

function writePayload(payload) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  const v = payload?.veredito || payload?.audit_pv_00194?.veredito || {};
  console.error('Veredito PV-00194:');
  console.error(`  pedido_encontrado: ${v.pedido_encontrado}`);
  console.error(`  ops_geradas: ${v.ops_geradas}`);
  console.error(`  snapshot_desatualizado: ${v.snapshot_desatualizado}`);
  console.error(`  costs_dirty: ${v.costs_dirty}`);
  console.error(`  reservations_outdated: ${v.reservations_outdated}`);
  console.error(`  linhas_consumo_vivo: ${v.linhas_consumo_vivo}`);
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
    throw new Error(`Management API HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  const data = JSON.parse(text);
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.rows)
      ? data.rows
      : data;
  const payload = Array.isArray(rows)
    ? rows[0]?.audit_pv_00194 || rows[0] || rows
    : rows;
  writePayload(payload);
}

async function runViaServiceRole() {
  const supabase = createClient(URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: orders, error: orderErr } = await supabase
    .from('sale_orders')
    .select(
      'id, order_number, status, client_name, client_order_number, total, created_at, updated_at, costs_dirty_at, reservations_outdated_at, packaging_mode, box_grouping',
    )
    .or('order_number.eq.PV-00194,order_number.ilike.%00194%')
    .order('created_at', { ascending: false })
    .limit(5);
  if (orderErr) throw orderErr;

  const pv =
    (orders || []).find((o) => o.order_number === 'PV-00194') ||
    (orders || [])[0] ||
    null;
  if (!pv) {
    writePayload({
      veredito: {
        pedido_encontrado: false,
        ops_geradas: false,
        snapshot_desatualizado: false,
        costs_dirty: false,
        reservations_outdated: false,
        linhas_consumo_vivo: 0,
      },
      candidatos: orders || [],
    });
    return;
  }

  const [
    { data: items, error: itemsErr },
    { data: ops, error: opsErr },
    { data: snaps, error: snapsErr },
    { data: report, error: reportErr },
  ] = await Promise.all([
    supabase
      .from('sale_order_items')
      .select(
        'id, color, quantity, fichas, grade, material_variant_id, reference_id, created_at, technical_sheets(id, code, name, version, updated_at, sole_drives_consumption, component_colors_enabled, upper_material, upper_consumption, upper_consumption_per_size, lining_material, lining_consumption, lining_consumption_per_size, insole_material, insole_consumption, insole_consumption_per_size, insole_lining_consumption, insole_lining_consumption_per_size, fachete_material, fachete_consumption, primary_sole_id)',
      )
      .eq('sale_order_id', pv.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('orders')
      .select(
        'id, order_number, status, quantity, color, grade, sale_order_item_id, reference_id, created_at, updated_at',
      )
      .eq('sale_order_id', pv.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('technical_sheet_snapshots')
      .select(
        'id, sale_order_item_id, sheet_id, sheet_name, sheet_version, color, quantity, frozen_at, outdated_at, sole_drives_consumption, consumption_snapshot',
      )
      .eq('sale_order_id', pv.id),
    supabase.rpc('calculate_consumption_report_batch', {
      p_sale_order_ids: [pv.id],
      p_order_ids: null,
    }),
  ]);

  if (itemsErr) throw itemsErr;
  if (opsErr) throw opsErr;
  if (snapsErr) throw snapsErr;
  if (reportErr) throw reportErr;

  const lines = Array.isArray(report?.lines) ? report.lines : [];
  const alinhamento = (items || []).map((item) => {
    const snap = (snaps || []).find((s) => s.sale_order_item_id === item.id);
    const liveVersion = item.technical_sheets?.version;
    let status = 'sem_snapshot';
    if (snap) {
      if (snap.outdated_at) status = 'snapshot_marcado_outdated';
      else if (snap.sheet_version !== liveVersion)
        status = 'versao_ficha_diferente_do_snapshot';
      else status = 'snapshot_parece_alinhado_a_versao';
    }
    return {
      item_id: item.id,
      color: item.color,
      ficha_code: item.technical_sheets?.code,
      ficha_name: item.technical_sheets?.name,
      ficha_version_viva: liveVersion,
      snapshot_id: snap?.id ?? null,
      snapshot_sheet_version: snap?.sheet_version ?? null,
      frozen_at: snap?.frozen_at ?? null,
      outdated_at: snap?.outdated_at ?? null,
      alinhamento_snapshot: status,
    };
  });

  const payload = {
    pedido: pv,
    ja_gerado: {
      tem_ops: (ops || []).length > 0,
      qtd_ops: (ops || []).length,
      status_pv: pv.status,
      promovido_em_producao: ['Em Produção', 'Finalizado', 'Expedido'].includes(
        pv.status,
      ),
      costs_dirty: pv.costs_dirty_at != null,
      reservations_outdated: pv.reservations_outdated_at != null,
    },
    itens: items || [],
    ops: ops || [],
    snapshots: snaps || [],
    alinhamento_snapshot_vs_ficha: alinhamento,
    consumo_vivo_linhas: lines,
    veredito: {
      pedido_encontrado: true,
      ops_geradas: (ops || []).length > 0,
      snapshot_desatualizado: alinhamento.some((a) =>
        [
          'snapshot_marcado_outdated',
          'versao_ficha_diferente_do_snapshot',
        ].includes(a.alinhamento_snapshot),
      ),
      costs_dirty: pv.costs_dirty_at != null,
      reservations_outdated: pv.reservations_outdated_at != null,
      consumo_vivo_com_aviso: lines.some(
        (l) => l.consumption_warning || l.conversion_warning || l.warning,
      ),
      linhas_consumo_vivo: lines.length,
    },
  };

  writePayload(payload);
}

async function main() {
  if (ACCESS_TOKEN) {
    await runViaManagementApi();
    return;
  }
  if (SERVICE_KEY) {
    await runViaServiceRole();
    return;
  }
  console.error(
    'Sem credencial. Defina SUPABASE_ACCESS_TOKEN ou SUPABASE_SERVICE_ROLE_KEY.',
  );
  console.error(`SQL pronto em: ${SQL_PATH}`);
  console.error(
    'SQL Editor: https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new',
  );
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
