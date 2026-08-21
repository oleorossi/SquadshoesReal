-- =============================================================================
-- "Material da ficha" vale como escolha também no BANCO
-- =============================================================================
-- Regra do dono (21/08/2026): cadastrar variante de material NAO substitui o
-- material principal da ficha — e mais uma opcao no pedido de venda.
--
-- O front ja foi corrigido em duas etapas hoje: o seletor passou a oferecer o
-- material da propria ficha (grava material_variant_id = NULL) e a validacao de
-- salvamento passou a aceitar essa escolha. Faltava a terceira guarda, no banco:
-- `enforce_sale_order_item_material_variant` recusa NULL sempre que a referencia
-- tem QUALQUER variante ativa, e por isso o PV ainda parava com
--
--   'Selecione a variação de material desta referência antes de salvar o item.'
--
-- na SR02 — cuja unica variante e GLOW METALIC, enquanto forro e material
-- principal da ficha sao NAPA SOFT.
--
-- ⚠ Esta e a MESMA regra que ja existe em TS (src/lib/materialVariantColorGroup.ts).
-- Duplicar regra e ruim, mas aqui e inevitavel: a guarda do banco precisa decidir
-- sozinha, sem confiar no cliente — e justamente por ser a ultima linha de
-- defesa. As duas implementacoes ficam travadas por teste de contrato
-- (saleOrderSheetMaterialOptionContract.test.ts) para nao divergirem em silencio.
--
-- O que NAO muda: referencia cuja familia da ficha JA e vendavel por uma
-- variante continua exigindo a escolha. Sao 27 das 30 referencias com variante,
-- que cadastraram uma variante repetindo o material da ficha como contorno deste
-- bug e carregam SKU proprio (25 com NCM, 1 ja usada em PV). Deixar NULL passar
-- nelas venderia o mesmo material sem o SKU — indistinguivel na tela.

BEGIN;

-- Espelha resolveSheetCommercialColorGroup: cabedal por UUID, senao cabedal por
-- NOME, senao forracao por nome (ficha de tiras usa a napa da forracao como
-- material-base). Sempre UM grupo exato — nunca uniao de familias.
CREATE OR REPLACE FUNCTION public.sheet_commercial_color_group_id(p_reference_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT g.id FROM public.product_groups g
      JOIN public.technical_sheets ts ON ts.id = p_reference_id
     WHERE g.id = ts.upper_material_group_id),
    (SELECT g.id FROM public.product_groups g
      JOIN public.technical_sheets ts ON ts.id = p_reference_id
     WHERE lower(btrim(g.name)) = lower(btrim(nullif(btrim(ts.upper_material), '')))
     LIMIT 1),
    (SELECT g.id FROM public.product_groups g
      JOIN public.technical_sheets ts ON ts.id = p_reference_id
     WHERE lower(btrim(g.name)) = lower(btrim(nullif(btrim(ts.lining_material), '')))
     LIMIT 1)
  );
$$;

-- Espelha resolveMaterialVariantColorGroup: pino de cabedal > grupo de cabedal >
-- (ficha delega cabedal ? principal) > pino de forro > grupo de forro >
-- (ficha delega forro ? principal).
CREATE OR REPLACE FUNCTION public.material_variant_color_group_id(p_variant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.group_id FROM public.products p WHERE p.id = v.upper_material_product_id),
    v.upper_material_group_id,
    CASE WHEN COALESCE(ts.variant_drives_upper, false) THEN v.main_material_group_id END,
    (SELECT p.group_id FROM public.products p WHERE p.id = v.lining_material_product_id),
    v.lining_material_group_id,
    CASE WHEN COALESCE(ts.variant_drives_lining, false) THEN v.main_material_group_id END
  )
  FROM public.reference_material_variants v
  LEFT JOIN public.technical_sheets ts ON ts.id = v.reference_id
  WHERE v.id = p_variant_id;
$$;

-- O material da ficha esta oferecido como opcao no PV desta referencia?
-- (= existe familia da ficha E nenhuma variante ativa resolve para ela)
CREATE OR REPLACE FUNCTION public.sheet_material_is_selectable(p_reference_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v_base.id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.reference_material_variants rmv
        WHERE rmv.reference_id = p_reference_id
          AND rmv.active
          AND public.material_variant_color_group_id(rmv.id) = v_base.id
     )
  FROM (SELECT public.sheet_commercial_color_group_id(p_reference_id) AS id) v_base;
$$;

REVOKE ALL ON FUNCTION public.sheet_commercial_color_group_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.material_variant_color_group_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sheet_material_is_selectable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sheet_commercial_color_group_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.material_variant_color_group_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sheet_material_is_selectable(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.sheet_material_is_selectable(uuid) IS
  'Verdadeiro quando o material da propria ficha e oferecido como opcao no PV — ou seja, quando material_variant_id NULL e escolha, nao ausencia de escolha. Espelha resolveMaterialVariantColorGroup/resolveSheetCommercialColorGroup do front.';

CREATE OR REPLACE FUNCTION public.enforce_sale_order_item_material_variant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_variant_reference_id uuid;
  v_variant_active boolean;
BEGIN
  -- Não reabre histórico só porque outro campo do item foi editado.
  IF TG_OP = 'UPDATE'
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.material_variant_id IS NOT DISTINCT FROM OLD.material_variant_id THEN
    RETURN NEW;
  END IF;

  IF NEW.material_variant_id IS NULL THEN
    -- NULL deixa de ser "sem escolha" quando o material da propria ficha esta
    -- oferecido no seletor: ali NULL E a escolha "material da ficha", e todos os
    -- resolvers estruturais ja a tratam (p_variant_id NULL cai na ficha).
    IF public.sheet_material_is_selectable(NEW.reference_id) THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.reference_material_variants rmv
      WHERE rmv.reference_id = NEW.reference_id
        AND rmv.active
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Selecione a variação de material desta referência antes de salvar o item.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT rmv.reference_id, rmv.active
    INTO v_variant_reference_id, v_variant_active
  FROM public.reference_material_variants rmv
  WHERE rmv.id = NEW.material_variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Variação de material não encontrada.';
  END IF;
  IF v_variant_reference_id IS DISTINCT FROM NEW.reference_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A variação de material pertence a outra referência.';
  END IF;
  IF NOT v_variant_active THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A variação de material selecionada está inativa.';
  END IF;

  RETURN NEW;
END;
$$;

DO $assertions$
DECLARE
  v_sr02 uuid;
  v_liberadas integer;
  v_ainda_exigem integer;
BEGIN
  SELECT id INTO v_sr02 FROM public.technical_sheets WHERE upper(name) = 'SR02' LIMIT 1;
  IF v_sr02 IS NULL THEN
    RAISE EXCEPTION 'SR02 nao encontrada — a assercao precisa do caso que originou o fix';
  END IF;
  IF NOT public.sheet_material_is_selectable(v_sr02) THEN
    RAISE EXCEPTION 'SR02 deveria aceitar o material da ficha (NAPA SOFT) como escolha';
  END IF;

  -- As referencias cuja familia da ficha ja e coberta por variante continuam
  -- exigindo a escolha. Se este numero cair pra zero, a guarda virou no-op.
  SELECT count(*) INTO v_ainda_exigem
    FROM (SELECT DISTINCT rmv.reference_id FROM public.reference_material_variants rmv
           WHERE rmv.active) r
   WHERE NOT public.sheet_material_is_selectable(r.reference_id);
  IF v_ainda_exigem = 0 THEN
    RAISE EXCEPTION 'Nenhuma referencia continua exigindo variante — a guarda foi anulada';
  END IF;

  SELECT count(*) INTO v_liberadas
    FROM (SELECT DISTINCT rmv.reference_id FROM public.reference_material_variants rmv
           WHERE rmv.active) r
   WHERE public.sheet_material_is_selectable(r.reference_id);
  RAISE NOTICE 'referencias que passam a aceitar o material da ficha: %; que continuam exigindo variante: %',
    v_liberadas, v_ainda_exigem;
END;
$assertions$;

COMMIT;
