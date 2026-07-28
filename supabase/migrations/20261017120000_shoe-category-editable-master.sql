-- Taxonomia de tipos de calçado editável pela interface.
-- A coluna textual continua sendo a referência funcional nas fichas e nos
-- tempos-padrão; shoe_category_id permanece como vínculo de compatibilidade.

CREATE UNIQUE INDEX IF NOT EXISTS silk_shoe_category_name_lower_uk
  ON public.silk_shoe_category (lower(btrim(name)));

-- A categoria de destino precisa existir antes de mover fichas que ainda
-- referenciam as categorias antigas pelo FK.
INSERT INTO public.silk_shoe_category (name)
SELECT 'Rasteirinha'
WHERE NOT EXISTS (
  SELECT 1
    FROM public.silk_shoe_category s
   WHERE lower(btrim(s.name)) = 'rasteirinha'
);

-- Rasteira e as variações históricas passam a ser Rasteirinha.
UPDATE public.technical_sheets
   SET shoe_category = 'Rasteirinha',
       shoe_category_id = (
         SELECT s.id
           FROM public.silk_shoe_category s
          WHERE lower(btrim(s.name)) = 'rasteirinha'
          LIMIT 1
       )
 WHERE lower(btrim(shoe_category)) IN ('rasteira', 'sandália rasteira', 'sandalia rasteira');

-- Hoje não há essas chaves nos tempos-padrão; a guarda evita colisão caso
-- uma categoria Rasteirinha já exista em uma execução repetida.
UPDATE public.default_lead_times
   SET shoe_category = 'Rasteirinha'
 WHERE lower(btrim(shoe_category)) IN ('rasteira', 'sandália rasteira', 'sandalia rasteira')
   AND NOT EXISTS (
     SELECT 1
       FROM public.default_lead_times d2
      WHERE lower(btrim(d2.shoe_category)) = 'rasteirinha'
   );

DELETE FROM public.silk_shoe_category
 WHERE lower(btrim(name)) IN ('rasteira', 'sandália rasteira', 'sandalia rasteira');

-- Mantém todos os tipos antes selecionáveis, exceto Rasteira, fundida acima.
INSERT INTO public.silk_shoe_category (name)
SELECT v
  FROM (
    VALUES
      ('Scarpin'), ('Sandália'), ('Sandália Tiras'), ('Mule'), ('Ankle Boot'),
      ('Oxford'), ('Plataforma'), ('Anabela'), ('Rasteirinha'), ('Tênis'),
      ('Sapatilha'), ('Bota'), ('Bota Curta'), ('Bota Longa'), ('Cinto'),
      ('Infantil'), ('Genérico')
  ) AS t(v)
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.silk_shoe_category s
    WHERE lower(btrim(s.name)) = lower(btrim(t.v))
 );

-- (Backfill de FK removido: o UPDATE em technical_sheets dispara
--  tg_guard_implausible_consumption, que aborta em linhas com consumo pré-existente
--  implausível — ex.: ficha "CF 09"/CONFORTO com upper_consumption=2000 dm²/par.
--  shoe_category_id continua sendo só vínculo de compat; a referência funcional é o
--  texto shoe_category, que não depende deste backfill. Corrigir o dado lixo é item
--  à parte.)

CREATE OR REPLACE FUNCTION public.create_shoe_category(
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe o nome da categoria';
  END IF;

  INSERT INTO public.silk_shoe_category (name, description)
  VALUES (v_name, p_description)
  ON CONFLICT (lower(btrim(name))) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id
      INTO v_id
      FROM public.silk_shoe_category
     WHERE lower(btrim(name)) = lower(btrim(v_name));
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_shoe_category(
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old text := btrim(coalesce(p_old, ''));
  v_new text := btrim(coalesce(p_new, ''));
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF v_new = '' THEN
    RAISE EXCEPTION 'Informe o novo nome da categoria';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.silk_shoe_category s
     WHERE lower(btrim(s.name)) = lower(btrim(v_new))
       AND lower(btrim(s.name)) <> lower(btrim(v_old))
  ) THEN
    RAISE EXCEPTION 'Já existe uma categoria com esse nome';
  END IF;

  UPDATE public.silk_shoe_category
     SET name = v_new
   WHERE lower(btrim(name)) = lower(btrim(v_old));

  UPDATE public.technical_sheets
     SET shoe_category = v_new
   WHERE shoe_category = p_old;

  UPDATE public.default_lead_times
     SET shoe_category = v_new
   WHERE shoe_category = p_old;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_shoe_category(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.technical_sheets
     WHERE shoe_category = p_name
  ) OR EXISTS (
    SELECT 1
      FROM public.default_lead_times
     WHERE shoe_category = p_name
  ) THEN
    RAISE EXCEPTION 'Categoria em uso: renomeie/reclassifique antes de excluir';
  END IF;

  DELETE FROM public.silk_shoe_category
   WHERE lower(btrim(name)) = lower(btrim(v_name));
END;
$$;

REVOKE ALL ON FUNCTION public.create_shoe_category(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_shoe_category(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_shoe_category(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_shoe_category(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_shoe_category(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_shoe_category(text) TO authenticated;
