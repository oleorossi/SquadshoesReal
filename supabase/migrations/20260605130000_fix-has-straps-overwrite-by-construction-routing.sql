-- =============================================================================
-- BUG GRAVE — has_straps zerado em todo save da ficha técnica
-- =============================================================================
--
-- 🔴 Sintoma reportado pelo usuário: ao salvar a ficha técnica de uma
--    referência e reabrir, a seção "Configuração de Tiras" some por
--    completo — "não tem nem tira habilitado". Material e consumo por
--    numeração das tiras já preenchidos pareciam ter sido perdidos.
--
-- 🕵️ Causa raiz: o trigger `trg_sync_construction_routing` (criado em
--    20260418184456) dispara em BEFORE UPDATE OF construction_type e
--    sobrescreve `NEW.has_straps` baseado no construction_type:
--
--      construction_type='corte_costura' → has_straps := false
--      construction_type='corte_fio'     → has_straps := false
--      construction_type='tiras'         → has_straps := true
--      construction_type='misto'         → has_straps := true
--
--    O default é 'corte_costura' e o frontend SEMPRE inclui
--    construction_type no payload do UPDATE (vem do useState do form).
--    Logo, todo save zerava has_straps mesmo quando o usuário tinha
--    acabado de marcar a checkbox e preencher as tiras.
--
--    Existe um trigger irmão `tg_sync_has_straps_with_strap_colors` que
--    derivaria has_straps=true automaticamente quando strap_colors tem
--    algum item real. Mas pela ordem alfabética dos triggers (tg_ < trg_),
--    ele rodava ANTES de sync_construction_routing e perdia a corrida.
--
-- 💥 Impacto adicional: como a UI condiciona TODA a seção de tiras a
--    `form.has_straps` (`{form.has_straps && (...)}` em TechnicalSheets.tsx),
--    quando has_straps voltava false a UI escondia tudo — strap_colors,
--    material por tira, consumo por numeração — dando a impressão que
--    todos esses dados também tinham sumido. Eles continuavam no DB
--    (preservados em strap_colors JSONB), só não eram renderizados.
--
-- ✅ Fix:
--   1. Reescrever `sync_construction_routing()` removendo APENAS as linhas
--      `NEW.has_straps := ...` — mantendo requires_cutting, requires_sewing,
--      requires_cutting_cabedal (esses são consistentes com construction_type).
--   2. has_straps passa a ser derivado exclusivamente por
--      `fn_sync_has_straps_with_strap_colors` (já existe e está correto).
--   3. Backfill: corrigir fichas atualmente com has_straps=false mas
--      strap_colors contendo item real (com group_id ou consumption>0).
-- =============================================================================

-- 1) Trigger de routing — remove sobrescrito de has_straps
CREATE OR REPLACE FUNCTION public.sync_construction_routing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- has_straps NÃO é mais tocado aqui — derivação fica a cargo de
  -- fn_sync_has_straps_with_strap_colors (trigger tg_sync_has_straps_with_strap_colors).
  -- Isso desacopla "tem tiras?" do "tipo de construção", permitindo
  -- modelos corte_costura com tiras opcionais (caso real da fábrica).
  IF NEW.construction_type = 'corte_fio' THEN
    -- Corte a fio: corta cabedal + palmilha, sem costura
    NEW.requires_cutting := true;
    NEW.requires_cutting_cabedal := true;
    NEW.requires_sewing := false;
  ELSIF NEW.construction_type = 'corte_costura' THEN
    -- Corte + costura: corta cabedal + palmilha, com costura
    NEW.requires_cutting := true;
    NEW.requires_cutting_cabedal := true;
    NEW.requires_sewing := true;
  ELSIF NEW.construction_type = 'tiras' THEN
    -- Tiras: cabedal NÃO é cortado, mas palmilha/forro SIM continuam sendo cortados
    NEW.requires_cutting := true;            -- mantém corte ativo (palmilha/forro)
    NEW.requires_cutting_cabedal := false;   -- pula corte do cabedal
    NEW.requires_sewing := false;
  ELSIF NEW.construction_type = 'misto' THEN
    -- Misto: mantém valores explícitos do usuário (corte + tiras, etc.)
    NEW.requires_cutting := true;
    NEW.requires_cutting_cabedal := COALESCE(NEW.requires_cutting_cabedal, true);
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_construction_routing() IS
  'Sincroniza flags de roteiro (requires_cutting/sewing/cutting_cabedal) com construction_type. '
  'Não toca em has_straps — esse é derivado por fn_sync_has_straps_with_strap_colors a partir do '
  'array strap_colors (desacopla tiras opcionais do tipo de construção).';

-- 2) Backfill — corrige fichas que tiveram has_straps zerado mas têm strap_colors real
WITH affected AS (
  SELECT ts.id
  FROM public.technical_sheets ts
  WHERE COALESCE(ts.has_straps, false) = false
    AND ts.strap_colors IS NOT NULL
    AND jsonb_typeof(ts.strap_colors) = 'array'
    AND jsonb_array_length(ts.strap_colors) > 0
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(ts.strap_colors) AS s(val)
      WHERE (s.val->>'group_id') IS NOT NULL AND length(s.val->>'group_id') > 0
         OR COALESCE((s.val->>'consumption')::numeric, 0) > 0
    )
)
UPDATE public.technical_sheets ts
SET has_straps = true
FROM affected a
WHERE ts.id = a.id;
