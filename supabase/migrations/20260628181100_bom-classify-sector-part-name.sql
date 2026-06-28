-- Fase 1 (custeio): classifica cada linha de sheet_materials por setor + part_name.
-- Crosswalk validado pelo Leonardo no gate (2026-06-28): cola→Colagem, embalagem→Expedição,
-- linha→Costura, solado→Solagem, saltinho→Solagem/Salto, tira→Aviamento, componente→Aviamento.
-- Idempotente (só onde NULL). NB: cabedal/forro/palmilha NÃO vivem em sheet_materials (são
-- custeados de technical_sheets por calculate_order_consumption); cobre só acessórios/consumíveis.
-- O CHECK legado só permitia 6 valores lowercase (corte/costura/forracao/palmilha/montagem/
-- acabamento); 0 linhas usavam → amplia pro vocabulário display de sector_grouping_config
-- (+ mantém legados). Fase 2 normaliza display→sector_key. Aplicada via Supabase MCP.
ALTER TABLE public.sheet_materials DROP CONSTRAINT IF EXISTS sheet_materials_sector_check;
ALTER TABLE public.sheet_materials ADD CONSTRAINT sheet_materials_sector_check
  CHECK (sector = ANY (ARRAY[
    'Acabamento','Aviamento','Colagem','Corte Cabedal','Corte Forração','Corte Palmilha',
    'Costura','Expedição','Montagem','Silk','Solagem',
    'corte','costura','forracao','palmilha','montagem','acabamento'
  ]));

CREATE TABLE IF NOT EXISTS public.bom_part_sector_map (
  group_id  uuid PRIMARY KEY REFERENCES public.product_groups(id) ON DELETE CASCADE,
  sector    text NOT NULL,
  part_name text NOT NULL
);

INSERT INTO public.bom_part_sector_map (group_id, sector, part_name) VALUES
  ('61d94eff-dd92-4674-9bdf-acf9b7b612bb','Expedição','Embalagem'),
  ('2444c048-05e5-4f4e-a11c-f67e0c5bfba1','Costura','Linha'),
  ('69c86aa8-57af-45e8-813f-19a1b50340d8','Solagem','Solado'),
  ('5902f5eb-668a-421e-a0b6-ce0ace9f1a6c','Solagem','Solado'),
  ('3c06f8e6-ef55-478e-9ecd-4b2cfe75b257','Solagem','Solado'),
  ('e5e101bb-e6af-4c9a-92c7-1bbaf3be71b7','Solagem','Solado'),
  ('9e1db20b-49dc-43a1-933e-63bdabc67dde','Solagem','Salto'),
  ('c759eb08-00f1-448a-aeba-4693a967be4f','Aviamento','Tira'),
  ('a657390e-1c4f-469b-ac48-8e45b2b8d3c0','Aviamento','Tira'),
  ('c0ce741a-6035-4d4e-9c30-35bcecc4e833','Aviamento','Componente'),
  ('dcf999dc-ac70-4913-9a15-a61812408808','Aviamento','Componente')
ON CONFLICT (group_id) DO UPDATE SET sector=EXCLUDED.sector, part_name=EXCLUDED.part_name;

UPDATE public.sheet_materials m
SET sector = x.sector, part_name = x.part_name
FROM public.bom_part_sector_map x
WHERE m.group_id = x.group_id
  AND (m.sector IS NULL OR m.part_name IS NULL);

UPDATE public.sheet_materials m
SET sector = 'Colagem', part_name = 'Cola'
FROM public.products p
WHERE p.id = m.product_id
  AND m.group_id IS NULL
  AND p.name ILIKE 'COLA%'
  AND (m.sector IS NULL OR m.part_name IS NULL);
