-- NF-e de devolução: emitida pela Squad como NF de entrada (modelo 55, tipo 0,
-- finalidade 4) referenciando a NF de saída original. Permite trazer
-- mercadoria de volta ao estoque legalmente quando a janela de 24h de
-- cancelamento SEFAZ já passou.

CREATE TABLE IF NOT EXISTS public.nfe_devolucoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nfe_original_id     uuid NOT NULL REFERENCES public.nfe_emitidas(id) ON DELETE RESTRICT,
  sale_order_id       uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'processando',
  ref_nfe             text,
  chave_acesso        text,
  protocolo           text,
  provider_nfe_id     text,
  numero              text,
  serie               text,
  valor_total         numeric(14,2),
  itens               jsonb NOT NULL,
  motivo              text NOT NULL,
  data_emissao        timestamptz,
  cnpj_emitente       text,
  motivo_rejeicao     text,
  company_id          uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nfe_devolucoes_original ON public.nfe_devolucoes(nfe_original_id);
CREATE INDEX IF NOT EXISTS idx_nfe_devolucoes_sale_order ON public.nfe_devolucoes(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_nfe_devolucoes_status ON public.nfe_devolucoes(status);

COMMENT ON TABLE public.nfe_devolucoes IS
  'NF-e de devolução (entrada modelo 55, finalidade 4) referenciando NF de venda original. Usado quando passou da janela de 24h pra cancelar.';

COMMENT ON COLUMN public.nfe_devolucoes.itens IS
  'Array JSON: [{sale_order_item_id, reference_id, color, qty, valor_unit, valor_total}] — itens devolvidos parcialmente.';

ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS qty_devolvida numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sale_order_items.qty_devolvida IS
  'Quantidade de pares já devolvida deste item via NF-e de devolução. Não pode exceder quantity.';

ALTER TABLE public.nfe_devolucoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_nfe_devolucoes_all ON public.nfe_devolucoes;
CREATE POLICY rls_nfe_devolucoes_all ON public.nfe_devolucoes
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','nfe_operator']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','nfe_operator']));

COMMENT ON POLICY rls_nfe_devolucoes_all ON public.nfe_devolucoes IS
  'CRUD restrito a admin, gerente e nfe_operator (mesmo grupo que emite NF de venda).';
