-- ============================================================================
-- A4 + M17 (auditoria 2026-07-28) — tg_strip_cut_sectors_when_ready_made não
-- remove 'Costura Palmilha' quando insole_ready_made=true.
--
-- Pós-split (20261001120000) o roteiro guarda 'Costura Palmilha', que não
-- casava com a lista de strip da definição viva (só os cortes) — marcar
-- "palmilha pronta na cor" deixava a etapa de costura da palmilha no roteiro,
-- a OP nascia com etapa/ficha de operador que não deveria existir e a UI
-- (READY_MADE_STRIPPED_SECTORS) fingia que o setor tinha sido removido.
--
-- Fix: 'costura palmilha' entra na lista de strip ('costura' legado também —
-- o trg_normalize_production_sectors, que dispara ANTES na ordem alfabética,
-- já o converte pra 'Costura Palmilha'; fica por segurança) e o caminho de
-- restauração (true→false) re-insere 'Costura Palmilha'. 'Costura Cabedal'
-- fica INTOCADA: costura de cabedal independe de palmilha pronta (decisão da
-- fase 1, 20260719170000). Idempotente (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_strip_cut_sectors_when_ready_made()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_arr      jsonb;
  v_required text[] := ARRAY['Corte Palmilha','Corte Forração','Costura Palmilha'];
  v_sector   text;
  v_exists   boolean;
BEGIN
  IF NEW.production_sectors IS NULL THEN
    NEW.production_sectors := '[]'::jsonb;
  END IF;

  IF NEW.insole_ready_made = true THEN
    -- Palmilha pronta dispensa cortar E costurar a PALMILHA. 'Costura Cabedal'
    -- não entra aqui (depende do modelo, não da palmilha). A operação de
    -- costura de palmilha no BOM segue desativada pelo gatilho
    -- tg_disable_costura_palmilha_on_ready_made.
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      INTO v_arr
      FROM jsonb_array_elements_text(NEW.production_sectors) AS t(value)
     WHERE LOWER(TRIM(value)) NOT IN ('corte palmilha','corte forração','corte forracao','costura palmilha','costura');
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
$function$;
