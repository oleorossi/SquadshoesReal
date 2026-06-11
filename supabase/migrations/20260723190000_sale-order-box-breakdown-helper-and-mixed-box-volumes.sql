-- ════════════════════════════════════════════════════════════════════════════
-- Auditoria NF-e/embalagem 2026-06-11 — helper único de contagem de caixas
-- ════════════════════════════════════════════════════════════════════════════
-- (1) compute_sale_order_box_breakdown(sale_order_id): FONTE ÚNICA do nº de
--     caixas por tipo de caixa do PV. Tanto compute_sale_order_nfe_volumes
--     (volumes da NF) quanto calculate_sale_order_weight (peso bruto) consomem
--     este mesmo breakdown — antes cada um contava à sua maneira e podiam
--     divergir.
--
-- (2) CAIXA MISTA: a versão anterior fazia CEIL(qty/pairs_per_box) POR
--     reference e somava. Quando duas referências cabem no MESMO master
--     (mesmo box_type_id), isso conta uma caixa a mais por referência parcial
--     (ex.: ref A 5 pares + ref B 5 pares, 12/caixa → CEIL(5/12)+CEIL(5/12)=2
--     em vez de CEIL(10/12)=1). Agora agrega os pares POR box_type_id e faz
--     CEIL UMA vez por caixa → respeita caixas mistas.
--
-- (3) Backward-compat de peso: o breakdown expõe empty_weight_kg (tara da
--     caixa) e legacy_box_weight_kg (Σ pares × technical_sheets.box_weight_kg)
--     pra calculate_sale_order_weight escolher o modelo por bucket.
--
-- Débito de embalagem (debit_packaging_for_order) continua por-OP (CEIL por OP),
-- que é o correto pra baixa de estoque (cada OP baixa as próprias caixas) e usa
-- o mesmo pairs_per_box_default — a agregação de caixa mista é específica da
-- DECLARAÇÃO de volumes/peso no nível do PV.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compute_sale_order_box_breakdown(p_sale_order_id uuid)
RETURNS TABLE(
  box_type_id          uuid,
  box_name             text,
  tipo                 text,
  total_pairs          integer,
  pairs_per_box        integer,
  boxes                integer,
  empty_weight_kg      numeric,
  legacy_box_weight_kg numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode           text;
  v_target_type    text;
  v_pair_as_volume boolean;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;

  -- Modos fitilho/amarrado: cada PAR é 1 volume (a caixa física é a individual,
  -- 1 par cada — fitilho amarra individuais mas não as agrupa em master).
  v_pair_as_volume := COALESCE(v_mode, '') IN ('individual_fitilho', 'individual_amarrado');
  v_target_type := CASE
    WHEN v_mode = 'colmeia'           THEN 'colmeia'
    WHEN v_mode = 'individual_master' THEN 'master'
    ELSE 'individual'   -- fitilho/amarrado/individual puro casam a caixa individual
  END;

  RETURN QUERY
  WITH items AS (
    SELECT soi.reference_id,
           SUM(soi.quantity)::integer AS qty,
           ts.box_weight_kg
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id
     GROUP BY soi.reference_id, ts.box_weight_kg
  ),
  resolved AS (
    SELECT i.reference_id, i.qty, i.box_weight_kg,
           bt.id   AS box_id,
           bt.nome AS box_name,
           bt.tipo::text AS bt_tipo,
           COALESCE(bt.pairs_per_box_default, 12) AS ppb,
           bt.empty_weight_kg
      FROM items i
      LEFT JOIN LATERAL (
        SELECT bt.id, bt.nome, bt.tipo, bt.pairs_per_box_default, bt.empty_weight_kg
          FROM public.technical_sheet_box_types tsbt
          JOIN public.box_types bt ON bt.id = tsbt.box_type_id
                                  AND bt.active = true
                                  AND bt.tipo::text = v_target_type
         WHERE tsbt.sheet_id = i.reference_id
         LIMIT 1
      ) bt ON true
  )
  SELECT
    r.box_id                                            AS box_type_id,
    MAX(r.box_name)                                     AS box_name,
    COALESCE(MAX(r.bt_tipo), v_target_type)             AS tipo,
    SUM(r.qty)::integer                                 AS total_pairs,
    CASE WHEN v_pair_as_volume THEN 1
         ELSE COALESCE(MAX(r.ppb), 12) END              AS pairs_per_box,
    -- CAIXA MISTA: agrega pares por box_type_id e faz CEIL uma vez.
    CASE WHEN v_pair_as_volume
         THEN SUM(r.qty)::integer
         ELSE CEIL(SUM(r.qty)::numeric / GREATEST(COALESCE(MAX(r.ppb), 12), 1))::integer
    END                                                 AS boxes,
    MAX(r.empty_weight_kg)                              AS empty_weight_kg,
    COALESCE(SUM(r.qty * r.box_weight_kg), 0)::numeric  AS legacy_box_weight_kg
  FROM resolved r
  GROUP BY r.box_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.compute_sale_order_box_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_sale_order_box_breakdown(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.compute_sale_order_box_breakdown(uuid) IS
  'Fonte ÚNICA de contagem de caixas por tipo do PV. Agrega pares por '
  'box_type_id e faz CEIL uma vez (respeita caixas mistas). Expõe empty_weight_kg '
  '(tara) e legacy_box_weight_kg (Σ pares × box_weight_kg) p/ o cálculo de peso. '
  'Modos fitilho/amarrado: cada par = 1 volume. Consumido por '
  'compute_sale_order_nfe_volumes e calculate_sale_order_weight.';

-- ─── compute_sale_order_nfe_volumes agora soma o breakdown único ─────────────
CREATE OR REPLACE FUNCTION public.compute_sale_order_nfe_volumes(p_sale_order_id uuid)
RETURNS TABLE(volumes integer, mode text, breakdown jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode      text;
  v_volumes   integer := 0;
  v_breakdown jsonb := '[]'::jsonb;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;

  SELECT
    COALESCE(SUM(b.boxes), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'box_type_id', b.box_type_id,
      'box_name', b.box_name,
      'tipo', b.tipo,
      'pairs', b.total_pairs,
      'pairs_per_box', b.pairs_per_box,
      'volumes', b.boxes
    )), '[]'::jsonb)
  INTO v_volumes, v_breakdown
  FROM public.compute_sale_order_box_breakdown(p_sale_order_id) b;

  -- Garantia: NF nunca pode ir com 0 volumes.
  IF v_volumes < 1 THEN v_volumes := 1; END IF;

  RETURN QUERY SELECT v_volumes, COALESCE(v_mode, 'individual_master'), v_breakdown;
END $$;

GRANT EXECUTE ON FUNCTION public.compute_sale_order_nfe_volumes(uuid) TO authenticated;

COMMENT ON FUNCTION public.compute_sale_order_nfe_volumes(uuid) IS
  'Nº de volumes da NF-e = Σ caixas do compute_sale_order_box_breakdown (fonte '
  'única; respeita caixas mistas). Modos master/colmeia agrupam pairs_per_box; '
  'fitilho/amarrado cada par = 1 volume.';
