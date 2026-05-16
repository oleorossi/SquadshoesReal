-- =============================================================================
-- Consolida embalagem no setor "Gestão de Embalagens".
--
-- Modelo novo:
--  • box_types ganha tipo (individual/master/colmeia/fitilho) e
--    pairs_per_box_default — toda definição de capacidade vive aqui.
--  • Nova tabela technical_sheet_box_types: a ficha só ESCOLHE quais caixas
--    aquele solado usa (N:M); não duplica tipo nem pares.
--  • PV continua escolhendo o modo; RPC casa box_types.tipo com o modo do PV.
--
-- Compatibilidade: product_groups.box_type_*_id e pairs_per_box_* ficam
-- mantidos por enquanto (fallback). RPC nova lê primeiro do novo modelo, depois
-- cai no antigo (e por último em packaging_configs).
-- =============================================================================

-- Step 1: enum de tipo de caixa
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'box_type_kind') THEN
    CREATE TYPE public.box_type_kind AS ENUM ('individual', 'master', 'colmeia', 'fitilho');
  END IF;
END$$;

-- Step 2: colunas novas em box_types
ALTER TABLE public.box_types
  ADD COLUMN IF NOT EXISTS tipo public.box_type_kind,
  ADD COLUMN IF NOT EXISTS pairs_per_box_default integer,
  ADD COLUMN IF NOT EXISTS metros_per_amarrado_default numeric;

-- Backfill tipo a partir da coluna legacy interno (true=individual, false=master).
-- Quem for colmeia/fitilho terá que ser ajustado manualmente; só conseguimos
-- inferir os dois casos triviais.
UPDATE public.box_types
   SET tipo = CASE WHEN interno THEN 'individual'::box_type_kind
                   ELSE 'master'::box_type_kind END
 WHERE tipo IS NULL;

-- Backfill pairs_per_box_default a partir dos pairs_per_box_* em product_groups
-- (modal: pega o valor mais comum por box_type_id, ignorando NULL).
WITH pairs_modal AS (
  SELECT box_id, pairs, ROW_NUMBER() OVER (PARTITION BY box_id ORDER BY freq DESC) AS rn
  FROM (
    SELECT box_id, pairs, COUNT(*) AS freq
    FROM (
      SELECT box_type_id         AS box_id, pairs_per_box_individual AS pairs FROM public.product_groups WHERE box_type_id IS NOT NULL AND pairs_per_box_individual IS NOT NULL
      UNION ALL
      SELECT box_type_master_id  AS box_id, pairs_per_box_master     AS pairs FROM public.product_groups WHERE box_type_master_id IS NOT NULL AND pairs_per_box_master IS NOT NULL
      UNION ALL
      SELECT box_type_colmeia_id AS box_id, pairs_per_box_colmeia    AS pairs FROM public.product_groups WHERE box_type_colmeia_id IS NOT NULL AND pairs_per_box_colmeia IS NOT NULL
      UNION ALL
      SELECT box_type_fitilho_id AS box_id, pairs_per_box_fitilho    AS pairs FROM public.product_groups WHERE box_type_fitilho_id IS NOT NULL AND pairs_per_box_fitilho IS NOT NULL
    ) src
    GROUP BY box_id, pairs
  ) ranked
)
UPDATE public.box_types bt
   SET pairs_per_box_default = pm.pairs
  FROM pairs_modal pm
 WHERE pm.rn = 1
   AND pm.box_id = bt.id
   AND bt.pairs_per_box_default IS NULL;

-- Default razoável pra caixas sem nada (1 par = caixa individual padrão).
UPDATE public.box_types
   SET pairs_per_box_default = CASE tipo
                                  WHEN 'individual' THEN 1
                                  WHEN 'master'     THEN 12
                                  WHEN 'colmeia'    THEN 12
                                  WHEN 'fitilho'    THEN 12
                                END
 WHERE pairs_per_box_default IS NULL;

-- Backfill metros_per_amarrado_default a partir de product_groups.metros_fitilho_per_amarrado
-- (só pra caixas marcadas como fitilho)
UPDATE public.box_types bt
   SET metros_per_amarrado_default = pg.metros_fitilho_per_amarrado
  FROM public.product_groups pg
 WHERE bt.tipo = 'fitilho'
   AND pg.box_type_fitilho_id = bt.id
   AND pg.metros_fitilho_per_amarrado IS NOT NULL
   AND bt.metros_per_amarrado_default IS NULL;

-- Step 3: tabela N:M ficha técnica ↔ box_types
CREATE TABLE IF NOT EXISTS public.technical_sheet_box_types (
  sheet_id    uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  box_type_id uuid NOT NULL REFERENCES public.box_types(id)         ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_id, box_type_id)
);

CREATE INDEX IF NOT EXISTS idx_tsbt_sheet ON public.technical_sheet_box_types(sheet_id);
CREATE INDEX IF NOT EXISTS idx_tsbt_box   ON public.technical_sheet_box_types(box_type_id);

ALTER TABLE public.technical_sheet_box_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tsbt_read  ON public.technical_sheet_box_types;
DROP POLICY IF EXISTS tsbt_write ON public.technical_sheet_box_types;

CREATE POLICY tsbt_read  ON public.technical_sheet_box_types FOR SELECT USING (public.is_approved_user());
CREATE POLICY tsbt_write ON public.technical_sheet_box_types FOR ALL    USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- Step 4: backfill technical_sheet_box_types a partir do product_groups da ficha.
-- Cada slot (individual/master/colmeia/fitilho) preenchido vira uma linha.
INSERT INTO public.technical_sheet_box_types (sheet_id, box_type_id)
SELECT DISTINCT ts.id, pg.box_type_id
  FROM public.technical_sheets ts
  JOIN public.product_groups pg ON pg.id = ts.sole_group_id
 WHERE pg.box_type_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.technical_sheet_box_types (sheet_id, box_type_id)
SELECT DISTINCT ts.id, pg.box_type_master_id
  FROM public.technical_sheets ts
  JOIN public.product_groups pg ON pg.id = ts.sole_group_id
 WHERE pg.box_type_master_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.technical_sheet_box_types (sheet_id, box_type_id)
SELECT DISTINCT ts.id, pg.box_type_colmeia_id
  FROM public.technical_sheets ts
  JOIN public.product_groups pg ON pg.id = ts.sole_group_id
 WHERE pg.box_type_colmeia_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.technical_sheet_box_types (sheet_id, box_type_id)
SELECT DISTINCT ts.id, pg.box_type_fitilho_id
  FROM public.technical_sheets ts
  JOIN public.product_groups pg ON pg.id = ts.sole_group_id
 WHERE pg.box_type_fitilho_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.technical_sheet_box_types IS
  'Multi-select de caixas que a ficha técnica usa. Tipo e pares-por-caixa vivem em box_types.';
COMMENT ON COLUMN public.box_types.tipo IS
  'Tipo da caixa: individual, master, colmeia ou fitilho. Determina em qual modo de PV ela é consumida.';
COMMENT ON COLUMN public.box_types.pairs_per_box_default IS
  'Capacidade padrão da caixa em pares (ou amarrados, no caso de fitilho). RPC usa este valor pra calcular qtde de caixas no débito.';
COMMENT ON COLUMN public.box_types.metros_per_amarrado_default IS
  'Para caixas tipo=fitilho: metros consumidos por amarrado. NULL para outros tipos.';
