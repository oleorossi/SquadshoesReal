-- Peças de cabedal por par (Costura Cabedal).
-- Default 2 = par clássico (esquerdo+direito). Modelos com mais peças
-- (ex.: SP201 = 4) cadastram o valor na ficha; a ficha de operador multiplica
-- pares × este campo. Só camada de impressão / cadastro — não afeta consumo
-- de material nem débito de estoque.

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS upper_sewing_pieces_per_pair integer NOT NULL DEFAULT 2;

ALTER TABLE public.technical_sheets
  DROP CONSTRAINT IF EXISTS technical_sheets_upper_sewing_pieces_per_pair_check;

ALTER TABLE public.technical_sheets
  ADD CONSTRAINT technical_sheets_upper_sewing_pieces_per_pair_check
  CHECK (upper_sewing_pieces_per_pair >= 1 AND upper_sewing_pieces_per_pair <= 24);

COMMENT ON COLUMN public.technical_sheets.upper_sewing_pieces_per_pair IS
  'Qtd de peças de cabedal por par pra Costura Cabedal (default 2). Cadastro do modelo; a ficha de operador mostra pares × este valor.';
