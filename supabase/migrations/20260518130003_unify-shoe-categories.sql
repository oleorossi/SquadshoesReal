-- Unifica categorias de calçado em 14 valores canônicos.
--
-- Pedido user (18/05/2026): "categorias de sandálias estão muito confusas
-- têm que ser notificados por exemplo na ficha técnica tem uma categoria
-- quero que seja unificadas".
--
-- Auditoria mostrou 4 tabelas com shoe_category, cada uma com lista diferente
-- e grafia inconsistente (rasteirinha vs Rasteirinha vs Rasteira, mule vs
-- Mule, sandalia_tiras, generico, Geral, etc.).
--
-- Decisão: silk_shoe_category vira fonte canônica única com 14 valores
-- (escolhidos pelo user). Outras tabelas auto-mapeiam pelo nome.
--
-- Lista canônica (14):
--   Sandália · Rasteirinha · Tamanco · Mule · Plataforma · Anabela
--   Sapatilha · Scarpin · Sapato · Tênis · Sapatênis · Bota · Botina · Infantil

-- ── 1. Garantir 14 categorias na tabela canônica ──
INSERT INTO public.silk_shoe_category (name)
VALUES ('Sandália'), ('Rasteirinha'), ('Tamanco'), ('Mule'), ('Plataforma'),
       ('Anabela'), ('Sapatilha'), ('Scarpin'), ('Sapato'), ('Tênis'),
       ('Sapatênis'), ('Bota'), ('Botina'), ('Infantil')
ON CONFLICT (name) DO NOTHING;

-- Remove categorias antigas que NÃO estão na lista canônica
-- (mas só se nenhuma technical_sheet aponta pra elas via shoe_category_id)
DELETE FROM public.silk_shoe_category
 WHERE name NOT IN ('Sandália','Rasteirinha','Tamanco','Mule','Plataforma',
                    'Anabela','Sapatilha','Scarpin','Sapato','Tênis',
                    'Sapatênis','Bota','Botina','Infantil')
   AND NOT EXISTS (
     SELECT 1 FROM public.technical_sheets ts
      WHERE ts.shoe_category_id = silk_shoe_category.id
   );

-- ── 2. Função auxiliar: normaliza texto pra valor canônico ──
-- Aceita variações comuns (case, acento, underscore) e retorna a forma
-- canônica ou NULL se não houver match.
CREATE OR REPLACE FUNCTION public.normalize_shoe_category(p_input text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_norm text;
BEGIN
  IF p_input IS NULL OR trim(p_input) = '' THEN RETURN NULL; END IF;
  v_norm := lower(trim(extensions.unaccent(p_input)));
  -- Sandália + variações
  IF v_norm IN ('sandalia','sandália','sandalia_tiras','sand') THEN RETURN 'Sandália'; END IF;
  -- Rasteirinha + Rasteira
  IF v_norm IN ('rasteirinha','rasteira','rast') THEN RETURN 'Rasteirinha'; END IF;
  -- Mule
  IF v_norm = 'mule' THEN RETURN 'Mule'; END IF;
  -- Tamanco
  IF v_norm = 'tamanco' THEN RETURN 'Tamanco'; END IF;
  -- Plataforma
  IF v_norm IN ('plataforma','plat') THEN RETURN 'Plataforma'; END IF;
  -- Anabela
  IF v_norm = 'anabela' THEN RETURN 'Anabela'; END IF;
  -- Sapatilha
  IF v_norm IN ('sapatilha','sapatilhas') THEN RETURN 'Sapatilha'; END IF;
  -- Scarpin
  IF v_norm IN ('scarpin','scarpins') THEN RETURN 'Scarpin'; END IF;
  -- Sapato (genérico, não sapatilha/scarpin/etc)
  IF v_norm = 'sapato' THEN RETURN 'Sapato'; END IF;
  -- Tênis (e variações de teclado sem acento)
  IF v_norm IN ('tenis','tênis') THEN RETURN 'Tênis'; END IF;
  -- Sapatênis
  IF v_norm IN ('sapatenis','sapatênis') THEN RETURN 'Sapatênis'; END IF;
  -- Bota + variações
  IF v_norm IN ('bota','bota_curta','bota_longa','botas') THEN RETURN 'Bota'; END IF;
  -- Botina
  IF v_norm = 'botina' THEN RETURN 'Botina'; END IF;
  -- Infantil
  IF v_norm IN ('infantil','infantis','crianca') THEN RETURN 'Infantil'; END IF;
  -- Sem match (chinelo, generico, Geral, etc) → NULL
  RETURN NULL;
END;
$$;

-- ── 3. Backfill technical_sheets ──
-- Normaliza shoe_category (texto livre) E shoe_category_id (FK)
DO $$
DECLARE
  v_count_mapped int := 0;
  v_count_unmapped int := 0;
  r RECORD;
  v_norm text;
  v_cat_id uuid;
BEGIN
  FOR r IN
    SELECT id, shoe_category, shoe_category_id
      FROM public.technical_sheets
     WHERE COALESCE(shoe_category,'') <> ''
        OR shoe_category_id IS NOT NULL
  LOOP
    v_norm := public.normalize_shoe_category(r.shoe_category);
    IF v_norm IS NULL THEN
      -- Texto não mapeou — tenta resolver via shoe_category_id existente
      IF r.shoe_category_id IS NOT NULL THEN
        SELECT name INTO v_norm FROM public.silk_shoe_category
         WHERE id = r.shoe_category_id;
        v_norm := public.normalize_shoe_category(v_norm);
      END IF;
    END IF;

    IF v_norm IS NOT NULL THEN
      SELECT id INTO v_cat_id FROM public.silk_shoe_category WHERE name = v_norm;
      UPDATE public.technical_sheets
         SET shoe_category = v_norm,
             shoe_category_id = v_cat_id,
             updated_at = now()
       WHERE id = r.id;
      v_count_mapped := v_count_mapped + 1;
    ELSE
      v_count_unmapped := v_count_unmapped + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Technical sheets: % mapeadas, % sem mapeamento', v_count_mapped, v_count_unmapped;
END $$;

-- ── 4. Normaliza shoe_category nas tabelas de lead time ──
UPDATE public.shoe_category_lead_times
   SET shoe_category = public.normalize_shoe_category(shoe_category)
 WHERE public.normalize_shoe_category(shoe_category) IS NOT NULL;

UPDATE public.default_lead_times
   SET shoe_category = public.normalize_shoe_category(shoe_category)
 WHERE public.normalize_shoe_category(shoe_category) IS NOT NULL;

-- Remove lead times órfãos (categorias que não existem mais)
DELETE FROM public.shoe_category_lead_times
 WHERE public.normalize_shoe_category(shoe_category) IS NULL;

-- ── 5. Normaliza product_references e sole_silk_registrations ──
UPDATE public.product_references
   SET shoe_category = public.normalize_shoe_category(shoe_category)
 WHERE public.normalize_shoe_category(shoe_category) IS NOT NULL;

UPDATE public.sole_silk_registrations
   SET shoe_category = public.normalize_shoe_category(shoe_category)
 WHERE public.normalize_shoe_category(shoe_category) IS NOT NULL;

-- ── 6. View pra ver o que ficou sem mapeamento ──
CREATE OR REPLACE VIEW public.v_shoe_category_unmapped AS
SELECT 'technical_sheets' AS tabela, id::text AS row_id, code, name,
       shoe_category AS categoria_atual
  FROM public.technical_sheets
 WHERE COALESCE(shoe_category,'') <> ''
   AND public.normalize_shoe_category(shoe_category) IS NULL
UNION ALL
SELECT 'product_references', id::text, code, name, shoe_category
  FROM public.product_references
 WHERE COALESCE(shoe_category,'') <> ''
   AND public.normalize_shoe_category(shoe_category) IS NULL
UNION ALL
SELECT 'default_lead_times', shoe_category, NULL, NULL, shoe_category
  FROM public.default_lead_times
 WHERE public.normalize_shoe_category(shoe_category) IS NULL;

COMMENT ON VIEW public.v_shoe_category_unmapped IS
  'Lista fichas/refs/lead-times cujo shoe_category não casou com a lista canônica de 14 valores. Operador deve revisar e cadastrar manualmente.';
