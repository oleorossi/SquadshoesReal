-- Observações por setor na ficha técnica.
-- A observação é uma característica da REFERÊNCIA (ex.: "esse modelo sempre
-- leva linha reforçada na Costura") — fica na ficha técnica e reflete
-- automaticamente em toda OP/ficha de operador daquele setor.
-- JSONB keyed pelo nome canônico do setor (mesmas chaves de production_sectors):
--   {"Costura": "usar linha nº 40", "Montagem": "atenção à biqueira"}
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS sector_notes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.technical_sheets.sector_notes IS
  'Observações por setor produtivo (JSONB keyed por nome de setor). Renderizado como callout nas fichas de operador do setor correspondente.';
