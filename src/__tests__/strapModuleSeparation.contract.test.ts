import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const navigation = read('src/data/navigation.ts');
const contractors = read('src/pages/Contractors.tsx');
const contractorHooks = read('src/hooks/useContractors.ts');
const contractorReports = read('src/pages/ContractorReports.tsx');
const contractorHistory = read('src/components/contractors/ContractorHistoryDialog.tsx');
const consolidatedServiceOrders = read('src/hooks/useConsolidatedServiceOrders.ts');
const globalSearch = read('src/components/layout/GlobalSearch.tsx');
const pvServiceOrders = read('src/components/sale-orders/PvServiceOrdersCard.tsx');
const strapsHub = read('src/pages/ArtisanalStraps.tsx');
const migration = read('supabase/migrations/20270101009900_separar_tiras_terceirizados_e_reparar_worker.sql');
const strapView = migration.slice(
  migration.indexOf('CREATE OR REPLACE VIEW public.v_strap_service_orders'),
  migration.indexOf('CREATE OR REPLACE VIEW public.v_non_strap_service_orders'),
);
const nonStrapView = migration.slice(
  migration.indexOf('CREATE OR REPLACE VIEW public.v_non_strap_service_orders'),
  migration.indexOf('CREATE OR REPLACE VIEW public.v_non_strap_service_order_payables'),
);

describe('Tiras — fronteira própria fora de Terceirizados', () => {
  it('mantém a Central de Tiras em um grupo principal independente', () => {
    expect(navigation).toContain("label: 'Central de Tiras', group: 'Tiras'");
    expect(navigation).toMatch(/label: 'Tiras', icon: Scissors,[\s\S]*items: \[resource\('\/tiras-artesanais'\)\]/);
    expect(strapsHub).toContain('sectionLabel="CENTRAL DE TIRAS"');
    expect(strapsHub).not.toContain('ENGENHARIA · TIRAS');

    const engineeringGroup = navigation.slice(
      navigation.indexOf("label: 'Engenharia', icon: Ruler"),
      navigation.indexOf("label: 'Tiras', icon: Scissors"),
    );
    expect(engineeringGroup).not.toContain("resource('/tiras-artesanais')");
  });

  it('filtra OS de tira antes de entregar o dataset ao menu genérico', () => {
    expect(contractorHooks).toContain("loadCanonicalIds('v_strap_service_orders', 'id')");
    expect(contractorHooks).toContain('.filter(o => !isStrapServiceOrder(o))');
    expect(contractors).not.toContain('isCanonicalStrapServiceOrder');
    expect(contractors).not.toContain('artisanal_output_name');
    expect(contractors).not.toContain('Abrir no Hub de Tiras');
    expect(contractorHooks).not.toContain('useUpsertOpenServiceOrder');
    expect(consolidatedServiceOrders).toContain('return !isStrapServiceOrder({ ...o, is_canonical_strap: hasCanonicalStrapLine })');
  });

  it('separa busca global e atalhos do PV conforme o domínio de cada OS', () => {
    expect(globalSearch).toContain('const strapServiceOrders');
    expect(globalSearch).toContain('Ordens de Tiras');
    expect(globalSearch).toContain('/tiras-artesanais?tab=producao&q=');
    expect(globalSearch).toContain(".from('v_non_strap_service_orders')");
    expect(globalSearch).toContain(".from('v_strap_service_orders')");
    expect(globalSearch).toContain(".from('v_strap_service_order_items_operational')");
    expect(globalSearch).not.toContain('const allServiceOrders');
    expect(pvServiceOrders).toContain('const strapOrder = isStrapServiceOrder(r)');
    expect(pvServiceOrders).toContain("Produção de tiras");
    expect(pvServiceOrders).toContain('/tiras-artesanais?tab=producao&q=');
    expect(strapsHub).not.toContain('Ordens terceirizadas');
  });

  it('retira tiras também dos KPIs, histórico e financeiro genéricos', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.v_non_strap_service_orders');
    expect(migration).toContain('CREATE OR REPLACE VIEW public.v_strap_service_orders');
    expect(migration).toContain('CREATE OR REPLACE VIEW public.v_non_strap_service_order_payables');
    expect(migration).toContain("'v_contractor_metrics'");
    expect(migration).toContain("'v_contractor_history_orders'");
    expect(migration).toContain("'v_contractor_os_financials'");
    expect(strapView).toContain("so.service_order_domain = 'strap'");
    expect(nonStrapView).toContain("so.service_order_domain = 'generic'");
    expect(strapView).not.toContain('artisanal_recipe_id IS NOT NULL');
    expect(nonStrapView).not.toContain('artisanal_recipe_id IS NOT NULL');
    expect(migration).toContain("'\\m(public\\.)?service_orders\\s+so\\M'");
    expect(migration).toContain("'\\m(public\\.)?v_service_order_payables\\s+p\\M'");
    expect(migration).toMatch(/REVOKE ALL ON public\.v_non_strap_service_orders\s+FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/REVOKE ALL ON public\.v_non_strap_service_order_payables\s+FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration.match(/session_user::text IN \('postgres', 'supabase_admin', 'service_role'\)/g)).toHaveLength(3);
    expect(migration.match(/current_setting\('request\.jwt\.claim\.role', true\), ''\) = 'service_role'/g)).toHaveLength(3);
    expect(migration).toMatch(/ALTER VIEW public\.v_contractor_metrics SET \(security_invoker = true\)/);
    expect(migration).toMatch(/REVOKE ALL ON public\.v_contractor_metrics\s+FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toContain("v_definition !~ '\\m(public\\.)?v_non_strap_service_orders\\s+so\\M'");
    expect(migration).toContain("v_definition !~ '\\m(public\\.)?v_non_strap_service_orders\\s+so2\\M'");
    expect(migration).toContain("v_definition !~ '\\m(public\\.)?v_non_strap_service_order_payables\\s+p\\M'");
    expect(migration).toContain('IF v_rewritten IS DISTINCT FROM v_definition THEN');
    expect(contractorReports).not.toContain('o.is_artisanal');
    expect(contractorHistory).not.toContain('o.is_artisanal');
  });

  it('impede OS mista e protege os cinco vínculos canônicos pelo motor', () => {
    expect(migration).toContain("CHECK (service_order_domain IN ('generic', 'strap'))");
    expect(migration).toContain("(so.service_order_domain = 'strap') IS DISTINCT FROM (");
    expect(migration).toContain('CREATE TRIGGER trg_enforce_service_order_item_domain');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.tg_guard_canonical_strap_service_order_item()');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.tg_guard_canonical_strap_service_order()');
    for (const field of [
      'strap_variant_id',
      'strap_recipe_id',
      'strap_batch_item_id',
      'sale_order_strap_demand_id',
      'strap_stock_floor_contribution_id',
    ]) {
      expect(migration).toContain(`OLD.${field}`);
      expect(migration).toContain(`NEW.${field}`);
    }
    expect(migration).toContain("NEW.service_order_domain = 'strap'");
    expect(migration).toContain("OLD.service_order_domain = 'strap'");
    expect(migration).toContain('ERRCODE = \'42501\'');
  });

  it('não reutiliza cabeçalho legado e mantém rollout retrocompatível', () => {
    expect(migration).toContain('AND so.canonical_strap_recipe_id IS NULL');
    expect(migration).toContain('AND so.artisanal_recipe_id IS NULL');
    expect(migration).toContain('AND NOT coalesce(so.artisanal_stock_entry_done, false)');
    expect(contractorHooks).toContain("isMissingPostgrestRelation(error, 'v_strap_service_orders')");
    expect(globalSearch).toContain("isMissingPostgrestRelation(error, 'v_non_strap_service_orders')");
    expect(globalSearch).toContain("isMissingPostgrestRelation(legacyError, 'v_strap_service_orders')");
    expect(consolidatedServiceOrders).not.toContain('created_at, service_order_domain');
    expect(pvServiceOrders).not.toContain('status, service_order_domain');
  });

  it('autoriza somente o backfill e aposenta o escritor artesanal paralelo de estoque mínimo', () => {
    expect(migration).toContain("set_config('app.strap_engine_write', '1', true)");
    expect(migration).toContain('coalesce(v_previous_strap_engine_write');
    expect(migration).toContain('DISABLE TRIGGER set_service_orders_updated_at');
    expect(migration).toContain('ENABLE TRIGGER set_service_orders_updated_at');
    expect(migration).toContain('ENABLE REPLICA TRIGGER set_service_orders_updated_at');
    expect(migration).toContain('ENABLE ALWAYS TRIGGER set_service_orders_updated_at');
    expect(migration).toContain("WHERE service_order_domain IS NULL");
    expect(migration).toContain("service_order.service_order_domain = 'generic'");
    expect(migration).toContain("'public.auto_create_purchase_order()'::regprocedure");
    expect(migration).toContain('IF COALESCE(NEW.is_artisanal, false) THEN');
    expect(migration).toMatch(/IF COALESCE\(NEW\.is_artisanal, false\) THEN\\n {4}RETURN NEW;/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.upsert_open_service_order\([\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  });

  it('mantém o reparo durável do worker que não pode agregar UUID com max', () => {
    expect(migration).toContain('(array_agg(o.id ORDER BY o.id))[1]');
    expect(migration).toContain('ORDER BY u.id DESC');
    expect(migration).toContain("jobname = 'artisanal-strap-demand-worker'");
    expect(migration).toContain("'''pendente_aprovacao'', v_group.supplier_id'");
    expect(migration).toContain('WHERE poi.purchase_order_id = v_po.id');
  });
});
