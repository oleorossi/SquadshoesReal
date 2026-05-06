-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ MIGRATION CONSOLIDADA — fluxo de setores, mesa independente e dias úteis  ║
-- ║                                                                            ║
-- ║ Esta migration é a fonte canônica de verdade para:                        ║
-- ║   1. stage_order()         → mapa de níveis dos setores                   ║
-- ║   2. stage_starts_with_wave() → quais setores iniciam junto com a onda   ║
-- ║   3. start_wave()          → inicia Corte (nível 1) + Mesa (independente) ║
-- ║   4. add_business_days()   → soma/subtração em dias ÚTEIS (seg-sex)       ║
-- ║   5. compute_wave_timeline() → cronograma usando dias úteis              ║
-- ║                                                                            ║
-- ║ Substitui as definições anteriores espalhadas em:                         ║
-- ║   20260429140000_mesa-wave-sector.sql       (versão obsoleta)             ║
-- ║   20260429150000_reposition-mesa-after-costura.sql (obsoleta)             ║
-- ║   20260429170000_palmilha-wave-sector.sql   (parte: stage_order)          ║
-- ║   20260429180000_mesa-parallel-with-corte.sql (obsoleta)                  ║
-- ║   20260429190000_mesa-independent-stage.sql (obsoleta)                    ║
-- ║   20260428190000_wave-material-intelligence.sql (compute_wave_timeline)   ║
-- ║                                                                            ║
-- ║ NOTA: as migrations antigas continuam no histórico para auditoria mas as  ║
-- ║ funções aqui definidas são as ATIVAS (CREATE OR REPLACE sobrescreve).     ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- ── 1. stage_order — mapa de níveis ──────────────────────────────────────────
-- Define o nível de execução de cada setor. Setores com o mesmo nível executam
-- em paralelo. advance_wave_stage só avança ao próximo nível quando todos os
-- estágios do nível atual estiverem 'completed'.
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 2  -- inicia junto com Corte (independente), aguarda no nível 2
    WHEN 'palmilha'   THEN 2
    WHEN 'costura'    THEN 2
    WHEN 'montagem'   THEN 3
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

-- ── 2. stage_starts_with_wave — quais setores iniciam imediatamente ──────────
-- Encapsula a regra "este setor inicia junto com a onda" (em vez de hardcoded
-- 'mesa' espalhado pelo código). Adicionar novos setores independentes aqui.
CREATE OR REPLACE FUNCTION public.stage_starts_with_wave(s production_stage_enum)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT s = 'mesa';  -- Mesa é independente: começa quando a onda começa
$$;

-- ── 3. start_wave — usa stage_starts_with_wave em vez de hardcoded 'mesa' ────
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now           timestamptz := now();
  v_first_stage   production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Inicia: estágios de nível 1 (Corte) + qualquer estágio independente (Mesa).
  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status   = 'pending'
     AND (stage_order(stage) = 1 OR stage_starts_with_wave(stage));

  -- current_stage aponta para Corte (estágio principal de nível 1)
  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = 1
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage = v_first_stage,
         started_at    = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.stage_starts_with_wave(production_stage_enum) TO authenticated;

-- ── 4. add_business_days — soma de dias úteis (seg-sex, ignora feriados) ─────
-- Não considera feriados nacionais/estaduais por enquanto. Para suportar
-- feriados, criar tabela `holidays(date)` e cruzar aqui.
-- p_days pode ser negativo (subtração).
CREATE OR REPLACE FUNCTION public.add_business_days(p_start date, p_days int)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_date  date := p_start;
  v_step  int  := CASE WHEN p_days >= 0 THEN 1 ELSE -1 END;
  v_left  int  := abs(p_days);
BEGIN
  IF p_start IS NULL THEN RETURN NULL; END IF;
  WHILE v_left > 0 LOOP
    v_date := v_date + v_step;
    -- 1=Mon … 5=Fri são úteis; 6=Sat, 7=Sun são fim de semana
    IF EXTRACT(ISODOW FROM v_date) BETWEEN 1 AND 5 THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN v_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_business_days(date, int) TO authenticated;

-- ── 5. compute_wave_timeline — cronograma em DIAS ÚTEIS ──────────────────────
-- Substitui a versão anterior (subtração corrida) para evitar planejar início
-- em fim de semana. Mantém a mesma assinatura — chamadores não precisam mudar.
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline    date,
  corte_start_date     date,
  costura_start_date   date,
  montagem_start_date  date,
  acabamento_start_date date,
  material_ready_date  date,
  purchase_deadline    date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(MAX(ts.lead_time_corte_dias),           2),
    COALESCE(MAX(ts.lead_time_costura_dias),         3),
    COALESCE(MAX(ts.lead_time_montagem_dias),        2),
    COALESCE(MAX(ts.lead_time_acabamento_dias),      1),
    COALESCE(MAX(ts.lead_time_buffer_material_dias), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7)
    INTO v_lead_supplier
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    JOIN products p ON p.id = sm.product_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  RETURN QUERY SELECT
    v_deadline                                                                         AS earliest_deadline,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte))  AS corte_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura))                 AS costura_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem))                                  AS montagem_start_date,
    add_business_days(v_deadline, -v_lead_acab)                                                       AS acabamento_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte + v_lead_buffer))                 AS material_ready_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte + v_lead_buffer + v_lead_supplier)) AS purchase_deadline;
END;
$$;

-- ── 6. Comentário de design — solado debita em pares (sem waste) ─────────────
COMMENT ON FUNCTION public.debit_sole_stock_by_grade(uuid, uuid, text, jsonb) IS
  'Debita estoque de solado por grade. Solado é consumido em PARES (1 par por par produzido), portanto NÃO aplica waste_pct — diferente de cabedal/forro/palmilha que são debitados por área (dm²) com desperdício de corte.';
