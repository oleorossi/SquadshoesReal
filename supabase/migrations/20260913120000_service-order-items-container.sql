-- =============================================================================
-- OS consolidada por prestador — FASE 1 (fundação, ADITIVA)
-- Ver specs/os-consolidada-por-prestador.md
-- =============================================================================
--
-- Transforma a Ordem de Serviço num CONTÊINER por prestador com LINHAS
-- (service_order_items). Cada linha = uma demanda (tira/serviço/OP×setor/avulso)
-- com seu PV, OP, material, quantidade em DUAS unidades (base + metros) e status
-- de entrega próprio.
--
-- Esta fase é 100% ADITIVA e NÃO altera dados/comportamento existentes:
--   • cria a tabela de linhas + índices + RLS;
--   • cria os RPCs find-or-create (1 OS aberta por prestador) e add-line (idempotente);
--   • cria o trigger de rollup (total do cabeçalho + conclusão quando todas as
--     linhas entregam).
-- O ÍNDICE ÚNICO "1 OS aberta por prestador" e a MIGRAÇÃO das OS pendentes
-- existentes (destrutivos) ficam para o cutover (fase posterior) — hoje ainda há
-- várias OS pendentes por prestador (modelo flat), que violariam o índice.
-- =============================================================================

-- ── 1) Tabela de LINHAS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id  uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  -- Origem da demanda (o cabeçalho agrega os DISTINTOS destes)
  sale_order_id     uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  order_id          uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  target_sector     text,
  sector            text,
  -- Descrição do serviço/material
  material_name     text NOT NULL DEFAULT '',
  description       text NOT NULL DEFAULT '',
  color             text,
  -- DUAS unidades: quantidade base (par/un) + metragem (metro linear do material
  -- de corte). meters NULL quando é serviço puro (pesponto/costura), sem material.
  quantity          numeric NOT NULL DEFAULT 0,   -- unidade base (ex.: pares)
  unit              text NOT NULL DEFAULT 'par',
  meters            numeric,                       -- 2ª unidade (metro) — geralmente é metro
  -- Financeiro (tarifa × quantidade); firmado na ENTREGA da linha (fase 4)
  unit_price        numeric NOT NULL DEFAULT 0,
  total_value       numeric NOT NULL DEFAULT 0,
  -- Entrega parcial por linha
  line_status       text NOT NULL DEFAULT 'Pendente',   -- Pendente | Entregue | Cancelado
  delivered_at      timestamptz,
  delivered_qty     numeric,
  payable_id        uuid REFERENCES public.accounts_payable(id) ON DELETE SET NULL,
  -- Idempotência (mesma demanda não duplica linha)
  source_item_key   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soi_service_order ON public.service_order_items (service_order_id);
CREATE INDEX IF NOT EXISTS idx_soi_sale_order    ON public.service_order_items (sale_order_id);
CREATE INDEX IF NOT EXISTS idx_soi_order         ON public.service_order_items (order_id);
-- Idempotência: (OS, source_item_key). NULLs não conflitam (avulso sem chave = livre).
CREATE UNIQUE INDEX IF NOT EXISTS uq_soi_source ON public.service_order_items (service_order_id, source_item_key);

COMMENT ON TABLE public.service_order_items IS
  'Linhas da OS consolidada por prestador. 1 linha = 1 demanda (tira/serviço/OP×setor/avulso). quantity=unidade base (pares), meters=metragem do material de corte. Ver specs/os-consolidada-por-prestador.md';

-- ── 2) RLS (padrão is_approved_user — NÃO esquecer, senão INSERT bloqueia) ───
ALTER TABLE public.service_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "approved_select" ON public.service_order_items;
DROP POLICY IF EXISTS "approved_insert" ON public.service_order_items;
DROP POLICY IF EXISTS "approved_update" ON public.service_order_items;
DROP POLICY IF EXISTS "approved_delete" ON public.service_order_items;
CREATE POLICY "approved_select" ON public.service_order_items FOR SELECT TO authenticated USING ((SELECT public.is_approved_user()));
CREATE POLICY "approved_insert" ON public.service_order_items FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_approved_user()));
CREATE POLICY "approved_update" ON public.service_order_items FOR UPDATE TO authenticated USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));
CREATE POLICY "approved_delete" ON public.service_order_items FOR DELETE TO authenticated USING ((SELECT public.is_approved_user()));

-- ── 3) find-or-create da OS ABERTA do prestador ─────────────────────────────
-- "Aberta" = status Pendente (acumula). Advisory lock por contractor evita a
-- corrida de dois inserts criando duas OS abertas. Enquanto o índice único
-- (cutover) não existe, o RPC é o guardião do invariante "1 aberta por prestador".
CREATE OR REPLACE FUNCTION public.get_or_create_open_service_order(p_contractor_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuário não aprovado'; END IF;
  IF p_contractor_id IS NULL THEN RAISE EXCEPTION 'contractor_id obrigatório'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('open_os:' || p_contractor_id::text));

  SELECT id INTO v_id
    FROM public.service_orders
   WHERE contractor_id = p_contractor_id
     AND lower(btrim(status)) IN ('pendente', 'pending')
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.service_orders (contractor_id, status, service_date, description, notes)
    VALUES (p_contractor_id, 'Pendente', CURRENT_DATE, '', '')
    RETURNING id INTO v_id;   -- trigger BEFORE INSERT atribui order_number 'OS-#####'
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_or_create_open_service_order(uuid) TO authenticated;

-- ── 4) add-line: insere/atualiza uma linha na OS aberta (idempotente) ────────
CREATE OR REPLACE FUNCTION public.add_service_order_line(
  p_contractor_id  uuid,
  p_source_item_key text,
  p_material_name  text,
  p_description    text    DEFAULT '',
  p_sale_order_id  uuid    DEFAULT NULL,
  p_order_id       uuid    DEFAULT NULL,
  p_target_sector  text    DEFAULT NULL,
  p_color          text    DEFAULT NULL,
  p_quantity       numeric DEFAULT 0,
  p_unit           text    DEFAULT 'par',
  p_meters         numeric DEFAULT NULL,
  p_unit_price     numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_os uuid; v_line uuid;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuário não aprovado'; END IF;

  v_os := public.get_or_create_open_service_order(p_contractor_id);

  INSERT INTO public.service_order_items (
    service_order_id, source_item_key, material_name, description, sale_order_id, order_id,
    target_sector, sector, color, quantity, unit, meters, unit_price, total_value, line_status
  ) VALUES (
    v_os, NULLIF(btrim(p_source_item_key), ''), COALESCE(p_material_name, ''), COALESCE(p_description, ''),
    p_sale_order_id, p_order_id, p_target_sector, p_target_sector, p_color,
    COALESCE(p_quantity, 0), COALESCE(NULLIF(btrim(p_unit), ''), 'par'), p_meters,
    COALESCE(p_unit_price, 0), COALESCE(p_quantity, 0) * COALESCE(p_unit_price, 0), 'Pendente'
  )
  ON CONFLICT (service_order_id, source_item_key) DO UPDATE
    SET material_name = EXCLUDED.material_name,
        description   = EXCLUDED.description,
        color         = EXCLUDED.color,
        quantity      = EXCLUDED.quantity,
        unit          = EXCLUDED.unit,
        meters        = EXCLUDED.meters,
        unit_price    = EXCLUDED.unit_price,
        total_value   = EXCLUDED.total_value,
        updated_at    = now()
    -- só atualiza linha ainda pendente (não mexe em algo já entregue)
    WHERE service_order_items.line_status = 'Pendente'
  RETURNING id INTO v_line;

  RETURN jsonb_build_object('service_order_id', v_os, 'line_id', v_line);
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_service_order_line(uuid, text, text, text, uuid, uuid, text, text, numeric, text, numeric, numeric) TO authenticated;

-- ── 5) rollup: total do cabeçalho + conclui quando todas as linhas entregam ──
CREATE OR REPLACE FUNCTION public.tg_service_order_rollup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_os      uuid;
  v_total   numeric;
  v_meters  numeric;
  v_pend    integer;
  v_active  integer;
  v_cur     text;
BEGIN
  v_os := COALESCE(NEW.service_order_id, OLD.service_order_id);
  IF v_os IS NULL THEN RETURN NULL; END IF;

  SELECT
    COALESCE(SUM(total_value) FILTER (WHERE line_status <> 'Cancelado'), 0),
    COALESCE(SUM(meters)      FILTER (WHERE line_status <> 'Cancelado'), 0),
    COUNT(*) FILTER (WHERE line_status = 'Pendente'),
    COUNT(*) FILTER (WHERE line_status <> 'Cancelado')
  INTO v_total, v_meters, v_pend, v_active
  FROM public.service_order_items
  WHERE service_order_id = v_os;

  SELECT status INTO v_cur FROM public.service_orders WHERE id = v_os;

  UPDATE public.service_orders
     SET total_value = v_total,
         -- Conclui quando há linhas ativas e NENHUMA pendente (todas entregues),
         -- e a OS não está cancelada/já concluída. (A entrega só acontece após o
         -- envio — regra do app.)
         status = CASE
           WHEN v_active > 0 AND v_pend = 0
                AND lower(btrim(v_cur)) NOT IN ('cancelado','cancelada','cancelled','concluído','concluido','finalizado')
             THEN 'Concluído'
           ELSE status END,
         updated_at = now()
   WHERE id = v_os;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_soi_rollup ON public.service_order_items;
CREATE TRIGGER trg_soi_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.service_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_order_rollup();

-- ── 6) Read model: agrega PV/OP distintos por OS (pro cabeçalho da tela) ─────
CREATE OR REPLACE VIEW public.v_service_order_refs AS
SELECT
  soi.service_order_id,
  ARRAY_AGG(DISTINCT so.order_number) FILTER (WHERE so.order_number IS NOT NULL)  AS pv_numbers,
  ARRAY_AGG(DISTINCT o.order_number)  FILTER (WHERE o.order_number IS NOT NULL)   AS op_numbers,
  COUNT(*)                                                                        AS line_count,
  COUNT(*) FILTER (WHERE soi.line_status = 'Entregue')                            AS delivered_count,
  COALESCE(SUM(soi.meters) FILTER (WHERE soi.line_status <> 'Cancelado'), 0)      AS total_meters
FROM public.service_order_items soi
LEFT JOIN public.sale_orders so ON so.id = soi.sale_order_id
LEFT JOIN public.orders o       ON o.id = soi.order_id
GROUP BY soi.service_order_id;

GRANT SELECT ON public.v_service_order_refs TO authenticated;
