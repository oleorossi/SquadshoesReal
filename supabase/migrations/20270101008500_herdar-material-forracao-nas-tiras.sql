-- =============================================================================
-- Tiras sem cabedal herdam o material da Forracao
-- =============================================================================
-- Regra do produto (23/08/2026): quando a ficha e um modelo de tiras e nao
-- possui cabedal, a Forracao e o material principal da referencia. Linhas de
-- tira `reference_base` devem usar essa mesma familia de napa.
--
-- O motor operacional continua UUID-only. A traducao controlada do nome legado
-- acontece somente na escrita da ficha e materializa o UUID ja existente em
-- `technical_sheets.strap_base_group_id`; nenhum preview, reserva ou debito
-- passa a procurar grupo por texto.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_reference_base boolean := false;
  v_lining_group_id uuid;
BEGIN
  -- Fora do caso de negocio desta regra, preserva a identidade ja existente.
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

  -- Tira comprada pronta tem grupo proprio e nao consome a napa da referencia.
  IF NOT v_has_reference_base THEN
    NEW.strap_base_group_id := NULL;
    RETURN NEW;
  END IF;

  -- Pin de produto da Forracao vence o nome do grupo. O fallback textual e
  -- exato e inequivoco pelo indice unico lower(trim(product_groups.name)).
  SELECT coalesce(
    (SELECT p.group_id
       FROM public.products p
      WHERE p.id = NEW.lining_material_product_id),
    (SELECT g.id
       FROM public.product_groups g
      WHERE lower(btrim(g.name)) = nullif(lower(btrim(NEW.lining_material)), ''))
  )
  INTO v_lining_group_id;

  -- NULL tambem e uma decisao: se a Forracao foi apagada ou nao resolve mais,
  -- nunca conserva silenciosamente uma napa-base antiga e divergente.
  NEW.strap_base_group_id := v_lining_group_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining()
  FROM PUBLIC, anon, authenticated;

-- O guard manual de strap_base_group_id se chama `trg_guard_*` e roda antes
-- destes triggers em ordem alfabetica. Assim, INSERT enviado pelo cliente so
-- passa se vier sem pin manual; a derivacao server-owned acontece em seguida.
-- Em UPDATE de Forracao/tiras, o guard de `UPDATE OF strap_base_group_id` nao e
-- agendado. Uma tentativa direta de editar a coluna continua protegida.
DROP TRIGGER IF EXISTS trg_sync_technical_sheet_strap_base_from_lining_insert
  ON public.technical_sheets;
CREATE TRIGGER trg_sync_technical_sheet_strap_base_from_lining_insert
BEFORE INSERT ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining();

DROP TRIGGER IF EXISTS trg_sync_technical_sheet_strap_base_from_lining_update
  ON public.technical_sheets;
CREATE TRIGGER trg_sync_technical_sheet_strap_base_from_lining_update
BEFORE UPDATE OF
  has_straps,
  strap_colors,
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  lining_material,
  lining_material_product_id
ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining();

COMMENT ON FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining() IS
  'Materializa strap_base_group_id pela Forracao em modelo de tiras sem cabedal; linhas compradas prontas ficam sem napa-base da referencia.';

-- A variante deve seguir a mesma Forracao efetiva. Em modelo de tiras sem
-- cabedal, um material principal da variante so troca a base se a ficha marcou
-- `variant_drives_lining`; pins proprios do slot de Forracao continuam vencendo.
CREATE OR REPLACE FUNCTION public.resolve_strap_base_group_id(
  p_reference_id uuid,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id,
           rmv.main_material_group_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_material_variant_id
       AND rmv.reference_id = p_reference_id
       AND coalesce(rmv.active, true)
  ), s AS (
    SELECT ts.has_straps,
           ts.upper_material,
           ts.upper_material_group_id,
           ts.strap_base_group_id,
           ts.upper_material_product_id,
           ts.lining_material_product_id,
           ts.variant_drives_lining,
           coalesce(ts.has_straps, false)
             AND nullif(btrim(ts.upper_material), '') IS NULL
             AND ts.upper_material_group_id IS NULL
             AND ts.upper_material_product_id IS NULL AS straps_follow_lining
      FROM public.technical_sheets ts
     WHERE ts.id = p_reference_id
  )
  SELECT CASE
    WHEN s.straps_follow_lining THEN coalesce(
      variant_lining_product.group_id,
      v.lining_material_group_id,
      CASE WHEN coalesce(s.variant_drives_lining, false)
        THEN v.main_material_group_id END,
      sheet_lining_product.group_id,
      s.strap_base_group_id
    )
    ELSE coalesce(
      variant_upper_product.group_id,
      v.upper_material_group_id,
      variant_lining_product.group_id,
      v.lining_material_group_id,
      v.main_material_group_id,
      sheet_upper_product.group_id,
      s.upper_material_group_id,
      s.strap_base_group_id,
      sheet_lining_product.group_id
    )
  END
  FROM s
  LEFT JOIN v ON true
  LEFT JOIN public.products variant_upper_product
    ON variant_upper_product.id = v.upper_material_product_id
  LEFT JOIN public.products variant_lining_product
    ON variant_lining_product.id = v.lining_material_product_id
  LEFT JOIN public.products sheet_upper_product
    ON sheet_upper_product.id = s.upper_material_product_id
  LEFT JOIN public.products sheet_lining_product
    ON sheet_lining_product.id = s.lining_material_product_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid) IS
  'Resolve napa-base somente por UUID. Em tiras sem cabedal, espelha a Forracao efetiva: pin/grupo do slot da variante > principal se variant_drives_lining > pin/base derivada da ficha.';

-- Repassa as fichas existentes pelo mesmo trigger. Atualizar uma coluna-fonte
-- (sem mudar seu valor) aciona a derivacao server-owned sem abrir a coluna
-- protegida para escrita direta. Demandas/reservas congeladas nao sao
-- reescritas; fichas efetivamente corrigidas invalidam custos abertos pelo
-- trigger normal de dirty-cost.
UPDATE public.technical_sheets ts
   SET lining_material = ts.lining_material
 WHERE coalesce(ts.has_straps, false)
   AND nullif(btrim(ts.upper_material), '') IS NULL
   AND ts.upper_material_group_id IS NULL
   AND ts.upper_material_product_id IS NULL
   -- A migration ja pode ter sido aplicada via MCP com outra versao no
   -- historico. O db push futuro deve ser um no-op nas fichas alinhadas, sem
   -- tocar updated_at nem invalidar novamente custos/snapshots.
   AND ts.strap_base_group_id IS DISTINCT FROM coalesce(
     (SELECT p.group_id
        FROM public.products p
       WHERE p.id = ts.lining_material_product_id),
     (SELECT g.id
        FROM public.product_groups g
       WHERE lower(btrim(g.name)) = nullif(lower(btrim(ts.lining_material)), ''))
   )
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(coalesce(ts.strap_colors, '[]'::jsonb)) = 'array'
             THEN coalesce(ts.strap_colors, '[]'::jsonb)
           ELSE '[]'::jsonb
         END
       ) AS line(value)
      WHERE coalesce(
        nullif(btrim(line.value ->> 'identity_basis'), ''),
        'reference_base'
      ) = 'reference_base'
   );

-- Se todas as tiras sao produtos acabados, a ficha nao deve carregar uma napa
-- de referencia residual.
UPDATE public.technical_sheets ts
   SET strap_colors = ts.strap_colors
 WHERE coalesce(ts.has_straps, false)
   AND nullif(btrim(ts.upper_material), '') IS NULL
   AND ts.upper_material_group_id IS NULL
   AND ts.upper_material_product_id IS NULL
   AND ts.strap_base_group_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(coalesce(ts.strap_colors, '[]'::jsonb)) = 'array'
             THEN coalesce(ts.strap_colors, '[]'::jsonb)
           ELSE '[]'::jsonb
         END
       ) AS line(value)
      WHERE coalesce(
        nullif(btrim(line.value ->> 'identity_basis'), ''),
        'reference_base'
      ) = 'reference_base'
   );

-- Falha fechada se uma Forracao resolvivel nao tiver sido materializada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.technical_sheets ts
      JOIN public.product_groups g
        ON g.id = coalesce(
          (SELECT p.group_id
             FROM public.products p
            WHERE p.id = ts.lining_material_product_id),
          (SELECT named.id
             FROM public.product_groups named
            WHERE lower(btrim(named.name)) = nullif(lower(btrim(ts.lining_material)), ''))
        )
     WHERE coalesce(ts.has_straps, false)
       AND nullif(btrim(ts.upper_material), '') IS NULL
       AND ts.upper_material_group_id IS NULL
       AND ts.upper_material_product_id IS NULL
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(coalesce(ts.strap_colors, '[]'::jsonb)) = 'array'
                 THEN coalesce(ts.strap_colors, '[]'::jsonb)
               ELSE '[]'::jsonb
             END
           ) AS line(value)
          WHERE coalesce(
            nullif(btrim(line.value ->> 'identity_basis'), ''),
            'reference_base'
          ) = 'reference_base'
       )
       AND ts.strap_base_group_id IS DISTINCT FROM g.id
  ) THEN
    RAISE EXCEPTION
      'Falha ao sincronizar a napa-base das tiras com o grupo da Forracao';
  END IF;
END;
$$;

COMMIT;
