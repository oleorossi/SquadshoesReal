-- =============================================================================
-- COSTURA: cabedal × palmilha — FASE 1 (custo e ficha)
--
-- Decisão do dono (2026-07-19): são DUAS etapas separadas, hoje agrupadas numa
-- só. A separação começa onde ela muda dinheiro — tempo e custo por etapa — sem
-- tocar no fluxo, no Kanban nem na terceirização, que tratam 'Costura' como um
-- estágio único (43 funções SQL, 58 OPs abertas e 282 linhas de programação
-- diária apontam para ele). A separação canônica no fluxo fica para a fase 2.
--
-- Modelo: duas OPERAÇÕES dentro do mesmo stage 'Costura'.
--   • calculate_order_cost_item já soma todas as operações ativas da ficha, logo
--     o custo por par passa a incluir as duas automaticamente;
--   • o motor de capacidade continua agrupando por stage (fluxo intacto);
--   • get_sheet_sector_operations abre o setor nas etapas para a tela mostrar.
--
-- Corrige também o gatilho da palmilha pronta: ele removia a Costura INTEIRA do
-- roteiro, levando junto a costura de CABEDAL. O dono confirmou que ter ou não
-- costura de cabedal "depende do modelo", então o gatilho deixa de decidir isso.
-- =============================================================================

-- 1) A operação que existe hoje é a costura de cabedal (é o que estava lançado).
UPDATE bom_operations
   SET operation_name = 'Costura Cabedal',
       updated_at = now()
 WHERE public.capacity_sector_key(stage) = 'costura'
   AND trim(coalesce(operation_name, '')) IN ('', 'Costura', 'costura');

UPDATE bom_operations
   SET operation_name = 'Costura Cabedal'
 WHERE public.capacity_sector_key(stage) = 'costura'
   AND operation_name = stage;

-- 2) Gatilho da palmilha pronta: não remove mais 'Costura' do roteiro.
--    Palmilha pronta dispensa cortar e costurar a PALMILHA; a costura do CABEDAL
--    depende do modelo e passa a ficar sob controle do usuário.
CREATE OR REPLACE FUNCTION public.tg_strip_cut_sectors_when_ready_made()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_arr      jsonb;
  v_required text[] := ARRAY['Corte Palmilha','Corte Forração'];
  v_sector   text;
  v_exists   boolean;
BEGIN
  IF NEW.production_sectors IS NULL THEN
    NEW.production_sectors := '[]'::jsonb;
  END IF;

  IF NEW.insole_ready_made = true THEN
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      INTO v_arr
      FROM jsonb_array_elements_text(NEW.production_sectors) AS t(value)
     WHERE LOWER(TRIM(value)) NOT IN ('corte palmilha','corte forração','corte forracao');
    NEW.production_sectors := v_arr;
  ELSIF TG_OP = 'UPDATE'
    AND COALESCE(OLD.insole_ready_made, false) = true
    AND COALESCE(NEW.insole_ready_made, false) = false THEN
    FOREACH v_sector IN ARRAY v_required LOOP
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.production_sectors) AS t(value)
         WHERE LOWER(TRIM(value)) = LOWER(v_sector)
      ) INTO v_exists;
      IF NOT v_exists THEN
        NEW.production_sectors := NEW.production_sectors || to_jsonb(v_sector);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Palmilha pronta desativa a OPERAÇÃO de costura de palmilha (não o setor).
CREATE OR REPLACE FUNCTION public.tg_disable_costura_palmilha_on_ready_made()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.insole_ready_made IS DISTINCT FROM coalesce(OLD.insole_ready_made, false) THEN
    UPDATE bom_operations
       SET active = NOT NEW.insole_ready_made,
           updated_at = now()
     WHERE sheet_id = NEW.id
       AND public.capacity_sector_key(stage) = 'costura'
       AND lower(operation_name) LIKE '%palmilha%';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_disable_costura_palmilha ON public.technical_sheets;
CREATE TRIGGER tg_disable_costura_palmilha
  AFTER UPDATE OF insole_ready_made ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_disable_costura_palmilha_on_ready_made();

-- 4) Leitura e escrita das ETAPAS de um setor -------------------------------
CREATE OR REPLACE FUNCTION public.get_sheet_sector_operations(
  p_sheet_id uuid,
  p_sector   text DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  setor       text,
  operacao    text,
  minutos     numeric,
  custo_hora  numeric,
  mo_por_par  numeric,
  time_source text,
  ativa       boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT bo.id,
         public.capacity_sector_label(public.capacity_sector_key(bo.stage)) AS setor,
         coalesce(nullif(trim(bo.operation_name), ''), bo.stage) AS operacao,
         round(bo.standard_time_minutes, 4),
         round(coalesce(bo.cost_per_hour, 0), 4),
         round(bo.standard_time_minutes * coalesce(bo.cost_per_hour, 0) / 60.0, 4),
         bo.time_source,
         bo.active
    FROM bom_operations bo
   WHERE bo.sheet_id = p_sheet_id
     AND (p_sector IS NULL
          OR public.capacity_sector_key(bo.stage) = public.capacity_sector_key(p_sector))
   ORDER BY bo.sort_order, bo.operation_name
$$;

CREATE OR REPLACE FUNCTION public.set_sheet_sector_operation(
  p_sheet_id   uuid,
  p_sector     text,
  p_operacao   text,
  p_minutos    numeric,
  p_custo_hora numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_key    text;
  v_label  text;
  v_nome   text;
  v_rate   numeric;
  v_id     uuid;
  v_action text;
  v_sheet  record;
BEGIN
  IF p_sheet_id IS NULL THEN RAISE EXCEPTION 'Ficha obrigatória'; END IF;
  v_nome := trim(coalesce(p_operacao, ''));
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome da etapa'; END IF;
  IF p_minutos IS NULL OR p_minutos < 0 THEN
    RAISE EXCEPTION 'Tempo inválido: informe minutos por par (0 desativa a etapa)';
  END IF;

  v_key := public.capacity_sector_key(p_sector);
  v_label := public.capacity_sector_label(v_key);

  SELECT id, name, production_sectors INTO v_sheet FROM technical_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha % não encontrada', p_sheet_id; END IF;

  -- Custo-hora: o informado > o do RH para o setor > o cadastro do setor.
  IF p_custo_hora IS NOT NULL AND p_custo_hora >= 0 THEN
    v_rate := p_custo_hora;
  ELSE
    SELECT r.hourly_rate INTO v_rate FROM public.sector_rh_hourly_rate(v_label) r;
    v_rate := coalesce(v_rate, 0);
  END IF;

  SELECT bo.id INTO v_id FROM bom_operations bo
   WHERE bo.sheet_id = p_sheet_id
     AND public.capacity_sector_key(bo.stage) = v_key
     AND lower(trim(bo.operation_name)) = lower(v_nome)
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE bom_operations
       SET standard_time_minutes = p_minutos,
           cost_per_hour = v_rate,
           active = (p_minutos > 0),
           time_source = 'manual',
           updated_at = now()
     WHERE id = v_id;
    v_action := 'updated';
  ELSE
    INSERT INTO bom_operations
      (sheet_id, operation_name, stage, standard_time_minutes, cost_per_hour,
       sort_order, active, notes, time_source)
    VALUES
      (p_sheet_id, v_nome, v_label, p_minutos, v_rate,
       (SELECT coalesce(max(sort_order), 0) + 1 FROM bom_operations WHERE sheet_id = p_sheet_id),
       (p_minutos > 0), 'etapa informada na tela de produtividade', 'manual')
    RETURNING id INTO v_id;
    v_action := 'inserted';
  END IF;

  RETURN jsonb_build_object(
    'action', v_action, 'id', v_id, 'setor', v_label, 'operacao', v_nome,
    'minutos', p_minutos, 'custo_hora', v_rate,
    'mo_por_par', round(p_minutos * v_rate / 60.0, 4));
END;
$$;

REVOKE ALL ON FUNCTION public.get_sheet_sector_operations(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_sheet_sector_operation(uuid, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sheet_sector_operations(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_sheet_sector_operation(uuid, text, text, numeric, numeric) TO authenticated, service_role;
