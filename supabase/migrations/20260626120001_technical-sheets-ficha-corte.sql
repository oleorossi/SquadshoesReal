-- Ficha Técnica imprimível (Ficha de Corte): cabeçalho LINHA/REFERENCIA/CORTE/
-- CABEDAL/PESO/OBS + tabela "Materiais Variáveis" (faca/peça) + itens fixos
-- (aviamento). Preenchida na aba "Ficha Imprimível" do editor de ficha técnica
-- e impressa em A4 (src/lib/printFichaTecnica.ts). Campo só de impressão — NÃO
-- afeta consumo/produção (salvo direto, sem resync).
ALTER TABLE public.technical_sheets ADD COLUMN IF NOT EXISTS ficha_corte jsonb;
COMMENT ON COLUMN public.technical_sheets.ficha_corte IS 'Ficha técnica imprimível (cabeçalho LINHA/REFERENCIA/CORTE/CABEDAL/PESO/OBS + materiais variáveis/facas + itens fixos) — preenchida na aba "Ficha Imprimível".';
