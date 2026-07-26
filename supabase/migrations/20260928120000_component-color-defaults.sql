-- =============================================================================
-- 20260928120000 — Padrões GLOBAIS de componente por cor (component_color_defaults)
-- =============================================================================
-- Problema: o painel "Componentes por Cor" da ficha exige configurar, ficha a
-- ficha e cor a cor, qual SKU do grupo é usado. Mas vários componentes são
-- padrão POR COR em qualquer modelo (ex.: todo modelo que usa TIRA STRASS 6MM
-- na cor Preta consome a tira "preto com fundo preto"). Repetir isso em cada
-- ficha é retrabalho e fonte de erro.
--
-- Solução: regra GLOBAL (grupo de componente + cor do cabedal/PV) → produto,
-- no molde da irmã sole_color_conjugations (regra por grupo, is_default como
-- catch-all), mas mapeando pra PRODUCT_ID (como technical_sheet_sole_colors).
--
-- Contrato ("re-colorir, não adicionar"):
--   • A ficha continua declarando os componentes e a QUANTIDADE
--     (direct_components / strap_colors). A regra só resolve QUAL SKU do grupo
--     usar conforme a cor do pedido. Ficha que não usa o grupo não é afetada.
--   • A lista por-cor manual da ficha (technical_sheet_component_colors)
--     SEMPRE vence a regra global (replace-all, comportamento intocado).
--   • Linha default (catch-all do grupo): cabedal_color = '*' + is_default.
--     Regra de cor exata vence o default.
--
-- Quem consome a regra:
--   • calculate_order_consumption_by_grade (mig 20260928121000) — e por herança
--     débito (hybrid_debit_stock_for_order via snapshot), reserva
--     (try_reserve_materials deriva do motor), custeio (calculate_order_cost*),
--     compras por PV (compute_materials_per_pv) e MRP (get_wave_material_needs).
--   • order_strap_needs / debit_strap_stock / check_stock_availability
--     (mig 20260929120000) — prioridade 0 na resolução de tiras.
--   • Motores TS em paridade: src/lib/orderConsumption.ts, bomConsumption.ts,
--     strapShortages.ts.

-- 1) Tabela.
CREATE TABLE IF NOT EXISTS public.component_color_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  cabedal_color text NOT NULL,   -- cor do item do PV (= sale_order_items.color); '*' na linha default
  product_id uuid NOT NULL REFERENCES public.products(id),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.component_color_defaults IS
  'Regra GLOBAL: grupo de componente + cor do cabedal (PV) → produto padrão. '
  'Vale pra TODA ficha que use o grupo (componentes diretos e tiras); a ficha só '
  'define a quantidade. Lista por-cor da ficha (technical_sheet_component_colors) '
  'tem precedência. is_default = catch-all do grupo (cabedal_color = ''*'').';

-- Unicidade case-insensitive por (grupo, cor). Sem unaccent (não é IMMUTABLE);
-- mesma justificativa do uq_component_color (20260906120000).
CREATE UNIQUE INDEX IF NOT EXISTS uq_component_color_default
  ON public.component_color_defaults(group_id, lower(btrim(cabedal_color)));

-- Apenas UMA regra default (catch-all) por grupo — molde da irmã
-- idx_sole_color_conjugations_one_default.
CREATE UNIQUE INDEX IF NOT EXISTS idx_component_color_defaults_one_default
  ON public.component_color_defaults(group_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_component_color_defaults_group_active
  ON public.component_color_defaults(group_id, active);

-- 2) RLS — espelha technical_sheet_component_colors (is_approved_user em todo CRUD).
ALTER TABLE public.component_color_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approved_select ON public.component_color_defaults;
DROP POLICY IF EXISTS approved_insert ON public.component_color_defaults;
DROP POLICY IF EXISTS approved_update ON public.component_color_defaults;
DROP POLICY IF EXISTS approved_delete ON public.component_color_defaults;

CREATE POLICY approved_select ON public.component_color_defaults
  FOR SELECT TO authenticated USING ((SELECT public.is_approved_user()));
CREATE POLICY approved_insert ON public.component_color_defaults
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_approved_user()));
CREATE POLICY approved_update ON public.component_color_defaults
  FOR UPDATE TO authenticated USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));
CREATE POLICY approved_delete ON public.component_color_defaults
  FOR DELETE TO authenticated USING ((SELECT public.is_approved_user()));

-- 3) Invalidação (malha da 20260920130000): editar/criar/apagar regra muda o
--    consumo de TODA ficha que usa o grupo — custos ficam dirty, snapshot
--    congelado vira outdated e reservas precisam reavaliar. Fan-out por grupo:
--    fichas cujo direct_components aponta produto do grupo + fichas com tira
--    (strap_colors) do grupo. PVs derivam da ficha dentro do helper.
-- Mapeia um GRUPO de componente para as fichas que o usam (direct_components
-- apontando produto do grupo, ou tira do grupo em strap_colors) e invalida
-- cada uma — mesmo espírito de mark_pv_costs_dirty_for_sole.
CREATE OR REPLACE FUNCTION public.mark_pv_costs_dirty_for_component_group(p_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet uuid;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_sheet IN
    SELECT DISTINCT ts.id
      FROM public.technical_sheets ts
     WHERE (
             jsonb_typeof(ts.direct_components) = 'array'
             AND EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(ts.direct_components) dc
                 JOIN public.products p ON p.id::text = NULLIF(dc ->> 'product_id', '')
                WHERE p.group_id = p_group_id
             )
           )
        OR (
             jsonb_typeof(ts.strap_colors) = 'array'
             AND EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(ts.strap_colors) sc
                WHERE NULLIF(sc ->> 'group_id', '') = p_group_id::text
             )
           )
  LOOP
    PERFORM public.mark_pv_costs_dirty_for_sheet(v_sheet);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_component_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- UPDATE sem mudança real (re-save da UI) não invalida nada.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;

  PERFORM public.mark_pv_costs_dirty_for_component_group(COALESCE(NEW.group_id, OLD.group_id));
  IF TG_OP = 'UPDATE' AND NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    PERFORM public.mark_pv_costs_dirty_for_component_group(OLD.group_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_component_defaults
  ON public.component_color_defaults;
CREATE TRIGGER trg_mark_so_costs_dirty_from_component_defaults
  AFTER INSERT OR UPDATE OR DELETE ON public.component_color_defaults
  FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_component_defaults();
