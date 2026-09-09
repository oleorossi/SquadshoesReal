-- Planejamento gerencial compartilhado. Nenhum lançamento altera contas,
-- bancos, estoque ou o pedido de venda vinculado.
CREATE TABLE public.cfo_planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  data_inicio date NOT NULL CHECK (isfinite(data_inicio)),
  data_fim date NOT NULL CHECK (isfinite(data_fim)),
  saldo_inicial numeric(14, 2) NOT NULL DEFAULT 0
    CHECK (saldo_inicial > '-Infinity'::numeric AND saldo_inicial < 'Infinity'::numeric),
  reserva_minima numeric(14, 2) NOT NULL DEFAULT 0
    CHECK (reserva_minima >= 0 AND reserva_minima < 'Infinity'::numeric),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cfo_planos_periodo CHECK (
    data_fim >= data_inicio AND data_fim <= (data_inicio + interval '2 years')::date
  )
);

CREATE TABLE public.cfo_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.cfo_planos(id) ON DELETE RESTRICT,
  pedido_venda_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 240),
  entrega_em date NOT NULL CHECK (isfinite(entrega_em)),
  lucro_informado numeric(14, 2) NOT NULL DEFAULT 0
    CHECK (lucro_informado > '-Infinity'::numeric AND lucro_informado < 'Infinity'::numeric),
  lucro_liquido boolean NOT NULL DEFAULT true,
  receita_total numeric(14, 2)
    CHECK (receita_total >= 0 AND receita_total < 'Infinity'::numeric),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cfo_pedidos_plano_id_id_key UNIQUE (plano_id, id)
);

CREATE TABLE public.cfo_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.cfo_planos(id) ON DELETE RESTRICT,
  pedido_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('recebimento', 'material', 'despesa', 'aporte', 'retirada')),
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 240),
  data_prevista date NOT NULL CHECK (isfinite(data_prevista)),
  valor_previsto numeric(14, 2) NOT NULL CHECK (valor_previsto >= 0 AND valor_previsto < 'Infinity'::numeric),
  data_realizada date CHECK (isfinite(data_realizada)),
  valor_realizado numeric(14, 2) CHECK (valor_realizado >= 0 AND valor_realizado < 'Infinity'::numeric),
  status text NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto', 'realizado', 'cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cfo_lancamentos_pedido_mesmo_plano FOREIGN KEY (plano_id, pedido_id)
    REFERENCES public.cfo_pedidos(plano_id, id) ON DELETE RESTRICT,
  CONSTRAINT cfo_lancamentos_realizado_completo CHECK (
    status <> 'realizado' OR (data_realizada IS NOT NULL AND valor_realizado IS NOT NULL)
  )
);

CREATE INDEX cfo_pedidos_pedido_venda_idx ON public.cfo_pedidos(pedido_venda_id);
CREATE INDEX cfo_lancamentos_plano_pedido_idx ON public.cfo_lancamentos(plano_id, pedido_id);

CREATE TRIGGER cfo_planos_updated_at BEFORE UPDATE ON public.cfo_planos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER cfo_pedidos_updated_at BEFORE UPDATE ON public.cfo_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER cfo_lancamentos_updated_at BEFORE UPDATE ON public.cfo_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Espelha useCan('/financeiro'). O invocador só consulta suas permissões pela
-- RLS existente de user_permissions; não há função SECURITY DEFINER nova.
CREATE FUNCTION public.can_access_cfo(p_action text DEFAULT 'view')
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_path_permission public.user_permissions%ROWTYPE;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('view', 'create', 'edit', 'delete')
      OR v_user_id IS NULL OR NOT public.is_approved_user() THEN
    RETURN false;
  END IF;
  IF public.has_role(v_user_id, 'admin') THEN RETURN true; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_permissions WHERE user_id = v_user_id AND can_view
  ) THEN
    RETURN public.has_role(v_user_id, 'gerente') OR public.has_role(v_user_id, 'consulta');
  END IF;

  SELECT * INTO v_path_permission FROM public.user_permissions
   WHERE user_id = v_user_id AND module = '/financeiro' AND can_view;
  IF FOUND THEN
    RETURN CASE p_action
      WHEN 'view' THEN true
      WHEN 'create' THEN v_path_permission.can_create
      WHEN 'edit' THEN v_path_permission.can_edit
      WHEN 'delete' THEN v_path_permission.can_delete
    END;
  END IF;

  -- Grants antigos por módulo concedem todas as ações; a linha do path acima
  -- tem prioridade quando ambos existem, inclusive se uma ação estiver negada.
  RETURN EXISTS (
    SELECT 1 FROM public.user_permissions
     WHERE user_id = v_user_id AND module = 'financeiro' AND can_view
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_cfo(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_cfo(text) TO authenticated;

ALTER TABLE public.cfo_planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfo_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfo_lancamentos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cfo_planos, public.cfo_pedidos, public.cfo_lancamentos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfo_planos, public.cfo_pedidos, public.cfo_lancamentos TO authenticated;
GRANT ALL ON public.cfo_planos, public.cfo_pedidos, public.cfo_lancamentos TO service_role;

CREATE POLICY cfo_planos_select ON public.cfo_planos FOR SELECT TO authenticated
  USING ((SELECT public.can_access_cfo('view')));
CREATE POLICY cfo_planos_insert ON public.cfo_planos FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access_cfo('create')));
CREATE POLICY cfo_planos_update ON public.cfo_planos FOR UPDATE TO authenticated
  USING ((SELECT public.can_access_cfo('edit'))) WITH CHECK ((SELECT public.can_access_cfo('edit')));
CREATE POLICY cfo_planos_delete ON public.cfo_planos FOR DELETE TO authenticated
  USING ((SELECT public.can_access_cfo('delete')));

CREATE POLICY cfo_pedidos_select ON public.cfo_pedidos FOR SELECT TO authenticated
  USING ((SELECT public.can_access_cfo('view')));
CREATE POLICY cfo_pedidos_insert ON public.cfo_pedidos FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access_cfo('create')));
CREATE POLICY cfo_pedidos_update ON public.cfo_pedidos FOR UPDATE TO authenticated
  USING ((SELECT public.can_access_cfo('edit'))) WITH CHECK ((SELECT public.can_access_cfo('edit')));
CREATE POLICY cfo_pedidos_delete ON public.cfo_pedidos FOR DELETE TO authenticated
  USING ((SELECT public.can_access_cfo('delete')));

CREATE POLICY cfo_lancamentos_select ON public.cfo_lancamentos FOR SELECT TO authenticated
  USING ((SELECT public.can_access_cfo('view')));
CREATE POLICY cfo_lancamentos_insert ON public.cfo_lancamentos FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access_cfo('create')));
CREATE POLICY cfo_lancamentos_update ON public.cfo_lancamentos FOR UPDATE TO authenticated
  USING ((SELECT public.can_access_cfo('edit'))) WITH CHECK ((SELECT public.can_access_cfo('edit')));
CREATE POLICY cfo_lancamentos_delete ON public.cfo_lancamentos FOR DELETE TO authenticated
  USING ((SELECT public.can_access_cfo('delete')));

COMMENT ON TABLE public.cfo_planos IS 'Cenários compartilhados de projeção gerencial semanal, governados pelas permissões do Financeiro.';
COMMENT ON TABLE public.cfo_pedidos IS 'Lucro informado por entrega. Materiais já descontados não são deduzidos novamente do lucro.';
COMMENT ON TABLE public.cfo_lancamentos IS 'Calendário manual de caixa previsto e realizado. Não gera títulos financeiros nem movimenta estoque/bancos.';
COMMENT ON FUNCTION public.can_access_cfo(text) IS 'Paridade com useCan(/financeiro): aprovado, admin, grants por path/ação ou módulo legado, fallback gerente/consulta.';
