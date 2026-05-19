-- Adiciona categoria "Conforto" à lista canônica de calçados.
--
-- Pedido user 19/05/2026: criar nova categoria de sandália CONFORTO.
-- Era a 15ª categoria — antes tinha 14 (unificadas em 18/05 via
-- migration 20260518130000_unify-shoe-categories.sql):
--   Sandália · Rasteirinha · Tamanco · Mule · Plataforma · Anabela ·
--   Sapatilha · Scarpin · Sapato · Tênis · Sapatênis · Bota · Botina · Infantil
--
-- Agora vira 15:
--   ... + Conforto

-- ── 1. Insere na tabela canônica ──
INSERT INTO public.silk_shoe_category (name)
VALUES ('Conforto')
ON CONFLICT (name) DO NOTHING;

-- ── 2. Atualiza normalize_shoe_category pra reconhecer "Conforto" e variações ──
-- Aceita: conforto, confort, comfort (pra digitação errada em inglês),
-- "linha conforto" (alguns ficheiros antigos vinham com prefixo).
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
  -- Conforto (NOVO 19/05/2026) + variações comuns
  IF v_norm IN ('conforto','confort','comfort','linha conforto') THEN RETURN 'Conforto'; END IF;
  -- Sem match (chinelo, generico, Geral, etc) → NULL
  RETURN NULL;
END;
$$;

-- ── 3. Atualiza guard de DELETE na tabela canônica ──
-- A migration original (20260518130000) tinha um DELETE que removia
-- categorias fora da lista. Recriamos aqui pra incluir "Conforto" e
-- não apagá-la por engano caso alguém rode esse cleanup de novo.
-- (Defensivo — o DELETE original já rodou no histórico; isso é só
-- pra ficar idempotente se rerodar.)
DELETE FROM public.silk_shoe_category
 WHERE name NOT IN ('Sandália','Rasteirinha','Tamanco','Mule','Plataforma',
                    'Anabela','Sapatilha','Scarpin','Sapato','Tênis',
                    'Sapatênis','Bota','Botina','Infantil','Conforto')
   AND NOT EXISTS (
     SELECT 1 FROM public.technical_sheets ts
      WHERE ts.shoe_category_id = silk_shoe_category.id
   );

COMMENT ON FUNCTION public.normalize_shoe_category(text) IS
  'Normaliza texto livre de categoria pra valor canônico (15 valores). Retorna NULL pra inputs sem match. Atualizado 19/05/2026: adiciona Conforto.';
