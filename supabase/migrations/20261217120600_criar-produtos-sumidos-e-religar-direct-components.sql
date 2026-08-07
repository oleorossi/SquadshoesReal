-- Fase 3 da auditoria dos motores — docs/AUDITORIA_MOTORES_2026-08-07.md
--
-- PROBLEMA: 24 das 28 linhas de technical_sheets.direct_components apontam um
-- product_id que não existe mais em products. Causa raiz: merge_product_into
-- (e o caminho de deleção) remapeiam colunas FK mas não varrem esse JSONB —
-- e JSONB não é protegido por FK, então nenhum ON DELETE impediu o ponteiro morto.
-- A causa raiz é fechada na migration 20261217120400; esta aqui limpa o estrago.
--
-- ⚠ O RELIGAMENTO É POR NOME, NÃO POR UUID MORTO — e isso não é preferência:
--    o UUID 645bf78e… carrega DOIS nomes contraditórios ("BINÓCULO 6MM" em 4 fichas
--    e "Fivela Dourada 10.7mm" em 5), e o 73e1826c… carrega outros dois. Usar
--    relink_direct_component(dead, new), que religa tudo que aponta pro UUID morto,
--    apontaria binóculo e fivela pro MESMO produto. Por isso o UPDATE abaixo casa
--    pelo product_name de cada entrada do array.
--
-- Decisões do dono (sessão de 2026-08-07):
--   · criar os produtos sumidos e religar (em vez de apontar pros de outra bitola
--     — 6mm ≠ 10mm — ou de apagar as linhas)
--   · espelhar os análogos: 'un' / Componente / COMPONENTES DIVERSOS
--   · Elástico 7mm dedinho é LINEAR ('m'), não contagem

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) SNAPSHOT — estado ANTES de qualquer UPDATE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_direct_components_20260807 AS
SELECT ts.id,
       ts.name,
       ts.direct_components,
       now() AS capturado_em
  FROM public.technical_sheets ts
 WHERE jsonb_typeof(ts.direct_components) = 'array'
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(ts.direct_components) dc
      WHERE NULLIF(dc->>'product_id','') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.products p
           WHERE p.id = (NULLIF(dc->>'product_id',''))::uuid
        )
   );

-- ---------------------------------------------------------------------------
-- 2) Criar os 6 produtos sumidos (idempotente por nome)
-- ---------------------------------------------------------------------------
INSERT INTO public.products (name, sku, category, unit, color, group_id, quantity, unit_price, location)
SELECT v.nome,
       v.sku,
       'Componente',
       v.unidade,
       v.cor,
       '7a42c0c5-c59d-47c1-8ca6-da5f9bdf32f9'::uuid,  -- COMPONENTES DIVERSOS
       0,
       0,
       'Almoxarifado A'
  FROM (VALUES
    ('BINÓCULO 6MM',          'AUD20260807-BIN6MM',      'un', ''       ),
    ('BINÓCULO 6MM: DOURADO', 'AUD20260807-BIN6MM-DOU',  'un', 'DOURADO'),
    ('Fivela Dourada 10.7mm', 'AUD20260807-FIV107',      'un', ''       ),
    ('Coração',               'AUD20260807-CORACAO',     'un', ''       ),
    ('Dedinho GOLD',          'AUD20260807-DEDGOLD',     'un', ''       ),
    ('Elástico 7mm dedinho',  'AUD20260807-ELAST7',      'm',  ''       )
  ) AS v(nome, sku, unidade, cor)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.products p
    WHERE lower(trim(p.name)) = lower(trim(v.nome))
 );

-- ---------------------------------------------------------------------------
-- 3) Religar SÓ as entradas cujo product_id NÃO resolve, casando por nome
--    (as de nome defasado com ID válido são tratadas em 20261217120500)
-- ---------------------------------------------------------------------------
UPDATE public.technical_sheets ts
   SET direct_components = sub.novo
  FROM (
    SELECT ts2.id,
           jsonb_agg(
             CASE
               WHEN NULLIF(e.dc->>'product_id','') IS NOT NULL
                AND NOT EXISTS (
                      SELECT 1 FROM public.products x
                       WHERE x.id = (NULLIF(e.dc->>'product_id',''))::uuid)
                AND p.id IS NOT NULL
               THEN e.dc || jsonb_build_object(
                      'product_id',   p.id::text,
                      'product_name', p.name)
               ELSE e.dc
             END
             ORDER BY e.ord
           ) AS novo
      FROM public.technical_sheets ts2
      CROSS JOIN LATERAL jsonb_array_elements(ts2.direct_components)
                    WITH ORDINALITY AS e(dc, ord)
      LEFT JOIN public.products p
             ON lower(trim(extensions.unaccent(p.name)))
              = lower(trim(extensions.unaccent(e.dc->>'product_name')))
     WHERE jsonb_typeof(ts2.direct_components) = 'array'
     GROUP BY ts2.id
  ) sub
 WHERE ts.id = sub.id
   AND ts.direct_components IS DISTINCT FROM sub.novo;

-- ---------------------------------------------------------------------------
-- 4) Verificação — falha a migration se sobrar órfão
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_restantes int;
BEGIN
  SELECT count(*) INTO v_restantes
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(ts.direct_components) dc
   WHERE jsonb_typeof(ts.direct_components) = 'array'
     AND NULLIF(dc->>'product_id','') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.products p
        WHERE p.id = (NULLIF(dc->>'product_id',''))::uuid);

  IF v_restantes > 0 THEN
    RAISE EXCEPTION 'Ainda restam % entradas de direct_components com product_id morto', v_restantes;
  END IF;
END $$;

COMMIT;
