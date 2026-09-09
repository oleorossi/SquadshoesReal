/**
 * Contrato estrutural do planejamento de terceirização por OP × atividade.
 *
 * O comportamento real também é verificado contra o banco após a aplicação da
 * migration. Estes guards impedem regressões silenciosas no arquivo versionado:
 * prazo para frente, fila contando a própria OS, segundo motor de consumo ou
 * mistura entre necessidade calculada e remessa física.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101009800_terceirizacao_capacidade_prazo_materiais.sql'),
  'utf8',
);

const section = (start: string, end: string) => {
  const startIndex = SQL.indexOf(start);
  if (startIndex < 0) throw new Error(`Início de seção ausente: ${start}`);
  const endIndex = SQL.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`Fim de seção ausente após ${start}: ${end}`);
  return SQL.slice(startIndex, endIndex);
};
const CONFIG_VALIDATION = section(
  'CREATE OR REPLACE FUNCTION public.outsource_config_issue',
  'COMMENT ON FUNCTION public.outsource_config_issue',
);
const CONFIG_IDENTITY_GUARD = section(
  'CREATE OR REPLACE FUNCTION public.tg_guard_outsource_config_identity',
  '-- O trigger novo preenche source_terceirizacao_id',
);
const ITEM_VALIDATOR = section(
  'CREATE OR REPLACE FUNCTION public.tg_validate_item_outsourced_sectors',
  '-- Normaliza setores já preenchidos',
);
const MATERIALS = section(
  'CREATE OR REPLACE FUNCTION public.calculate_outsource_material_requirements',
  'COMMENT ON FUNCTION public.calculate_outsource_material_requirements',
);
const PLAN = section(
  'CREATE OR REPLACE FUNCTION public.calculate_outsource_plan',
  'COMMENT ON FUNCTION public.calculate_outsource_plan',
);
const APPLY_TRIGGER = section(
  'CREATE OR REPLACE FUNCTION public.tg_apply_outsource_plan_to_service_order',
  'CREATE OR REPLACE FUNCTION public.tg_guard_outsource_planning_snapshot',
);
const QUEUE_LOCK_GUARD = section(
  'CREATE OR REPLACE FUNCTION public.tg_lock_outsource_queue_workload',
  'REVOKE ALL ON FUNCTION public.tg_lock_outsource_queue_workload',
);
const COMPLETION_GUARD = section(
  'CREATE OR REPLACE FUNCTION public.tg_guard_planned_service_order_completion',
  'COMMENT ON FUNCTION public.tg_guard_planned_service_order_completion',
);
const PV_CANCEL_GUARD = section(
  'CREATE OR REPLACE FUNCTION public.tg_cancel_service_orders_on_pv_cancel',
  'COMMENT ON FUNCTION public.tg_cancel_service_orders_on_pv_cancel',
);
const PV_CANDIDATE = section(
  'CREATE OR REPLACE FUNCTION public.is_service_order_candidate_for_sale',
  'COMMENT ON FUNCTION public.is_service_order_candidate_for_sale',
);
const PV_EXCLUSIVITY = section(
  'CREATE OR REPLACE FUNCTION public.is_exclusive_service_order_for_sale',
  'COMMENT ON FUNCTION public.is_exclusive_service_order_for_sale',
);
const ITEM_IDENTITY_GUARD = section(
  'CREATE OR REPLACE FUNCTION public.tg_guard_service_order_item_identity',
  'COMMENT ON FUNCTION public.tg_guard_service_order_item_identity',
);
const DELETE_GUARD = section(
  'CREATE OR REPLACE FUNCTION public.tg_guard_service_order_delete_history',
  'COMMENT ON FUNCTION public.tg_guard_service_order_delete_history',
);
const DEPENDENCIES = section(
  'CREATE OR REPLACE FUNCTION public.get_outsource_open_stage_dependencies',
  'COMMENT ON FUNCTION public.get_outsource_open_stage_dependencies',
);
const STAGE_GUARD = section(
  'CREATE OR REPLACE FUNCTION public.tg_guard_order_stage_outsource_dependency',
  'DROP TRIGGER IF EXISTS tg_block_montagem_with_pending_service_order',
);
const STAGE_INSERT_SYNC = section(
  'CREATE OR REPLACE FUNCTION public.tg_refresh_outsource_block_after_stage_insert',
  'CREATE OR REPLACE FUNCTION public.tg_sync_op_block_on_outsource',
);
const SERVICE_ORDER_SYNC = section(
  'CREATE OR REPLACE FUNCTION public.tg_sync_op_block_on_outsource',
  '-- A função canônica conclui a etapa atual',
);
const FINALIZE = section(
  'CREATE OR REPLACE FUNCTION public.finalize_production_sector',
  'COMMENT ON FUNCTION public.finalize_production_sector',
);
const WIZARD_READ = section(
  'CREATE FUNCTION public.get_pv_outsourceable_lines',
  'COMMENT ON FUNCTION public.get_pv_outsourceable_lines',
);
const WRITER = section(
  'CREATE OR REPLACE FUNCTION public.create_op_service_order',
  'COMMENT ON FUNCTION public.create_op_service_order',
);
const OP_IDENTITY_GUARD = section(
  'CREATE OR REPLACE FUNCTION public.tg_guard_service_order_from_op',
  '-- Writer integrado legado:',
);
const LEGACY_SEND = section(
  'CREATE OR REPLACE FUNCTION public.send_terceirizacao_os',
  'COMMENT ON FUNCTION public.send_terceirizacao_os',
);
const LEGACY_UPDATE_QUANTITY = section(
  'CREATE OR REPLACE FUNCTION public.update_terceirizacao_os_qty',
  'COMMENT ON FUNCTION public.update_terceirizacao_os_qty',
);
const SEND_ONE = section(
  'CREATE OR REPLACE FUNCTION public.send_item_sector_os',
  'COMMENT ON FUNCTION public.send_item_sector_os',
);
const AUTO_GENERATE = section(
  'CREATE OR REPLACE FUNCTION public.generate_configured_outsource_orders_for_order',
  'COMMENT ON FUNCTION public.generate_configured_outsource_orders_for_order',
);
const INTENT_RESYNC = section(
  'CREATE OR REPLACE FUNCTION public.tg_resync_outsource_orders_after_item_intent',
  'COMMENT ON TRIGGER trg_resync_outsource_orders_after_item_intent',
);
const GAPS = section(
  'CREATE OR REPLACE FUNCTION public.list_service_order_generation_gaps',
  'COMMENT ON FUNCTION public.list_service_order_generation_gaps',
);
const BATCH = section(
  'CREATE OR REPLACE FUNCTION public.generate_op_service_orders',
  'COMMENT ON FUNCTION public.generate_op_service_orders',
);

describe('migration capacidade/prazo/materiais de terceirização — contrato SQL', () => {
  it('adiciona a configuração completa sem inventar capacidade no backfill', () => {
    expect(SQL).toMatch(/capacity_pairs_per_day numeric/);
    expect(SQL).toMatch(/return_before_sector text/);
    expect(SQL).toMatch(/material_components text\[\] NOT NULL DEFAULT ARRAY\[\]::text\[\]/);
    expect(SQL).toContain('capacity_pairs_per_day permanece NULL');
    expect(SQL).not.toMatch(/SET\s+capacity_pairs_per_day\s*=/i);
  });

  it('mantém capacidade e preço em domínio numérico finito e operacional', () => {
    expect(SQL).toMatch(/reference_terceirizacoes_capacity_pairs_per_day_check[\s\S]*NOT IN \('NaN', 'Infinity', '-Infinity'\)[\s\S]*capacity_pairs_per_day >= 1[\s\S]*capacity_pairs_per_day <= 1000000[\s\S]*pg_catalog\.trunc\(capacity_pairs_per_day\)/);
    expect(SQL).toMatch(/reference_terceirizacoes_value_per_pair_operational_check[\s\S]*NOT IN \('NaN', 'Infinity', '-Infinity'\)[\s\S]*value_per_pair > 0/);
    expect(CONFIG_VALIDATION).toContain('Capacidade deve ser um número inteiro entre 1 e 1.000.000 pares/dia.');
  });

  it('garante um único prestador ativo por ficha/atividade sem desativar duplicatas', () => {
    expect(SQL).toContain('DO $preflight_single_provider$');
    expect(SQL).toMatch(/HAVING pg_catalog\.count\(\*\) > 1/);
    expect(SQL).toContain('Não é possível garantir um prestador por ficha/atividade');
    expect(SQL).toMatch(/CREATE UNIQUE INDEX uq_reference_terceirizacoes_active_ref_sector[\s\S]*reference_id,[\s\S]*normalize_outsource_sector\(sector\)[\s\S]*WHERE active = true/);
    expect(SQL).not.toMatch(/UPDATE\s+public\.reference_terceirizacoes[\s\S]{0,180}SET\s+active\s*=\s*false/i);
  });

  it('fecha escrita da configuração para papéis operacionais privilegiados', () => {
    expect(SQL).toContain('ALTER TABLE public.reference_terceirizacoes ENABLE ROW LEVEL SECURITY');
    expect(SQL).toMatch(/CREATE POLICY reference_terceirizacoes_select_approved[\s\S]*FOR SELECT[\s\S]*public\.is_approved_user\(\)/);
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(SQL).toContain(`FOR ${operation}`);
    }
    expect(SQL).toContain("public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])");
  });

  it('congela para sempre a identidade de configuração já usada sem congelar parâmetros futuros', () => {
    expect(CONFIG_IDENTITY_GUARD).toContain('NEW.reference_id IS DISTINCT FROM OLD.reference_id');
    expect(CONFIG_IDENTITY_GUARD).toContain('NEW.contractor_id IS DISTINCT FROM OLD.contractor_id');
    expect(CONFIG_IDENTITY_GUARD).toContain('normalize_outsource_sector(NEW.sector)');
    expect(CONFIG_IDENTITY_GUARD).toContain('pg_try_advisory_xact_lock');
    expect(CONFIG_IDENTITY_GUARD).toContain('service_order.source_terceirizacao_id = OLD.id');
    expect(CONFIG_IDENTITY_GUARD).toContain('production_order.reference_id = OLD.reference_id');
    expect(CONFIG_IDENTITY_GUARD).toContain('service_order.planning_source IS NOT NULL');
    expect(CONFIG_IDENTITY_GUARD).toContain('Configuração já referenciada por OS não pode ser excluída');
    expect(CONFIG_IDENTITY_GUARD).not.toMatch(/normalize_service_order_status[\s\S]*NOT IN \('Concluído', 'Cancelado'\)/);
    expect(CONFIG_IDENTITY_GUARD).not.toMatch(/NEW\.(?:capacity_pairs_per_day|return_before_sector|material_components|value_per_pair|active)\s+IS DISTINCT/);
    expect(SQL).toMatch(/CREATE TRIGGER trg_guard_outsource_config_identity[\s\S]*BEFORE DELETE OR UPDATE OF reference_id, sector, contractor_id/);
  });

  it('não expõe OS e snapshots a conta autenticada ainda não aprovada', () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "Auth users can view service_orders"[\s\S]*CREATE POLICY "Approved users can view service_orders"[\s\S]*FOR SELECT TO authenticated[\s\S]*public\.is_approved_user\(\)/);
  });

  it('centraliza readiness temporal e a allowlist exata de materiais', () => {
    expect(CONFIG_VALIDATION).toContain('public.minimum_outsource_return_before_sector');
    expect(CONFIG_VALIDATION).toContain('Etapa mínima da atividade não existe no fluxo de produção');
    expect(CONFIG_VALIDATION).toMatch(/v_return_flow_order < v_minimum_flow_order/);
    expect(CONFIG_VALIDATION).toContain('Etapa de retorno anterior ao mínimo da atividade');
    for (const component of [
      'Cabedal', 'Forração', 'Forração Palmilha', 'Palmilha', 'Fachete',
      'Solado', 'BOM', 'Componente Direto', 'Item padrão (solado)',
    ]) {
      expect(CONFIG_VALIDATION).toContain(`'${component}'`);
    }
    expect(CONFIG_VALIDATION).toContain('Componentes de material fora da lista canônica');
  });

  it('aceita Fachete na intenção do item e mantém Tiras no fluxo separado', () => {
    expect(ITEM_VALIDATOR).toContain("'fachete'");
    expect(ITEM_VALIDATOR).not.toContain("'tiras'");
    expect(ITEM_VALIDATOR).toMatch(/jsonb_each_text\(NEW\.outsourced_sectors\)/);
    expect(ITEM_VALIDATOR).toContain('prestador invalido (nao e uuid)');
  });

  it('rejeita envelopes de materiais incompletos, inclusive o objeto vazio', () => {
    const shape = section(
      'ADD CONSTRAINT service_orders_material_requirements_shape_check',
      'COMMENT ON COLUMN public.service_orders.service_date',
    );
    expect(shape).toMatch(/COALESCE\([\s\S]*jsonb_typeof\(material_requirements\) = 'object',[\s\S]*false/);
    expect(shape).toContain("material_requirements -> 'version' = '1'::jsonb");
    expect(shape).toContain("jsonb_typeof(material_requirements -> 'items') = 'array'");
    expect(shape).toContain("jsonb_typeof(material_requirements -> 'warnings') = 'array'");
  });

  it('usa o motor canônico por grade e só escala a quantidade parcial', () => {
    expect(MATERIALS).toContain('public.resolve_effective_op_grade');
    expect(MATERIALS).toContain('public.calculate_order_consumption_by_grade');
    expect(MATERIALS).toMatch(/v_scale := v_qty \/ NULLIF\(v_order\.quantity, 0\)/);
    expect(MATERIALS).toMatch(/v_required :=[\s\S]*'required'[\s\S]*\* v_scale/);
    expect(MATERIALS).toContain("'basis', 'calculate_order_consumption_by_grade'");
    expect(MATERIALS).toContain("WHEN pg_catalog.lower(extensions.unaccent(v_component)) = 'solado' THEN 'par'");
  });

  it('mantém necessidade calculada separada de baixa, reserva e remessa', () => {
    expect(MATERIALS).not.toMatch(/materials_sent|stock_movements|material_reservations|UPDATE\s+public\.products/i);
    expect(APPLY_TRIGGER).toContain('NEW.material_requirements := public.calculate_outsource_material_requirements');
    expect(APPLY_TRIGGER).not.toContain('NEW.materials_sent');
    expect(SQL).not.toMatch(/INSERT\s+INTO\s+public\.stock_movements/i);
    expect(SQL).not.toMatch(/UPDATE\s+public\.products/i);
  });

  it('calcula execução e fila pela capacidade e volta em dias úteis', () => {
    expect(PLAN).toMatch(/v_execution_days := pg_catalog\.ceil\(v_qty \/ v_capacity\)::integer/);
    expect(PLAN).toMatch(/pg_catalog\.sum\(remaining_qty \/ NULLIF\(queue_capacity, 0\)\)/);
    expect(PLAN).toMatch(/v_queue_days := pg_catalog\.ceil\(v_queue_effort_days\)::integer/);
    expect(PLAN).toContain('v_lead_days := v_queue_days + v_execution_days');
    expect(PLAN).toContain('public.add_business_days(v_return_date, -v_lead_days)');
  });

  it('ancora no run mais recente e cai para a próxima etapa real da rota', () => {
    expect(PLAN).toMatch(/ORDER BY ps\.created_at DESC, ps\.id DESC/);
    expect(PLAN).toMatch(/pg_catalog\.min\(ps\.date\)/);
    expect(PLAN).toMatch(/scheduled\.flow_order >= anchor\.flow_order/);
    expect(PLAN).toMatch(/ORDER BY scheduled\.flow_order, ps\.date/);
    expect(PLAN).toContain("v_source := 'production_schedule_next_sector'");
  });

  it('fila FIFO exclui a própria OS e conta todo o saldo uma única vez', () => {
    expect(PLAN).toContain('so.id IS DISTINCT FROM p_exclude_service_order_id');
    expect(PLAN).not.toContain('so.quoted_deadline <= v_return_date');
    expect(PLAN).toContain('bal.qty_to_dispatch');
    expect(PLAN).toContain('bal.qty_in_field');
    expect(PLAN).not.toContain('bal.qty_defect_pending_rework');
    expect(PLAN).toContain('COALESCE(so.order_id, so.related_order_id)');
    expect(PLAN).toMatch(/fifo\.order_sequence < v_exclude_order_sequence/);
    expect(PLAN.match(/order_number ~ '\^OS-\[0-9\]\+\$'/g)).toHaveLength(2);
    expect(PLAN).toContain('fifo.order_sequence = v_exclude_order_sequence');
    expect(PLAN).toMatch(/so\.created_at < v_exclude_created_at/);
    expect(PLAN).toContain('OS legada(s) sem numeração sequencial usaram created_at/id');
    expect(PLAN).toContain('NULLIF(so.provider_capacity_pairs_per_day, 0)');
    expect(PLAN).toContain('LEFT JOIN public.reference_terceirizacoes source_config');
    expect(PLAN).toMatch(/COALESCE\(\s*so\.target_sector,\s*so\.sector,\s*source_config\.sector/);
    expect(PLAN).toMatch(/NULLIF\(so\.provider_capacity_pairs_per_day, 0\),\s*NULLIF\(source_config\.capacity_pairs_per_day, 0\),\s*NULLIF\(queue_config\.capacity_pairs_per_day, 0\),\s*v_capacity/);
    expect(PLAN).toContain('NULLIF(queue_config.capacity_pairs_per_day, 0)');
    expect(PLAN).toContain('v_preserve_fifo_position');
    expect(PLAN).toMatch(/v_exclude_contractor_id IS NOT DISTINCT FROM p_contractor_id/);
    expect(PLAN).toMatch(/v_exclude_sector IS NOT DISTINCT FROM v_sector/);
    expect(PLAN).toMatch(/NOT v_preserve_fifo_position[\s\S]*fifo\.order_sequence < v_exclude_order_sequence/);
  });

  it('serializa toda carga manual ou canônica que entra e sai da fila', () => {
    expect(QUEUE_LOCK_GUARD).toContain('NEW.target_sector');
    expect(QUEUE_LOCK_GUARD).toContain('NEW.sector');
    expect(QUEUE_LOCK_GUARD).toContain('NEW.source_terceirizacao_id');
    expect(QUEUE_LOCK_GUARD).toContain("NOT IN ('Concluído', 'Cancelado')");
    expect(QUEUE_LOCK_GUARD).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(QUEUE_LOCK_GUARD).toContain('pg_catalog.pg_try_advisory_xact_lock');
    expect(SQL).toMatch(/CREATE TRIGGER trg_00_service_order_lock_outsource_queue[\s\S]*BEFORE INSERT OR UPDATE OF contractor_id, target_sector, sector, status,[\s\S]*quantity, order_id, related_order_id, source_terceirizacao_id,[\s\S]*order_number, created_at, dispatch_tracked/);
  });

  it('usa a hierarquia PV → global → stage/config e sincroniza stages por OP', () => {
    const globalLock = "pg_catalog.hashtextextended('outsource_service_order_generation', 0)";
    const applyGlobalAt = APPLY_TRIGGER.indexOf(globalLock);
    const applyConfigAt = APPLY_TRIGGER.indexOf('FROM public.reference_terceirizacoes r');
    expect(applyGlobalAt).toBeGreaterThan(0);
    expect(applyConfigAt).toBeGreaterThan(applyGlobalAt);

    for (const body of [WRITER, SEND_ONE, AUTO_GENERATE, BATCH]) {
      const saleAt = body.indexOf('FROM public.sale_orders sale');
      const lockAt = body.indexOf(globalLock);
      const protectedReadAt = Math.min(
        ...[
          body.indexOf('FROM public.order_stages stage'),
          body.indexOf('FROM public.reference_terceirizacoes r'),
        ].filter((index) => index >= 0),
      );
      expect(saleAt).toBeGreaterThan(0);
      expect(lockAt).toBeGreaterThan(saleAt);
      expect(protectedReadAt).toBeGreaterThan(lockAt);
    }
    expect(STAGE_INSERT_SYNC).toContain("'outsource_stage_sync:' || v_lock_order_id::text");
    expect(STAGE_INSERT_SYNC).not.toContain('outsource_service_order_generation');
    expect(STAGE_INSERT_SYNC.indexOf('outsource_stage_sync:')).toBeLessThan(
      STAGE_INSERT_SYNC.indexOf('get_outsource_open_stage_dependencies'),
    );
    expect(SERVICE_ORDER_SYNC).toContain("'outsource_stage_sync:' || v_lock_order_id::text");
    expect(SERVICE_ORDER_SYNC).toMatch(/ORDER BY pending\.order_id/);
    expect(DEPENDENCIES).toMatch(/LANGUAGE sql\s+VOLATILE/);
    expect(SQL).toMatch(/BEFORE DELETE OR UPDATE OF order_id, stage_name, stage_order, status,[\s\S]*quantity_processed/);
    expect(SQL).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF order_id, stage_name, stage_order, status/);
  });

  it('rejeita edição isolada da saída e nunca recalcula materiais por ajuste de retorno', () => {
    expect(SQL).toMatch(/BEFORE INSERT OR UPDATE OF order_id, target_sector, contractor_id, quantity,[\s\S]*quoted_deadline, service_date/);
    expect(APPLY_TRIGGER).toContain('NEW.service_date := OLD.service_date');
    expect(APPLY_TRIGGER).toMatch(/NEW\.quoted_deadline IS NOT DISTINCT FROM OLD\.quoted_deadline THEN[\s\S]*RETURN NEW/);
    expect(APPLY_TRIGGER).toContain('v_recalculate_materials := v_routing_changed');
    expect(APPLY_TRIGGER).toMatch(/IF v_recalculate_materials THEN[\s\S]*calculate_outsource_material_requirements/);
  });

  it('limpa snapshots incompatíveis ao trocar rota/quantidade sem configuração', () => {
    expect(APPLY_TRIGGER).toMatch(/TG_OP = 'UPDATE'[\s\S]*AND v_routing_changed/);
    expect(APPLY_TRIGGER).toContain('NEW.source_terceirizacao_id := NULL');
    expect(APPLY_TRIGGER).toContain('NEW.provider_capacity_pairs_per_day := NULL');
    expect(APPLY_TRIGGER).toContain(`NEW.material_requirements := '{"version":1,"items":[]}'::jsonb`);
    expect(APPLY_TRIGGER).toContain('As datas foram preservadas para o fluxo legado');
  });

  it('preserva a chave do fluxo agregado legado quando a OS não é OP por setor', () => {
    const nonOpInsertStart = APPLY_TRIGGER.indexOf("ELSIF TG_OP = 'INSERT' THEN");
    const nonOpInsertEnd = APPLY_TRIGGER.indexOf("ELSIF TG_OP = 'UPDATE'", nonOpInsertStart);
    expect(nonOpInsertStart).toBeGreaterThan(0);
    const nonOpInsert = APPLY_TRIGGER.slice(nonOpInsertStart, nonOpInsertEnd);
    expect(nonOpInsert).not.toContain('NEW.source_terceirizacao_id := NULL');
    expect(nonOpInsert).toContain('send_terceirizacao_os');
    expect(APPLY_TRIGGER).toContain('AND (v_is_op_sector OR v_was_op_sector)');
    expect(APPLY_TRIGGER).not.toContain('OR OLD.source_terceirizacao_id IS NOT NULL');
  });

  it('só libera terminal físico depois do retorno, preservando containers e tiras', () => {
    expect(COMPLETION_GUARD).toContain("SET search_path = ''");
    expect(COMPLETION_GUARD).toContain('OLD.planning_source IS NOT NULL');
    expect(COMPLETION_GUARD).toContain('OLD.source_terceirizacao_id IS NOT NULL');
    expect(COMPLETION_GUARD).toContain('OLD.source_sale_order_item_id IS NOT NULL');
    expect(COMPLETION_GUARD).toContain('OLD.linked_sale_order_ids');
    expect(COMPLETION_GUARD).toContain("event.event_type = 'created'");
    expect(COMPLETION_GUARD).toContain('OLD.canonical_strap_recipe_id IS NOT NULL');
    expect(COMPLETION_GUARD).toContain('OS consolidada terminal não pode ser reativada');
    expect(COMPLETION_GUARD).toContain('OS consolidada enviada só pode ser cancelada');
    expect(COMPLETION_GUARD).toContain('FROM public.v_service_order_balance balance');
    expect(COMPLETION_GUARD).toContain('v_qty_in_field IS DISTINCT FROM 0::bigint');
    expect(COMPLETION_GUARD).toContain('v_qty_to_dispatch IS DISTINCT FROM 0::bigint');
    expect(COMPLETION_GUARD).toContain('IF NOT FOUND');
    expect(COMPLETION_GUARD).toContain("v_old_status = 'Concluído' AND v_new_status <> 'Concluído'");
    expect(COMPLETION_GUARD).toContain("v_old_status = 'Cancelado' AND v_new_status <> 'Cancelado'");
    expect(COMPLETION_GUARD).toContain("v_new_status = 'Cancelado' AND v_old_status <> 'Cancelado'");
    expect(COMPLETION_GUARD).toContain('FROM public.service_order_dispatches dispatch');
    expect(COMPLETION_GUARD).toContain('v_qty_in_field IS DISTINCT FROM 0::bigint');
    expect(COMPLETION_GUARD).toContain('OS vinculada só pode ser cancelada depois que nenhum par permanecer em campo');
    expect(COMPLETION_GUARD).not.toContain('pg_advisory');
    expect(SQL).toMatch(/CREATE TRIGGER trg_03_service_order_guard_planned_completion[\s\S]*BEFORE INSERT OR UPDATE OF status/);
  });

  it('mantém o cancelamento do PV atômico quando qualquer OS vinculada ainda tem pares em campo', () => {
    const raiseAt = PV_CANCEL_GUARD.indexOf('PV não pode ser cancelado enquanto houver retorno físico pendente');
    const cancelAt = PV_CANCEL_GUARD.indexOf('UPDATE public.service_orders AS so');
    expect(PV_CANCEL_GUARD).toMatch(/(?:FROM|JOIN) public\.v_service_order_balance balance/);
    expect(PV_CANCEL_GUARD).toContain('balance.qty_in_field IS DISTINCT FROM 0::bigint');
    expect(PV_CANCEL_GUARD).toContain('pg_catalog.string_agg');
    expect(PV_CANCEL_GUARD).not.toContain('FROM public.service_order_dispatches');
    expect(PV_CANCEL_GUARD).not.toContain('service_order.planning_source IS NOT NULL');
    expect(raiseAt).toBeGreaterThan(0);
    expect(cancelAt).toBeGreaterThan(raiseAt);
  });

  it('cancela as linhas abertas antes do cabeçalho exclusivo sem abrir bypass de provenance', () => {
    const physicalPreflightAt = PV_CANCEL_GUARD.indexOf('IF v_blocking_orders IS NOT NULL');
    const cancelLinesAt = PV_CANCEL_GUARD.indexOf('UPDATE public.service_order_items AS item');
    const cancelHeaderAt = PV_CANCEL_GUARD.indexOf('UPDATE public.service_orders AS so');
    expect(cancelLinesAt).toBeGreaterThan(physicalPreflightAt);
    expect(cancelHeaderAt).toBeGreaterThan(cancelLinesAt);
    expect(PV_CANCEL_GUARD).toContain("SET line_status = 'Cancelado'");
    expect(PV_CANCEL_GUARD).toContain('public.is_exclusive_service_order_for_sale(parent.id, NEW.id)');
    expect(PV_CANCEL_GUARD).toContain('item.strap_variant_id IS NULL');
    expect(ITEM_IDENTITY_GUARD).toContain('v_expected_cancel public.service_order_items%ROWTYPE');
    expect(ITEM_IDENTITY_GUARD).toContain('NEW IS NOT DISTINCT FROM v_expected_cancel');
    expect(ITEM_IDENTITY_GUARD).toMatch(/v_cancel_only[\s\S]*cardinality\(v_new_sale_scope\) = 1[\s\S]*is_exclusive_service_order_for_sale/);
    expect(ITEM_IDENTITY_GUARD).not.toContain('app.pv_cancel');
  });

  it('resolve a provenance de linha pelo PV explícito ou pela OP da linha', () => {
    for (const body of [PV_CANDIDATE, PV_EXCLUSIVITY]) {
      expect(body).toContain('LEFT JOIN public.orders child_order');
      expect(body).toContain('COALESCE(item.sale_order_id, child_order.sale_order_id)');
    }
    expect(ITEM_IDENTITY_GUARD).toContain("IF TG_OP = 'INSERT'");
    expect(ITEM_IDENTITY_GUARD).toContain('NEW.sale_order_id := v_new_order_sale_id');
  });

  it('trata os cinco marcadores canônicos de Tiras como uma identidade indivisível', () => {
    for (const body of [COMPLETION_GUARD, PV_EXCLUSIVITY, PV_CANCEL_GUARD]) {
      expect(body).toContain('sale_order_strap_demand_id');
      expect(body).toContain('strap_stock_floor_contribution_id');
    }
    expect(PV_CANCEL_GUARD).toContain('item.sale_order_strap_demand_id IS NULL');
    expect(PV_CANCEL_GUARD).toContain('item.strap_stock_floor_contribution_id IS NULL');
  });

  it('não permite apagar a trilha física, financeira ou operacional da OS', () => {
    expect(DELETE_GUARD).toContain("normalize_service_order_status(OLD.status) <> 'Cancelado'");
    expect(DELETE_GUARD).toContain('FROM public.service_order_dispatches');
    expect(DELETE_GUARD).toContain('FROM public.service_order_returns');
    expect(DELETE_GUARD).toContain('FROM public.service_order_items');
    expect(DELETE_GUARD).toContain('FROM public.accounts_payable');
    expect(DELETE_GUARD).toContain('FROM public.service_order_events');
    expect(DELETE_GUARD).toContain("COALESCE(OLD.materials_sent, '[]'::jsonb) <> '[]'::jsonb");
    expect(SQL).toMatch(/CREATE TRIGGER trg_04_service_order_guard_delete_history[\s\S]*BEFORE DELETE/);
  });

  it('bloqueia avanço físico até o retorno real e permite correção/regressão', () => {
    expect(DEPENDENCIES).toContain('so.planning_anchor_sector');
    expect(DEPENDENCIES).toContain('so.return_before_sector');
    expect(DEPENDENCIES).toMatch(/raw\.normalized_status NOT IN \('Concluído', 'Cancelado'\)/);
    expect(STAGE_GUARD).toMatch(/v_status_advanced :=[\s\S]*IN \('Em Andamento', 'Concluído'\)/);
    expect(STAGE_GUARD).toMatch(/v_quantity_increased := COALESCE\(NEW\.quantity_processed, 0\)[\s\S]*> COALESCE\(OLD\.quantity_processed, 0\)/);
    expect(STAGE_GUARD).toContain('IF NOT v_status_advanced AND NOT v_quantity_increased THEN');
    expect(STAGE_GUARD).toContain('bloqueada até o retorno real da terceirização');
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS tg_block_montagem_with_pending_service_order[\s\S]*DROP FUNCTION IF EXISTS public\.tg_block_montagem_with_pending_service_order\(\)/);
  });

  it('recalcula bloqueio em INSERT/UPDATE/DELETE e em toda entrada que muda a dependência', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_refresh_outsource_block_after_stage_insert[\s\S]*AFTER INSERT[\s\S]*ON public\.order_stages/);
    expect(SQL).toMatch(/CREATE TRIGGER trg_sync_op_block_on_outsource[\s\S]*AFTER INSERT OR DELETE OR UPDATE OF status, service_date, quoted_deadline, order_id,[\s\S]*related_order_id, contractor_id, quantity, sector, target_sector, return_before_sector,[\s\S]*planning_anchor_sector/);
    expect(SERVICE_ORDER_SYNC).toContain('public.refresh_outsource_stage_blocks(v_old_order_id)');
    expect(SERVICE_ORDER_SYNC).toContain('public.refresh_outsource_stage_blocks(v_order_id)');
  });

  it('finalização conclui a etapa atual sem iniciar uma dependência aberta', () => {
    expect(FINALIZE).toContain("'finalize_op:' || p_order_id::text");
    expect(FINALIZE).toContain("SET status = 'concluido'");
    expect(FINALIZE).toMatch(/NOT EXISTS \([\s\S]*get_outsource_open_stage_dependencies\(p_order_id\)[\s\S]*candidate\.stage_name/);
    expect(FINALIZE).toContain("SET status = 'em_andamento'");
    expect(FINALIZE.indexOf("SET status = 'concluido'")).toBeLessThan(
      FINALIZE.indexOf("SET status = 'em_andamento'"),
    );
  });

  it('inclui Fachete apenas quando a ficha tem configuração ativa', () => {
    expect(WIZARD_READ).toContain("'fachete'::text AS sector");
    expect(WIZARD_READ).toMatch(/reference_terceirizacoes r[\s\S]*normalize_outsource_sector\(r\.sector\) = 'fachete'/);
    expect(SQL).toMatch(/IF v_sector = 'fachete' THEN[\s\S]*configuração ativa desta ficha para o prestador/);
  });

  it('remove OP terminal do read model e o writer fecha o mesmo bypass', () => {
    expect(WIZARD_READ).toContain('NOT public.is_inactive_production_order_status(o.status)');
    expect(WRITER).toContain('NOT public.is_inactive_production_order_status(o.status)');
    expect(WRITER).toContain('OP não encontrada ou inativa.');
    expect(BATCH).toContain('public.is_inactive_production_order_status(v_order_status)');
    expect(BATCH).toContain('OP inativa; OS terceirizada não pode ser gerada.');
    expect(GAPS).toContain('NOT public.is_inactive_production_order_status(o.status)');
  });

  it('writer preserva idempotência, serializa a fila e prioriza preço da ficha', () => {
    expect(WRITER).toContain("pg_catalog.hashtext('op_os:'");
    expect(WRITER).toContain("pg_catalog.hashtext('outsource_queue:'");
    expect(WRITER).toMatch(/v_price := COALESCE\([\s\S]*p_unit_price,[\s\S]*NULLIF\(v_config_price, 0\),[\s\S]*get_contractor_rate/);
    expect(WRITER).toMatch(/normalize_outsource_sector\(COALESCE\(target_sector, sector\)\)\s*=\s*v_sector/);
  });

  it('fecha INSERT/UPDATE direto e deriva toda identidade da OS planejada da OP', () => {
    expect(OP_IDENTITY_GUARD).toContain("'canonical:' || pg_catalog.pg_current_xact_id()::text");
    expect(OP_IDENTITY_GUARD).toContain('OS vinculada a OP deve ser criada pelo writer canônico.');
    expect(OP_IDENTITY_GUARD).toContain("user_has_any_role(ARRAY['admin', 'gerente', 'producao'])");
    expect(OP_IDENTITY_GUARD).toContain('Número de OS vinculada à OP é imutável');
    expect(OP_IDENTITY_GUARD).toContain('NEW.sale_order_id := v_order_sale_order_id');
    expect(OP_IDENTITY_GUARD).toContain('NEW.source_sale_order_id := v_order_sale_order_id');
    expect(OP_IDENTITY_GUARD).toContain('NEW.selected_sale_order_item_ids := CASE');
    expect(OP_IDENTITY_GUARD).toContain('NEW.source_sale_order_item_id := v_order_sale_order_item_id');
    expect(OP_IDENTITY_GUARD).toContain("NEW.source_item_key := NEW.order_id::text || '::' || v_sector");
    expect(SQL).toMatch(/BEFORE INSERT OR UPDATE OF order_id, related_order_id, sale_order_id,[\s\S]*source_sale_order_id, source_sale_order_item_id, source_terceirizacao_id,[\s\S]*source_item_key, selected_sale_order_item_ids, linked_sale_order_ids,[\s\S]*order_number, description,[\s\S]*quantity, unit_price, total_value, status, target_sector, sector,[\s\S]*contractor_id/);
    expect(WRITER).toContain('v_order.sale_order_item_id, p_order_id::text');
  });

  it('congela termos estruturais antes ou durante qualquer transição terminal', () => {
    const changeAt = OP_IDENTITY_GUARD.indexOf('IF v_legacy_structural_changed');
    const roleGateAt = OP_IDENTITY_GUARD.indexOf('IF v_was_planned', changeAt);
    expect(changeAt).toBeGreaterThan(0);
    expect(OP_IDENTITY_GUARD.slice(changeAt, roleGateAt)).toContain(
      "normalize_service_order_status(OLD.status)",
    );
    expect(OP_IDENTITY_GUARD.slice(changeAt, roleGateAt)).toContain(
      "normalize_service_order_status(NEW.status)",
    );
    expect(OP_IDENTITY_GUARD.slice(changeAt, roleGateAt)).toContain(
      "IN ('Concluído', 'Cancelado')",
    );
    expect(OP_IDENTITY_GUARD.slice(changeAt, roleGateAt)).toContain(
      'Campos estruturais da OS não podem mudar junto de ou após estado terminal.',
    );
    for (const field of [
      'NEW.related_order_id', 'NEW.linked_sale_order_ids',
      'NEW.dispatch_tracked', 'NEW.is_avulsa', 'NEW.unit_price',
      'NEW.total_value', 'NEW.description', 'NEW.payment_due_date',
    ]) {
      expect(OP_IDENTITY_GUARD.slice(0, changeAt)).toContain(field);
    }
  });

  it('preserva o writer agregado legado com marker estreito e fecha conversão para OP × setor', () => {
    expect(OP_IDENTITY_GUARD).toContain("'aggregate:' || pg_catalog.pg_current_xact_id()::text");
    expect(OP_IDENTITY_GUARD).toContain('NEW.selected_sale_order_item_ids IS NULL');
    expect(OP_IDENTITY_GUARD).toContain('NOT COALESCE(NEW.dispatch_tracked, false)');
    expect(OP_IDENTITY_GUARD).toContain('v_gains_sector_link');
    expect(OP_IDENTITY_GUARD).toContain('Vínculo de setor em OS de OP deve ser criado pelo writer canônico.');
    expect(OP_IDENTITY_GUARD).toMatch(/IF v_is_legacy_aggregate THEN\s+RETURN NEW/);
    expect(LEGACY_SEND).toContain("'app.outsource_legacy_writer'");
    expect(LEGACY_SEND).toContain("'aggregate:' || pg_catalog.pg_current_xact_id()::text");
    expect(LEGACY_SEND).toContain('selected_sale_order_item_ids');
    expect(LEGACY_SEND).toMatch(/selected_sale_order_item_ids,[\s\S]*NULL,[\s\S]*p_terceirizacao_id/);
    expect(LEGACY_SEND).toContain('public.is_approved_user()');
    expect(LEGACY_SEND).toContain('contractor.active');
    const legacySaleAt = LEGACY_SEND.indexOf('FROM public.sale_orders sale');
    const legacyGlobalAt = LEGACY_SEND.indexOf("hashtextextended('outsource_service_order_generation', 0)");
    const legacyConfigAt = LEGACY_SEND.indexOf('FROM public.reference_terceirizacoes config');
    const legacyKeyAt = LEGACY_SEND.indexOf("'legacy_outsource:'");
    expect(legacySaleAt).toBeGreaterThan(0);
    expect(legacyGlobalAt).toBeGreaterThan(legacySaleAt);
    expect(legacyConfigAt).toBeGreaterThan(legacyGlobalAt);
    expect(legacyKeyAt).toBeGreaterThan(legacyConfigAt);
    expect(LEGACY_SEND).toContain('v_existing.delivered_at IS NOT NULL');
    expect(LEGACY_SEND).toContain('v_existing.receipt_generated_at IS NOT NULL');
    expect(LEGACY_SEND).toContain('v_existing.signed_photo_url');
    expect(LEGACY_SEND).toContain("normalize_service_order_status(service_order.status)\n         <> 'Cancelado'");
    const activeLookupAt = LEGACY_SEND.search(
      /normalize_service_order_status\(service_order\.status\)\s+<> 'Cancelado'/,
    );
    const cancelledLookupAt = LEGACY_SEND.search(
      /normalize_service_order_status\(service_order\.status\)\s+= 'Cancelado'/,
    );
    expect(activeLookupAt).toBeGreaterThan(0);
    expect(cancelledLookupAt).toBeGreaterThan(activeLookupAt);
  });

  it('atualiza quantidade agregada somente pelo mesmo marker e com saldo inteiro', () => {
    expect(LEGACY_UPDATE_QUANTITY).toContain("'app.outsource_legacy_writer'");
    expect(LEGACY_UPDATE_QUANTITY).toContain('FOR UPDATE OF service_order');
    expect(LEGACY_UPDATE_QUANTITY).toContain("IN ('Concluído', 'Cancelado')");
    expect(LEGACY_UPDATE_QUANTITY).toContain("v_qty::text IN ('NaN', 'Infinity', '-Infinity')");
    expect(LEGACY_UPDATE_QUANTITY).toContain('v_qty <> pg_catalog.trunc(v_qty)');
    expect(LEGACY_UPDATE_QUANTITY).toMatch(/FROM public\.service_order_dispatches[\s\S]*FROM public\.service_order_returns[\s\S]*'physical_history_exists'/);
    expect(LEGACY_UPDATE_QUANTITY).toContain('public.is_approved_user()');
    const qtyGlobalAt = LEGACY_UPDATE_QUANTITY.indexOf("hashtextextended('outsource_service_order_generation', 0)");
    const qtyLegacyAt = LEGACY_UPDATE_QUANTITY.indexOf("'legacy_outsource:'");
    const qtyRowLockAt = LEGACY_UPDATE_QUANTITY.indexOf('FOR UPDATE OF service_order');
    expect(qtyGlobalAt).toBeGreaterThan(0);
    expect(qtyLegacyAt).toBeGreaterThan(qtyGlobalAt);
    expect(qtyRowLockAt).toBeGreaterThan(qtyLegacyAt);
  });

  it('congela provenance das linhas consolidadas e preserva o writer canônico de tiras', () => {
    expect(ITEM_IDENTITY_GUARD).toContain("current_setting('app.strap_engine_write'");
    expect(ITEM_IDENTITY_GUARD).toContain('v_old_is_canonical_strap');
    expect(ITEM_IDENTITY_GUARD).toContain("IF TG_OP = 'DELETE' THEN");
    expect(ITEM_IDENTITY_GUARD).toContain('Identidade/provenance da linha de OS é imutável');
    expect(ITEM_IDENTITY_GUARD).toMatch(/normalize_service_order_status\(OLD\.line_status\)[\s\S]*IN \('Concluído', 'Cancelado'\)[\s\S]*normalize_service_order_status\(NEW\.line_status\)[\s\S]*IS DISTINCT FROM/);
    expect(ITEM_IDENTITY_GUARD).toContain('Linha de OS concluída/cancelada não pode ser reaberta');
    expect(ITEM_IDENTITY_GUARD).toContain('FOR SHARE OF sale NOWAIT');
    expect(ITEM_IDENTITY_GUARD).toContain('FOR SHARE OF service_order NOWAIT');
    expect(SQL).toMatch(/CREATE TRIGGER trg_00_service_order_item_identity[\s\S]*BEFORE INSERT OR UPDATE OR DELETE/);
  });

  it('remove o overload público legado de finalização e fotografa a configuração sob lock', () => {
    expect(SQL).toContain('DROP FUNCTION IF EXISTS public.finalize_production_sector(uuid, text);');
    expect(WRITER).toMatch(/FROM public\.reference_terceirizacoes r[\s\S]*LIMIT 1\s+FOR SHARE OF r/);
  });

  it('endpoints estritos exigem configuração exata e etapa aberta sem perder parcial', () => {
    for (const body of [SEND_ONE, AUTO_GENERATE, BATCH]) {
      expect(body).toContain('public.outsource_config_issue');
      expect(body).toMatch(/reference_id = v_(?:reference_id|order\.reference_id)/);
      expect(body).toContain('contractor_id =');
      expect(body).toContain('normalize_outsource_sector(r.sector) = v_sector');
    }
    expect(SEND_ONE).toContain('Etapa já concluída internamente.');
    expect(AUTO_GENERATE).toContain('Etapa já concluída internamente.');
    expect(BATCH).not.toContain('Planejamento obrigatório exige a quantidade integral da OP');
    expect(BATCH).toContain('v_requested_quantity := COALESCE(v_requested_quantity, v_order_quantity)');
    expect(BATCH).toContain("WHEN v_require_planning_raw IN ('true', 't', '1', 'yes', 'on')");
    expect(BATCH).toContain("WHEN v_require_planning_raw IN ('false', 'f', '0', 'no', 'off')");
    expect(BATCH).toContain('require_planning_config inválido; use true ou false explicitamente.');
  });

  it('gera automaticamente só depois do cronograma deferred', () => {
    expect(SQL).toMatch(/CREATE CONSTRAINT TRIGGER trg_zz_orders_generate_outsourcing_os[\s\S]*AFTER INSERT[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
    expect(SQL).toContain('DROP TRIGGER IF EXISTS tg_orders_generate_outsourcing_os ON public.orders');
    expect(AUTO_GENERATE).toContain('public.create_op_service_order');
    expect(AUTO_GENERATE).toContain('RAISE WARNING');
    expect(AUTO_GENERATE).toContain('NOT public.is_inactive_production_order_status(o.status)');
  });

  it('reprocessa intenção adicionada depois que a OP já existe sem cancelar remoções', () => {
    expect(INTENT_RESYNC).toContain("SET search_path = ''");
    expect(INTENT_RESYNC).toContain('public.generate_configured_outsource_orders_for_order(v_order_id)');
    expect(INTENT_RESYNC).toContain('NOT public.is_inactive_production_order_status(o.status)');
    expect(INTENT_RESYNC).toContain('RAISE WARNING');
    expect(INTENT_RESYNC).not.toMatch(/DELETE\s+FROM\s+public\.service_orders|UPDATE\s+public\.service_orders/i);
    expect(INTENT_RESYNC).toMatch(/AFTER UPDATE OF outsourced_sectors[\s\S]*WHEN \(OLD\.outsourced_sectors IS DISTINCT FROM NEW\.outsourced_sectors\)/);
  });

  it('diagnostica lacunas pela mesma configuração exata e pelo preço da ficha', () => {
    expect(GAPS).toContain("SET search_path = ''");
    expect(GAPS).toContain('public.outsource_config_issue');
    expect(GAPS).toMatch(/r\.reference_id = gap\.reference_id[\s\S]*r\.contractor_id = gap\.contractor_id[\s\S]*normalize_outsource_sector\(r\.sector\) = gap\.sector/);
    expect(GAPS).toMatch(/NULLIF\(config\.value_per_pair, 0\)[\s\S]*public\.get_contractor_rate/);
    expect(GAPS).toContain('Etapa já concluída internamente.');
    expect(GAPS).toMatch(/normalize_service_order_status\(service_order\.status\)[\s\S]*= 'Concluído'/);
    expect(GAPS).toMatch(/normalize_service_order_status\(service_order\.status\)[\s\S]*NOT IN \('Concluído', 'Cancelado'\)/);
  });

  it('fecha ACLs das funções SECURITY DEFINER e usa search_path fixo', () => {
    for (const body of [
      MATERIALS, PLAN, DEPENDENCIES, FINALIZE, WIZARD_READ, WRITER,
      SEND_ONE, AUTO_GENERATE, INTENT_RESYNC, GAPS, BATCH, COMPLETION_GUARD,
      PV_CANCEL_GUARD, LEGACY_SEND, LEGACY_UPDATE_QUANTITY,
    ]) {
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toContain("SET search_path = ''");
    }
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.calculate_outsource_plan[\s\S]*FROM PUBLIC, anon/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.calculate_outsource_plan[\s\S]*TO authenticated, service_role/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.generate_op_service_orders[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.generate_op_service_orders[\s\S]*TO authenticated, service_role/);
  });

  it('expõe material_requirements no fim da view histórica sem mudar a ordem anterior', () => {
    expect(SQL).toMatch(/so\.materials_sent AS materials_sent,[\s\S]*so\.signed_photo_url AS signed_photo_url,[\s\S]*so\.created_at AS created_at,[\s\S]*so\.material_requirements AS material_requirements/);
    expect(SQL).toMatch(/REVOKE ALL ON public\.v_contractor_history_orders\s+FROM PUBLIC, anon/);
    expect(SQL).toMatch(/GRANT SELECT ON public\.v_contractor_history_orders TO authenticated, service_role/);
  });
});
