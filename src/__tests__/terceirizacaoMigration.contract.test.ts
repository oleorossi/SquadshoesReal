/**
 * Guard de CONTRATO da migration de Terceirização Integrada (PV → envio → OS).
 *
 * A lógica vive no SQL (RPCs send_terceirizacao_os / send_all / get_pv_… /
 * update_…_qty + trigger de cascata). Não há motor TS pra testar isoladamente.
 * Este suite trava os invariantes do contrato no arquivo de migration pra que
 * uma edição acidental (reintroduzir auto-criação, mudar o formato das notes,
 * tirar a idempotência ou a guarda de OS concluída) quebre o CI.
 *
 * O teste end-to-end de comportamento (marca no PV → envia linha → OS criada →
 * muda qty → atualiza → cancela → reenvia → PV cancelado → cascata) é manual /
 * DB-integration: requer a migration aplicada e um Postgres com dados.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260818120001_terceirizacao-integrada-pv-os.sql'),
  'utf8',
);

describe('migration terceirização integrada — contrato SQL', () => {
  it('cria a tabela reference_terceirizacoes com valor por par > 0', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.reference_terceirizacoes/);
    expect(SQL).toMatch(/value_per_pair\s+numeric\([\d,]+\)\s+NOT NULL\s+CHECK\s*\(value_per_pair > 0\)/);
    expect(SQL).toMatch(/reference_id\s+uuid\s+NOT NULL\s+REFERENCES public\.technical_sheets\(id\)\s+ON DELETE CASCADE/);
  });

  it('a seleção por item do PV é só INTENÇÃO (não gera OS sozinha)', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.sale_order_items[\s\S]*selected_terceirizacao_ids\s+uuid\[\]/);
    // remove a RPC de auto-sync da v1 (o fluxo agora é envio explícito por botão)
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS public\.sync_sale_order_service_orders\(uuid\)/);
  });

  it('adiciona as colunas de origem na OS (incl. chave estável source_item_key)', () => {
    expect(SQL).toMatch(/source_sale_order_id\s+uuid\s+REFERENCES public\.sale_orders\(id\)\s+ON DELETE SET NULL/);
    expect(SQL).toMatch(/source_sale_order_item_id\s+uuid\s+REFERENCES public\.sale_order_items\(id\)\s+ON DELETE SET NULL/);
    expect(SQL).toMatch(/source_terceirizacao_id\s+uuid\s+REFERENCES public\.reference_terceirizacoes\(id\)/);
    expect(SQL).toMatch(/source_item_key\s+text/);
  });

  it('trava a idempotência por (PV, item_key, terceirização)', () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_per_pv_item_terceirizacao[\s\S]*\(source_sale_order_id,\s*source_item_key,\s*source_terceirizacao_id\)/,
    );
  });

  it('expõe a leitura das linhas do card concedida a authenticated', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.get_pv_terceirizacao_lines\(p_sale_order_id uuid\)/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_pv_terceirizacao_lines\(uuid\) TO authenticated/);
  });

  it('define os RPCs de envio explícito (uma linha + todas) e de update de qty', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.send_terceirizacao_os\(/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.send_terceirizacao_os\(uuid, uuid, text, uuid, boolean\) TO authenticated/);
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.send_all_terceirizacao_os\(p_sale_order_id uuid\)/);
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.update_terceirizacao_os_qty\(p_service_order_id uuid\)/);
  });

  it('"enviar todas" não ressuscita canceladas (p_reactivate=false)', () => {
    expect(SQL).toMatch(/send_terceirizacao_os\(p_sale_order_id, r\.reference_id, r\.color, r\.terceirizacao_id, false\)/);
  });

  it('monta as notes com o número do pedido do cliente quando houver, senão o interno', () => {
    expect(SQL).toMatch(/'PV cliente: '\s*\|\|\s*btrim\(v_so\.client_order_number\)/);
    expect(SQL).toMatch(/'PV: '\s*\|\|\s*COALESCE\(v_so\.order_number/);
  });

  it('usa delivery_deadline como payment_due_date (fallback +30 dias)', () => {
    expect(SQL).toMatch(/v_due\s*:=\s*COALESCE\(v_so\.delivery_deadline,\s*\(CURRENT_DATE \+ INTERVAL '30 days'\)::date\)/);
  });

  it('cria a OS como Pendente, não-avulsa, vinculada ao PV', () => {
    expect(SQL).toMatch(/status, notes, payment_due_date, is_avulsa,/); // lista de colunas do INSERT
    expect(SQL).toMatch(/'Pendente', v_notes, v_due, false,/); // status=Pendente, is_avulsa=false
    expect(SQL).toMatch(/source_sale_order_id, source_sale_order_item_id, source_terceirizacao_id, source_item_key/);
  });

  it('nunca mexe em OS já entregue/concluída; idempotente em OS ativa', () => {
    expect(SQL).toMatch(/v_finalized\s+constant text\[\]\s*:=\s*ARRAY\['received', ?'Concluído'/);
    expect(SQL).toMatch(/IF v_existing\.status = ANY \(v_finalized\) THEN[\s\S]*finalized_untouched/);
    expect(SQL).toMatch(/já enviada e ativa[\s\S]*'exists'/);
  });

  it('faz cascata: PV → Cancelado cancela as OS vinculadas ativas via trigger', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.tg_cancel_service_orders_on_pv_cancel/);
    expect(SQL).toMatch(/CREATE TRIGGER trg_cancel_so_on_pv_cancel[\s\S]*AFTER UPDATE OF status ON public\.sale_orders/);
  });
});
