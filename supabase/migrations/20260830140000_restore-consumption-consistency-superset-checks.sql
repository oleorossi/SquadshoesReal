-- =============================================================================
-- Restaura o SUPERCONJUNTO de checks em consumption_consistency_report()
-- =============================================================================
-- BUG (regressão por timestamp fora de ordem):
--   • 20260623130000_consumo-B1-warning-M2-guard.sql definiu a função com 6
--     checks (os 4 de cadastro + `persize_diverge_do_escalar` +
--     `consumo_implausivel_alto`). Foi AUTORADA em 2026-06-23 (commit 51ce1a6).
--   • 20260722120000_consumption-consistency-and-parity-guards.sql redefiniu a
--     MESMA função com apenas os 4 checks de cadastro. Foi autorada ANTES, em
--     2026-06-17 (commit 5ba875c), mas recebeu um timestamp de migration MAIOR
--     (0722 > 0623).
--   Resultado: num `supabase db push` limpo (ou ambiente novo), as migrations
--   replicam em ordem de timestamp → 0623 (6 checks) aplica primeiro, depois
--   0722 (4 checks) SOBRESCREVE → os 2 checks valiosos somem silenciosamente.
--
-- POR QUE OS 2 CHECKS IMPORTAM (pegam gaps que reintroduzem consumo errado):
--   • consumo_implausivel_alto (val > 100): é o detector canônico do gap
--     dm²→unidade física NÃO convertido. Quando falta largura na ficha de
--     componente, o consumo de área sai ~100× inflado; nenhum dos 4 checks de
--     cadastro pega um valor já gravado/derivado absurdamente alto.
--   • persize_diverge_do_escalar (média per-size diverge >3× do escalar):
--     pega ficha onde o JSONB *_consumption_per_size foi cadastrado em unidade
--     diferente do campo escalar (ex.: um em dm², outro em m²) → custo/MRP por
--     tamanho divergem do display sem aviso.
--
-- FIX: timestamp POSTERIOR a todas as migrations (2026-08-30) recria a função
-- com o SUPERCONJUNTO (6 checks), travando o estado pretendido independente da
-- ordem de replay. Idempotente (CREATE OR REPLACE). Read-only (STABLE), nada
-- destrutivo. A UI (SystemDiagnostics.tsx → consumption_consistency_report())
-- renderiza as linhas dinamicamente, então os 2 checks reaparecem sem mudança
-- de frontend.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.consumption_consistency_report()
RETURNS TABLE (
  check_name  text,
  severity    text,
  item_count  integer,
  sample      text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A) Material LINEAR (m/cm) usado em ficha mas SEM largura na ficha de
  --    componente → conversor dm²→metro devolve dm² cru (~100× inflado).
  RETURN QUERY
  SELECT 'material_linear_sem_largura'::text, 'alto'::text,
         COALESCE(count(*),0)::int,
         COALESCE(string_agg(product_name || ' ('||product_unit||')', ' · '
                  ORDER BY product_name), '—')
    FROM (SELECT * FROM public.list_materials_missing_width() LIMIT 200) m;

  -- B) Ficha marcada palmilha PRONTA mas com consumo de ÁREA de palmilha > 1
  --    (contradição: pronta deveria ser 1/par, sem placa). Cadastro inconsistente.
  RETURN QUERY
  SELECT 'palmilha_pronta_com_consumo_area'::text, 'medio'::text,
         count(*)::int,
         COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE ts.insole_ready_made = true
     AND COALESCE(ts.insole_consumption, 0) > 1;

  -- C) Ficha onde o solado dirige o consumo mas o solado primário NÃO tem
  --    sole_technical_specs → cálculo cai na média escalar (fallback_average).
  RETURN QUERY
  SELECT 'solado_dirige_consumo_sem_specs'::text, 'medio'::text,
         count(*)::int,
         COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE ts.sole_drives_consumption = true
     AND ts.primary_sole_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.sole_technical_specs sts WHERE sts.sole_id = ts.primary_sole_id
     );

  -- D) Solado FACHETADO sem consumo de fachete por numeração → componente
  --    "Fachete" sai com 0 (forro do salto não debita).
  RETURN QUERY
  SELECT 'solado_fachetado_sem_specs_fachete'::text, 'medio'::text,
         count(*)::int,
         COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p
   WHERE p.is_fachetado = true
     AND lower(COALESCE(p.category,'')) LIKE '%solado%'
     AND NOT EXISTS (
       SELECT 1 FROM public.sole_technical_specs sts
        WHERE sts.sole_id = p.id AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
     );

  -- E) [RESTAURADO] Média do JSONB *_consumption_per_size diverge >3× do campo
  --    escalar → per-size cadastrado em unidade diferente do escalar; custo/MRP
  --    por tamanho divergem do display sem aviso.
  RETURN QUERY
  WITH persize AS (
    SELECT ts.name, 'cabedal' AS comp, ts.upper_consumption AS escalar,
           (SELECT avg(NULLIF(v,'')::numeric)
              FROM jsonb_each_text(ts.upper_consumption_per_size) e(k,v)
             WHERE NULLIF(v,'')::numeric > 0) AS media
      FROM public.technical_sheets ts
     WHERE jsonb_typeof(ts.upper_consumption_per_size) = 'object'
    UNION ALL
    SELECT ts.name, 'forro', ts.lining_consumption,
           (SELECT avg(NULLIF(v,'')::numeric)
              FROM jsonb_each_text(ts.lining_consumption_per_size) e(k,v)
             WHERE NULLIF(v,'')::numeric > 0)
      FROM public.technical_sheets ts
     WHERE jsonb_typeof(ts.lining_consumption_per_size) = 'object'
    UNION ALL
    SELECT ts.name, 'palmilha', ts.insole_consumption,
           (SELECT avg(NULLIF(v,'')::numeric)
              FROM jsonb_each_text(ts.insole_consumption_per_size) e(k,v)
             WHERE NULLIF(v,'')::numeric > 0)
      FROM public.technical_sheets ts
     WHERE jsonb_typeof(ts.insole_consumption_per_size) = 'object'
  )
  SELECT 'persize_diverge_do_escalar'::text, 'alto'::text, count(*)::int,
         COALESCE(string_agg(name||' ('||comp||' '||round(media,2)||'<>'||round(escalar,2)||')',
                  ' · ' ORDER BY name), '—')
    FROM persize
   WHERE media IS NOT NULL AND escalar IS NOT NULL AND escalar > 0
     AND (media > escalar * 3 OR media < escalar / 3.0);

  -- F) [RESTAURADO] Consumo absurdamente alto (> 100 na maior unidade entre o
  --    escalar e o JSONB per-size). É o detector canônico do gap dm²→unidade
  --    NÃO convertido (sem largura, área sai ~100× inflada). 'alto'.
  RETURN QUERY
  SELECT 'consumo_implausivel_alto'::text, 'alto'::text, count(*)::int,
         COALESCE(string_agg(name||' ('||comp||' '||round(val,0)||')',
                  ' · ' ORDER BY name), '—')
    FROM (
      SELECT ts.name, 'cabedal' AS comp,
             GREATEST(
               COALESCE(ts.upper_consumption, 0),
               COALESCE((SELECT max(NULLIF(v,'')::numeric)
                           FROM jsonb_each_text(
                                  CASE WHEN jsonb_typeof(ts.upper_consumption_per_size) = 'object'
                                       THEN ts.upper_consumption_per_size ELSE '{}'::jsonb END) e(k,v)), 0)
             ) AS val
        FROM public.technical_sheets ts
      UNION ALL
      SELECT ts.name, 'forro',
             GREATEST(
               COALESCE(ts.lining_consumption, 0),
               COALESCE((SELECT max(NULLIF(v,'')::numeric)
                           FROM jsonb_each_text(
                                  CASE WHEN jsonb_typeof(ts.lining_consumption_per_size) = 'object'
                                       THEN ts.lining_consumption_per_size ELSE '{}'::jsonb END) e(k,v)), 0)
             )
        FROM public.technical_sheets ts
      UNION ALL
      SELECT ts.name, 'palmilha',
             GREATEST(
               COALESCE(ts.insole_consumption, 0),
               COALESCE((SELECT max(NULLIF(v,'')::numeric)
                           FROM jsonb_each_text(
                                  CASE WHEN jsonb_typeof(ts.insole_consumption_per_size) = 'object'
                                       THEN ts.insole_consumption_per_size ELSE '{}'::jsonb END) e(k,v)), 0)
             )
        FROM public.technical_sheets ts
    ) x
   WHERE val > 100;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consumption_consistency_report() TO authenticated;
COMMENT ON FUNCTION public.consumption_consistency_report() IS
  'Diagnóstico read-only dos gaps de cadastro que quebram o cálculo de consumo. '
  'SUPERCONJUNTO de 6 checks: largura faltando, palmilha pronta inconsistente, '
  'solado sem specs, fachete sem consumo, per-size divergindo do escalar, e '
  'consumo implausível > 100 (detector do gap dm²→unidade não convertido).';
