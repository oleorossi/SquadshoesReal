-- =============================================================================
-- Padronização de cores entre grupos derivados (ex: Tira Overlock 5mm é feita
-- de Napa Soft; deve poder importar as cores cadastradas da Napa).
--
-- Modelo:
--   • group_color_sources: M:N entre product_groups
--       (group_id = quem herda;  source_group_id = de quem herda)
--   • Importação MANUAL: operador escolhe quais cores importar; sistema só
--     mostra "cores disponíveis nas fontes que ainda não estão na paleta".
--   • Sem auto-criar variâncias em products — paleta = catálogo de cores
--     possíveis; SKU só nasce quando precisar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.group_color_sources (
  group_id        uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  source_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (group_id, source_group_id),
  CONSTRAINT chk_no_self_source CHECK (group_id <> source_group_id)
);

CREATE INDEX IF NOT EXISTS idx_gcs_group  ON public.group_color_sources(group_id);
CREATE INDEX IF NOT EXISTS idx_gcs_source ON public.group_color_sources(source_group_id);

ALTER TABLE public.group_color_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gcs_read  ON public.group_color_sources;
DROP POLICY IF EXISTS gcs_write ON public.group_color_sources;
CREATE POLICY gcs_read  ON public.group_color_sources FOR SELECT USING (public.is_approved_user());
CREATE POLICY gcs_write ON public.group_color_sources FOR ALL    USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

COMMENT ON TABLE public.group_color_sources IS
  'Grupos-origem cujas cores podem ser importadas pra paleta deste grupo. Ex: Tira Overlock 5mm → [Napa Soft, Napa Sudani]. Importação é manual via UI.';

-- =============================================================================
-- Função: cores das fontes que NÃO estão na paleta do próprio grupo.
-- Retorna {color_id, color_name, color_hex, color_pantone, source_group_id,
--          source_group_name}. UI lista isso como "disponíveis pra importar".
-- =============================================================================
DROP FUNCTION IF EXISTS public.list_available_source_colors(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.list_available_source_colors(p_group_id uuid)
RETURNS TABLE(
  color_id          uuid,
  color_name        text,
  color_hex         text,
  color_pantone     text,
  source_group_id   uuid,
  source_group_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sources AS (
    SELECT s.source_group_id, pg.name AS source_group_name
      FROM public.group_color_sources s
      JOIN public.product_groups pg ON pg.id = s.source_group_id
     WHERE s.group_id = p_group_id
  ),
  existing_colors AS (
    SELECT color_id FROM public.group_colors WHERE group_id = p_group_id
  )
  SELECT DISTINCT
    c.id           AS color_id,
    c.nome         AS color_name,
    c.referencia_hex     AS color_hex,
    c.referencia_pantone AS color_pantone,
    s.source_group_id,
    s.source_group_name
    FROM sources s
    JOIN public.group_colors gc ON gc.group_id = s.source_group_id
    JOIN public.colors c        ON c.id = gc.color_id
   WHERE gc.color_id NOT IN (SELECT color_id FROM existing_colors)
   ORDER BY s.source_group_name, c.nome;
$$;

GRANT EXECUTE ON FUNCTION public.list_available_source_colors(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_available_source_colors(uuid) IS
  'Lista cores dos grupos-origem que ainda não estão na paleta deste grupo. Usado na UI pra mostrar "disponíveis pra importar".';
