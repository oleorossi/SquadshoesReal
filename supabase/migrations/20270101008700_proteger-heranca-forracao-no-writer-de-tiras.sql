-- =============================================================================
-- Fecha o writer administrativo sobre a heranca Forracao -> tiras
-- =============================================================================
-- `resolve_technical_strap_context_from_sale_order` possui permissao oficial
-- para atualizar `strap_base_group_id`. Antes desta migration, esse UPDATE
-- passava pelo guard, mas nao pelo trigger derivado da 08500, pois a coluna
-- protegida nao fazia parte do evento dele. Assim o drawer poderia persistir
-- uma napa diferente da Forracao em uma sandalia sem cabedal.
--
-- A ordem alfabetica fica guard -> reject -> sync: primeiro valida capability
-- + motivo, depois rejeita um UUID divergente informado pelo writer e, por
-- ultimo, a derivacao server-owned consolida o UUID da Forracao.

BEGIN;

-- Um writer privilegiado ainda deve informar o valor coerente. Rejeitar a
-- divergencia antes da sincronizacao evita que a RPC registre no audit/retorno
-- um UUID solicitado enquanto o BEFORE seguinte persiste outro silenciosamente.
CREATE OR REPLACE FUNCTION public.tg_validate_technical_sheet_strap_base_from_lining()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_reference_base boolean := false;
  v_expected_group_id uuid;
BEGIN
  IF NOT coalesce(NEW.has_straps, false)
     OR nullif(btrim(NEW.upper_material), '') IS NOT NULL
     OR NEW.upper_material_group_id IS NOT NULL
     OR NEW.upper_material_product_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(coalesce(NEW.strap_colors, '[]'::jsonb)) = 'array'
            THEN coalesce(NEW.strap_colors, '[]'::jsonb)
          ELSE '[]'::jsonb
        END
      ) AS line(value)
     WHERE coalesce(
       nullif(btrim(line.value ->> 'identity_basis'), ''),
       'reference_base'
     ) = 'reference_base'
  ) INTO v_has_reference_base;

  IF v_has_reference_base THEN
    SELECT coalesce(
      (SELECT p.group_id
         FROM public.products p
        WHERE p.id = NEW.lining_material_product_id),
      (SELECT g.id
         FROM public.product_groups g
        WHERE lower(btrim(g.name)) = nullif(lower(btrim(NEW.lining_material)), ''))
    ) INTO v_expected_group_id;
  ELSE
    v_expected_group_id := NULL;
  END IF;

  IF NEW.strap_base_group_id IS DISTINCT FROM v_expected_group_id THEN
    RAISE EXCEPTION
      'A napa-base das tiras deve ser o mesmo grupo da Forracao nesta ficha sem cabedal';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_validate_technical_sheet_strap_base_from_lining()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reject_divergent_strap_base_from_lining_update
  ON public.technical_sheets;

CREATE TRIGGER trg_reject_divergent_strap_base_from_lining_update
BEFORE UPDATE OF strap_base_group_id ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.tg_validate_technical_sheet_strap_base_from_lining();

DROP TRIGGER IF EXISTS trg_sync_technical_sheet_strap_base_from_lining_update
  ON public.technical_sheets;

CREATE TRIGGER trg_sync_technical_sheet_strap_base_from_lining_update
BEFORE UPDATE OF
  has_straps,
  strap_colors,
  strap_base_group_id,
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  lining_material,
  lining_material_product_id
ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining();

COMMENT ON TRIGGER trg_sync_technical_sheet_strap_base_from_lining_update
  ON public.technical_sheets IS
  'Autoridade final da napa-base: inclusive writers administrativos seguem a Forracao em modelos de tiras sem cabedal.';

-- O resolvedor da tira passou a depender também destas duas colunas. Um
-- BEFORE trigger alterar NEW.strap_base_group_id não agenda um trigger
-- `UPDATE OF strap_base_group_id` quando a coluna não estava na target list
-- original; portanto elas precisam constar explicitamente na malha de dirty.
DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sheet
  ON public.technical_sheets;

CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet
AFTER UPDATE OF
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  upper_consumption,
  upper_consumption_per_size,
  lining_material,
  lining_material_product_id,
  lining_consumption,
  insole_material,
  insole_consumption,
  sole_material,
  sole_consumption,
  components_accessories,
  lining_accessories,
  direct_components,
  custom_overhead,
  has_straps,
  strap_colors,
  assembly_time_minutes,
  sole_group_id,
  insole_ready_made,
  sole_drives_consumption,
  strap_base_group_id,
  variant_drives_lining
ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet();

COMMIT;
