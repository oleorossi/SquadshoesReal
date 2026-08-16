BEGIN;

-- As três variantes abaixo pertencem à ficha I91, mas herdaram por cópia os
-- SKUs I90I-* usados pela ficha I100. O diagnóstico de 2026-08-16 comprovou
-- que estes três UUIDs da I91 não possuem PV, OP nem BOM específico.
DO $fix_i91_variant_skus$
DECLARE
  v_locked_count integer;
  v_updated_count integer;
BEGIN
  PERFORM 1
  FROM public.reference_material_variants v
  JOIN public.technical_sheets ts ON ts.id = v.reference_id
  JOIN (VALUES
    ('75f6fcfb-7e61-42d8-ace3-0fd566cc9be3'::uuid, 'I90I-GM'::text, 'I91-GM'::text),
    ('519826f3-6a67-4f89-a401-22c924900ac6'::uuid, 'I90I-NS'::text, 'I91-NS'::text),
    ('51eddc5f-b58c-4fe3-b6e3-12308069589b'::uuid, 'I90I-SD'::text, 'I91-SD'::text)
  ) expected(id, old_sku, new_sku) ON expected.id = v.id
  WHERE v.reference_id = 'dc553ff7-db5c-4ee5-83b9-e78469d2c0d7'::uuid
    AND btrim(COALESCE(ts.name, '')) = 'I91'
    AND btrim(COALESCE(ts.code, '')) = 'I90I'
    AND btrim(COALESCE(v.sku, '')) = expected.old_sku
    AND v.active
  ORDER BY v.id
  FOR UPDATE OF v;

  GET DIAGNOSTICS v_locked_count = ROW_COUNT;
  IF v_locked_count <> 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = format(
        'Correção I91 recusada: esperava travar 3 variantes exatas; encontrei %s.',
        v_locked_count
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sale_order_items soi
    WHERE soi.material_variant_id IN (
      '75f6fcfb-7e61-42d8-ace3-0fd566cc9be3'::uuid,
      '519826f3-6a67-4f89-a401-22c924900ac6'::uuid,
      '51eddc5f-b58c-4fe3-b6e3-12308069589b'::uuid
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.sheet_materials sm
    WHERE sm.material_variant_id IN (
      '75f6fcfb-7e61-42d8-ace3-0fd566cc9be3'::uuid,
      '519826f3-6a67-4f89-a401-22c924900ac6'::uuid,
      '51eddc5f-b58c-4fe3-b6e3-12308069589b'::uuid
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Correção I91 recusada: uma variante passou a ter vínculo operacional.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reference_material_variants v
    WHERE lower(btrim(v.sku)) IN ('i91-gm', 'i91-ns', 'i91-sd')
      AND v.id NOT IN (
        '75f6fcfb-7e61-42d8-ace3-0fd566cc9be3'::uuid,
        '519826f3-6a67-4f89-a401-22c924900ac6'::uuid,
        '51eddc5f-b58c-4fe3-b6e3-12308069589b'::uuid
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Correção I91 recusada: um dos novos SKUs já existe.';
  END IF;

  UPDATE public.reference_material_variants v
     SET sku = expected.new_sku,
         updated_at = clock_timestamp()
  FROM (VALUES
    ('75f6fcfb-7e61-42d8-ace3-0fd566cc9be3'::uuid, 'I90I-GM'::text, 'I91-GM'::text),
    ('519826f3-6a67-4f89-a401-22c924900ac6'::uuid, 'I90I-NS'::text, 'I91-NS'::text),
    ('51eddc5f-b58c-4fe3-b6e3-12308069589b'::uuid, 'I90I-SD'::text, 'I91-SD'::text)
  ) expected(id, old_sku, new_sku)
  WHERE v.id = expected.id
    AND v.reference_id = 'dc553ff7-db5c-4ee5-83b9-e78469d2c0d7'::uuid
    AND btrim(v.sku) = expected.old_sku;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = format(
        'Correção I91 recusada: esperava atualizar 3 variantes; atualizei %s.',
        v_updated_count
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reference_material_variants v
    WHERE NULLIF(btrim(v.sku), '') IS NOT NULL
    GROUP BY lower(btrim(v.sku))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Correção I91 não eliminou todas as duplicidades globais de SKU.';
  END IF;
END;
$fix_i91_variant_skus$;

COMMIT;

SELECT id, reference_id, material_name, sku, active, updated_at
FROM public.reference_material_variants
WHERE id IN (
  '75f6fcfb-7e61-42d8-ace3-0fd566cc9be3'::uuid,
  '519826f3-6a67-4f89-a401-22c924900ac6'::uuid,
  '51eddc5f-b58c-4fe3-b6e3-12308069589b'::uuid
)
ORDER BY sku;
