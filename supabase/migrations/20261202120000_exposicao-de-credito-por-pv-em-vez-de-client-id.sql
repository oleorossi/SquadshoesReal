-- B5: as views de exposicao de credito liam uma coluna vazia e devolviam R$ 0,00.
--
-- POR QUE
-- `v_client_credit_exposure` e `v_economic_group_credit` ligavam titulo -> cliente por
-- `accounts_receivable.client_id`. Em producao (auditoria 05/08/2026) essa coluna esta
-- NULA em 70 dos 72 titulos -- enquanto `sale_order_id` esta preenchido em 72/72. O
-- LEFT JOIN nunca casava, entao as duas views devolviam exposicao 0 para TODO cliente e
-- TODO grupo economico. Exposicao real escondida: R$ 349.474,40 (R$ 309.092,40 so em
-- LNG 10 CONFECCOES). Consumidor vivo: `useEconomicGroupCredit`
-- (src/hooks/useEconomicGroup360.ts) -> painel de credito do grupo, que mostrava AR
-- aberta zerada e limite 100% disponivel.
--
-- O QUE MUDA
-- O vinculo passa a ser `accounts_receivable.sale_order_id -> sale_orders.client_id`,
-- com FALLBACK para o `client_id` direto (lancamento avulso sem PV) e dedup por titulo.
-- E exatamente a regra que o TypeScript ja usa em `src/lib/clientCreditExposure.ts`
-- (`fetchClientCreditExposure`): mesmos status excluidos, mesma soma
-- `amount - COALESCE(amount_received, 0)`, mesmos dois caminhos de vinculo.
-- O dedup e feito pelo `UNION` (sem `ALL`) entre os dois caminhos: um titulo que casa
-- pelos dois entra uma vez so por cliente -- espelha o `Set` de ids do TS.
--
-- STATUS EXCLUIDOS: ('received','cancelled') nas DUAS views.
-- A view de grupo excluia tambem 'paid'. `paid` e dominio de `accounts_payable` e nunca
-- existiu em `accounts_receivable` (conferido em producao: 0 linhas; os unicos status
-- presentes sao 'cancelled' e 'pending'), entao o terceiro item era ruido e escondia a
-- divergencia com o TS. Removido para que as duas views e o TS usem o MESMO conjunto.
--
-- O QUE NAO MUDA
-- Nomes, ordem e tipos das colunas (o `types.ts` gerado continua valido), o aging
-- 0-30/30-60/60-90/90+, o `GREATEST(..., 0)` do credito disponivel do grupo e o
-- `security_invoker = true` das duas views.
--
-- NOTA sobre a agregacao do grupo: o AR e somado POR CLIENTE num CTE antes de entrar no
-- grupo, de modo que o LEFT JOIN com `clients` continue 1:1 e os `COUNT(DISTINCT c.id)`
-- (total_clients / total_matriz) nao inflem com o fan-out dos titulos.

DROP VIEW IF EXISTS public.v_client_credit_exposure;

CREATE VIEW public.v_client_credit_exposure
WITH (security_invoker = true)
AS
WITH ar_aberto AS (
  SELECT
    ar.id,
    ar.sale_order_id,
    ar.client_id,
    ar.amount - COALESCE(ar.amount_received, 0) AS saldo
  FROM public.accounts_receivable ar
  WHERE ar.status NOT IN ('received', 'cancelled')
),
ar_por_cliente AS (
  -- caminho 1: titulo -> PV -> cliente (o vinculo que existe de fato)
  SELECT so.client_id, a.id, a.saldo
  FROM ar_aberto a
  JOIN public.sale_orders so ON so.id = a.sale_order_id
  WHERE so.client_id IS NOT NULL
  UNION  -- UNION sem ALL = dedup por (cliente, titulo)
  -- caminho 2: fallback pelo client_id direto (lancamento avulso, sem PV)
  SELECT a.client_id, a.id, a.saldo
  FROM ar_aberto a
  WHERE a.client_id IS NOT NULL
)
SELECT
  c.id                                            AS client_id,
  c.razao_social,
  c.nome_fantasia,
  c.credit_limit,
  COALESCE(SUM(a.saldo), 0)                       AS open_exposure,
  c.credit_limit - COALESCE(SUM(a.saldo), 0)      AS available_credit,
  COUNT(a.id)                                     AS open_ar_count
FROM public.clients c
LEFT JOIN ar_por_cliente a ON a.client_id = c.id
GROUP BY c.id, c.razao_social, c.nome_fantasia, c.credit_limit;

COMMENT ON VIEW public.v_client_credit_exposure IS
  'Exposicao em aberto (AR) por cliente. Vinculo por sale_order_id -> sale_orders.client_id, com fallback para accounts_receivable.client_id e dedup por titulo -- mesma regra de src/lib/clientCreditExposure.ts. Status excluidos: received, cancelled.';

DROP VIEW IF EXISTS public.v_economic_group_credit;

CREATE VIEW public.v_economic_group_credit
WITH (security_invoker = true)
AS
WITH ar_aberto AS (
  SELECT
    ar.id,
    ar.sale_order_id,
    ar.client_id,
    ar.due_date,
    ar.amount - COALESCE(ar.amount_received, 0) AS saldo
  FROM public.accounts_receivable ar
  WHERE ar.status NOT IN ('received', 'cancelled')
),
ar_por_cliente AS (
  SELECT so.client_id, a.id, a.due_date, a.saldo
  FROM ar_aberto a
  JOIN public.sale_orders so ON so.id = a.sale_order_id
  WHERE so.client_id IS NOT NULL
  UNION
  SELECT a.client_id, a.id, a.due_date, a.saldo
  FROM ar_aberto a
  WHERE a.client_id IS NOT NULL
),
ar_agg AS (
  -- 1 linha por cliente: preserva o COUNT(DISTINCT) do grupo la embaixo
  SELECT
    client_id,
    SUM(saldo)                                                          AS ar_open_total,
    SUM(saldo) FILTER (WHERE due_date >= CURRENT_DATE)                  AS ar_a_vencer,
    SUM(saldo) FILTER (
      WHERE due_date < CURRENT_DATE
        AND due_date >= CURRENT_DATE - INTERVAL '30 days'
    )                                                                   AS ar_atraso_0_30,
    SUM(saldo) FILTER (
      WHERE due_date < CURRENT_DATE - INTERVAL '30 days'
        AND due_date >= CURRENT_DATE - INTERVAL '60 days'
    )                                                                   AS ar_atraso_30_60,
    SUM(saldo) FILTER (
      WHERE due_date < CURRENT_DATE - INTERVAL '60 days'
        AND due_date >= CURRENT_DATE - INTERVAL '90 days'
    )                                                                   AS ar_atraso_60_90,
    SUM(saldo) FILTER (WHERE due_date < CURRENT_DATE - INTERVAL '90 days') AS ar_atraso_90_mais
  FROM ar_por_cliente
  GROUP BY client_id
)
SELECT
  eg.id                                           AS economic_group_id,
  eg.name                                         AS group_name,
  eg.credit_limit,
  COUNT(DISTINCT c.id)                            AS total_clients,
  COUNT(DISTINCT c.id) FILTER (WHERE c.is_matriz) AS total_matriz,
  COALESCE(SUM(a.ar_open_total), 0)               AS ar_open_total,
  COALESCE(SUM(a.ar_a_vencer), 0)                 AS ar_a_vencer,
  COALESCE(SUM(a.ar_atraso_0_30), 0)              AS ar_atraso_0_30,
  COALESCE(SUM(a.ar_atraso_30_60), 0)             AS ar_atraso_30_60,
  COALESCE(SUM(a.ar_atraso_60_90), 0)             AS ar_atraso_60_90,
  COALESCE(SUM(a.ar_atraso_90_mais), 0)           AS ar_atraso_90_mais,
  GREATEST(eg.credit_limit - COALESCE(SUM(a.ar_open_total), 0), 0) AS credit_available
FROM public.economic_groups eg
LEFT JOIN public.clients c ON c.economic_group_id = eg.id
LEFT JOIN ar_agg a         ON a.client_id = c.id
GROUP BY eg.id;

COMMENT ON VIEW public.v_economic_group_credit IS
  'Consolida AR aberta + aging 0-30/30-60/60-90/90+ por grupo economico. Vinculo por sale_order_id -> sale_orders.client_id com fallback para client_id direto (mesma regra de src/lib/clientCreditExposure.ts). credit_available = limite - aberto.';

-- GRANTS
-- DROP + CREATE zera o ACL e os default privileges do Supabase reconcedem tudo a `anon`.
-- Estas views expoem limite de credito e saldo devedor por cliente/grupo -- e antes deste
-- arquivo elas devolviam so zeros, entao um grant a anon que era inofensivo passaria a
-- vazar numero real. Segue o mesmo padrao de 20261122120000: revoke SELECT de anon,
-- reafirma authenticated/service_role (ACL de anon fica `awdDxtm`, sem o `r`).
-- ───────────────────────────────────────────────────────────────────

REVOKE SELECT ON public.v_client_credit_exposure FROM anon;
REVOKE SELECT ON public.v_economic_group_credit  FROM anon;

GRANT SELECT ON public.v_client_credit_exposure TO authenticated, service_role;
GRANT SELECT ON public.v_economic_group_credit  TO authenticated, service_role;

-- Trava anti-regressao: se o SELECT de anon voltar numa das duas, isto falha alto.
DO $$
DECLARE
  expostas text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO expostas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'v'
    AND c.relname IN ('v_client_credit_exposure', 'v_economic_group_credit')
    AND has_table_privilege('anon', c.oid, 'SELECT');

  IF expostas IS NOT NULL THEN
    RAISE EXCEPTION 'anon ainda le view(s) de credito: %', expostas;
  END IF;
END $$;
