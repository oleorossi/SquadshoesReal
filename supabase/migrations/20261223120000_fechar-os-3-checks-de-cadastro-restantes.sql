-- Fecha 3 dos 4 checks de cadastro que sobraram da auditoria de 2026-08-07.
-- (O quarto — solado_fachetado_sem_specs_fachete — exige medida de fábrica.)
--
-- 1) material_base_artesanal_sem_cor (149) — DEFEITO DO CHECK, não do cadastro.
--    Ele junta produto × receita e exige que a base de CADA receita exista na cor
--    do produto. Mas o grupo TIRA OVERLOCK 5MM tem 4 receitas ativas (NAPA SUDANI,
--    GLOW METALIC, NAPA MADRID, NAPA SOFT) e a tira precisa de UMA delas, não das
--    quatro. Medido antes de mexer: dos 62 artesanais com cor, 62 têm ao menos uma
--    base disponível — `sem_nenhuma_base = 0`. Os 149 são ruído puro.
--    ⚠ Criar as 79 combinações (base × cor) que o check pedia teria inventado
--    estoque de material que a fábrica não usa nessa cor.
--
-- 2) forro_cabedal_duplicado_com_palmilha (27) — dado. Nessas fichas o solado
--    dirige o consumo, tem forro de PALMILHA (insole_lining_consumption_dm2 ≈ 5,7083)
--    e NÃO tem forro de cabedal (lining_consumption_dm2 IS NULL). O escalar
--    `lining_consumption` da ficha (4,56–5,83) é a área da palmilha digitada no campo
--    errado — bug PV-00146. O motor já suprime a linha fantasma
--    (`v_suppress_cabedal_lining` / `suppressCabedalForracao`), então zerar NÃO muda
--    número: apenas remove a armadilha para qualquer leitor ingênuo do escalar,
--    que foi exatamente o Desencontro 1 desta auditoria.
--
-- 3) produto_artesanal_flag_inconsistente (4) — dado. São 4 LINHAS de um único
--    produto (TIRA OVERLOCK 5MM: CAPUCCINO), contado uma vez por receita ativa do
--    grupo. O grupo tem receita artesanal ativa, logo o produto é artesanal.

-- ---------------------------------------------------------------------------
-- SNAPSHOT antes de qualquer UPDATE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_cadastro_20260807b AS
SELECT ts.id, ts.name, ts.lining_consumption, now() AS capturado_em
  FROM public.technical_sheets ts
 WHERE COALESCE(ts.sole_drives_consumption, false) = true
   AND COALESCE(ts.lining_consumption, 0) > 0
   AND ts.primary_sole_id IS NOT NULL;

REVOKE ALL ON TABLE public.backup_cadastro_20260807b FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Zerar o escalar de forro digitado no campo errado
-- ---------------------------------------------------------------------------
UPDATE public.technical_sheets ts
   SET lining_consumption = 0
 WHERE COALESCE(ts.sole_drives_consumption, false) = true
   AND COALESCE(ts.lining_consumption, 0) > 0
   AND ts.primary_sole_id IS NOT NULL
   AND COALESCE(
         (SELECT NULLIF(bool_or(NULLIF(kv.value, '')::numeric > 0), false)
            FROM jsonb_each_text(public.get_sole_consumption_per_size(
              ts.primary_sole_id, 'insole_lining_consumption_per_size')) kv),
         EXISTS (SELECT 1 FROM public.sole_technical_specs sts
                  WHERE sts.sole_id = ts.primary_sole_id
                    AND COALESCE(sts.insole_lining_consumption_dm2, 0) > 0))
   AND NOT COALESCE(
         (SELECT NULLIF(bool_or(NULLIF(kv.value, '')::numeric > 0), false)
            FROM jsonb_each_text(public.get_sole_consumption_per_size(
              ts.primary_sole_id, 'lining_consumption_per_size')) kv),
         EXISTS (SELECT 1 FROM public.sole_technical_specs sts
                  WHERE sts.sole_id = ts.primary_sole_id
                    AND COALESCE(sts.lining_consumption_dm2, 0) > 0));

-- ---------------------------------------------------------------------------
-- 3) Flag artesanal coerente com a receita do grupo
-- ---------------------------------------------------------------------------
UPDATE public.products p
   SET is_artisanal = true
  FROM public.product_groups g
 WHERE g.id = p.group_id
   AND p.active = true
   AND COALESCE(p.is_artisanal, false) = false
   AND EXISTS (SELECT 1 FROM public.artisanal_recipes ar
                WHERE ar.active = true
                  AND lower(trim(extensions.unaccent(ar.artisanal_product_name)))
                    = lower(trim(extensions.unaccent(g.name))));

-- ---------------------------------------------------------------------------
-- 1) Corrigir o check: basta UMA base na cor, não todas
--    Injetado a partir do catálogo — o resto da função não é transcrito.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def text;
  v_novo text;
  v_bloco text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'consumption_consistency_report';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'consumption_consistency_report não existe';
  END IF;

  v_bloco := $b$RETURN QUERY
  SELECT 'material_base_artesanal_sem_cor'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(x.nome || ' (' || x.cor || ')', ' · ' ORDER BY x.nome), '—')
    FROM (
      SELECT DISTINCT p.name AS nome, p.color AS cor
        FROM public.products p
        JOIN public.product_groups g ON g.id = p.group_id
       WHERE p.active = true
         AND COALESCE(p.is_artisanal, false) = true
         AND COALESCE(p.color, '') <> ''
         AND EXISTS (
           SELECT 1 FROM public.artisanal_recipes ar0
            WHERE ar0.active = true
              AND lower(trim(extensions.unaccent(ar0.artisanal_product_name)))
                = lower(trim(extensions.unaccent(g.name))))
         AND NOT EXISTS (
           SELECT 1
             FROM public.artisanal_recipes ar
             JOIN public.products bp ON bp.active = true
             LEFT JOIN public.product_groups bg ON bg.id = bp.group_id
            WHERE ar.active = true
              AND lower(trim(extensions.unaccent(ar.artisanal_product_name)))
                = lower(trim(extensions.unaccent(g.name)))
              AND (lower(trim(extensions.unaccent(COALESCE(bg.name, ''))))
                     = lower(trim(extensions.unaccent(ar.base_product_name)))
                OR lower(trim(extensions.unaccent(bp.name)))
                     = lower(trim(extensions.unaccent(ar.base_product_name))))
              AND lower(trim(extensions.unaccent(COALESCE(bp.color, ''))))
                = lower(trim(extensions.unaccent(COALESCE(p.color, '')))))
    ) x;$b$;

  -- ⚠ `[^;]*` e NÃO `.*?`: no regex do Postgres (ARE), quando a expressão mistura
  --   quantificadores greedy e non-greedy, é o PRIMEIRO que decide a ganância do
  --   todo. Como `[[:space:]]+` vem antes, um `.*?` aqui vira greedy e engole até o
  --   último `;` da função — levando o `END;` junto e quebrando o corpo.
  --   `[^;]*` não consegue atravessar ponto-e-vírgula, então para no fim do bloco.
  v_novo := regexp_replace(
    v_def,
    'RETURN QUERY[[:space:]]+SELECT ''material_base_artesanal_sem_cor''[^;]*;',
    v_bloco);

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'bloco material_base_artesanal_sem_cor não localizado — injeção abortada';
  END IF;

  EXECUTE v_novo;
END $mig$;
