-- ─────────────────────────────────────────────────────────────────────────────
-- trg_strip_cut_sectors_when_ready_made: restaurar setores SÓ na transição
-- real true→false de insole_ready_made.
--
-- Bug (auditoria 2026-06-11 das fichas de operador): o fix D5
-- (20260627129000) tornou o trigger "bidirecional" — ao desligar
-- insole_ready_made, restaura Corte Palmilha/Corte Forração/Costura. Mas o
-- ramo ELSE rodava em QUALQUER INSERT/UPDATE de production_sectors com
-- insole_ready_made=false, sem comparar OLD→NEW: o usuário desmarcava
-- Costura (ou Corte Palmilha/Corte Forração) no editor de roteiro, o toast
-- de sucesso aparecia, e o trigger re-adicionava os 3 setores em silêncio.
-- Resultado na impressão: ficha do setor aparecia no relatório mesmo o
-- usuário tendo tirado o setor do roteiro ("setor aparece sem estar
-- relacionado"). Também explica por que TODAS as fichas do banco têm
-- roteiro completo.
--
-- Semântica nova:
--   • insole_ready_made=true  → continua removendo os 3 setores (inalterado);
--   • UPDATE com transição true→false → restaura os 3 (intenção original do
--     D5: re-ligar o roteiro de corte que o strip tirou);
--   • qualquer outro caso (INSERT com false, UPDATE mantendo false) →
--     respeita a lista enviada pelo usuário.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_strip_cut_sectors_when_ready_made()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_arr jsonb;
  v_required text[] := ARRAY['Corte Palmilha','Corte Forração','Costura'];
  v_sector text;
  v_exists boolean;
BEGIN
  IF NEW.production_sectors IS NULL THEN
    NEW.production_sectors := '[]'::jsonb;
  END IF;

  IF NEW.insole_ready_made = true THEN
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      INTO v_arr
      FROM jsonb_array_elements_text(NEW.production_sectors) AS t(value)
     WHERE LOWER(TRIM(value)) NOT IN ('corte palmilha','corte forração','corte forracao','costura');
    NEW.production_sectors := v_arr;
  ELSIF TG_OP = 'UPDATE'
    AND COALESCE(OLD.insole_ready_made, false) = true
    AND COALESCE(NEW.insole_ready_made, false) = false THEN
    -- Transição real "pronta na cor" → desligada: restaura o roteiro de
    -- corte/costura que o strip removeu enquanto a flag esteve ligada.
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
  -- Demais casos: respeita production_sectors enviado (edição manual do
  -- roteiro deixa de ser silenciosamente desfeita).

  RETURN NEW;
END;
$function$;
