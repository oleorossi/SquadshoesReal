-- recalc_waves_for_shoe_category — repropagação EXPLÍCITA dos tempos-padrão
--
-- Problema (auditoria 2026-08-03): `default_lead_times` é a fonte de capacidade
-- diária pra 44 das 53 fichas (só 9 têm capacidade própria; solagem e costura
-- cabedal: NENHUMA tem). Mas a tabela NÃO tem trigger de recálculo:
--   - `tg_recompute_production_schedule` está plugado em production_queue,
--     production_pointings, sector_settings, order_stages e technical_sheets —
--     não em default_lead_times;
--   - `tg_recalc_waves_on_capacity_change` existe mas é ÓRFÃ (não está ligada a
--     tabela nenhuma) e o corpo dela usa NEW.id contra production_wave_items.
--     reference_id, ou seja, foi escrita pra technical_sheets, não pra esta tabela.
--
-- Resultado medido: as 20 ondas em production_waves têm updated_at máximo de
-- 09/07/2026 — anteriores às edições de capacidade de 27/07 e 03/08. Seguem
-- congeladas com a capacidade velha.
--
-- Decisão do dono (03/08/2026): NÃO criar trigger automático. Um save de 11
-- campos disparando recomputação síncrona de todas as ondas da categoria é
-- efeito colateral escondido. Em vez disso, botão explícito "Recalcular ondas
-- desta categoria" na tela Tempos-Padrão por Setor, que chama esta RPC e mostra
-- quantas ondas foram recalculadas.
--
-- As ondas antigas de julho NÃO foram tocadas por esta migration (decisão do
-- dono: podem ser histórico já produzido). Quem quiser recalcular, aperta o botão.

CREATE OR REPLACE FUNCTION public.recalc_waves_for_shoe_category(p_shoe_category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wave_id uuid;
  v_ok int := 0;
  v_fail int := 0;
  v_erro text := NULL;
BEGIN
  -- RLS de tabela não protege RPC: SECURITY DEFINER sem guard é executável com a
  -- anon key que vai no bundle do front. Ver P0 de 01/08/2026.
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Acesso negado: usuário não aprovado.';
  END IF;

  FOR v_wave_id IN
    SELECT DISTINCT pwi.wave_id
      FROM public.production_wave_items pwi
      JOIN public.technical_sheets ts ON ts.id = pwi.reference_id
     WHERE ts.shoe_category IS NOT DISTINCT FROM p_shoe_category
  LOOP
    BEGIN
      PERFORM public.update_wave_timeline(v_wave_id);
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Uma onda quebrada não pode abortar as outras, mas o erro NÃO é engolido:
      -- volta no retorno pra aparecer na tela (o antigo tg_recalc_waves_on_capacity_change
      -- fazia `EXCEPTION WHEN OTHERS THEN NULL` e escondia tudo).
      v_fail := v_fail + 1;
      IF v_erro IS NULL THEN v_erro := SQLERRM; END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'categoria', p_shoe_category,
    'recalculadas', v_ok,
    'falhas', v_fail,
    'primeiro_erro', v_erro
  );
END;
$function$;

COMMENT ON FUNCTION public.recalc_waves_for_shoe_category(text) IS
  'Recalcula o cronograma das ondas cujas fichas pertencem à categoria informada. '
  'Chamada pelo botão "Recalcular ondas desta categoria" da tela Tempos-Padrão por Setor — '
  'default_lead_times não tem trigger de recálculo, então a repropagação é explícita.';

REVOKE ALL ON FUNCTION public.recalc_waves_for_shoe_category(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_waves_for_shoe_category(text) TO authenticated;
