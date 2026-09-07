-- Totais manuais por semana. Zero é uma declaração explícita; campos
-- financeiros ausentes não podem nascer como zero por DEFAULT.
CREATE TABLE public.cfo_semanas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.cfo_planos(id) ON DELETE RESTRICT,
  semana_inicio date NOT NULL,
  contas_semana numeric(14, 2) NOT NULL
    CHECK (contas_semana >= 0 AND contas_semana < 'Infinity'::numeric),
  reinvestimento numeric(14, 2) NOT NULL
    CHECK (reinvestimento >= 0 AND reinvestimento < 'Infinity'::numeric),
  pares_produzidos integer CHECK (pares_produzidos >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cfo_semanas_plano_semana_key UNIQUE (plano_id, semana_inicio),
  CONSTRAINT cfo_semanas_segunda_iso CHECK (
    isfinite(semana_inicio)
    AND semana_inicio BETWEEN date '0001-01-01' AND date '9999-12-31'
    AND EXTRACT(ISODOW FROM semana_inicio) = 1
  )
);

CREATE TRIGGER cfo_semanas_updated_at BEFORE UPDATE ON public.cfo_semanas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cfo_semanas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cfo_semanas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfo_semanas TO authenticated;
GRANT ALL ON public.cfo_semanas TO service_role;

CREATE POLICY cfo_semanas_select ON public.cfo_semanas FOR SELECT TO authenticated
  USING ((SELECT public.can_access_cfo('view')));
CREATE POLICY cfo_semanas_insert ON public.cfo_semanas FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access_cfo('create')));
CREATE POLICY cfo_semanas_update ON public.cfo_semanas FOR UPDATE TO authenticated
  USING ((SELECT public.can_access_cfo('edit'))) WITH CHECK ((SELECT public.can_access_cfo('edit')));
CREATE POLICY cfo_semanas_delete ON public.cfo_semanas FOR DELETE TO authenticated
  USING ((SELECT public.can_access_cfo('delete')));

COMMENT ON TABLE public.cfo_semanas IS 'Contas obrigatórias, reinvestimento manual e pares produzidos informados por semana de segunda a domingo. Não gera títulos financeiros.';
COMMENT ON COLUMN public.cfo_semanas.contas_semana IS 'Total obrigatório informado explicitamente; zero informado é diferente de uma semana ainda não preenchida.';
COMMENT ON COLUMN public.cfo_semanas.reinvestimento IS 'Reinvestimento decidido pelo usuário para esta semana; não usa percentual nem DEFAULT.';
COMMENT ON COLUMN public.cfo_semanas.pares_produzidos IS 'NULL = produção desconhecida; zero = semana sem produção. Quantidade inteira não negativa.';
