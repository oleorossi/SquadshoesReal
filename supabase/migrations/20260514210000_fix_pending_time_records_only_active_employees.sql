-- ============================================================================
-- FIX: relatório de Pendências inconsistente (resumo 320 x detalhe 545)
-- ============================================================================
-- Auditoria do controle de ponto: v_pending_time_records fazia LEFT JOIN em
-- employees por nome/external_id. 225 dias de batida ímpar pertencem a ~25
-- pessoas NÃO cadastradas em employees (ex-funcionários / nunca cadastrados +
-- lixo "", "1"). Ficavam com employee_id NULL — apareciam no DETALHE mas o
-- RESUMO (v_employee_pending_summary, que agrupa por employee) não as contava.
-- Resumo dizia 320, detalhe 545.
--
-- Decisão (opção B): relatório operacional só mostra pendências ACIONÁVEIS —
-- de funcionário ativo. Ponto de quem saiu / não está cadastrado não entra.
-- LEFT JOIN -> INNER JOIN + filtro e.active. Detalhe passa a bater com o resumo.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_pending_time_records AS
SELECT tr.id AS time_record_id,
    tr.employee_name,
    tr.employee_external_id,
    e.id AS employee_id,
    tr.department,
    tr.record_date,
    EXTRACT(isodow FROM tr.record_date)::integer AS dow,
    tr.punches,
    jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) AS punch_count,
    CASE
        WHEN jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) = 1 THEN 'somente_uma_batida'::text
        WHEN jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) = 3 THEN 'falta_saida_apos_almoco'::text
        WHEN jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) = 5 THEN 'batida_extra'::text
        WHEN (jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) % 2) <> 0 THEN 'punches_impar'::text
        ELSE NULL::text
    END AS issue_type,
    (EXISTS ( SELECT 1
           FROM time_record_manual_overrides o
          WHERE o.time_record_id = tr.id)) AS has_manual_override
   FROM time_records tr
     -- INNER JOIN (era LEFT): registro sem funcionário cadastrado não é
     -- pendência acionável — não aparece mais.
     JOIN employees e
       ON (tr.employee_external_id = e.external_id
           OR lower(TRIM(BOTH FROM tr.employee_name)) = lower(TRIM(BOTH FROM e.name)))
  WHERE jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) > 0
    AND (jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) % 2) <> 0
    -- só funcionário ativo: ponto de ex-funcionário não é acionável
    AND e.active = true;

COMMENT ON VIEW public.v_pending_time_records IS
  'Dias com batida ímpar (1/3/5 batidas) de funcionários ATIVOS — pendências acionáveis de correção de ponto. Registros de gente não cadastrada ou inativa são excluídos (auditoria 2026-05).';
