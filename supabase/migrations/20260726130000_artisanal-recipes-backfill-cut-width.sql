-- ════════════════════════════════════════════════════════════════════════════
-- Backfill — largura de corte da tira artesanal (`artisanal_recipes.cut_width_mm`)
-- ════════════════════════════════════════════════════════════════════════════
-- A coluna `cut_width_mm` foi adicionada em 20260726120000 (nullable). A maioria
-- das receitas já carrega a largura embutida no NOME do grupo de resultado
-- (`artisanal_product_name`, ex.: "Tira Chata 25mm") ou na descrição livre da
-- receita (`name`, ex.: "Trançado 8mm"). Esta migration extrai esse número e
-- preenche `cut_width_mm` onde ainda estiver vazio, evitando cadastro manual
-- tira a tira.
--
-- Fonte da largura (prioridade):
--   1) `artisanal_product_name` — identidade canônica da tira artesanal; a
--      largura é uma propriedade física do PRODUTO de resultado, não do processo.
--   2) `name` — fallback quando o grupo de resultado não traz o número.
--   Em ambos, pega o PRIMEIRO número seguido de "mm" (case-insensitive).
--
-- Segurança / idempotência:
--   • Só atualiza quando `cut_width_mm IS NULL` → NUNCA sobrescreve valor que o
--     Leonardo já tenha preenchido na UI (Engenharia → Receitas).
--   • Só atualiza quando o número extraído é > 0 → respeita o CHECK
--     (`cut_width_mm IS NULL OR cut_width_mm > 0`) e descarta "0mm".
--   • Reexecutável: numa 2ª passada não há mais NULLs casáveis, então não muda
--     nada.
--   • Se a regex não casar com nada (cenário improvável), a migration é inócua —
--     nenhuma linha é tocada.
--
-- O bloco DO emite RAISE NOTICE com a lista do que foi preenchido e do que
-- continuou sem largura (pra cadastro manual). Esses avisos aparecem no log da
-- GitHub Action `supabase-migrate.yml`.

DO $$
DECLARE
  rec          RECORD;
  n_updated    int := 0;
  n_unmatched  int := 0;
BEGIN
  -- 1) Backfill + log das receitas afetadas
  FOR rec IN
    UPDATE public.artisanal_recipes AS r
    SET cut_width_mm = sub.w
    FROM (
      SELECT
        id,
        COALESCE(
          NULLIF(substring(lower(artisanal_product_name) FROM '(\d+)\s*mm'), '')::int,
          NULLIF(substring(lower(name)                   FROM '(\d+)\s*mm'), '')::int
        ) AS w
      FROM public.artisanal_recipes
    ) AS sub
    WHERE r.id = sub.id
      AND r.cut_width_mm IS NULL          -- não sobrescreve preenchimento manual
      AND sub.w IS NOT NULL
      AND sub.w > 0                        -- respeita CHECK e descarta "0mm"
    RETURNING r.name, r.artisanal_product_name, r.cut_width_mm
  LOOP
    n_updated := n_updated + 1;
    RAISE NOTICE 'cut_width backfill ✓  "%" [%] -> % mm',
      rec.name, rec.artisanal_product_name, rec.cut_width_mm;
  END LOOP;

  RAISE NOTICE 'cut_width backfill: % receita(s) preenchida(s).', n_updated;

  -- 2) Log das receitas que continuaram sem largura (cadastrar manualmente)
  FOR rec IN
    SELECT name, artisanal_product_name
    FROM public.artisanal_recipes
    WHERE cut_width_mm IS NULL
    ORDER BY name
  LOOP
    n_unmatched := n_unmatched + 1;
    RAISE NOTICE 'cut_width backfill ⚠  SEM largura: "%" [%]',
      rec.name, rec.artisanal_product_name;
  END LOOP;

  RAISE NOTICE 'cut_width backfill: % receita(s) sem largura (cadastrar em Engenharia → Receitas).',
    n_unmatched;
END $$;
