-- ════════════════════════════════════════════════════════════════════════
-- technical_sheets.grading_config — memória do escalonamento de consumo (CAD).
--
-- A aba "Escalonamento / CAD" da ficha técnica importa o DXF (Shoemaster/
-- AutoCAD), calcula a área das peças no tamanho base e escalona o consumo em
-- todas as numerações, gravando o RESULTADO em upper_consumption_per_size /
-- strap_colors[].consumption_per_size (colunas que o motor já consome).
--
-- Esta coluna guarda os PARÂMETROS que geraram a curva (área base, peças,
-- tamanho base, modo área/linear, unidade, nome do DXF) pra permitir re-editar
-- e re-escalonar depois. O arquivo DXF em si não é arquivado (parse é
-- client-side); só os números derivados + o nome ficam aqui.
--
-- Shape livre (jsonb), ex.:
-- {
--   "upper":  { "baseSize":37, "baseDm2":53.14, "mode":"area",
--               "wastePct":10, "unit":"mm", "dxfFileName":"x.dxf",
--               "pieces":[{"layer":"CABEDAL","areaDm2":50}], "updatedAt":"..." },
--   "straps": { "<id>": { "baseSize":37, "baseCm":25, "mode":"linear" } }
-- }
-- ════════════════════════════════════════════════════════════════════════

alter table public.technical_sheets
  add column if not exists grading_config jsonb not null default '{}'::jsonb;

comment on column public.technical_sheets.grading_config is
  'Parâmetros do escalonamento de consumo (CAD/DXF): área base, peças, tamanho '
  'base, modo, unidade. Resultado vai em *_consumption_per_size. Ver gradeScaling.ts.';
