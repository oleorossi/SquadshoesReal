-- =============================================================================
-- Lacunas de pv_origem: VISÍVEIS, não backfilladas
-- =============================================================================
-- Complemento da 20270101041000, que deixou a COMPARAÇÃO de neutralidade cega
-- à chave derivável. Esta migration ia materializar o dado; o backfill foi
-- ABORTADO depois de medir o efeito colateral. Fica registrado porque a
-- tentação de "só preencher a coluna" volta toda vez.
--
-- O QUE IA SER FEITO: UPDATE em sale_order_items.strap_colors preenchendo
-- pv_origem='sku_acabado' nas 22 linhas com source_mode='buy_ready' sem a chave
-- (mapeamento inequívoco: 77/77 das linhas buy_ready que TÊM pv_origem são
-- 'sku_acabado').
--
-- POR QUE NÃO FOI: medido em 13/10/2026, um UPDATE em sale_order_items dispara,
-- em AFTER UPDATE sobre TODAS as colunas:
--
--   trg_touch_sale_order_version_from_item          → sobe sale_orders.order_version
--   trg_enqueue_strap_demands_on_item_change_on_update → reenfileira demanda de tira
--   trg_mark_reservations_outdated_from_item_on_update → reservas viram "desatualizadas"
--   trg_sync_orders_from_sale_order_item_on_update  → ressincroniza as OPs
--   trg_mark_so_costs_dirty_from_item_on_update     → custeio sujo
--   trg_aa_sale_order_item_purchase_allocation_version → sobe versão de alocação de compra
--
-- E a fronteira de comando NÃO protege contra isso: a primeira coisa que
-- tg_enforce_sale_order_command_boundary faz é
-- `IF public.is_service_role_request_128() ... RETURN NEW`, e migration roda
-- como service_role. Ou seja o backfill não seria RECUSADO — seria aceito em
-- silêncio, com todos os efeitos acima.
--
-- O bump de order_version sozinho já condena: o dono está com o editor do
-- PV-00195 aberto, e `expected_order_version` é enviado no save. Subir a versão
-- pelas costas faria o save dele falhar por conflito — o oposto do que a
-- 20270101041000 acabou de consertar.
--
-- E o backfill não compra nada: com a comparação cega à chave derivável, a
-- lacuna já é inofensiva para o save documental. Corrigir o dado é reparo de
-- cadastro, e reparo de cadastro em PV comprometido passa pela TELA, por quem
-- tem o papel — não por migration.
--
-- O que fica: as lacunas viram consulta. Backfill parcial silencioso se lê como
-- "cobriu tudo"; uma lista acionável não mente.
--
-- Recorte medido em 13/10/2026 (strap_colors × strap_sourcing.source_mode):
--   buy_ready  / sku_acabado   77   consistente
--   buy_ready  / (ausente)     22   derivável, NÃO materializado (ver acima)
--   internal   / fabrica      504
--   internal   / prestador    228   ← 31%: internal é AMBÍGUO
--   internal   / (ausente)     29   não derivável — seria chute
--   (sem mode) / (ausente)    422   não derivável — nada de onde derivar
--
-- ⚠ O CLIENTE faz esse chute: recoverEmptyStrapSnapshotsForSubmit mapeia
-- internal → 'fabrica' e, no caminho NÃO-neutro, isso é persistido. Numa linha
-- que deveria ser 'prestador' ele grava 'fabrica' sem avisar ninguém. Está
-- fora do escopo deste conserto e é decisão de cadastro do dono — mas as 29
-- linhas em risco aparecem aqui.
--
-- Marcador: lacunas_de_pv_origem_visiveis_20270101041100
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_strap_pv_origem_gaps()
RETURNS TABLE (
  order_number text,
  sale_order_status text,
  sale_order_item_id uuid,
  item_color text,
  technical_strap_line_id text,
  source_mode text,
  derivavel boolean,
  motivo text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- lacunas_de_pv_origem_visiveis_20270101041100
  SELECT
    so.order_number,
    so.status,
    soi.id,
    soi.color,
    private.strap_line_sourcing_key(ln.value),
    soi.strap_sourcing -> private.strap_line_sourcing_key(ln.value) ->> 'source_mode',
    -- COALESCE obrigatório: sem source_mode a comparação dá NULL, e aí tanto
    -- `WHERE derivavel` quanto `WHERE NOT derivavel` descartam a linha — 422
    -- das 473 sumiriam de qualquer filtro booleano na tela.
    COALESCE(
      (soi.strap_sourcing
         -> private.strap_line_sourcing_key(ln.value)
         ->> 'source_mode') = 'buy_ready',
      false
    ),
    CASE
      WHEN (soi.strap_sourcing
             -> private.strap_line_sourcing_key(ln.value)
             ->> 'source_mode') = 'buy_ready'
        THEN 'derivável (sku_acabado) — a neutralidade já a ignora; gravar exige salvar o PV pela tela'
      WHEN (soi.strap_sourcing
             -> private.strap_line_sourcing_key(ln.value)
             ->> 'source_mode') = 'internal'
        THEN 'AMBÍGUO: internal cobre fabrica e prestador — escolha explícita no PV'
      ELSE 'sem source_mode gravado — não há de onde derivar'
    END
  FROM public.sale_order_items soi
  JOIN public.sale_orders so ON so.id = soi.sale_order_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(soi.strap_colors) = 'array'
      THEN soi.strap_colors ELSE '[]'::jsonb END
  ) AS ln(value)
  WHERE soi.production_excluded_at IS NULL
    AND COALESCE(ln.value ->> 'pv_origem', '')
        NOT IN ('fabrica', 'prestador', 'sku_acabado')
  ORDER BY so.order_number, soi.color;
$fn$;

REVOKE ALL ON FUNCTION public.list_strap_pv_origem_gaps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_strap_pv_origem_gaps() TO authenticated, service_role;

COMMENT ON FUNCTION public.list_strap_pv_origem_gaps() IS
  'Linhas de tira sem pv_origem. derivavel=true é inofensivo (neutralidade ignora); false exige decisão de cadastro.';
