-- Volumes de embalagem: CEIL por REFERÊNCIA + fallback de 12 pares EXPLÍCITO
-- Auditoria de volumes 31/07/2026 (docs/AUDITORIA_NFE_2026-07-31.md §Volumes).
--
-- Contexto medido no banco antes desta migration:
--   • 58 PVs ativos (52 'colmeia', 6 'individual_fitilho').
--   • NENHUM box_type do tipo 'master', 'colmeia' ou 'fitilho' existe — os 3
--     cadastrados são todos 'individual' com pairs_per_box_default = 1.
--   • 0 de 34 product_groups tem qualquer caixa vinculada.
--   ⇒ o LATERAL de compute_sale_order_box_breakdown NUNCA resolve uma caixa:
--     todos os PVs caem no COALESCE(...,12) hardcoded e saem com
--     box_type_id = NULL. O "12 pares por colmeia" não vem de cadastro
--     nenhum — é um chute embutido no SQL, e nada no sistema acusava isso.
--
-- Esta migration NÃO adivinha a capacidade real da colmeia (isso é cadastro,
-- não código). Ela faz duas coisas:
--
--   1. CEIL por REFERÊNCIA em vez de CEIL sobre a soma agregada.
--   2. Marca o fallback como fallback (`unconfigured`/`pairs_per_box_source`),
--      pra que a NF-e e a UI possam AVISAR em vez de fingir que sabem.
--
-- Compatibilidade: as colunas/campos existentes seguem com o mesmo nome e
-- semântica; só foram ACRESCENTADOS campos. compute_sale_order_nfe_volumes
-- continua devolvendo (volumes, mode, breakdown).

-- Ambas ganham COLUNAS no RETURNS TABLE, e CREATE OR REPLACE não muda tipo de
-- retorno ("cannot change return type of existing function") — daí o DROP.
-- Ordem: derruba a consumidora antes da consumida. Sem CASCADE de propósito:
-- se alguma dependência aparecer no futuro, é melhor o DROP falhar do que
-- levar junto um objeto que ninguém viu. Verificado em 31/07: nenhuma outra
-- função SQL referencia as duas; o único consumidor é a edge function emit-nfe
-- (via .rpc(), que tolera coluna nova).
DROP FUNCTION IF EXISTS public.compute_sale_order_nfe_volumes(uuid);
DROP FUNCTION IF EXISTS public.compute_sale_order_box_breakdown(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) compute_sale_order_box_breakdown
-- ─────────────────────────────────────────────────────────────────────────────
-- MUDANÇA A — CEIL por referência.
--   Antes: GROUP BY box_id e CEIL(SUM(qty)/ppb). Com duas referências de 6
--   pares e ppb 12 dava 1 caixa, mas fisicamente são 2 caixas parciais (uma
--   caixa coletiva leva pares da MESMA referência/cor).
--   Hoje isso não causa divergência — todas as quantidades são múltiplas de 12
--   porque vêm da grade base (verificado: 0 PVs divergentes) — então a mudança
--   é NEUTRA agora e correta quando alguém vender quantidade quebrada.
--
-- MUDANÇA B — `unconfigured` + `pairs_per_box_source`.
--   Diz se o pairs_per_box veio do cadastro ('box_type') ou do chute
--   ('fallback_default'), e se a caixa do modo não existe ('unconfigured').
CREATE OR REPLACE FUNCTION public.compute_sale_order_box_breakdown(p_sale_order_id uuid)
 RETURNS TABLE(
   box_type_id uuid, box_name text, tipo text, total_pairs integer,
   pairs_per_box integer, boxes integer, empty_weight_kg numeric,
   legacy_box_weight_kg numeric,
   unconfigured boolean, pairs_per_box_source text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mode           text;
  v_target_type    text;
  v_pair_as_volume boolean;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;

  v_pair_as_volume := COALESCE(v_mode, '') IN ('individual_fitilho', 'individual_amarrado');
  v_target_type := CASE
    WHEN v_mode = 'colmeia'           THEN 'colmeia'
    WHEN v_mode = 'individual_master' THEN 'master'
    ELSE 'individual'
  END;

  RETURN QUERY
  WITH items AS (
    -- quantity > 0: espelha o `billableItems` do emit-nfe. Item zerado não
    -- ocupa volume e não pode inflar a contagem.
    SELECT soi.reference_id,
           SUM(soi.quantity)::integer AS qty,
           ts.box_weight_kg
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id
       AND COALESCE(soi.quantity, 0) > 0
     GROUP BY soi.reference_id, ts.box_weight_kg
  ),
  resolved AS (
    SELECT i.reference_id, i.qty, i.box_weight_kg,
           bt.id   AS box_id,
           bt.nome AS box_name,
           bt.tipo::text AS bt_tipo,
           bt.pairs_per_box_default AS ppb_cadastrado,
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
  ),
  -- CEIL POR REFERÊNCIA (mudança A): cada referência fecha suas próprias
  -- caixas antes de somar.
  per_ref AS (
    SELECT r.*,
           CASE WHEN v_pair_as_volume THEN 1
                ELSE COALESCE(r.ppb_cadastrado, 12) END AS ppb_efetivo
      FROM resolved r
  ),
  per_ref_boxes AS (
    SELECT p.*,
           CASE WHEN v_pair_as_volume
                THEN p.qty
                ELSE CEIL(p.qty::numeric / GREATEST(p.ppb_efetivo, 1))::integer
           END AS ref_boxes
      FROM per_ref p
  )
  SELECT
    b.box_id                                            AS box_type_id,
    MAX(b.box_name)                                     AS box_name,
    COALESCE(MAX(b.bt_tipo), v_target_type)             AS tipo,
    SUM(b.qty)::integer                                 AS total_pairs,
    MAX(b.ppb_efetivo)::integer                         AS pairs_per_box,
    SUM(b.ref_boxes)::integer                           AS boxes,
    MAX(b.empty_weight_kg)                              AS empty_weight_kg,
    COALESCE(SUM(b.qty * b.box_weight_kg), 0)::numeric  AS legacy_box_weight_kg,
    -- unconfigured: nenhuma caixa do tipo exigido pelo modo do PV foi
    -- encontrada — o número de volumes está saindo de um DEFAULT, não de
    -- cadastro. Em modo par-como-volume não há caixa coletiva a configurar.
    bool_or(b.box_id IS NULL AND NOT v_pair_as_volume)  AS unconfigured,
    CASE
      WHEN v_pair_as_volume                  THEN 'pair_as_volume'
      WHEN MAX(b.ppb_cadastrado) IS NOT NULL THEN 'box_type'
      ELSE 'fallback_default'
    END                                                 AS pairs_per_box_source
  FROM per_ref_boxes b
  GROUP BY b.box_id;
END $function$;

COMMENT ON FUNCTION public.compute_sale_order_box_breakdown(uuid) IS
  'Caixas/volumes por tipo de caixa de um PV. CEIL POR REFERÊNCIA (caixa '
  'coletiva leva pares da mesma referência). Expõe unconfigured=true e '
  'pairs_per_box_source=fallback_default quando o modo do PV exige uma caixa '
  'que não existe no cadastro e o número de volumes veio do default 12 — '
  'quem consome DEVE avisar o operador em vez de tratar como dado confiável.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) compute_sale_order_nfe_volumes — propaga o aviso
-- ─────────────────────────────────────────────────────────────────────────────
-- Acrescenta a coluna `unconfigured` ao retorno. O emit-nfe usa pra empurrar um
-- warning pro preview da NF-e; a UI de expedição pode usar igual.
-- NÃO falha: volume de NF-e é campo obrigatório e derrubar a emissão por falta
-- de cadastro de caixa seria pior que emitir avisando.
CREATE OR REPLACE FUNCTION public.compute_sale_order_nfe_volumes(p_sale_order_id uuid)
 RETURNS TABLE(volumes integer, mode text, breakdown jsonb, unconfigured boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mode         text;
  v_volumes      integer := 0;
  v_breakdown    jsonb := '[]'::jsonb;
  v_unconfigured boolean := false;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;

  SELECT
    COALESCE(SUM(b.boxes), 0),
    COALESCE(bool_or(b.unconfigured), false),
    COALESCE(jsonb_agg(jsonb_build_object(
      'box_type_id', b.box_type_id,
      'box_name', b.box_name,
      'tipo', b.tipo,
      'pairs', b.total_pairs,
      'pairs_per_box', b.pairs_per_box,
      'volumes', b.boxes,
      'unconfigured', b.unconfigured,
      'pairs_per_box_source', b.pairs_per_box_source
    )), '[]'::jsonb)
  INTO v_volumes, v_unconfigured, v_breakdown
  FROM public.compute_sale_order_box_breakdown(p_sale_order_id) b;

  IF v_volumes < 1 THEN v_volumes := 1; END IF;

  RETURN QUERY SELECT v_volumes, COALESCE(v_mode, 'individual_master'), v_breakdown, v_unconfigured;
END $function$;

COMMENT ON FUNCTION public.compute_sale_order_nfe_volumes(uuid) IS
  'Nº de volumes da NF-e de um PV. unconfigured=true significa que o número '
  'veio do default de 12 pares/caixa e NÃO de cadastro — o emit-nfe transforma '
  'isso em warning no preview.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Corrige o `tipo` da "CAIXA COLMEIA 11"
-- ─────────────────────────────────────────────────────────────────────────────
-- Cadastrada como 'individual' apesar do nome. Está INATIVA e sem nenhuma ficha
-- vinculada, então a correção tem raio de impacto zero hoje (todas as consultas
-- filtram active = true) — mas evita que alguém a reative e ela conte como
-- caixa individual. Idempotente.
UPDATE public.box_types
   SET tipo = 'colmeia'::box_type_kind, updated_at = now()
 WHERE lower(nome) LIKE '%colmeia%'
   AND tipo::text <> 'colmeia';
