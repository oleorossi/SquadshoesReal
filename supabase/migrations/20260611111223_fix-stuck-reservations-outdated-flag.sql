-- =============================================================================
-- FIX — Badge "Reservas pendentes de atualização" preso permanentemente no PV
-- =============================================================================
-- Sintoma: PVs exibem o badge âmbar "RESERVAS PENDENTES DE ATUALIZAÇÃO"
--   (PvOutdatedBadge, status_label='reservations_outdated' via v_pv_outdated_status,
--    derivado de sale_orders.reservations_outdated_at) que NUNCA limpa, apesar de
--   o cron 'auto-refresh-reservations' rodar a cada 2 min com sucesso.
--   No diagnóstico, 9 PVs presos; o mais antigo desde 2026-05-12 (≈1 mês).
--
-- Causa raiz: o bloco de CLEAR de process_outdated_reservations tinha um
--   dead-zone — três classes de PV nunca conseguiam ter o flag limpo:
--
--   (0) PV que avançou pra status terminal (Faturado/Concluído/Expedido): o
--       CLEAR exigia status IN (Pendente,Aprovado,Em Produção), então o flag,
--       setado quando o PV ainda era pré-produção, ficava órfão pra sempre.
--       (ex.: PV-00107/00111/00116/00122, Faturados.)
--
--   (a) PV "Em Produção" COM snapshot e OPs ainda "Reservado": o LOOP de
--       processamento pula PVs com snapshot (guard correto contra duplo-débito),
--       e o CLEAR exigia "nenhuma OP Pendente/Reservado". As duas condições se
--       excluem → flag eterno. (ex.: PV-00140/00141.)
--
--   (b) PV pré-produção SEM snapshot, OPs "Reservado": o loop refazia as
--       reservas todo ciclo (refresh_order_reservations = release +
--       try_reserve_materials, idempotente), mas a OP CONTINUA "Reservado"
--       após o refresh — esse é o estado CORRETO pós-refresh, não evidência de
--       staleness. O CLEAR usava "nenhuma OP Reservado" como proxy de "pronto",
--       proxy que nunca virava verdadeiro. (ex.: PV-2026-00067/00092/00093.)
--
-- ⚠ Descoberta-chave (auditoria 2026-07): o auto-refresh do cron NUNCA funcionou.
--   refresh_order_reservations chama release_order_reservations / try_reserve_
--   materials, ambas guardadas por is_approved_user() = EXISTS(profiles WHERE
--   id = auth.uid() AND approved). No contexto do cron (pg_cron, auth.uid()
--   NULL) isso é sempre FALSE → "Permission denied: usuário não aprovado". O
--   loop captura a exceção (failed++, subtransação rollback, zero efeito) e a
--   função retorna "succeeded" — por isso o cron aparece verde mas nunca
--   recalcula nada. Logo o flag NÃO pode ser limpo só no SUCESSO do refresh
--   (sucesso é inalcançável via cron) — tem que limpar na VISITA.
--
-- Fix: reescreve SÓ o bloco de CLEAR (o loop só ganha o tracking de visitadas).
--   Limpa reservations_outdated_at de qualquer PV que NÃO tenha mais nenhuma OP
--   "loop-elegível" pendente de visita — onde loop-elegível = PV pré-produção
--   (Pendente/Aprovado/Em Produção) SEM snapshot e OP em (Pendente/Reservado).
--   Esse predicado único cobre as 3 classes que ficavam presas:
--     (0) PV terminal (Faturado/Finalizado): nenhuma OP loop-elegível → limpa.
--     (a) PV com snapshot: o loop pula (guard anti duplo-débito) → nenhuma OP
--         loop-elegível → limpa o badge falso (o sinal correto p/ ficha-pós-
--         produção é snapshot_outdated, via technical_sheet_snapshots.outdated_at).
--     (b) PV pré-prod sem snapshot: limpa quando TODA OP reservável foi visitada
--         neste run (OP fora do batch por LIMIT mantém o flag até o run seguinte).
--
-- Segurança: o CLEAR toca SÓ sale_orders.reservations_outdated_at — NÃO altera
--   nenhuma reserva, material_reservations, reserved_stock nem estoque (validado:
--   soma de reserved_stock idêntica antes/depois do backfill). O badge é puramente
--   informativo e NÃO é guard de nenhuma função de débito/MRP. Refresh continua
--   sendo TENTADO (no-op sob permission-denied, idempotente se um dia rodar). Sem
--   flapping: as funções de refresh não escrevem em sale_order_items, então o
--   trigger setter não re-dispara.
--
-- Fora do escopo deste fix (badge): (i) o auto-refresh morto sob cron e (ii)
--   PVs pré-prod com reservas faltando (ex.: PV-2026-00067/00092/00093 têm OPs
--   "Reservado" com ~0 material_reservations) são problemas de RESERVA, não do
--   badge — sinalizados em follow-up separado.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_outdated_reservations(p_max_orders integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op RECORD;
  v_processed int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_failures jsonb := '[]'::jsonb;
  v_started_at timestamptz := now();
  v_result jsonb;
  -- Inicializar VAZIO (não NULL): "x <> ALL(NULL)" devolve NULL e quebraria o
  -- predicado do CLEAR silenciosamente. Rastreia TODA OP iterada (visitada)
  -- neste run, independente do refresh ter dado certo — o clear é por visita.
  v_visited_ops uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v_op IN
    SELECT o.id AS order_id, so.id AS sale_order_id, so.reservations_outdated_at
      FROM public.orders o
      JOIN public.sale_orders so ON so.id = o.sale_order_id
     WHERE so.reservations_outdated_at IS NOT NULL
       AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
       AND o.status IN ('Pendente', 'Reservado')
       AND NOT EXISTS (
         SELECT 1 FROM public.technical_sheet_snapshots
          WHERE sale_order_id = so.id
       )
     ORDER BY so.reservations_outdated_at ASC
     LIMIT p_max_orders
  LOOP
    -- Marca visitada ANTES de tentar (o refresh quase sempre permission-denia
    -- sob cron; mesmo assim a OP foi "varrida" e o flag deve poder limpar).
    v_visited_ops := array_append(v_visited_ops, v_op.order_id);
    BEGIN
      v_result := public.refresh_order_reservations(v_op.order_id);
      IF (v_result ->> 'refreshed')::boolean THEN
        v_processed := v_processed + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'order_id', v_op.order_id, 'error', SQLERRM);
    END;
  END LOOP;

  -- CLEAR unificado — limpa o flag quando não resta nenhuma OP "loop-elegível"
  -- pendente de visita. loop-elegível = PV pré-prod + sem snapshot + OP
  -- Pendente/Reservado. Cobre as 3 classes presas (ver cabeçalho):
  --   terminal → sem OP loop-elegível → limpa;
  --   snapshot → loop pula → sem OP loop-elegível → limpa;
  --   pré-prod sem snapshot → limpa quando toda OP reservável foi visitada.
  -- Limpa por VISITA (não por sucesso do refresh): o refresh permission-denia
  -- sob cron, então "limpar só no sucesso" deixaria o flag preso pra sempre.
  -- Toca SÓ a coluna do flag — nenhuma reserva/estoque é alterado.
  UPDATE public.sale_orders so
     SET reservations_outdated_at = NULL
   WHERE so.reservations_outdated_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.sale_order_id = so.id
          AND o.status IN ('Pendente', 'Reservado')
          AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
          AND NOT EXISTS (
            SELECT 1 FROM public.technical_sheet_snapshots tss
             WHERE tss.sale_order_id = so.id
          )
          AND o.id <> ALL (v_visited_ops)
     );

  RETURN jsonb_build_object(
    'processed', v_processed,
    'skipped', v_skipped,
    'failed', v_failed,
    'failures', v_failures,
    'duration_ms', extract(epoch from (now() - v_started_at)) * 1000
  );
END;
$function$;


-- ─── View: o badge "outdated" só faz sentido em PV ACIONÁVEL ──────────────────
-- A view surfaceava qualquer PV exceto Cancelado/Cancelada/Rascunho — então PVs
-- terminais (Faturado, Finalizado s/ NF) com o flag setado quando ainda eram
-- pré-produção exibiam o badge âmbar PRESO PARA SEMPRE (nenhum caminho limpa
-- reservas/snapshot de PV terminal: as OPs estão Finalizado, "Resync OPs" não
-- toca, re-freeze não reseta outdated_at, só a deleção do snapshot — que não roda
-- pra OP terminal). Pior: limpar só o flag de reservas de um Faturado com snapshot
-- outdated o jogaria num 'snapshot_outdated' igualmente permanente.
-- Fix: a view passa a listar SÓ os status acionáveis (mesma lista dos setters do
-- flag: Pendente/Aprovado/Em Produção). PV terminal nunca mais mostra o badge —
-- e o badge de Custos (costs_dirty_at) é independente (lido direto do PV), não
-- afetado por isto. Mantém security_invoker=true (RLS, migration 20260620130000).
CREATE OR REPLACE VIEW public.v_pv_outdated_status AS
SELECT
  so.id AS sale_order_id,
  so.order_number,
  so.status,
  so.client_name,
  so.reservations_outdated_at,
  EXISTS(
    SELECT 1 FROM public.technical_sheet_snapshots tss
     WHERE tss.sale_order_id = so.id AND tss.outdated_at IS NOT NULL
  ) AS has_outdated_snapshot,
  (SELECT MIN(tss.outdated_at) FROM public.technical_sheet_snapshots tss
    WHERE tss.sale_order_id = so.id AND tss.outdated_at IS NOT NULL) AS oldest_snapshot_outdated_at,
  CASE
    WHEN so.reservations_outdated_at IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.technical_sheet_snapshots tss
                 WHERE tss.sale_order_id = so.id AND tss.outdated_at IS NOT NULL)
      THEN 'reservations_and_snapshot_outdated'
    WHEN so.reservations_outdated_at IS NOT NULL
      THEN 'reservations_outdated'
    WHEN EXISTS(SELECT 1 FROM public.technical_sheet_snapshots tss
                 WHERE tss.sale_order_id = so.id AND tss.outdated_at IS NOT NULL)
      THEN 'snapshot_outdated'
    ELSE 'in_sync'
  END AS status_label
FROM public.sale_orders so
WHERE so.status IN ('Pendente', 'Aprovado', 'Em Produção');

ALTER VIEW public.v_pv_outdated_status SET (security_invoker = true);
GRANT SELECT ON public.v_pv_outdated_status TO authenticated;

COMMENT ON VIEW public.v_pv_outdated_status IS
  'PVs ACIONÁVEIS (Pendente/Aprovado/Em Produção) com snapshot ou reservations '
  'desatualizados. UI usa pra exibir badges/alertas e oferecer Resync OPs. PV '
  'terminal (Faturado/Finalizado) é excluído de propósito — o badge não é '
  'acionável lá (fix 2026-07 do badge preso).';
