#!/usr/bin/env bun
/**
 * Runner do diagnóstico focado: elástico/forrado no PV-00194.
 *
 * Preferência 1 — Management API:
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_ID=ssvxfoybzmjlypnipqzn \
 *     bun scripts/run-audit-pv-00194-elastico.mjs
 *
 * Preferência 2 — PostgREST service role (RPC + selects parciais):
 *   SUPABASE_SERVICE_ROLE_KEY=... bun scripts/run-audit-pv-00194-elastico.mjs
 *
 * Somente leitura. Saída: JSON em stdout + artifact em
 * /opt/cursor/artifacts/audit-pv-00194-elastico-forrado.json
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
  '../sql-scripts/audit-pv-00194-elastico-forrado.sql',
);
const OUT_DIR = resolve('/opt/cursor/artifacts');
const OUT_PATH = resolve(OUT_DIR, 'audit-pv-00194-elastico-forrado.json');

function writePayload(payload) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  const v = payload?.veredito || payload?.audit_pv_00194_elastico?.veredito || {};
  console.error('Veredito PV-00194 · elástico/forrado:');
  console.error(`  pedido_encontrado: ${v.pedido_encontrado}`);
  console.error(`  canal_direct: ${v.tem_direct_component_elastico}`);
  console.error(`  canal_accessory: ${v.tem_accessory_elastico} (mandatory=${v.tem_accessory_mandatory_elastico})`);
  console.error(`  has_straps: ${v.ficha_has_straps} · linhas_strap=${v.tem_linhas_strap_colors}`);
  console.error(`  canal_bom: ${v.tem_bom_elastico}`);
  console.error(`  consumo_material: ${v.consumo_mostra_elastico_material}`);
  console.error(`  consumo_tira: ${v.consumo_mostra_strap_preview}`);
  console.error(`  hipótese: ${v.hipotese}`);
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
    ? rows[0]?.audit_pv_00194_elastico || rows[0] || rows
    : rows;
  writePayload(payload);
}

/**
 * Fallback PostgREST: replica o essencial do SQL (canais da ficha + report).
 * Menos rico que o SQL completo, mas basta pra fechar o veredito.
 */
async function runViaServiceRole() {
  const supabase = createClient(URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: orders, error: orderErr } = await supabase
    .from('sale_orders')
    .select('id, order_number, status, client_name, client_order_number, created_at, updated_at')
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
        hipotese: 'pedido_nao_encontrado',
      },
      candidatos: orders || [],
    });
    return;
  }

  const [{ data: items, error: itemsErr }, { data: report, error: reportErr }] =
    await Promise.all([
      supabase
        .from('sale_order_items')
        .select(
          'id, color, quantity, fichas, grade, material_variant_id, reference_id, technical_sheets(id, code, name, version, updated_at, has_straps, component_colors_enabled, direct_components, components_accessories, strap_colors, upper_material, upper_consumption)',
        )
        .eq('sale_order_id', pv.id),
      supabase.rpc('calculate_consumption_report_batch', {
        p_sale_order_ids: [pv.id],
        p_order_ids: null,
      }),
    ]);
  if (itemsErr) throw itemsErr;
  if (reportErr) throw reportErr;

  const sheetIds = [
    ...new Set((items || []).map((i) => i.reference_id).filter(Boolean)),
  ];
  const { data: bomRows, error: bomErr } = sheetIds.length
    ? await supabase
        .from('sheet_materials')
        .select(
          'id, sheet_id, product_id, quantity_per_unit, color, material_variant_id, products(name, active, unit, group_id, product_groups(name))',
        )
        .in('sheet_id', sheetIds)
    : { data: [], error: null };
  if (bomErr) throw bomErr;

  const matchElastico = (text) => {
    const t = (text || '').toString().toLowerCase();
    return /el[aá]stic|forrad/.test(t);
  };

  const canalDc = [];
  const canalAcc = [];
  const canalStrap = [];
  for (const item of items || []) {
    const ts = item.technical_sheets || {};
    for (const [idx, elem] of (ts.direct_components || []).entries()) {
      const name = elem?.product_name || '';
      if (!matchElastico(name)) continue;
      canalDc.push({
        item_id: item.id,
        ficha_code: ts.code,
        pv_color: item.color,
        idx,
        product_id: elem.product_id,
        product_name_snap: name,
        qty_per_pair: Number(elem.quantity) || 0,
        unit_snap: elem.unit,
      });
    }
    for (const [idx, elem] of (ts.components_accessories || []).entries()) {
      const label = elem?.material || '';
      if (!matchElastico(label) && !matchElastico(elem?.product_id)) continue;
      canalAcc.push({
        item_id: item.id,
        ficha_code: ts.code,
        pv_color: item.color,
        idx,
        mandatory: !!elem.mandatory,
        material_label: label,
        product_id: elem.product_id || elem.id || null,
        consumption: Number(elem.consumption) || 0,
        consumption_per_size: elem.consumption_per_size || null,
      });
    }
    for (const [idx, elem] of (ts.strap_colors || []).entries()) {
      canalStrap.push({
        item_id: item.id,
        ficha_code: ts.code,
        pv_color: item.color,
        has_straps: !!ts.has_straps,
        idx,
        technical_strap_line_id: elem.technical_strap_line_id || null,
        identity_basis: elem.identity_basis || null,
        measure_id: elem.measure_id || null,
        strap_type_id: elem.strap_type_id || null,
        consumption: Number(elem.consumption) || 0,
        material_group_id: elem.material_group_id || null,
      });
    }
  }

  const canalBom = (bomRows || [])
    .filter((row) => {
      const pname = row.products?.name || '';
      const gname = row.products?.product_groups?.name || '';
      return matchElastico(pname) || matchElastico(gname);
    })
    .map((row) => ({
      sheet_id: row.sheet_id,
      product_id: row.product_id,
      quantity_per_unit: row.quantity_per_unit,
      bom_color: row.color,
      material_variant_id: row.material_variant_id,
      product_name: row.products?.name,
      product_active: row.products?.active,
      product_unit: row.products?.unit,
      group_name: row.products?.product_groups?.name,
    }));

  const lines = Array.isArray(report?.lines) ? report.lines : [];
  const strapPreviews = Array.isArray(report?.strap_previews)
    ? report.strap_previews
    : [];

  const liveMaterial = lines.filter((line) =>
    matchElastico(line.product_name) || matchElastico(line.component),
  );
  const liveStraps = strapPreviews.map((preview) => {
    const resolved = preview.resolved || {};
    return {
      sale_order_item_id: preview.sale_order_item_id,
      technical_strap_line_id: preview.technical_strap_line_id,
      strap_product_name:
        resolved.strap_product_name || resolved.group_name || resolved.label,
      measure_name: resolved.measure_name || null,
      strap_color_name: resolved.strap_color_name || resolved.color || null,
      base_group_name: resolved.base_group_name || null,
      base_product_name: resolved.base_product_name || null,
      source_mode: preview.source_mode,
      gross_required_m: preview.gross_required_m,
      base_required_m: resolved.base_required_m ?? null,
      blocking_reasons: preview.blocking_reasons || [],
    };
  });

  const hasStraps = (items || []).some((i) => i.technical_sheets?.has_straps);
  let hipotese = 'revisar_detalhe_dos_canais';
  if (canalStrap.length && !liveStraps.length) {
    hipotese =
      'tira_na_ficha_sem_preview_canônico — cadastro de receita/variante/base incompleto ou bloqueado';
  } else if (canalStrap.length && liveStraps.length) {
    hipotese =
      'elástico_forrado_é_TIRA — aparece só em § Tiras artesanais, não na tabela de materiais';
  } else if (canalDc.length && liveMaterial.length) {
    hipotese =
      'elástico_está_em_componentes_diretos_e_aparece_no_consumo — confira o NOME do produto (ex.: Elástico 6MM no grupo ELÁSTICO 7MM)';
  } else if (canalAcc.some((a) => a.mandatory) && !liveMaterial.length) {
    hipotese =
      'accessory_mandatory_sem_linha_no_consumo — produto inativo/órfão ou qty 0 (skip silencioso)';
  } else if (canalBom.length && !liveMaterial.length) {
    hipotese =
      'BOM_com_elastico_omitido — dedup/variante/produto inativo/qty 0';
  } else if (
    !canalDc.length &&
    !canalAcc.length &&
    !canalStrap.length &&
    !canalBom.length
  ) {
    hipotese =
      'nenhum_canal_da_ficha_tem_elastico_forrado — o que a UI mostra pode ser só rótulo/grupo, não vínculo consumível';
  }

  writePayload({
    pedido: pv,
    itens: (items || []).map((i) => ({
      item_id: i.id,
      cor: i.color,
      pares: i.quantity,
      ficha: i.technical_sheets?.code,
      ficha_version: i.technical_sheets?.version,
      has_straps: i.technical_sheets?.has_straps,
      qtd_direct_components: (i.technical_sheets?.direct_components || []).length,
      qtd_components_accessories: (i.technical_sheets?.components_accessories || []).length,
      qtd_strap_colors: (i.technical_sheets?.strap_colors || []).length,
    })),
    canal_direct_components_elastico: canalDc,
    canal_components_accessories_elastico: canalAcc,
    canal_strap_colors_todas_linhas: canalStrap,
    canal_bom_elastico: canalBom,
    consumo_vivo_materiais_elastico: liveMaterial,
    consumo_vivo_strap_previews: liveStraps,
    veredito: {
      pedido_encontrado: true,
      tem_direct_component_elastico: canalDc.length > 0,
      tem_accessory_elastico: canalAcc.length > 0,
      tem_accessory_mandatory_elastico: canalAcc.some((a) => a.mandatory),
      ficha_has_straps: hasStraps,
      tem_linhas_strap_colors: canalStrap.length > 0,
      tem_bom_elastico: canalBom.length > 0,
      consumo_mostra_elastico_material: liveMaterial.length > 0,
      consumo_mostra_strap_preview: liveStraps.length > 0,
      hipotese,
    },
  });
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
