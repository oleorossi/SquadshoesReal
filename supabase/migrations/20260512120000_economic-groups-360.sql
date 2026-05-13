-- ============================================================================
-- ECONOMIC GROUPS 360° — Niveis 1, 2, 3 de mercado (TOTVS, Omie, Sankhya, Betalabs)
-- ============================================================================
-- Transforma "grupo econômico" de agrupamento simples em hub completo:
--
--  NIVEL 1 — Condições comerciais herdadas (defaults pro PV):
--    - default_price_list_id, default_payment_condition,
--      default_factoring_config_id, default_modalidade_frete,
--      default_transport_company_id, default_discount_pct
--
--  NIVEL 2 — Crédito + matriz/filial:
--    - credit_limit, block_new_orders, aging_alert_days
--    - clients.is_matriz pra marcar a empresa-mãe do grupo
--    - VIEW v_economic_group_credit (AR consolidado + aging 30/60/90)
--
--  NIVEL 3 — 360° (contatos, notas, anexos, histórico):
--    - economic_group_contacts (múltiplos por papel)
--    - economic_group_notes (CRM-style timeline)
--    - economic_group_attachments (Storage links)
--    - economic_group_audit_log (trigger BEFORE UPDATE registra diffs)
--    - VIEW v_economic_group_kpis (receita 12m, ticket médio, pedidos, dias médio pgto)
-- ============================================================================


-- ───────────────────────────────────────────────────────────────────
-- NIVEL 1 + 2: novas colunas em economic_groups
-- ───────────────────────────────────────────────────────────────────

ALTER TABLE public.economic_groups
  ADD COLUMN IF NOT EXISTS default_price_list_id         uuid REFERENCES public.price_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_payment_condition     text,
  ADD COLUMN IF NOT EXISTS default_factoring_config_id   uuid REFERENCES public.factoring_config(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_modalidade_frete      text,
  ADD COLUMN IF NOT EXISTS default_transport_company_id  uuid REFERENCES public.transport_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_discount_pct          numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit                  numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS block_new_orders              boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_reason                  text,
  ADD COLUMN IF NOT EXISTS aging_alert_days              integer       NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.economic_groups.default_price_list_id IS
  'Tabela de preço default pro PV. Cliente pode sobrescrever via clients.price_list_id.';
COMMENT ON COLUMN public.economic_groups.credit_limit IS
  'Limite de crédito consolidado do grupo (soma de AR aberta de TODAS filiais).';
COMMENT ON COLUMN public.economic_groups.block_new_orders IS
  'Bloqueio comercial do grupo todo. Bloqueia qualquer cliente do grupo.';


-- ───────────────────────────────────────────────────────────────────
-- NIVEL 2: hierarquia matriz/filial em clients
-- ───────────────────────────────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_matriz boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.is_matriz IS
  'Marca a empresa matriz dentro do grupo econômico. Apenas 1 matriz por grupo (validação via UI, não constraint pq null group é OK).';

-- Index parcial pra busca rápida de matriz por grupo
CREATE INDEX IF NOT EXISTS idx_clients_matriz_per_group
  ON public.clients (economic_group_id)
  WHERE is_matriz = true;


-- ───────────────────────────────────────────────────────────────────
-- NIVEL 3: contatos múltiplos por papel
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.economic_group_contacts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  economic_group_id   uuid NOT NULL REFERENCES public.economic_groups(id) ON DELETE CASCADE,
  role                text NOT NULL,
  name                text NOT NULL,
  email               text,
  phone               text,
  whatsapp            text,
  notes               text,
  is_primary          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT chk_contact_role CHECK (role IN ('Comprador', 'Financeiro', 'Logística', 'Diretor', 'Comercial', 'Suporte', 'Outro'))
);

CREATE INDEX IF NOT EXISTS idx_eg_contacts_group ON public.economic_group_contacts(economic_group_id);

ALTER TABLE public.economic_group_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read group contacts"
  ON public.economic_group_contacts FOR SELECT
  USING (public.is_approved_user());
CREATE POLICY "Approved users can write group contacts"
  ON public.economic_group_contacts FOR INSERT
  WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update group contacts"
  ON public.economic_group_contacts FOR UPDATE
  USING (public.is_approved_user());
CREATE POLICY "Approved users can delete group contacts"
  ON public.economic_group_contacts FOR DELETE
  USING (public.is_approved_user());

CREATE OR REPLACE FUNCTION public.tg_eg_contacts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eg_contacts_updated_at ON public.economic_group_contacts;
CREATE TRIGGER trg_eg_contacts_updated_at
  BEFORE UPDATE ON public.economic_group_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_eg_contacts_updated_at();


-- ───────────────────────────────────────────────────────────────────
-- NIVEL 3: notas estilo CRM (timeline)
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.economic_group_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  economic_group_id   uuid NOT NULL REFERENCES public.economic_groups(id) ON DELETE CASCADE,
  content             text NOT NULL,
  note_type           text NOT NULL DEFAULT 'geral',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT chk_note_type CHECK (note_type IN ('geral', 'reunião', 'ligação', 'email', 'visita', 'whatsapp', 'incidente', 'oportunidade'))
);

CREATE INDEX IF NOT EXISTS idx_eg_notes_group_date ON public.economic_group_notes(economic_group_id, created_at DESC);

ALTER TABLE public.economic_group_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read group notes"
  ON public.economic_group_notes FOR SELECT USING (public.is_approved_user());
CREATE POLICY "Approved users can write group notes"
  ON public.economic_group_notes FOR INSERT WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update group notes"
  ON public.economic_group_notes FOR UPDATE USING (public.is_approved_user());
CREATE POLICY "Approved users can delete group notes"
  ON public.economic_group_notes FOR DELETE USING (public.is_approved_user());


-- ───────────────────────────────────────────────────────────────────
-- NIVEL 3: anexos (links pro Storage)
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.economic_group_attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  economic_group_id   uuid NOT NULL REFERENCES public.economic_groups(id) ON DELETE CASCADE,
  file_url            text NOT NULL,
  file_name           text NOT NULL,
  mime_type           text,
  size_bytes          bigint,
  description         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_eg_attachments_group ON public.economic_group_attachments(economic_group_id, created_at DESC);

ALTER TABLE public.economic_group_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read group attachments"
  ON public.economic_group_attachments FOR SELECT USING (public.is_approved_user());
CREATE POLICY "Approved users can write group attachments"
  ON public.economic_group_attachments FOR INSERT WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update group attachments"
  ON public.economic_group_attachments FOR UPDATE USING (public.is_approved_user());
CREATE POLICY "Approved users can delete group attachments"
  ON public.economic_group_attachments FOR DELETE USING (public.is_approved_user());


-- ───────────────────────────────────────────────────────────────────
-- NIVEL 3: audit log (timeline de mudanças no cadastro)
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.economic_group_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  economic_group_id   uuid NOT NULL REFERENCES public.economic_groups(id) ON DELETE CASCADE,
  changed_at          timestamptz NOT NULL DEFAULT now(),
  changed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  field_name          text NOT NULL,
  old_value           text,
  new_value           text
);

CREATE INDEX IF NOT EXISTS idx_eg_audit_group_date ON public.economic_group_audit_log(economic_group_id, changed_at DESC);

ALTER TABLE public.economic_group_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read group audit"
  ON public.economic_group_audit_log FOR SELECT USING (public.is_approved_user());

-- Trigger: registra diffs em campos relevantes
CREATE OR REPLACE FUNCTION public.tg_economic_groups_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
BEGIN
  v_user := auth.uid();

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.economic_group_audit_log(economic_group_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, v_user, 'name', OLD.name, NEW.name);
  END IF;

  IF NEW.credit_limit IS DISTINCT FROM OLD.credit_limit THEN
    INSERT INTO public.economic_group_audit_log(economic_group_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, v_user, 'credit_limit', OLD.credit_limit::text, NEW.credit_limit::text);
  END IF;

  IF NEW.block_new_orders IS DISTINCT FROM OLD.block_new_orders THEN
    INSERT INTO public.economic_group_audit_log(economic_group_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, v_user, 'block_new_orders', OLD.block_new_orders::text, NEW.block_new_orders::text);
  END IF;

  IF NEW.default_price_list_id IS DISTINCT FROM OLD.default_price_list_id THEN
    INSERT INTO public.economic_group_audit_log(economic_group_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, v_user, 'default_price_list_id', OLD.default_price_list_id::text, NEW.default_price_list_id::text);
  END IF;

  IF NEW.default_payment_condition IS DISTINCT FROM OLD.default_payment_condition THEN
    INSERT INTO public.economic_group_audit_log(economic_group_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, v_user, 'default_payment_condition', OLD.default_payment_condition, NEW.default_payment_condition);
  END IF;

  IF NEW.default_factoring_config_id IS DISTINCT FROM OLD.default_factoring_config_id THEN
    INSERT INTO public.economic_group_audit_log(economic_group_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, v_user, 'default_factoring_config_id', OLD.default_factoring_config_id::text, NEW.default_factoring_config_id::text);
  END IF;

  IF NEW.default_discount_pct IS DISTINCT FROM OLD.default_discount_pct THEN
    INSERT INTO public.economic_group_audit_log(economic_group_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, v_user, 'default_discount_pct', OLD.default_discount_pct::text, NEW.default_discount_pct::text);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_economic_groups_audit ON public.economic_groups;
CREATE TRIGGER trg_economic_groups_audit
  AFTER UPDATE ON public.economic_groups
  FOR EACH ROW EXECUTE FUNCTION public.tg_economic_groups_audit();


-- ───────────────────────────────────────────────────────────────────
-- NIVEL 2: VIEW de crédito consolidado + aging
-- ───────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_economic_group_credit;

CREATE VIEW public.v_economic_group_credit AS
SELECT
  eg.id                                                                 AS economic_group_id,
  eg.name                                                               AS group_name,
  eg.credit_limit,
  COUNT(DISTINCT c.id)                                                  AS total_clients,
  COUNT(DISTINCT c.id) FILTER (WHERE c.is_matriz)                       AS total_matriz,
  COALESCE(SUM(ar.amount - ar.amount_received) FILTER (
    WHERE ar.status NOT IN ('cancelled','received','paid')
  ), 0)                                                                 AS ar_open_total,
  COALESCE(SUM(ar.amount - ar.amount_received) FILTER (
    WHERE ar.status NOT IN ('cancelled','received','paid')
      AND ar.due_date >= CURRENT_DATE
  ), 0)                                                                 AS ar_a_vencer,
  COALESCE(SUM(ar.amount - ar.amount_received) FILTER (
    WHERE ar.status NOT IN ('cancelled','received','paid')
      AND ar.due_date < CURRENT_DATE
      AND ar.due_date >= CURRENT_DATE - INTERVAL '30 days'
  ), 0)                                                                 AS ar_atraso_0_30,
  COALESCE(SUM(ar.amount - ar.amount_received) FILTER (
    WHERE ar.status NOT IN ('cancelled','received','paid')
      AND ar.due_date < CURRENT_DATE - INTERVAL '30 days'
      AND ar.due_date >= CURRENT_DATE - INTERVAL '60 days'
  ), 0)                                                                 AS ar_atraso_30_60,
  COALESCE(SUM(ar.amount - ar.amount_received) FILTER (
    WHERE ar.status NOT IN ('cancelled','received','paid')
      AND ar.due_date < CURRENT_DATE - INTERVAL '60 days'
      AND ar.due_date >= CURRENT_DATE - INTERVAL '90 days'
  ), 0)                                                                 AS ar_atraso_60_90,
  COALESCE(SUM(ar.amount - ar.amount_received) FILTER (
    WHERE ar.status NOT IN ('cancelled','received','paid')
      AND ar.due_date < CURRENT_DATE - INTERVAL '90 days'
  ), 0)                                                                 AS ar_atraso_90_mais,
  GREATEST(eg.credit_limit - COALESCE(SUM(ar.amount - ar.amount_received) FILTER (
    WHERE ar.status NOT IN ('cancelled','received','paid')
  ), 0), 0)                                                             AS credit_available
FROM public.economic_groups eg
LEFT JOIN public.clients c               ON c.economic_group_id = eg.id
LEFT JOIN public.accounts_receivable ar  ON ar.client_id = c.id
GROUP BY eg.id;

GRANT SELECT ON public.v_economic_group_credit TO authenticated;

COMMENT ON VIEW public.v_economic_group_credit IS
  'Consolida AR aberta + aging 0-30/30-60/60-90/90+ por grupo econômico. credit_available = limite - aberto.';


-- ───────────────────────────────────────────────────────────────────
-- NIVEL 3: VIEW de KPIs (receita 12m, ticket, dias médio pagamento)
-- ───────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_economic_group_kpis;

CREATE VIEW public.v_economic_group_kpis AS
WITH so_12m AS (
  SELECT
    c.economic_group_id,
    COUNT(DISTINCT so.id)                       AS orders_12m,
    COALESCE(SUM(so.total), 0)                  AS revenue_12m,
    MAX(so.created_at)                          AS last_order_at
  FROM public.sale_orders so
  JOIN public.clients c ON c.id = so.client_id
  WHERE so.status NOT IN ('Cancelado','cancelled')
    AND so.created_at >= NOW() - INTERVAL '12 months'
    AND c.economic_group_id IS NOT NULL
  GROUP BY c.economic_group_id
),
pay_stats AS (
  SELECT
    c.economic_group_id,
    AVG(EXTRACT(EPOCH FROM (ar.payment_date::timestamptz - ar.created_at)) / 86400)::numeric(8,1) AS avg_days_to_pay
  FROM public.accounts_receivable ar
  JOIN public.clients c ON c.id = ar.client_id
  WHERE ar.status IN ('received','paid')
    AND ar.payment_date IS NOT NULL
    AND ar.created_at >= NOW() - INTERVAL '12 months'
    AND c.economic_group_id IS NOT NULL
  GROUP BY c.economic_group_id
),
total_revenue AS (
  SELECT COALESCE(SUM(total), 0) AS total
  FROM public.sale_orders
  WHERE status NOT IN ('Cancelado','cancelled')
    AND created_at >= NOW() - INTERVAL '12 months'
)
SELECT
  eg.id                                       AS economic_group_id,
  eg.name                                     AS group_name,
  COALESCE(s.orders_12m, 0)                   AS orders_12m,
  COALESCE(s.revenue_12m, 0)                  AS revenue_12m,
  CASE WHEN COALESCE(s.orders_12m, 0) > 0
    THEN ROUND(s.revenue_12m / s.orders_12m, 2)
    ELSE 0
  END                                          AS avg_ticket,
  COALESCE(p.avg_days_to_pay, 0)              AS avg_days_to_pay,
  CASE WHEN tr.total > 0
    THEN ROUND((COALESCE(s.revenue_12m, 0) / tr.total * 100)::numeric, 2)
    ELSE 0
  END                                          AS share_of_wallet_pct,
  s.last_order_at
FROM public.economic_groups eg
LEFT JOIN so_12m s    ON s.economic_group_id = eg.id
LEFT JOIN pay_stats p ON p.economic_group_id = eg.id
CROSS JOIN total_revenue tr;

GRANT SELECT ON public.v_economic_group_kpis TO authenticated;

COMMENT ON VIEW public.v_economic_group_kpis IS
  'KPIs do grupo: receita 12m, # pedidos, ticket médio, dias médio pagamento, share of wallet %.';


-- ───────────────────────────────────────────────────────────────────
-- HELPER FUNCTION: pega defaults do grupo pra herança em PV
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_client_commercial_defaults(p_client_id uuid)
RETURNS TABLE (
  price_list_id          uuid,
  payment_condition      text,
  factoring_config_id    uuid,
  modalidade_frete       text,
  transport_company_id   uuid,
  discount_pct           numeric,
  credit_limit           numeric,
  block_new_orders       boolean,
  block_reason           text,
  inherited_from         text
)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(c.price_list_id,             eg.default_price_list_id)         AS price_list_id,
    -- ATENÇÃO: payment_condition vem APENAS do grupo. NÃO usar c.contato aqui —
    -- 'contato' é nome da pessoa de contato no cliente, não condição de pgto.
    -- Se quiser override por cliente, criar coluna clients.default_payment_condition.
    eg.default_payment_condition                                            AS payment_condition,
    eg.default_factoring_config_id                                          AS factoring_config_id,
    eg.default_modalidade_frete                                             AS modalidade_frete,
    COALESCE(c.preferred_transporter_id,  eg.default_transport_company_id)  AS transport_company_id,
    COALESCE(NULLIF(c.max_discount_pct,0), eg.default_discount_pct)         AS discount_pct,
    COALESCE(NULLIF(c.credit_limit,0),    eg.credit_limit)                  AS credit_limit,
    (c.commercial_block OR COALESCE(eg.block_new_orders, false))            AS block_new_orders,
    COALESCE(c.commercial_block_reason,   eg.block_reason)                  AS block_reason,
    CASE
      WHEN c.economic_group_id IS NULL THEN 'cliente'
      WHEN c.price_list_id IS NOT NULL THEN 'cliente (sobrescreve grupo)'
      ELSE 'grupo econômico'
    END                                                                     AS inherited_from
  FROM public.clients c
  LEFT JOIN public.economic_groups eg ON eg.id = c.economic_group_id
  WHERE c.id = p_client_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_commercial_defaults(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_client_commercial_defaults(uuid) IS
  'Resolve defaults comerciais com precedência cliente > grupo. Frontend usa pra pré-popular PV.';


-- ───────────────────────────────────────────────────────────────────
-- Storage bucket pra anexos do grupo (contratos, propostas, NDAs)
-- ───────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('economic-group-attachments', 'economic-group-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read eg attachments" ON storage.objects;
CREATE POLICY "Authenticated can read eg attachments" ON storage.objects FOR SELECT
  USING (bucket_id = 'economic-group-attachments' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated can upload eg attachments" ON storage.objects;
CREATE POLICY "Authenticated can upload eg attachments" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'economic-group-attachments' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated can delete eg attachments" ON storage.objects;
CREATE POLICY "Authenticated can delete eg attachments" ON storage.objects FOR DELETE
  USING (bucket_id = 'economic-group-attachments' AND auth.role() = 'authenticated');
