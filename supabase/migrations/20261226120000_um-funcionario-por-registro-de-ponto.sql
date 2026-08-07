-- =============================================================================
-- Fan-out de funcionário nas views de pendência de ponto.
--
-- SINTOMA MEDIDO NO BANCO (07/08/2026, project ssvxfoybzmjlypnipqzn):
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
-- time_record — uma pelo crachá e outra pelo nome — o registro sai duplicado.
-- `idx_employees_external_id` (20260402165922) NÃO é único, então o ramo do
-- crachá sozinho também pode casar 2 fichas.
--
-- ⚠ O CRACHÁ É UM SLOT RECICLADO, NÃO UMA IDENTIDADE. É a descoberta que decide
-- o desenho desta migration, e ela contraria a intuição natural.
-- Medido no banco: 23 dos 44 external_id do ponto aparecem com NOMES DIFERENTES
-- ao longo do tempo. O crachá `6` foi da "camila" (out/2025→jun/2026) e hoje
-- está na ficha do "Admilson", admitido em 01/07/2026; o crachá `3` foi do
-- "junior" (que nem existe em `employees`) e hoje é da "CAMILA".
--
-- Consequência: `tr.employee_external_id` é um fato HISTÓRICO (o crachá no
-- momento da batida) e `e.external_id` é a atribuição ATUAL. Comparar os dois
-- atravessa a reciclagem. Havia 572 registros de ponto casando por crachá com
-- uma ficha admitida DEPOIS da batida — 12 crachás, 12 fichas recebendo ponto
-- de outra pessoa. Todos os 30 registros ambíguos elegiam "Admilson" pelo
-- crachá e "CAMILA" pelo nome.
--
-- DECISÃO DO DONO (07/08/2026): CRACHÁ VIGENTE NA DATA > NOME.
-- O que identifica quem bateu é o PAR (crachá, data), não o crachá sozinho. O
-- casamento por crachá só vale se a batida cair dentro da vigência da ficha
-- (admission_date .. termination_date); fora disso o crachá é ignorado e cai no
-- nome. Se o nome também não casar, o registro fica SEM funcionário — que é o
-- resultado correto: melhor pendência órfã e visível do que pendência atribuída
-- a quem não estava na empresa.
--
-- ⚠ Uma versão anterior desta migration usava `crachá > nome` puro. Estava
-- errada e nunca foi aplicada. NÃO reintroduza: o ranking sozinho não basta,
-- o crachá anacrônico precisa sair do CONJUNTO DE CANDIDATOS. Se ele apenas
-- perdesse a ordenação, voltaria a vencer sempre que o nome não casasse com
-- ficha nenhuma — que é exatamente o caso dos 572.
--
-- Efeito medido sobre os 1.521 registros distintos de v_time_pendings:
--   sem funcionário:  925 (só crachá)  →  974 (crachá vigente > nome)
--   atribuição muda em 73 registros
-- Os 49 a mais sem funcionário são precisamente os que hoje vão para quem ainda
-- não tinha sido admitido. ⚠ Note que ~2/3 da view JÁ não casava com ficha
-- nenhuma antes desta mudança (gente que bateu ponto e não está em `employees`,
-- como o "junior") — isso é anterior e não é tratado aqui.
--
-- `admission_date` está preenchido em 23/23 fichas hoje. Ficha SEM admissão não
-- perde o casamento por crachá: NULL é tratado como "sem limite inferior", pra
-- degradar ao comportamento antigo em vez de sumir com a ficha em silêncio.
--
-- POR QUE NÃO É COSMÉTICO
--   · get_pending_count_by_employee (20260524220001) faz COUNT(*) sobre a view e
--     agrupa por employee_id → o MESMO time_record era contado sob DOIS
--     funcionários diferentes, não duas vezes sob um. Badge do RH Hub
--     (src/pages/RHHub.tsx:139) e KPI de funcionários distintos
--     (src/pages/TimePendings.tsx:131) sobiam juntos.
--   · src/pages/TimePendings.tsx:355 usa key={p.id} → chave React duplicada.
--   · selectedIds é um Set de p.id (TimePendings.tsx:139) → marcar uma linha
--     marcava a gêmea, e useBulkApplySuggestions (useTimePendings.ts:164) montava
--     DOIS itens para o MESMO time_record.
--   · ⚠ O consumidor mais destrutivo: bulkApplyDefaultExit
--     (src/services/pendingTimeRecordsService.ts:158) itera
--     v_pending_time_records e chama apply_manual_punch_completion, que APPENDA
--     a batida (`v_old_punches || to_jsonb(...)`, 20260613120002) sem dedup.
--     Linha duplicada ⇒ "18:00*" gravado DUAS vezes no mesmo time_record: 1
--     batida vira 3, continua ímpar, continua pendente, e deixa duas linhas em
--     time_record_manual_overrides. Corrompe o dado.
--
-- ⚠ A ESCOLHA DO FUNCIONÁRIO MUDA O CONTEÚDO DA LINHA, NÃO SÓ O RÓTULO.
-- Em v_time_pendings o `e.id` alimenta get_employee_expected_minutes → entra em
-- calculate_day_summary → decide o `status` que classifica a linha como
-- pendência. E `COALESCE(e.payment_type,'mensalista') <> 'producao'` está no
-- WHERE: se o vencedor for funcionário por par, a pendência SOME inteira. Por
-- isso a verificação do fim compara distintos ANTES × DEPOIS, e não só o total.
--
-- SEGUNDO FAN-OUT, em `work_schedules`:
--     ON ws.id = e.work_schedule_id OR (e.work_schedule_id IS NULL AND ws.is_default)
-- Os ramos são exclusivos, mas o segundo casa TODAS as jornadas com
-- `is_default = true`, e não há índice único garantindo unicidade — o resto do
-- código já assume que pode haver várias (`generate_bom_operations`
-- 20260628181500 e o motor de capacidade 20260719120000 fazem
-- `WHERE is_default ORDER BY created_at LIMIT 1`). ⚠ Pior: quando NENHUM
-- funcionário casa, `e.work_schedule_id` é NULL pelo LEFT JOIN, o segundo ramo
-- fica TRUE e a linha órfã se multiplica por todas as default — e órfã é a
-- maioria desta view. Medido hoje: existe exatamente 1 jornada default, então
-- este fan-out está DORMENTE, não ativo. A correção aqui é preventiva.
--
-- ⚠ MUDANÇA DE COMPORTAMENTO DELIBERADA, ALÉM DO DEDUP:
-- `v_pending_time_records` casava `tr.employee_external_id = e.external_id` SEM
-- a guarda de vazio que `v_time_pendings` já tinha. Com isso `'' = ''` casava, e
-- UM registro com crachá vazio puxava TODA ficha de crachá vazio (há 4 fichas
-- sem crachá hoje). A guarda foi acrescentada — é causa de fan-out, não
-- refactor.
--
-- A ambiguidade fica VISÍVEL, não silenciosa: a coluna nova
-- `employee_match_ambiguous` marca as linhas que tinham mais de um candidato.
-- Sem ela o sintoma sumiria e a causa — crachá reciclado / ficha duplicada —
-- continuaria mordendo em qualquer relatório futuro que junte ponto com
-- funcionário. A coluna entra no FIM da lista: `CREATE OR REPLACE VIEW` aceita
-- coluna acrescentada no fim e PRESERVA `security_invoker` e o ACL; DROP+CREATE
-- apagaria os dois em silêncio (lição de 20261219120000 e 20261224120000).
--
-- FORA DE ESCOPO (achados registrados, NÃO tocados aqui):
--   · Os 572 registros com crachá anacrônico só deixam de ser mal atribuídos
--     NESTAS 3 VIEWS. Qualquer outro caminho que junte ponto com funcionário
--     pelo crachá continua atravessando a reciclagem.
--   · 20260613120002 recriou v_pending_time_records sem o issue_type
--     'dia_incompleto_suspeito' e v_employee_pending_summary sem o
--     `WHERE e.active = true`, ambos de 20260522180000. O TS ainda referencia os
--     dois (pendingTimeRecordsService.ts:23 e :51, o branch de bulk em :167).
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
  -- Coluna NOVA, no fim: mais de uma ficha casou com este registro.
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
        AND emp.external_id <> ''
        AND (emp.admission_date IS NULL OR tr.record_date >= emp.admission_date)
        AND (emp.termination_date IS NULL OR tr.record_date <= emp.termination_date)
       ) IS TRUE) AS by_badge,
      -- Janela avaliada ANTES do LIMIT (WINDOW precede LIMIT na execução),
      -- então conta todos os candidatos, não o que sobrou.
      (count(*) OVER () > 1) AS ambiguous
    FROM public.employees emp
    -- ⚠ A vigência entra AQUI, no conjunto de candidatos — não só no ORDER BY.
    -- Crachá fora da vigência não é candidato; se fosse, venceria sempre que o
    -- nome não casasse com ficha nenhuma (os 572 registros anacrônicos).
    WHERE (emp.external_id = tr.employee_external_id
           AND emp.external_id IS NOT NULL
           AND emp.external_id <> ''
           AND (emp.admission_date IS NULL OR tr.record_date >= emp.admission_date)
           AND (emp.termination_date IS NULL OR tr.record_date <= emp.termination_date))
       OR lower(trim(emp.name)) = lower(trim(tr.employee_name))
  ) m
  ORDER BY m.by_badge DESC,   -- crachá vigente vence nome
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
  'badge do RH Hub). 1 linha por time_record: a ficha é resolvida por LEFT JOIN '
  'LATERAL com precedência CRACHÁ VIGENTE NA DATA > nome. ⚠ O crachá é '
  'reciclado (23 dos 44 já foram de mais de uma pessoa), então casar pelo '
  'external_id sozinho atravessa a reciclagem e atribui ponto a quem nem estava '
  'na empresa; o casamento por crachá só vale dentro de admission_date .. '
  'termination_date. employee_id NULL = ninguém casou, e isso é melhor que '
  'atribuir errado. employee_match_ambiguous = true marca onde houve mais de um '
  'candidato. ⚠ Contém batida de ponto, nome e departamento: precisa de '
  'security_invoker=true para herdar a RLS de time_records (is_approved_user()). '
  'Para acrescentar coluna use CREATE OR REPLACE acrescentando no FIM: '
  'DROP+CREATE apaga security_invoker e ACL sem deixar rastro no diff.';


-- ── 2. v_pending_time_records ────────────────────────────────────────────────
-- Mesmo SELECT de 20260613120002; muda o JOIN (agora com a guarda de crachá
-- vazio e a vigência) e a coluna do fim.

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
        AND emp.external_id <> ''
        AND (emp.admission_date IS NULL OR tr.record_date >= emp.admission_date)
        AND (emp.termination_date IS NULL OR tr.record_date <= emp.termination_date)
       ) IS TRUE) AS by_badge,
      (count(*) OVER () > 1) AS ambiguous
    FROM public.employees emp
    WHERE (emp.external_id = tr.employee_external_id
           AND emp.external_id IS NOT NULL
           AND emp.external_id <> ''
           AND (emp.admission_date IS NULL OR tr.record_date >= emp.admission_date)
           AND (emp.termination_date IS NULL OR tr.record_date <= emp.termination_date))
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
  'por time_record: ficha resolvida por LEFT JOIN LATERAL, precedência CRACHÁ '
  'VIGENTE NA DATA > nome (o crachá é reciclado — ver comentário de '
  'v_time_pendings). ⚠ O casamento por crachá exige external_id não-nulo e '
  'não-vazio: sem essa guarda, um registro de crachá vazio casava com toda ficha '
  'de crachá vazio. Linha duplicada aqui fazia bulkApplyDefaultExit gravar a '
  'MESMA batida duas vezes (apply_manual_punch_completion appenda, não deduplica).';


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
  'funcionários. ambiguous_match_count > 0 aponta crachá reciclado ou ficha '
  'duplicada em employees.';


-- =============================================================================
-- VERIFICAÇÃO — rodar ANTES e DEPOIS, comparando os dois lados.
--
-- 1) Fan-out (ANTES: 1547/1521 e 367/363; DEPOIS: iguais dos dois lados)
--   select count(*) linhas, count(distinct id) distintos from public.v_time_pendings;
--   select count(*) linhas, count(distinct time_record_id) distintos
--     from public.v_pending_time_records;
--
-- 2) ⚠ O total CAI mais do que as 26 duplicatas, e isso é esperado: os
--    registros cujo único casamento era um crachá anacrônico passam a ter
--    employee_id NULL. O que NÃO pode cair é o conjunto de ids DISTINTOS.
--   create temp table _antes as select distinct id from public.v_time_pendings;
--   -- (aplicar a migration)
--   select (select count(*) from _antes) antes,
--          (select count(distinct id) from public.v_time_pendings) depois,
--          (select count(*) from _antes a
--            where not exists (select 1 from public.v_time_pendings v where v.id=a.id))
--            as sumiram;   -- esperado: 0
--
-- 3) Badge do RH Hub — nenhum funcionário deve sumir da lista.
--   select sum(pending_count) total, count(*) funcionarios
--     from public.get_pending_count_by_employee(30);
--
-- 4) Onde a atribuição mudou (esperado ~73 registros, todos saindo de uma ficha
--    admitida depois da batida):
--   select employee_name, employee_external_id, count(*), min(record_date), max(record_date)
--     from public.v_time_pendings where employee_id is null group by 1,2 order by 3 desc;
--
-- 5) Ambiguidade que sobrou (cadastro a corrigir, aparece com badge na UI):
--   select employee_name, count(*) from public.v_time_pendings
--    where employee_match_ambiguous group by 1 order by 2 desc;
--
-- 6) security_invoker e ACL preservados pelo REPLACE (esperado DEPOIS: as 3 com
--    {security_invoker=true} e anon_le = false nas 3)
--   select c.relname, c.reloptions,
--          has_table_privilege('anon','public.'||c.relname,'SELECT') anon_le
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relname in
--      ('v_time_pendings','v_pending_time_records','v_employee_pending_summary');
--
-- 7) Com um usuário aprovado do RH logado: /rh/pendencias-ponto e o badge do RH
--    Hub continuam listando as mesmas pessoas.
-- =============================================================================
