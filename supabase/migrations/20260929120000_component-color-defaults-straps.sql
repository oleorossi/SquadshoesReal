-- =============================================================================
-- 20260929120000 — Tiras: padrão global grupo+cor com PRIORIDADE 0
-- =============================================================================
-- Depende da 20260928120000 (tabela component_color_defaults).
--
-- Problema que resolve: a cascata de tiras (exato em products.color → produto
-- genérico sem cor → RAISE/aviso) usa LIMIT 1 SEM ordering no match exato.
-- Grupo com 2+ SKUs da MESMA cor (ex.: TIRA STRASS 6MM "preto fundo preto" ×
-- "preto fundo transparente") resolvia ARBITRARIAMENTE. Com a regra global,
-- "Preta" resolve determinístico pro SKU padrão da fábrica, em QUALQUER modelo.
--
-- Prioridade nova (inserida ANTES do match exato, em paridade nos 3 pontos SQL
-- e nos espelhos TS strapShortages.ts / orderConsumption.ts / bomConsumption.ts):
--   0. component_color_defaults (grupo da tira + cor exata > is_default),
--      produto da regra precisa estar ATIVO e DENTRO do grupo (blinda regra
--      apontando produto de outro grupo — check ccd_produto_fora_do_grupo).
--   1. match exato em products.color (unaccent) — como hoje.
--   2. produto genérico sem cor — como hoje.
--   3. RAISE (débito) / linha de aviso (needs/availability) — como hoje.
--
-- Patch de texto sobre pg_get_functiondef vivo (mesma razão da 20260918120000);
-- âncoras conferidas contra o banco em 2026-07-26. Idempotente por função.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. order_strap_needs (custeio / compras / MRP de tiras)
-- ────────────────────────────────────────────────────────────────────────────
DO $mig1$
DECLARE
  v_def text; v_new text; v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'order_strap_needs';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'order_strap_needs nao existe — migration fora de ordem';
  END IF;
  IF position('component_color_defaults' IN v_def) > 0 THEN
    RAISE NOTICE 'order_strap_needs ja consulta a regra global — nada a fazer.';
    RETURN;
  END IF;

  v_before := v_def;
  v_new := replace(v_def,
$a1$    v_color_norm := lower(trim(unaccent(v_color)));
    SELECT p.id, p.name INTO v_pid, v_pname FROM public.products p
     WHERE p.active = true AND p.group_id = v_group_id
       AND lower(trim(unaccent(p.color))) = v_color_norm LIMIT 1;$a1$,
$n1$    v_color_norm := lower(trim(unaccent(v_color)));
    -- Prioridade 0: padrão global grupo+cor (component_color_defaults, mig
    -- 20260928120000) — exata > default; produto da regra ativo e do grupo.
    SELECT p.id, p.name INTO v_pid, v_pname
      FROM public.component_color_defaults d
      JOIN public.products p ON p.id = d.product_id
     WHERE d.active = true AND d.group_id = v_group_id
       AND p.active = true AND p.group_id = v_group_id
       AND (d.is_default OR lower(trim(unaccent(d.cabedal_color))) = v_color_norm)
     ORDER BY d.is_default ASC, d.id LIMIT 1;
    IF v_pid IS NULL THEN
      SELECT p.id, p.name INTO v_pid, v_pname FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND lower(trim(unaccent(p.color))) = v_color_norm LIMIT 1;
    END IF;$n1$);
  IF v_new = v_before THEN RAISE EXCEPTION 'order_strap_needs: patch (prioridade 0) nao casou'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'order_strap_needs: regra global grupo+cor com prioridade 0.';
END
$mig1$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. debit_strap_stock (débito real — FOR UPDATE no SKU da regra)
-- ────────────────────────────────────────────────────────────────────────────
DO $mig2$
DECLARE
  v_def text; v_new text; v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'debit_strap_stock';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'debit_strap_stock nao existe — migration fora de ordem';
  END IF;
  IF position('component_color_defaults' IN v_def) > 0 THEN
    RAISE NOTICE 'debit_strap_stock ja consulta a regra global — nada a fazer.';
    RETURN;
  END IF;

  v_new := v_def;

  -- (1) DECLARE: v_rule_pid
  v_before := v_new;
  v_new := replace(v_new,
$a2$  v_warn text;
  v_warnings text[] := ARRAY[]::text[];
BEGIN$a2$,
$n2$  v_warn text;
  v_warnings text[] := ARRAY[]::text[];
  v_rule_pid uuid;
BEGIN$n2$);
  IF v_new = v_before THEN RAISE EXCEPTION 'debit_strap_stock: patch 1/2 (DECLARE) nao casou'; END IF;

  -- (2) prioridade 0 antes do match exato (re-SELECT FOR UPDATE no SKU da regra)
  v_before := v_new;
  v_new := replace(v_new,
$a3$    v_color_norm := lower(trim(unaccent(v_color)));

    SELECT p.id, p.name, p.quantity, p.color
    INTO v_product_id, v_product_name, v_current_qty, v_product_color
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND lower(trim(unaccent(p.color))) = v_color_norm
    LIMIT 1
    FOR UPDATE;$a3$,
$n3$    v_color_norm := lower(trim(unaccent(v_color)));

    -- Prioridade 0: padrão global grupo+cor (component_color_defaults, mig
    -- 20260928120000) — exata > default; produto da regra ativo e do grupo.
    SELECT d.product_id INTO v_rule_pid
      FROM public.component_color_defaults d
      JOIN public.products p ON p.id = d.product_id
     WHERE d.active = true AND d.group_id = v_group_id
       AND p.active = true AND p.group_id = v_group_id
       AND (d.is_default OR lower(trim(unaccent(d.cabedal_color))) = v_color_norm)
     ORDER BY d.is_default ASC, d.id LIMIT 1;

    IF v_rule_pid IS NOT NULL THEN
      SELECT p.id, p.name, p.quantity, p.color
      INTO v_product_id, v_product_name, v_current_qty, v_product_color
      FROM public.products p
      WHERE p.id = v_rule_pid
      LIMIT 1
      FOR UPDATE;
    ELSE
      SELECT p.id, p.name, p.quantity, p.color
      INTO v_product_id, v_product_name, v_current_qty, v_product_color
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND lower(trim(unaccent(p.color))) = v_color_norm
      LIMIT 1
      FOR UPDATE;
    END IF;$n3$);
  IF v_new = v_before THEN RAISE EXCEPTION 'debit_strap_stock: patch 2/2 (prioridade 0) nao casou'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'debit_strap_stock: regra global grupo+cor com prioridade 0.';
END
$mig2$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. check_stock_availability (badge de disponibilidade / auto-OC)
-- ────────────────────────────────────────────────────────────────────────────
DO $mig3$
DECLARE
  v_def text; v_new text; v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_stock_availability';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'check_stock_availability nao existe — migration fora de ordem';
  END IF;
  IF position('component_color_defaults' IN v_def) > 0 THEN
    RAISE NOTICE 'check_stock_availability ja consulta a regra global — nada a fazer.';
    RETURN;
  END IF;

  v_before := v_def;
  v_new := replace(v_def,
$a4$    v_color_norm := lower(trim(extensions.unaccent(v_color)));

    SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
      INTO v_target_id, v_target_name, v_target_qty
      FROM public.products p
     WHERE p.active = true AND p.group_id = v_group_id
       AND lower(trim(extensions.unaccent(p.color))) = v_color_norm
     LIMIT 1;$a4$,
$n4$    v_color_norm := lower(trim(extensions.unaccent(v_color)));

    -- Prioridade 0: padrão global grupo+cor (component_color_defaults, mig
    -- 20260928120000) — exata > default; produto da regra ativo e do grupo.
    SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
      INTO v_target_id, v_target_name, v_target_qty
      FROM public.component_color_defaults d
      JOIN public.products p ON p.id = d.product_id
     WHERE d.active = true AND d.group_id = v_group_id
       AND p.active = true AND p.group_id = v_group_id
       AND (d.is_default OR lower(trim(extensions.unaccent(d.cabedal_color))) = v_color_norm)
     ORDER BY d.is_default ASC, d.id
     LIMIT 1;
    IF v_target_id IS NULL THEN
      SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
        INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND lower(trim(extensions.unaccent(p.color))) = v_color_norm
       LIMIT 1;
    END IF;$n4$);
  IF v_new = v_before THEN RAISE EXCEPTION 'check_stock_availability: patch (prioridade 0) nao casou'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'check_stock_availability: regra global grupo+cor com prioridade 0.';
END
$mig3$;
