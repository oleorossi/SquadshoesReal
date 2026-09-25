-- Corrige apply_sale_order_documentary_header: colunas NOT NULL de sale_orders
-- (client_order_number, brand, client_name, order_type) não podem receber NULL
-- quando o cliente manda string vazia.
--
-- Sintoma (PV-00204 / edição em /sales/edit/...):
--   null value in column "client_order_number" of relation "sale_orders"
--   violates not-null constraint
--
-- Causa: a 20270101024100 usava NULLIF(btrim(...), '') em TODOS os campos
-- textuais. Em colunas nullable isso é correto ("" → NULL). Em
-- client_order_number (DEFAULT '' NOT NULL desde 20260307180718) a conversão
-- estoura o CHECK e o save inteiro — inclusive remoção de itens — é recusado.
--
-- execute_sale_order_command SEMPRE chama esta função após o writer (caminho
-- neutro e teardown). Por isso o bug aparece em qualquer edição com OC vazia.

CREATE OR REPLACE FUNCTION public.apply_sale_order_documentary_header(
  p_sale_order_id uuid,
  p_header jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_header jsonb := COALESCE(p_header, '{}'::jsonb);
BEGIN
  -- fix_documentary_header_not_null_empty_20270101028700
  -- Chave ausente preserva o valor atual. Nunca grava NULL em coluna NOT NULL
  -- por omissão/trim vazio do cliente. packing/outsource ficam no complemento
  -- já existente de execute_sale_order_command.
  IF p_sale_order_id IS NULL OR v_header = '{}'::jsonb THEN
    RETURN;
  END IF;

  UPDATE public.sale_orders so
     SET client_order_number = CASE WHEN v_header ? 'client_order_number'
           THEN COALESCE(NULLIF(btrim(v_header ->> 'client_order_number'), ''), '')
           ELSE so.client_order_number END,
         nfe = CASE WHEN v_header ? 'nfe'
           THEN NULLIF(btrim(v_header ->> 'nfe'), '')
           ELSE so.nfe END,
         remessa = CASE WHEN v_header ? 'remessa'
           THEN NULLIF(btrim(v_header ->> 'remessa'), '')
           ELSE so.remessa END,
         notes = CASE WHEN v_header ? 'notes'
           THEN NULLIF(btrim(v_header ->> 'notes'), '')
           ELSE so.notes END,
         brand = CASE WHEN v_header ? 'brand'
           THEN COALESCE(NULLIF(btrim(v_header ->> 'brand'), ''), '')
           ELSE so.brand END,
         informacoes_complementares_nf = CASE
           WHEN v_header ? 'informacoes_complementares_nf'
           THEN NULLIF(btrim(v_header ->> 'informacoes_complementares_nf'), '')
           ELSE so.informacoes_complementares_nf END,
         nfe_required = CASE WHEN v_header ? 'nfe_required'
           THEN COALESCE((v_header ->> 'nfe_required')::boolean, so.nfe_required)
           ELSE so.nfe_required END,
         nfe_external = CASE WHEN v_header ? 'nfe_external'
           THEN COALESCE((v_header ->> 'nfe_external')::boolean, so.nfe_external)
           ELSE so.nfe_external END,
         external_nfe_number = CASE WHEN v_header ? 'external_nfe_number'
           THEN NULLIF(btrim(v_header ->> 'external_nfe_number'), '')
           ELSE so.external_nfe_number END,
         payment_condition = CASE WHEN v_header ? 'payment_condition'
           THEN NULLIF(btrim(v_header ->> 'payment_condition'), '')
           ELSE so.payment_condition END,
         representative = CASE WHEN v_header ? 'representative'
           THEN NULLIF(btrim(v_header ->> 'representative'), '')
           ELSE so.representative END,
         representative_id = CASE WHEN v_header ? 'representative_id'
           THEN NULLIF(btrim(v_header ->> 'representative_id'), '')::uuid
           ELSE so.representative_id END,
         client_contact = CASE WHEN v_header ? 'client_contact'
           THEN NULLIF(btrim(v_header ->> 'client_contact'), '')
           ELSE so.client_contact END,
         client_name = CASE WHEN v_header ? 'client_name'
           THEN COALESCE(NULLIF(btrim(v_header ->> 'client_name'), ''), '')
           ELSE so.client_name END,
         client_cnpj = CASE WHEN v_header ? 'client_cnpj'
           THEN NULLIF(btrim(v_header ->> 'client_cnpj'), '')
           ELSE so.client_cnpj END,
         client_id = CASE WHEN v_header ? 'client_id'
           THEN NULLIF(btrim(v_header ->> 'client_id'), '')::uuid
           ELSE so.client_id END,
         company_id = CASE WHEN v_header ? 'company_id'
           THEN NULLIF(btrim(v_header ->> 'company_id'), '')::uuid
           ELSE so.company_id END,
         order_type = CASE WHEN v_header ? 'order_type'
           THEN COALESCE(
             NULLIF(btrim(v_header ->> 'order_type'), ''),
             so.order_type
           )
           ELSE so.order_type END,
         own_delivery = CASE WHEN v_header ? 'own_delivery'
           THEN COALESCE((v_header ->> 'own_delivery')::boolean, so.own_delivery)
           ELSE so.own_delivery END,
         shipping_rate_per_pair = CASE WHEN v_header ? 'shipping_rate_per_pair'
           THEN COALESCE((v_header ->> 'shipping_rate_per_pair')::numeric, 0)
           ELSE so.shipping_rate_per_pair END,
         commission_value = CASE WHEN v_header ? 'commission_value'
           THEN COALESCE((v_header ->> 'commission_value')::numeric, so.commission_value)
           ELSE so.commission_value END,
         updated_at = now()
   WHERE so.id = p_sale_order_id;
END;
$fn$;

COMMENT ON FUNCTION public.apply_sale_order_documentary_header(uuid, jsonb) IS
  'Persiste NF/OC/notas/cliente do header jsonb; chave ausente não apaga o valor atual. Colunas NOT NULL (client_order_number, brand, client_name, order_type) gravam '''' / valor atual em vez de NULL.';
