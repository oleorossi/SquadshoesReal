-- =============================================================================
-- Fan-out de funcionário nas views de pendência de ponto.
--
-- SINTOMA MEDIDO (auditoria 07/08/2026, números do relato — reconferir com o
-- bloco "ANTES" no fim deste arquivo):
--   v_time_pendings         1.547 linhas / 1.521 distintas  → 26 duplicadas
--   v_pending_time_records    367 linhas /   363 distintas  →  4 duplicadas
--   v_employee_pending_summary — não duplica LINHA (agrupa por e.id), mas herda
--   a contagem inflada.
--
-- CAUSA
-- O ON do LEFT JOIN com `employees` é UM predicado com OR:
--
--     ON (e.external_id = tr.employee_external_id AND ...) OR lower(trim(e.name)) = ...
--
-- Join não é "case/when": ele devolve UMA LINHA POR LINHA DE `employees` que
-- satisfaça o predicado. Quando duas fichas distintas casam com o mesmo
-- time_record — uma pelo crachá e outra pelo nome (recadastro, homônimo) — o
-- registro sai duplicado. `idx_employees_external_id` (20260402165922) NÃO é
-- único, então o ramo do crachá sozinho também pode casar 2 fichas.
--
-- Há um SEGUNDO fan-out no mesmo padrão, em `work_schedules`:
--
--     ON ws.id = e.work_schedule_id OR (e.work_schedule_id IS NULL AND ws.is_default)
--
-- Os ramos são exclusivos, mas o segundo casa TODAS as jornadas com
-- `is_default = true` — e não há índice único garantindo que só exista uma.
-- O resto do código já assume que pode haver várias: `generate_bom_operations`
-- (20260628181500) e o motor de capacidade (20260719120000) fazem
-- `WHERE is_default ORDER BY created_at LIMIT 1`. ⚠ Pior: quando NENHUM
-- funcionário casa, `e.work_schedule_id` é NULL pelo LEFT JOIN, o segundo ramo
-- fica TRUE e a linha órfã se multiplica por todas as jornadas default.
--
-- POR QUE NÃO É COSMÉTICO
--   · get_pending_count_by_employee (20260524220001) faz COUNT(*) sobre a view e
--     agrupa por employee_id → o MESMO time_record é contado sob DOIS
--     funcionários diferentes, não duas vezes sob um. O badge do RH Hub
--     (src/pages/RHHub.tsx:139) e o KPI "funcionários distintos"
--     (src/pages/TimePendings.tsx:131) sobem juntos.
--   · src/pages/TimePendings.tsx:355 usa key={p.id} → chave React duplicada.
--   · selectedIds é um Set de p.id (TimePendings.tsx:139) → marcar uma linha
--     marca a gêmea, e useBulkApplySuggestions (useTimePendings.ts:164) monta
--     DOIS itens para o MESMO time_record.
--   · ⚠ O consumidor mais destrutivo não é esse. bulkApplyDefaultExit
--     (src/services/pendingTimeRecordsService.ts:158) itera
--     v_pending_time_records e chama apply_manual_punch_completion, que
--     APPENDA a batida (`v_old_punches || to_jsonb(...)`, 20260613120002) sem
--     dedup. Linha duplicada ⇒ "18:00*" gravado DUAS vezes no mesmo
--     time_record: 1 batida vira 3, continua ímpar, continua pendente, e deixa
--     duas linhas em time_record_manual_overrides. Corrompe o dado, não é só
--     chamada dupla.
--
-- ⚠ A ESCOLHA DO FUNCIONÁRIO MUDA O CONTEÚDO DA LINHA, NÃO SÓ O RÓTULO.
-- Em v_time_pendings o `e.id` alimenta get_employee_expected_minutes → entra em
-- calculate_day_summary → decide o `status` que classifica a linha como
-- pendência. E `COALESCE(e.payment_type,'mensalista') <> 'producao'` está no
-- WHERE: se o vencedor for funcionário por par, a pendência SOME inteira. Por
-- isso o bloco de verificação no fim compara distintos ANTES × DEPOIS, e não só
-- o total.
--
-- DECISÃO DO DONO (07/08/2026): precedência `external_id > nome`.
-- O external_id é o crachá do relógio de ponto — evidência física de quem bateu.
-- O nome é heurística de fallback (por isso o lower(trim(...))), e só decide
-- quando NENHUMA ficha casa pelo crachá. Desempate interno: `active = true`
-- antes da ficha desligada, depois `id` — determinístico e estável entre
-- execuções, que é o que prova 1 linha por time_record.
--
-- A ambiguidade fica VISÍVEL, não silenciosa: a coluna nova
-- `employee_match_ambiguous` marca as linhas que tinham mais de um candidato.
-- Sem ela o sintoma sumiria e a causa — fichas duplicadas em `employees` —
-- continuaria mordendo em qualquer relatório futuro que junte ponto com
-- funcionário. A coluna entra no FIM da lista: `CREATE OR REPLACE VIEW` aceita
-- coluna acrescentada no fim e PRESERVA `security_invoker` e o ACL; DROP+CREATE
-- apagaria os dois em silêncio (lição de 20261219120000 e 20261224120000).
-- Ainda assim o `WITH (security_invoker = true)` e os GRANTs são reafirmados
-- explicitamente abaixo, para não depender da preservação implícita.
--
-- ⚠ MUDANÇA DE COMPORTAMENTO DELIBERADA, ALÉM DO DEDUP:
-- `v_pending_time_records` casava `tr.employee_external_id = e.external_id` SEM
-- a guarda de vazio que `v_time_pendings` já tinha. Com isso `'' = ''` casava, e
-- UM registro com crachá vazio puxava TODA ficha de crachá vazio. A guarda
-- (`IS NOT NULL AND <> ''`) foi acrescentada aqui — é causa de fan-out, não
-- refactor. Onde os dois lados eram vazios, o casamento agora cai no nome.
--
-- FORA DE ESCOPO (achados registrados, NÃO tocados aqui):
--   · 20260613120002 recriou v_pending_time_records sem o issue_type
--     'dia_incompleto_suspeito' e v_employee_pending_summary sem o
--     `WHERE e.active = true`, ambos introduzidos em 20260522180000. O TS ainda
--     referencia os dois (pendingTimeRecordsService.ts:23 e :51, o branch de
--     bulk em :167). Reintroduzir é decisão de produto, não conserto de fan-out.
-- =============================================================================

-- ── 1. v_time_pendings ───────────────────────────────────────────────────────
-- Mesmo SELECT de 20260914120000; mudam só os dois JOINs e a coluna do fim.

CREATE OR REPLACE VIEW public.v_time_pendings
WITH (security_invoker = true) AS
SELECT
  tr.id,
  tr.employee_external_id,
  tr.employee_name,
  e.id AS employee_id,
  e.department,
  tr.record_date,
  tr.punches,
  jsonb_array_length(tr.punches) AS punches_count,
  EXTRACT(isodow FROM tr.record_date)::integer AS dow,
  (CURRENT_DATE - tr.record_date) AS days_since,
  public.calculate_day_summary(
    tr.punches,
    COALESCE(public.get_employee_expected_minutes(e.id, tr.record_date), 0),
    COALESCE(ws.tolerance_minutes, 10),
    COALESCE(ws.minimum_overtime_minutes, 10),
    EXISTS (
      SELECT 1 FROM public.holidays h
      WHERE h.holiday_date = tr.record_date AND COALESCE(h.optional, false) = false
    ),
    EXTRACT(isodow FROM tr.record_date)::integer BETWEEN 1 AND 5
  ) AS day_summary,
  CASE
    WHEN (CURRENT_DATE - tr.record_date) > 7 THEN 'overdue'
    WHEN (CURRENT_DATE - tr.record_date) > 3 THEN 'aging'
    ELSE 'fresh'
  END AS urgency,
  public.suggest_punches_for_record(tr.id) AS suggestion,
  -- Coluna NOVA, no fim: mais de uma ficha de employees casou com este registro.
  COALESCE(e.ambiguous, false) AS employee_match_ambiguous
FROM public.time_records tr

-- Uma ficha, escolhida por regra explícita. O LIMIT 1 é o que prova 1 linha por
-- time_record; o ORDER BY é o que torna a escolha reproduzível.
LEFT JOIN LATERAL (
  SELECT m.id, m.department, m.payment_type, m.work_schedule_id, m.ambiguous
  FROM (
    SELECT
      emp.id,
      emp.department,
      emp.payment_type,
      emp.work_schedule_id,
      emp.active,
      -- `IS TRUE` não é enfeite: com tr.employee_external_id NULL a comparação
      -- devolve NULL, e `ORDER BY <null> DESC` é NULLS FIRST no Postgres — o
      -- casamento por NOME passaria na frente do casamento por CRACHÁ.
      ((emp.external_id = tr.employee_external_id
        AND emp.external_id IS NOT NULL
        AND emp.external_id <> '') IS TRUE) AS by_badge,
      -- Janela avaliada ANTES do LIMIT (WINDOW precede LIMIT na execução),
      -- então conta todos os candidatos, não o que sobrou.
      (count(*) OVER () > 1) AS ambiguous
    FROM public.employees emp
    WHERE (emp.external_id = tr.employee_external_id
           AND emp.external_id IS NOT NULL
           AND emp.external_id <> '')
       OR lower(trim(emp.name)) = lower(trim(tr.employee_name))
  ) m
  ORDER BY m.by_badge DESC,   -- crachá vence nome
           m.active DESC,     -- ficha ativa vence desligada
           m.id               -- desempate estável
  LIMIT 1
) e ON true

-- Idem para a jornada. Mesma convenção já usada em generate_bom_operations e no
-- motor de capacidade: entre defaults, o mais antigo por created_at.
LEFT JOIN LATERAL (
  SELECT w.tolerance_minutes, w.minimum_overtime_minutes
  FROM public.work_schedules w
  WHERE w.id = e.work_schedule_id
     OR (e.work_schedule_id IS NULL AND w.is_default = true)
  ORDER BY ((w.id = e.work_schedule_id) IS TRUE) DESC, w.created_at, w.id
  LIMIT 1
) ws ON true

WHERE tr.record_date >= public.get_bank_hours_cutoff()
  AND tr.record_date >= CURRENT_DATE - INTERVAL '90 days'
  AND EXTRACT(isodow FROM tr.record_date) BETWEEN 1 AND 5
  -- Funcionário por par (piece-rate): relógio é só presença, não gera pendência.
  AND COALESCE(e.payment_type, 'mensalista') <> 'producao'
  AND NOT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.holiday_date = tr.record_date AND COALESCE(h.optional, false) = false
  );

REVOKE SELECT ON public.v_time_pendings FROM anon;
GRANT SELECT ON public.v_time_pendings TO authenticated, service_role;

COMMENT ON VIEW public.v_time_pendings IS
  'Pendências de ponto dos últimos 90 dias úteis (lista /rh/pendencias-ponto e '
  'badge do RH Hub). 1 linha por time_record: a ficha de employees é resolvida '
  'por LEFT JOIN LATERAL com precedência external_id > nome (desempate: active, '
  'depois id) — o LEFT JOIN com OR duplicava o registro quando duas fichas '
  'casavam. employee_match_ambiguous = true marca onde houve mais de um '
  'candidato: é cadastro duplicado a corrigir, não ruído. ⚠ Contém batida de '
  'ponto, nome e departamento: precisa de security_invoker=true para herdar a '
  'RLS de time_records (is_approved_user()). Se precisar acrescentar coluna, '
  'prefira CREATE OR REPLACE acrescentando no FIM: DROP+CREATE apaga '
  'security_invoker e ACL sem deixar rastro no diff.';


-- ── 2. v_pending_time_records ────────────────────────────────────────────────
-- Mesmo SELECT de 20260613120002; muda o JOIN (agora com a guarda de crachá
-- vazio) e a coluna do fim.

CREATE OR REPLACE VIEW public.v_pending_time_records
WITH (security_invoker = true) AS
SELECT
  tr.id AS time_record_id,
  tr.employee_name,
  tr.employee_external_id,
  e.id AS employee_id,
  tr.department,
  tr.record_date,
  EXTRACT(ISODOW FROM tr.record_date)::int AS dow,
  tr.punches,
  jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) AS punch_count,
  CASE
    WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) = 1 THEN 'somente_uma_batida'
    WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) = 3 THEN 'falta_saida_apos_almoco'
    WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) = 5 THEN 'batida_extra'
    WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) % 2 != 0 THEN 'punches_impar'
    ELSE NULL
  END AS issue_type,
  EXISTS (
    SELECT 1 FROM public.time_record_manual_overrides o WHERE o.time_record_id = tr.id
  ) AS has_manual_override,
  COALESCE(e.ambiguous, false) AS employee_match_ambiguous
FROM public.time_records tr
LEFT JOIN LATERAL (
  SELECT m.id, m.ambiguous
  FROM (
    SELECT
      emp.id,
      emp.active,
      ((emp.external_id = tr.employee_external_id
        AND emp.external_id IS NOT NULL
        AND emp.external_id <> '') IS TRUE) AS by_badge,
      (count(*) OVER () > 1) AS ambiguous
    FROM public.employees emp
    WHERE (emp.external_id = tr.employee_external_id
           AND emp.external_id IS NOT NULL
           AND emp.external_id <> '')
       OR lower(trim(emp.name)) = lower(trim(tr.employee_name))
  ) m
  ORDER BY m.by_badge DESC, m.active DESC, m.id
  LIMIT 1
) e ON true
WHERE jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) > 0
  AND jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) % 2 != 0;

-- GRANT reafirma exatamente o que já existia (20260613120002: só `authenticated`)
-- — CREATE OR REPLACE preserva o ACL, isto é só para o estado ficar legível aqui.
-- ⚠ O REVOKE, esse, NÃO é no-op: 20260613120002 recriou esta view com DROP VIEW +
-- CREATE, e DROP+CREATE devolve a view ao default privilege do Supabase, que
-- INCLUI SELECT para `anon`. Esta view nunca entrou na varredura de 20261122120000
-- (que mirava views SECURITY DEFINER; esta já nascera com security_invoker), então
-- o `r` do anon provavelmente segue lá. Com security_invoker o anon não lê nada de
-- fato — a RLS de time_records exige is_approved_user() —, mas o grant pendurado é
-- a mesma armadilha de 20261219120000. Confirme com a consulta (6) do fim.
REVOKE SELECT ON public.v_pending_time_records FROM anon;
GRANT SELECT ON public.v_pending_time_records TO authenticated;

COMMENT ON VIEW public.v_pending_time_records IS
  'Pendências de ponto por batida ímpar (aba de complementação manual). 1 linha '
  'por time_record: ficha resolvida por LEFT JOIN LATERAL, precedência '
  'external_id > nome (desempate: active, depois id). ⚠ O casamento por crachá '
  'exige external_id não-nulo e não-vazio — sem essa guarda, um registro de '
  'crachá vazio casava com toda ficha de crachá vazio. Linha duplicada aqui '
  'fazia bulkApplyDefaultExit gravar a MESMA batida duas vezes '
  '(apply_manual_punch_completion appenda, não deduplica).';


-- ── 3. v_employee_pending_summary ────────────────────────────────────────────
-- Não duplicava linha (agrupa por e.id), mas contava as duplicatas de
-- v_pending_time_records. Corrigida por tabela, ganha só o contador de
-- ambiguidade — é aqui que o RH olha por pessoa.

CREATE OR REPLACE VIEW public.v_employee_pending_summary
WITH (security_invoker = true) AS
SELECT
  e.id AS employee_id,
  e.name,
  e.department,
  COUNT(p.time_record_id) AS pending_count,
  MIN(p.record_date) AS oldest_pending,
  MAX(p.record_date) AS newest_pending,
  COUNT(p.time_record_id) FILTER (WHERE p.issue_type = 'somente_uma_batida') AS only_one_punch,
  COUNT(p.time_record_id) FILTER (WHERE p.issue_type = 'falta_saida_apos_almoco') AS missing_exit,
  COUNT(p.time_record_id) FILTER (WHERE p.issue_type = 'batida_extra') AS extra_punch,
  COUNT(p.time_record_id) FILTER (WHERE p.employee_match_ambiguous) AS ambiguous_match_count
FROM public.employees e
LEFT JOIN public.v_pending_time_records p ON p.employee_id = e.id
GROUP BY e.id, e.name, e.department;

-- Mesma situação da view anterior: GRANT idêntico ao que já havia, REVOKE do anon
-- pelo mesmo motivo (recriada por DROP+CREATE em 20260613120002).
REVOKE SELECT ON public.v_employee_pending_summary FROM anon;
GRANT SELECT ON public.v_employee_pending_summary TO authenticated;

COMMENT ON VIEW public.v_employee_pending_summary IS
  'Resumo de pendências por funcionário. Herda de v_pending_time_records, que '
  'desde 20261226120000 devolve 1 linha por time_record — antes o fan-out do '
  'LEFT JOIN com OR inflava pending_count e atribuía o MESMO registro a dois '
  'funcionários. ambiguous_match_count > 0 aponta ficha duplicada em employees.';


-- =============================================================================
-- VERIFICAÇÃO — rodar ANTES e DEPOIS, comparando os dois lados.
-- Esta sessão NÃO teve acesso ao banco (sem MCP do Supabase, sem psql, sem
-- credencial no ambiente), então os números do cabeçalho vieram do relato.
-- Reproduza antes de aplicar.
--
-- 1) Fan-out atual (ANTES: total > distintos; DEPOIS: iguais)
--   select count(*) as linhas, count(distinct id) as distintos
--     from public.v_time_pendings;
--   select count(*) as linhas, count(distinct time_record_id) as distintos
--     from public.v_pending_time_records;
--
-- 2) ⚠ O que importa não é o total cair, é o DISTINTO não cair. Guarde o
--    conjunto de ids ANTES e confirme que é idêntico DEPOIS — se um distinto
--    sumir, a linha caiu no filtro payment_type <> 'producao' porque o
--    vencedor da precedência é funcionário por par (ver o aviso no cabeçalho).
--   create temp table _antes as select distinct id from public.v_time_pendings;
--   -- (aplicar a migration)
--   select (select count(*) from _antes) as antes,
--          (select count(*) from public.v_time_pendings) as depois,
--          (select count(*) from _antes a
--            where not exists (select 1 from public.v_time_pendings v where v.id = a.id))
--            as sumiram;   -- esperado: 0
--
-- 3) Badge do RH Hub (get_pending_count_by_employee) — o total deve cair
--    exatamente o número de duplicatas, e nenhum funcionário deve sumir.
--   select sum(pending_count) as total, count(*) as funcionarios
--     from public.get_pending_count_by_employee(30);
--
-- 4) Quem eram as duplicatas (rodar ANTES, para saber o que se está resolvendo:
--    recadastro? homônimo? crachá repetido?)
--   select tr.id, tr.employee_name, tr.employee_external_id,
--          array_agg(e.id order by e.id) as fichas,
--          array_agg(e.name order by e.id) as nomes,
--          array_agg(e.external_id order by e.id) as crachas,
--          array_agg(e.active order by e.id) as ativos,
--          array_agg(e.payment_type order by e.id) as tipos
--     from public.time_records tr
--     join public.employees e
--       on (e.external_id = tr.employee_external_id
--           and e.external_id is not null and e.external_id <> '')
--        or lower(trim(e.name)) = lower(trim(tr.employee_name))
--    group by tr.id, tr.employee_name, tr.employee_external_id
--   having count(*) > 1
--    order by tr.employee_name;
--
-- 5) O segundo fan-out: existe mais de uma jornada default?
--   select count(*) from public.work_schedules where is_default = true;
--   -- > 1 confirma que o join de work_schedules também estava multiplicando.
--
-- 6) security_invoker e ACL preservados pelo REPLACE (esperado DEPOIS:
--    as 3 com {security_invoker=true}, e anon sem SELECT em nenhuma)
--   select c.relname, c.reloptions,
--          has_table_privilege('anon', 'public.'||c.relname, 'SELECT') as anon_le
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('v_time_pendings','v_pending_time_records',
--                        'v_employee_pending_summary');
--
-- 7) Depois de aplicar, com um usuário aprovado do RH logado: /rh/pendencias-ponto
--    e o badge do RH Hub continuam listando as MESMAS pessoas, com o total
--    menor apenas pelas duplicatas.
-- =============================================================================
