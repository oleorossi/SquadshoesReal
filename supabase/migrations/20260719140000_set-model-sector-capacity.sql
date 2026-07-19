-- =============================================================================
-- ENGINE DE CAPACIDADE — edição de capacidade produtiva NA TELA (aditivo 2 do dono).
--
-- O dono digita PARES/DIA do setor (capacidade observada da equipe atual) e o
-- sistema converte pra min/par:  min/par = headcount × jornada ÷ pares_dia
-- (minutos-PESSOA pagos por par — é isso que o custo-minuto multiplica pela
-- taxa; por isso a conversão NÃO aplica eficiência: a capacidade observada já
-- embute a ineficiência real. A eficiência global segue valendo só na EXIBIÇÃO
-- de pares/dia da engine).
--
-- O valor é gravado no BOM da própria ficha como time_source='manual':
--   • calculate_order_cost_item passa a usar o tempo novo (trigger costs_dirty
--     re-enfileira os PVs sozinho);
--   • get_model_productivity lê como camada 1 ('bom');
--   • outras referências herdam via camada 2 ('ultima_referencia') — o fluxo
--     de setores-padrão pedido na aprovação.
-- NÃO escreve nas colunas *_capacity_per_day da ficha (motor de ondas) — o
-- report capacity_consistency_report acusa divergência quando houver.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_model_sector_capacity(
  p_sheet_id uuid,
  p_sector text,
  p_pairs_per_day numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_key          text;
  v_label        text;
  v_sheet        record;
  v_hc           numeric;
  v_journey      numeric;
  v_rate         numeric;
  v_min          numeric;
  v_target       record;
  v_manual_count integer;
  v_action       text;
BEGIN
  IF p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'p_sheet_id obrigatório';
  END IF;
  IF p_pairs_per_day IS NULL OR p_pairs_per_day <= 0 OR p_pairs_per_day > 100000 THEN
    RAISE EXCEPTION 'Capacidade inválida: informe pares/dia maior que zero';
  END IF;

  v_key := public.capacity_sector_key(p_sector);
  v_label := public.capacity_sector_label(v_key);

  SELECT id, name, production_sectors INTO v_sheet
    FROM technical_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha % não encontrada', p_sheet_id;
  END IF;

  -- O setor precisa pertencer à ficha. Quando production_sectors é a lista viva
  -- (array não-vazio), ela MANDA — linha órfã no BOM (ex.: Costura que saiu da
  -- ficha por palmilha pronta) NÃO autoriza edição, senão alimentaria o custeio
  -- com setor que o modelo nem passa. Fallback pro BOM só quando a ficha não
  -- tem production_sectors (mesma derivação do get_model_productivity).
  IF jsonb_typeof(v_sheet.production_sectors) = 'array'
     AND jsonb_array_length(v_sheet.production_sectors) > 0 THEN
    IF NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(v_sheet.production_sectors) s
          WHERE public.capacity_sector_key(s) = v_key) THEN
      RAISE EXCEPTION '% não é setor de produção da ficha % — se existe linha desse setor no BOM, é órfã (ver aba Operações / report de capacidade)',
        v_label, v_sheet.name;
    END IF;
  ELSIF NOT EXISTS (
       SELECT 1 FROM bom_operations bo
        WHERE bo.sheet_id = p_sheet_id
          AND public.capacity_sector_key(bo.stage) = v_key) THEN
    RAISE EXCEPTION '% não é setor de produção da ficha %', v_label, v_sheet.name;
  END IF;

  SELECT headcount INTO v_hc FROM sector_settings WHERE sector = v_label;
  IF coalesce(v_hc, 0) <= 0 THEN
    RAISE EXCEPTION 'Cadastre a equipe de % primeiro (botão Equipe) — converter pares/dia em min/par exige o headcount do setor', v_label;
  END IF;

  SELECT journey_minutes INTO v_journey FROM capacity_parameters LIMIT 1;
  IF v_journey IS NULL THEN
    RAISE EXCEPTION 'capacity_parameters sem linha — aplicar migration 20260719120000';
  END IF;

  v_min := round(v_hc * v_journey / p_pairs_per_day, 4);
  IF v_min <= 0 THEN
    RAISE EXCEPTION 'Conversão deu 0 min/par — capacidade alta demais pra equipe informada';
  END IF;

  -- Setor com breakdown manual detalhado (várias operações) não é sobrescrito
  -- às cegas por um número único — manda editar onde o detalhe mora.
  SELECT count(*) INTO v_manual_count FROM bom_operations
   WHERE sheet_id = p_sheet_id AND active
     AND time_source IN ('manual', 'cronoanalise')
     AND public.capacity_sector_key(stage) = v_key;
  IF v_manual_count > 1 THEN
    RAISE EXCEPTION '% tem % operações manuais/cronoanálise em % — edite os tempos na aba Operações da ficha',
      v_sheet.name, v_manual_count, v_label;
  END IF;

  SELECT hourly_rate INTO v_rate FROM sector_labor_rates WHERE sector_key = v_key;

  -- Alvo: linha manual/cronoanálise existente > linha gerada > INSERT novo.
  SELECT id INTO v_target FROM bom_operations
   WHERE sheet_id = p_sheet_id
     AND public.capacity_sector_key(stage) = v_key
   ORDER BY CASE WHEN time_source IN ('manual', 'cronoanalise') THEN 0 ELSE 1 END,
            created_at
   LIMIT 1;

  IF v_target.id IS NOT NULL THEN
    UPDATE bom_operations
       SET standard_time_minutes = v_min,
           time_source = 'manual',
           active = true,
           cost_per_hour = CASE WHEN coalesce(cost_per_hour, 0) > 0
                                THEN cost_per_hour ELSE coalesce(v_rate, 0) END,
           notes = format('capacidade_dia:%s pares (equipe %s × %s min)',
                          p_pairs_per_day, v_hc, v_journey),
           updated_at = now()
     WHERE id = v_target.id;
    -- Linha gerada redundante do mesmo setor duplicaria o labor no custeio.
    DELETE FROM bom_operations
     WHERE sheet_id = p_sheet_id AND id <> v_target.id
       AND time_source IN ('capacidade', 'default', 'pendente')
       AND public.capacity_sector_key(stage) = v_key;
    v_action := 'updated';
  ELSE
    INSERT INTO bom_operations
      (sheet_id, operation_name, stage, standard_time_minutes, cost_per_hour,
       sort_order, active, notes, time_source)
    VALUES
      (p_sheet_id, v_label, v_label, v_min, coalesce(v_rate, 0),
       999, true,
       format('capacidade_dia:%s pares (equipe %s × %s min)',
              p_pairs_per_day, v_hc, v_journey),
       'manual');
    v_action := 'inserted';
  END IF;

  RETURN jsonb_build_object(
    'action',           v_action,
    'sector',           v_label,
    'pairs_per_day',    p_pairs_per_day,
    'headcount',        v_hc,
    'journey_minutes',  v_journey,
    'minutes_per_pair', v_min,
    'hourly_rate',      coalesce(v_rate, 0),
    'mo_per_pair',      round(v_min * coalesce(v_rate, 0) / 60.0, 4)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_model_sector_capacity(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_model_sector_capacity(uuid, text, numeric) TO authenticated, service_role;
