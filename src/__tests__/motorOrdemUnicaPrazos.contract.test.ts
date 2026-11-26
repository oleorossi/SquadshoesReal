import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const m1 = read('supabase/migrations/20270101054700_motor_prazos_config.sql');
const m2 = read('supabase/migrations/20270101054800_motor_ordem_unica_agenda.sql');
const m3 = read('supabase/migrations/20270101054900_motor_compras.sql');

/** Corpo de uma função CREATE OR REPLACE da migration (até o próximo $function$). */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start, `função ${name} não encontrada`).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf('$function$', start);
  const close = sql.indexOf('$function$', open + 10);
  return sql.slice(open, close);
}

describe('motor 1/3 — Prazos do motor (config)', () => {
  it('adiciona os prazos configuráveis com padrões que repetem o comportamento de antes', () => {
    expect(m1).toContain('default_prep_business_days integer,');
    expect(m1).toContain('default_oc_lead_days integer NOT NULL DEFAULT 10');
    expect(m1).toContain('oc_urgency_window_business_days integer NOT NULL DEFAULT 2');
    expect(m1).toContain("motor_cabedal_gate_sector text NOT NULL DEFAULT 'Montagem'");
  });

  it('lead de OC sem cadastro vem da configuração, não do 10 fixo', () => {
    const body = fnBody(m1, 'get_effective_supplier_lead_days');
    expect(body).toContain('motor_default_oc_lead_days()');
  });

  it('prazo efetivo do prestador: referência → padrão → Costura/Aviamento', () => {
    const body = fnBody(m1, 'atelier_effective_prep_business_days');
    expect(body).toContain('prep_business_days');
    expect(body).toContain('default_prep_business_days');
    expect(body).toContain('costura_offset_days');
  });

  it('update_motor_settings NÃO liga auto_motor nem liberação urgente', () => {
    const body = fnBody(m1, 'update_motor_settings');
    const allowed = body.slice(body.indexOf('v_allowed text[]'), body.indexOf('];'));
    expect(allowed).not.toContain('auto_motor_enabled');
    expect(allowed).not.toContain('urgent_release_without_material');
    expect(body).toContain('is_approved_user()');
  });

  it('reserva do kit: só marca reservas do PV (order_id NULL) como atelier_prep, sem mexer em quantidade', () => {
    const body = fnBody(m1, 'atelier_link_kit_reservations_for_item');
    expect(body).toContain('order_id IS NULL');
    expect(body).toContain("'atelier_prep'");
    expect(body).not.toMatch(/quantity_reserved\s*=/);
    expect(body).not.toMatch(/DELETE FROM/i);
  });

  it('materialização liga o kit às reservas ao aprovar', () => {
    const body = fnBody(m1, 'materialize_cabedal_prep_demands');
    expect(body).toContain('atelier_link_kit_reservations_for_item(r.item_id)');
  });

  it('expõe datas previstas do prestador com capacidade', () => {
    const body = fnBody(m1, 'atelier_jobs_expected_dates');
    expect(body).toContain('capacity_pairs_per_day');
    expect(m1).toContain('capacity_pushed');
  });
});

describe('motor 2/3 — ordem única + agenda', () => {
  it('estado do motor fica em tabela própria (não reescreve production_queue)', () => {
    expect(m2).toContain('CREATE TABLE IF NOT EXISTS public.production_motor_state');
    expect(m2).toContain('CREATE TABLE IF NOT EXISTS public.production_motor_forecast');
    expect(m2).not.toMatch(/UPDATE\s+public\.production_queue/i);
  });

  it('close_score passa a medir pares produzidos', () => {
    const body = fnBody(m2, 'production_sequence_close_score');
    expect(body.toLowerCase()).toContain('processed');
  });

  it('ordem: fixado → congelado → urgente → semana → progresso → mescla por pares → cor/ref', () => {
    const body = fnBody(m2, 'production_motor_order');
    expect(body).toContain('interleave_key');
    expect(body).toContain('billing_anchor');
    expect(body).toContain('is_urgent');
  });

  it('agenda: complexo espera a volta do prestador; falta de material espera a OC; setores da rua não entram', () => {
    const body = fnBody(m2, 'recompute_production_schedule_impl_249');
    expect(body).toContain('_rq_cab');
    expect(body).toContain('motor_material_eta');
    expect(body).toContain("'Corte Cabedal'");
    expect(body).toContain('production_motor_forecast');
    expect(body).toContain('refresh_purchase_order_motor_priority');
  });

  it('list_production_sequence expõe os campos do motor para Fila/Gestão', () => {
    expect(m2).toContain('DROP FUNCTION IF EXISTS public.list_production_sequence');
    for (const col of ['item_class', 'billing_anchor', 'is_urgent', 'earliest_start', 'wait_reason', 'projected_completion']) {
      expect(m2).toContain(col);
    }
    expect(m2).toContain('CREATE OR REPLACE VIEW public.v_production_motor_plan');
  });

  it('queue_position do Kanban segue a mesma ordem do motor', () => {
    expect(m2).toContain('v_production_queue_detail');
    expect(m2).toContain('SELECT ms.motor_position FROM production_motor_state ms WHERE ms.order_key = q.order_id');
  });
});

describe('motor 3/3 — compras automáticas', () => {
  it('OC do kit continua rascunho/sugerida (OC real só pelo clique Gerar OC)', () => {
    const body = fnBody(m3, 'process_cabedal_prep_purchase_shortages_po');
    expect(body).toContain("CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END");
    expect(body).not.toMatch(/status\s*=\s*'pending'/);
    expect(body).toContain('v_promised := v_send');
    expect(body).toContain('expedite');
  });

  it('prioridade fica em tabela própria e não altera a OC', () => {
    const body = fnBody(m3, 'refresh_purchase_order_motor_priority');
    expect(body).not.toMatch(/UPDATE\s+public\.purchase_orders/i);
    expect(body).toContain("'atrasada'");
    expect(body).toContain('weekly_purchase_cap_brl');
  });

  it('gatilho de despacho preserva as datas do motor na OC do kit', () => {
    const body = fnBody(m3, 'refresh_purchase_order_dispatch_fields');
    expect(body).toContain("source_type = 'cabedal_prep' AND sector_need_date IS NOT NULL");
  });

  it('sugestão de compra usa os materiais de cada item (sem multiplicar pelo nº de itens)', () => {
    const body = fnBody(m3, 'list_cabedal_motor_purchase_snapshot');
    expect(body).toContain('sale_order_material_demand_lines');
    expect(body).toContain('sale_order_item_id');
  });
});

describe('motor — telas', () => {
  it('Prazos do motor usa as RPCs novas e não grava as chaves do Leonardo', () => {
    const panel = read('src/components/atelier/MotorPrazosPanel.tsx');
    const hook = read('src/hooks/useMotorConfig.ts');
    expect(hook).toContain("'get_motor_config'");
    expect(hook).toContain("'update_motor_settings'");
    expect(panel).not.toMatch(/mutate\(\{\s*auto_motor_enabled/);
    expect(panel).not.toMatch(/mutate\(\{\s*urgent_release_without_material/);
    expect(read('src/pages/MotorProducao.tsx')).toContain('<MotorPrazosPanel />');
    expect(read('src/pages/TerceirizadosHub.tsx')).toContain('<MotorPrazosResumo />');
  });

  it('lista de OCs coloca no topo as rascunhos priorizadas pelo motor (só leitura)', () => {
    const page = read('src/pages/PurchaseOrders.tsx');
    expect(page).toContain('sortByMotorPriority(filtered, motorPriority)');
    const hook = read('src/hooks/usePurchaseOrderMotorPriority.ts');
    expect(hook).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
