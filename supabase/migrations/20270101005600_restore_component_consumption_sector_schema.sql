-- Repara o contrato de persistência publicado pela ficha técnica.
--
-- A migration 20261231122000 também cria estas colunas, porém não chegou ao
-- banco de produção. Reexecutá-la inteira não é seguro: ela contém updates de
-- dados que podem disparar fluxos operacionais adicionados posteriormente.
-- Este reparo é deliberadamente só de schema, idempotente e sem reescrever
-- fichas, materiais, OPs ou pedidos existentes.

BEGIN;

ALTER TABLE public.sheet_materials
  ADD COLUMN IF NOT EXISTS consumption_sector text;

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS component_consumption_sectors jsonb NOT NULL DEFAULT
    '{"fibra":"Corte Fibra","forracao_palmilha":"Corte Forração","cabedal":"Corte Cabedal","solado":"Solagem"}'::jsonb,
  ADD COLUMN IF NOT EXISTS consumption_routing_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.sheet_materials
  DROP CONSTRAINT IF EXISTS sheet_materials_consumption_sector_check;

ALTER TABLE public.sheet_materials
  ADD CONSTRAINT sheet_materials_consumption_sector_check
  CHECK (consumption_sector IS NULL OR consumption_sector IN (
    'Corte Fibra', 'Corte Forração', 'Corte Cabedal', 'Costura Palmilha',
    'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem',
    'Acabamento'
  ));

COMMENT ON COLUMN public.sheet_materials.consumption_sector IS
  'Setor físico que consome o item no início da operação.';

COMMENT ON COLUMN public.technical_sheets.component_consumption_sectors IS
  'Setor físico de consumo dos componentes técnicos fixos da ficha.';

COMMENT ON COLUMN public.technical_sheets.consumption_routing_required IS
  'Indica que a ficha exige roteamento explícito dos materiais por setor.';

DO $verify$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(expected.column_name ORDER BY expected.table_name, expected.column_name)
    INTO v_missing
    FROM (VALUES
      ('technical_sheets', 'component_consumption_sectors'),
      ('technical_sheets', 'consumption_routing_required'),
      ('sheet_materials', 'consumption_sector')
    ) AS expected(table_name, column_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = expected.table_name
        AND actual.column_name = expected.column_name
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Falha ao restaurar colunas de consumo por setor: %', v_missing;
  END IF;
END;
$verify$;

-- Evita a janela em que o PostgreSQL já tem as colunas, mas o PostgREST ainda
-- rejeita o payload com PGRST204/42703 por manter o schema antigo em cache.
NOTIFY pgrst, 'reload schema';

COMMIT;
