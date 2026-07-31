-- Remove a trava `variant_drives_insole` — cascata inválida por construção
-- ============================================================================
-- A mig 20261027120000 criou uma trava por componente pra cada slot. A da
-- PALMILHA nasceu morta e é a única que não pode existir:
--
--   • O slot de palmilha resolve `technical_sheets.insole_material`, que é o
--     grupo da PLACA (EVA). Não é napa.
--   • O "material principal" da variante é escolhido entre grupos do setor
--     Cabedal (o diálogo lista `cabedalGroups`) — é sempre napa.
--   • Logo, cascatear o material principal pro slot de palmilha trocaria a placa
--     de EVA por napa. Nunca é o comportamento certo.
--
-- O caso legítimo — "esta variante usa outra placa" — já é coberto pelo pino
-- `reference_material_variants.insole_material_group_id`, que continua valendo e
-- vence tudo.
--
-- Deixar a flag pendurada (sempre false, sem UI) seria um gatilho silencioso: um
-- UPDATE manual no banco passaria a debitar napa no lugar da placa, sem nada na
-- tela indicando por quê. Verificado antes de remover: 0 fichas com a flag ligada.

CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pid uuid; v_gid uuid; v_gname text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.insole_material_product_id, v.insole_material_group_id
      INTO v_pid, v_gid
      FROM public.reference_material_variants v
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
    -- Sem fallback pro material principal, de propósito (ver cabeçalho).
  END IF;

  RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(p_group_name, p_color, p_required, false) r;
END;
$function$;

ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS variant_drives_insole;
