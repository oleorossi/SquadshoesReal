-- Variante de material: "material principal" que cascateia pros slots liberados
-- ============================================================================
-- PROBLEMA (auditoria 31/07/2026): a variante tem 3 pinos independentes
-- (cabedal / forro / palmilha) + solado, e só troca o SLOT que foi pinado. As 63
-- variantes criadas em 11/07 preencheram só `lining_material_group_id`, então o
-- CABEDAL nunca troca de família: vende-se I110 em GLOW METALIC e o cabedal sai
-- NAPA SOFT. Pior, variante que aponta um slot que a ficha não consome vira
-- no-op SILENCIOSO — foi o que fez o PV-00141 (EC23, 600 pares) debitar NAPA
-- SUDANI com a variante dizendo NAPA SOFT.
--
-- SOLUÇÃO (decisões do dono, 31/07):
--   1. `reference_material_variants.main_material_group_id` — o material
--      principal da variante. Os resolvers caem nele quando o pino do slot é
--      NULL. Preced.: pino do slot > MATERIAL PRINCIPAL > pin da ficha > grupo
--      da ficha.
--   2. Trava POR SLOT na ficha (`technical_sheets.variant_drives_*`). Sem ela o
--      backfill quebraria DS21/DS19: o cabedal PALHA viraria NAPA SOFT, e a
--      palha é identidade do modelo, não default esquecido.
--   3. Cascateia para Cabedal, Forração (+ Forração da Palmilha, que resolve
--      pelo mesmo resolver de forro), Fachete e a base da tira artesanal.
--
-- NÃO muda quantidade: toda napa é 1000×1370 e os dois motores já usam
-- GREATEST(width,length) = 1370. A variante troca de QUAL grupo sai o material,
-- não quantos metros.

-- ── 1. Colunas ──────────────────────────────────────────────────────────────

ALTER TABLE public.reference_material_variants
  ADD COLUMN IF NOT EXISTS main_material_group_id uuid
    REFERENCES public.product_groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.reference_material_variants.main_material_group_id IS
  'Material PRINCIPAL da variante (grupo). Cascateia pros slots que a ficha '
  'liberou em technical_sheets.variant_drives_*. Perde para o pino específico '
  'do slot (upper/lining/insole_material_group_id) e para o pin de produto '
  'legado; ganha do pin e do grupo da ficha.';

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS variant_drives_upper   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS variant_drives_lining  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS variant_drives_insole  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS variant_drives_fachete boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.technical_sheets.variant_drives_upper IS
  'Quando true, o material principal da variante do item do PV substitui o '
  'cabedal desta ficha. false protege material de IDENTIDADE (ex.: a PALHA do '
  'cabedal do DS21/DS19, que não deve seguir a napa vendida).';

-- ── 2. Backfill do material principal ───────────────────────────────────────
-- COALESCE(cabedal, forro, palmilha) — o primeiro grupo pinado é a intenção do
-- cadastro. Cobre as 63 variantes pelo forro e EC23/ST16 pelo cabedal. Os pins
-- de PRODUTO legados entram pelo grupo do próprio produto.

UPDATE public.reference_material_variants v
   SET main_material_group_id = COALESCE(
         v.upper_material_group_id,
         v.lining_material_group_id,
         v.insole_material_group_id,
         (SELECT p.group_id FROM public.products p WHERE p.id = v.upper_material_product_id),
         (SELECT p.group_id FROM public.products p WHERE p.id = v.lining_material_product_id),
         (SELECT p.group_id FROM public.products p WHERE p.id = v.insole_material_product_id)
       )
 WHERE v.main_material_group_id IS NULL;

-- ── 3. Backfill das travas por slot ─────────────────────────────────────────
-- Regra: liga o slot quando o grupo que a ficha usa HOJE naquele slot é um dos
-- grupos que aparecem como material principal de alguma variante DESTA ficha.
-- É o sinal de que aquele slot faz parte do jogo de variação. Onde o grupo é
-- outro (PALHA, TIRA), fica desligado e a ficha continua mandando.

WITH variant_mains AS (
  SELECT v.reference_id, upper(btrim(g.name)) AS gname
    FROM public.reference_material_variants v
    JOIN public.product_groups g ON g.id = v.main_material_group_id
   WHERE COALESCE(v.active, true)
),
fachete_group AS (
  SELECT ts.id AS sheet_id,
         COALESCE(
           (SELECT upper(btrim(pg2.name))
              FROM public.products p2
              JOIN public.product_groups pg2 ON pg2.id = p2.fachete_material_group_id
             WHERE p2.id = ts.primary_sole_id),
           upper(btrim(COALESCE(ts.lining_material, '')))
         ) AS gname
    FROM public.technical_sheets ts
)
UPDATE public.technical_sheets ts
   SET variant_drives_upper = EXISTS (
         SELECT 1 FROM variant_mains m
          WHERE m.reference_id = ts.id
            AND m.gname = upper(btrim(COALESCE(ts.upper_material, '')))
            AND m.gname <> ''),
       variant_drives_lining = EXISTS (
         SELECT 1 FROM variant_mains m
          WHERE m.reference_id = ts.id
            AND m.gname = upper(btrim(COALESCE(ts.lining_material, '')))
            AND m.gname <> ''),
       variant_drives_insole = EXISTS (
         SELECT 1 FROM variant_mains m
          WHERE m.reference_id = ts.id
            AND m.gname = upper(btrim(COALESCE(ts.insole_material, '')))
            AND m.gname <> ''),
       variant_drives_fachete = EXISTS (
         SELECT 1 FROM variant_mains m
          JOIN fachete_group fg ON fg.sheet_id = ts.id
          WHERE m.reference_id = ts.id
            AND m.gname = fg.gname
            AND m.gname <> '')
 WHERE EXISTS (SELECT 1 FROM variant_mains m WHERE m.reference_id = ts.id);

-- EC23 à mão (decidido no grill): a ficha está em NAPA SUDANI e a única
-- variante é NAPA SOFT, então a regra acima não acha sinal nenhum — foi
-- exatamente esse silêncio que deixou 600 pares saírem na napa errada.
UPDATE public.technical_sheets
   SET variant_drives_lining = true
 WHERE upper(btrim(name)) = 'EC23'
   AND EXISTS (SELECT 1 FROM public.reference_material_variants v
                WHERE v.reference_id = technical_sheets.id);

-- ── 4. Resolvers com o material principal na cascata ────────────────────────
-- Além do fallback novo, corrige um furo LATENTE: o caminho `variant_group`
-- carimbava 'variant_group' por cima do matched_by de resolve_material_product,
-- ENGOLINDO o 'color_mismatch'. Com isso uma cor não cadastrada dentro do grupo
-- da variante era debitada como se estivesse certa, em vez de ser pulada por
-- hybrid_debit_stock_for_order.

CREATE OR REPLACE FUNCTION public.resolve_upper_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric,
  p_sheet_pin_product_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pid uuid; v_gid uuid; v_main uuid; v_drives boolean; v_gname text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.upper_material_product_id, v.upper_material_group_id,
           v.main_material_group_id, COALESCE(ts.variant_drives_upper, false)
      INTO v_pid, v_gid, v_main, v_drives
      FROM public.reference_material_variants v
      LEFT JOIN public.technical_sheets ts ON ts.id = v.reference_id
     WHERE v.id = p_variant_id;

    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p WHERE p.id = v_pid AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;

    IF v_gid IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_gid;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch' THEN r.matched_by ELSE 'variant_group' END
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;

    -- Material PRINCIPAL: só quando a ficha liberou este slot.
    IF v_drives AND v_main IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_main;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch' THEN r.matched_by ELSE 'variant_main' END
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;
  END IF;

  IF p_sheet_pin_product_id IS NOT NULL THEN
    RETURN QUERY SELECT p.id, p.name, p.quantity, 'sheet_pin'::text
      FROM public.products p WHERE p.id = p_sheet_pin_product_id AND p.active = true;
    IF FOUND THEN RETURN; END IF;
  END IF;

  RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(p_group_name, p_color, p_required, false) r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_lining_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric,
  p_sheet_pin_product_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pid uuid; v_gid uuid; v_main uuid; v_drives boolean; v_gname text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.lining_material_product_id, v.lining_material_group_id,
           v.main_material_group_id, COALESCE(ts.variant_drives_lining, false)
      INTO v_pid, v_gid, v_main, v_drives
      FROM public.reference_material_variants v
      LEFT JOIN public.technical_sheets ts ON ts.id = v.reference_id
     WHERE v.id = p_variant_id;

    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p WHERE p.id = v_pid AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;

    IF v_gid IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_gid;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch' THEN r.matched_by ELSE 'variant_group' END
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;

    IF v_drives AND v_main IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_main;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch' THEN r.matched_by ELSE 'variant_main' END
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;
  END IF;

  IF p_sheet_pin_product_id IS NOT NULL THEN
    RETURN QUERY SELECT p.id, p.name, p.quantity, 'sheet_pin'::text
      FROM public.products p WHERE p.id = p_sheet_pin_product_id AND p.active = true;
    IF FOUND THEN RETURN; END IF;
  END IF;

  RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(p_group_name, p_color, p_required, false) r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pid uuid; v_gid uuid; v_main uuid; v_drives boolean; v_gname text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.insole_material_product_id, v.insole_material_group_id,
           v.main_material_group_id, COALESCE(ts.variant_drives_insole, false)
      INTO v_pid, v_gid, v_main, v_drives
      FROM public.reference_material_variants v
      LEFT JOIN public.technical_sheets ts ON ts.id = v.reference_id
     WHERE v.id = p_variant_id;

    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p WHERE p.id = v_pid AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;

    IF v_gid IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_gid;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch' THEN r.matched_by ELSE 'variant_group' END
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;

    IF v_drives AND v_main IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_main;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch' THEN r.matched_by ELSE 'variant_main' END
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(p_group_name, p_color, p_required, false) r;
END;
$function$;

-- ── 5. Fachete (forração do salto) ──────────────────────────────────────────
-- Hoje o grupo vem de products.fachete_material_group_id do SOLADO (fallback
-- lining_material da ficha) e chama resolve_material_product DIRETO, sem passar
-- pela variante — ST15 sai NAPA SOFT mesmo vendendo a variante GLOW METALIC.

CREATE OR REPLACE FUNCTION public.resolve_fachete_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_main uuid; v_drives boolean; v_gname text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.main_material_group_id, COALESCE(ts.variant_drives_fachete, false)
      INTO v_main, v_drives
      FROM public.reference_material_variants v
      LEFT JOIN public.technical_sheets ts ON ts.id = v.reference_id
     WHERE v.id = p_variant_id;

    IF v_drives AND v_main IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_main;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch' THEN r.matched_by ELSE 'variant_main' END
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(p_group_name, p_color, p_required, false) r;
END;
$function$;

-- Injeta o resolver acima em calculate_order_consumption_by_grade sem
-- transcrever os ~47k caracteres da função (o que seria a via mais provável de
-- introduzir erro). Falha ALTO se o alvo não existir — nunca silenciosamente.
DO $patch$
DECLARE v_src text; v_new text; v_target text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_order_consumption_by_grade'
     AND pg_get_function_identity_arguments(p.oid) = 'p_reference_id uuid, p_grade jsonb, p_color text, p_material_variant_id uuid';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade(uuid,jsonb,text,uuid) não encontrada';
  END IF;

  v_target := 'SELECT * INTO v_resolved FROM resolve_material_product(v_fachete_group, p_color, 0, false);';
  IF position(v_target IN v_src) = 0 THEN
    RAISE EXCEPTION 'Chamada do fachete não encontrada em calculate_order_consumption_by_grade — a função mudou; revisar o patch antes de aplicar.';
  END IF;

  v_new := replace(v_src, v_target,
    'SELECT * INTO v_resolved FROM resolve_fachete_material_for_variant(p_material_variant_id, v_fachete_group, p_color, 0);');

  IF v_new = v_src THEN
    RAISE EXCEPTION 'Patch do fachete não alterou nada';
  END IF;

  EXECUTE v_new;
END
$patch$;

-- ── 6. Tira artesanal: material principal na cascata ────────────────────────
-- A sobrecarga de 2 args (mig 20261026120000) já prefere os grupos da variante;
-- aqui o material principal entra logo depois deles e antes da ficha.

CREATE OR REPLACE FUNCTION public.strap_base_family_for_sheet(p_reference_id uuid, p_variant_id uuid)
 RETURNS text
 LANGUAGE sql STABLE SET search_path TO 'public, extensions'
AS $function$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id,
           rmv.main_material_group_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_variant_id
       AND COALESCE(rmv.active, true)
       -- Variante tem que ser DESTA ficha: variante orfa nao pode ditar familia.
       AND (p_reference_id IS NULL OR rmv.reference_id = p_reference_id)
     LIMIT 1
  )
  SELECT COALESCE(
    -- 1) Cabedal da variante (grupo, depois o pin legado de produto)
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.product_groups g ON g.id = v.upper_material_group_id),
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.products p       ON p.id = v.upper_material_product_id
              JOIN public.product_groups g ON g.id = p.group_id),
    -- 2) Forracao da variante (modelo so de tiras cai aqui)
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.product_groups g ON g.id = v.lining_material_group_id),
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.products p       ON p.id = v.lining_material_product_id
              JOIN public.product_groups g ON g.id = p.group_id),
    -- 3) Material PRINCIPAL da variante (mig 20261027120000): a variante que
    --    não pinou slot nenhum ainda diz de qual napa a tira sai.
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.product_groups g ON g.id = v.main_material_group_id),
    -- 4) Ficha: comportamento historico, preservado intacto
    (SELECT NULLIF(btrim(ts.upper_material), '')
       FROM public.technical_sheets ts WHERE ts.id = p_reference_id),
    (SELECT NULLIF(btrim(ts.lining_material), '')
       FROM public.technical_sheets ts WHERE ts.id = p_reference_id)
  );
$function$;

-- ── 7. Custo do PV re-suja quando o material principal/trava mudar ──────────
-- tg_mark_so_costs_dirty_from_variant já cobre reference_material_variants; a
-- trava mora na ficha, e mark_pv_costs_dirty_for_sheet já é disparado por
-- UPDATE em technical_sheets, então nada novo a ligar aqui.
