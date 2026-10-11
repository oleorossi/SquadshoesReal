-- tira_fichas_e_grupos_20270101036000
--
-- specs/tira-material-de-estoque.md R1/R4/R21: um grupo de estoque = um tipo de
-- tira, e toda linha de tira da ficha aponta o seu grupo. Compatível com o motor
-- antigo (Hub): só ACRESCENTA `group_id`/`group_name` e o identificador estável
-- `technical_strap_line_id`; mantém medida/família/identity_basis nas linhas até
-- o DROP. Vem antes da virada para que a simulação dos PVs abertos (R24) rode
-- sobre as fichas já normalizadas.
--
-- Medido em 11/10/2026:
--   46 linhas / 13 fichas ganham o grupo pela medida (ex.: OB01 inteira);
--    3 linhas são reapontadas pela medida (5 mm e 7 mm no grupo misto "Tira chata 8mm");
--   80 linhas antigas ganham o UUID estável que faltava;
--    2 linhas (STX TIRA 1 e TIRA 2) não têm grupo nem medida → ficam como pendência
--      visível (list_strap_setup_pendencias), sem chute.
--
-- Grupo misto: os SKUs de 7 mm ("ELÁSTICO FORRADO 7 mm · …") saem de "Tira chata 8mm"
-- para ELÁSTICO FORRADO 7MM; o grupo de 8 mm passa a se chamar TIRA CHATA 8MM.

SELECT set_config('app.artisanal_strap_catalog_write', '1', true);

CREATE TEMP TABLE _strap_measure_group ON COMMIT DROP AS
SELECT m.measure_id::uuid, m.group_id::uuid
  FROM (VALUES
    ('69c30596-c428-459b-ad93-128814c8b277', '4d3943d7-adbb-4523-a1ec-f8ae003bea8b'), -- MEIA CANA 10
    ('2c84a703-851c-4c56-8a72-4615d3d1fa05', 'c759eb08-00f1-448a-aeba-4693a967be4f'), -- TIRA CHATA 25
    ('0166b326-2023-4427-a165-aada45ee5611', 'a657390e-1c4f-469b-ac48-8e45b2b8d3c0'), -- TIRA CHATA 8
    ('65628af5-8cb3-419a-8c54-3e2ac474ee5e', '87b706a8-40ba-4019-9aee-b2f80ef81212'), -- COSTURADA 11
    ('06500a23-801d-4627-a927-3ce7e5ee2619', 'e0301b34-7963-448d-a12a-33a897439282'), -- OVERLOCK 5
    ('a487b85e-8e3d-4091-9932-41205836b5c0', '6e43bbda-0f1f-412c-8d4a-ec009114530d'), -- STRASS 15
    ('00f07325-347b-4e65-90e6-fed33f70eacc', 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'), -- STRASS 6
    ('ea0c68b9-2911-4477-bf1b-206661e6c745', '2fbed979-a191-46e2-908c-5e02a0df4f3c')  -- TRANÇA 3
  ) AS m(measure_id, group_id)
UNION ALL
SELECT '9292a467-992e-4097-8dd5-5fb2f94abb15'::uuid, g.id
  FROM public.product_groups g WHERE g.name = 'ELÁSTICO FORRADO 7MM'
UNION ALL
SELECT '60242fca-662a-4c24-9ff6-407c9fc3bab0'::uuid, g.id
  FROM public.product_groups g WHERE g.name = 'OVERLOCK REDONDA 6MM';

-- ── Grupo misto: 7 mm sai do grupo de 8 mm ──────────────────────────────────
UPDATE public.products p
   SET group_id = (SELECT g.id FROM public.product_groups g WHERE g.name = 'ELÁSTICO FORRADO 7MM'),
       updated_at = now()
  FROM public.artisanal_strap_variants v
 WHERE v.finished_product_id = p.id
   AND v.measure_id = '9292a467-992e-4097-8dd5-5fb2f94abb15'
   AND p.group_id = 'a657390e-1c4f-469b-ac48-8e45b2b8d3c0';

UPDATE public.product_groups
   SET name = 'TIRA CHATA 8MM', updated_at = now()
 WHERE id = 'a657390e-1c4f-469b-ac48-8e45b2b8d3c0'
   AND name = 'Tira chata 8mm';

-- ── Linhas de tira das fichas ───────────────────────────────────────────────
WITH reshaped AS (
  SELECT ts.id,
         jsonb_agg(
           CASE WHEN g.id IS NULL THEN line.v ELSE line.v || jsonb_build_object(
             'group_id', g.id, 'group_name', g.name
           ) END
           ORDER BY line.ord
         ) AS strap_colors,
         bool_or(line.changed OR (g.id IS NOT NULL AND (
           nullif(line.v ->> 'group_id', '') IS DISTINCT FROM g.id::text
           OR line.v ->> 'group_name' IS DISTINCT FROM g.name
         ))) AS changed
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL (
      SELECT l.ord,
             CASE WHEN coalesce(l.value ->> 'technical_strap_line_id', '') = ''
                  THEN l.value || jsonb_build_object('technical_strap_line_id', gen_random_uuid())
                  ELSE l.value END AS v,
             coalesce(l.value ->> 'technical_strap_line_id', '') = '' AS changed,
             coalesce(
               (SELECT map.group_id FROM _strap_measure_group map
                 WHERE map.measure_id::text = nullif(l.value ->> 'measure_id', '')),
               CASE WHEN coalesce(l.value ->> 'group_id', '') ~* '^[0-9a-f-]{36}$'
                    THEN (l.value ->> 'group_id')::uuid END,
               CASE WHEN coalesce(l.value ->> 'identity_group_id', '') ~* '^[0-9a-f-]{36}$'
                    THEN (l.value ->> 'identity_group_id')::uuid END
             ) AS target_group_id
        FROM jsonb_array_elements(ts.strap_colors) WITH ORDINALITY l(value, ord)
    ) line
    LEFT JOIN public.product_groups g ON g.id = line.target_group_id
   WHERE jsonb_typeof(ts.strap_colors) = 'array'
     AND jsonb_array_length(ts.strap_colors) > 0
     -- Ficha aposentada é imutável (tg_guard_technical_sheet_retirement_metadata).
     AND ts.retired_at IS NULL
   GROUP BY ts.id
)
UPDATE public.technical_sheets ts
   SET strap_colors = r.strap_colors
  FROM reshaped r
 WHERE ts.id = r.id
   AND r.changed;

-- ── Pendências de cadastro de tira (visíveis na aba Tiras do Ateliê) ────────
-- Calculadas ao vivo: linha de ficha sem grupo de estoque. A migração dos PVs
-- abertos (virada) acrescenta as dela.
CREATE OR REPLACE FUNCTION public.list_strap_setup_pendencias()
 RETURNS TABLE(kind text, sheet_id uuid, sheet_label text, line_label text, message text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT 'ficha_sem_grupo'::text,
         ts.id,
         coalesce(nullif(ts.code, ''), nullif(ts.name, ''), ts.id::text),
         coalesce(nullif(l.value ->> 'label', ''), 'TIRA ' || l.ord),
         'A linha de tira não diz qual tira (grupo de estoque) usar — edite a ficha e escolha o grupo.'
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN ts.strap_colors ELSE '[]'::jsonb END
    ) WITH ORDINALITY l(value, ord)
   WHERE public.is_approved_user()
     AND ts.retired_at IS NULL
     AND coalesce(l.value ->> 'group_id', '') !~* '^[0-9a-f-]{36}$'
     AND coalesce(l.value ->> 'identity_group_id', '') !~* '^[0-9a-f-]{36}$'
   ORDER BY 3, 4;
$function$;

REVOKE ALL ON FUNCTION public.list_strap_setup_pendencias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_strap_setup_pendencias() TO authenticated;
