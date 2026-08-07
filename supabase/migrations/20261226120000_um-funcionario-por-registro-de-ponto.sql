-- =============================================================================
-- Fan-out de funcionário nas views de pendência de ponto.
--
-- ⚠ AS 3 VIEWS FORAM RECONSTRUÍDAS A PARTIR DE `pg_get_viewdef` NO BANCO, NÃO
-- DOS ARQUIVOS DO REPO — e isso não é preciosismo. Uma primeira versão desta
-- migration foi escrita a partir dos arquivos e teria apagado, em silêncio, três
-- coisas que existem em produção e não estão em nenhum .sql versionado:
--   1. o issue_type 'dia_incompleto_suspeito' e as CTEs default_sched /
--      records_with_gap de `v_pending_time_records` (o repo tem a versão de
--      20260613120002, que as removeu; o BANCO tem a de 20260522180000);
--   2. `suspicious_short_day` e o `WHERE e.active = true` de
--      `v_employee_pending_summary` (mesma divergência);
--   3. o tratamento de FERIADO RECORRENTE em `v_time_pendings`
--      (`COALESCE(h.recurring,false) AND to_char(...,'MM-DD') = ...`), que não
--      aparece em 20260914120000 nem em nenhum arquivo posterior.
-- Só (2) deu erro no apply (rename implícito de coluna); (1) e (3) teriam
-- passado limpos. É a "Regra de ouro" do CLAUDE.md cobrando o preço.
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
-- Join não é "case/when": devolve UMA LINHA POR LINHA DE `employees` que satisfaça
-- o predicado. Quando duas fichas distintas casam com o mesmo time_record — uma
-- pelo crachá e outra pelo nome — o registro sai duplicado.
-- `idx_employees_external_id` (20260402165922) NÃO é único, então o ramo do crachá
-- sozinho também pode casar 2 fichas.
--
-- ⚠ O CRACHÁ É UM SLOT RECICLADO, NÃO UMA IDENTIDADE. É o achado que decide o
-- desenho desta migration, e contraria a intuição natural.
-- Medido: 23 dos 44 external_id do ponto aparecem com NOMES DIFERENTES ao longo do
-- tempo. O crachá `6` foi da "camila" (out/2025→jun/2026) e hoje está na ficha do
-- "Admilson", admitido em 01/07/2026; o crachá `3` foi do "junior" (que nem existe
-- em `employees`) e hoje é da "CAMILA".
--
-- `tr.employee_external_id` é um fato HISTÓRICO (o crachá no momento da batida);
-- `e.external_id` é a atribuição ATUAL. Comparar os dois atravessa a reciclagem:
-- havia 572 registros casando por crachá com uma ficha admitida DEPOIS da batida
-- (12 crachás, 12 fichas recebendo ponto alheio), e todos os 30 registros
-- ambíguos elegiam "Admilson" pelo crachá e "CAMILA" pelo nome.
--
-- DECISÃO DO DONO (07/08/2026): CRACHÁ VIGENTE NA DATA > NOME.
-- O que identifica quem bateu é o PAR (crachá, data). O casamento por crachá só
-- vale se a batida cair dentro da vigência da ficha (admission_date ..
-- termination_date); fora disso o crachá é ignorado e cai no nome. Se o nome
-- também não casar, o registro fica SEM funcionário — melhor pendência órfã e
-- visível do que atribuída a quem não estava na empresa.
--
-- ⚠ Uma versão anterior desta migration usava `crachá > nome` puro. Estava errada
-- e nunca foi aplicada. NÃO reintroduza.
--
-- Efeito medido sobre os 1.521 registros distintos de v_time_pendings:
--   sem funcionário:  925 (só crachá)  →  974 (crachá vigente > nome)
--   atribuição muda em 73 registros; ambiguidade residual: 2
-- Os 49 a mais sem funcionário são precisamente os que hoje vão para quem ainda
-- não tinha sido admitido. ⚠ ~2/3 da view JÁ não casava com ficha nenhuma antes
-- desta mudança (gente que bateu ponto e não está em `employees`, como o
-- "junior") — isso é anterior e não é tratado aqui.
--
-- `admission_date` está preenchido em 23/23 fichas. Ficha SEM admissão não perde o
-- casamento por crachá: NULL é tratado como "sem limite inferior", pra degradar ao
-- comportamento antigo em vez de sumir com a ficha em silêncio.
--
-- POR QUE NÃO É COSMÉTICO
--   · get_pending_count_by_employee (20260524220001) faz COUNT(*) sobre a view e
--     agrupa por employee_id → o MESMO time_record era contado sob DOIS
--     funcionários diferentes, não duas vezes sob um. Badge do RH Hub
--     (src/pages/RHHub.tsx:139) e KPI de funcionários distintos
--     (src/pages/TimePendings.tsx:131) subiam juntos.
--   · src/pages/TimePendings.tsx:355 usa key={p.id} → chave React duplicada.
--   · selectedIds é um Set de p.id (TimePendings.tsx:139) → marcar uma linha
--     marcava a gêmea, e useBulkApplySuggestions (useTimePendings.ts:164) montava
--     DOIS itens para o MESMO time_record.
--   · ⚠ O consumidor mais destrutivo: bulkApplyDefaultExit
--     (src/services/pendingTimeRecordsService.ts:158) itera v_pending_time_records
--     e chama apply_manual_punch_completion, que APPENDA a batida
--     (`v_old_punches || to_jsonb(...)`) sem dedup. Linha duplicada ⇒ "18:00*"
--     gravado DUAS vezes no mesmo time_record: 1 batida vira 3, continua ímpar,
--     continua pendente, e deixa duas linhas em time_record_manual_overrides.
--
-- ⚠ A ESCOLHA DO FUNCIONÁRIO MUDA O CONTEÚDO DA LINHA, NÃO SÓ O RÓTULO.
-- Em v_time_pendings o `e.id` alimenta get_employee_expected_minutes → entra em
-- calculate_day_summary → decide o `status` que classifica a linha como pendência.
-- E `COALESCE(e.payment_type,'mensalista') <> 'producao'` está no WHERE: se o
-- vencedor for funcionário por par, a pendência SOME inteira. Por isso a
-- verificação do fim compara distintos ANTES × DEPOIS, e não só o total.
--
-- (2) SEGUNDO FAN-OUT, em `work_schedules`:
--     ON ws.id = e.work_schedule_id OR (e.work_schedule_id IS NULL AND ws.is_default)
-- Os ramos são exclusivos, mas o segundo casa TODAS as jornadas com
-- `is_default = true`, e não há índice único — o resto do código já assume que
-- pode haver várias (`generate_bom_operations` 20260628181500 e o motor de
-- capacidade 20260719120000 fazem `WHERE is_default ORDER BY created_at LIMIT 1`).
-- ⚠ Pior: quando NENHUM funcionário casa, `e.work_schedule_id` é NULL pelo LEFT
-- JOIN, o segundo ramo fica TRUE e a linha órfã se multiplica por todas as default
-- — e órfã é a maioria desta view. Medido hoje: existe exatamente 1 jornada
-- default, então este fan-out está DORMENTE. A correção aqui é preventiva, e pelo
-- mesmo motivo a CTE `default_sched` ganhou `ORDER BY created_at, id`.
--
-- ⚠ MUDANÇA DE COMPORTAMENTO DELIBERADA, ALÉM DO DEDUP:
-- `v_pending_time_records` casava `employee_external_id = e.external_id` SEM a
-- guarda de vazio que `v_time_pendings` já tinha. Com isso `'' = ''` casava, e UM
-- registro com crachá vazio puxava TODA ficha de crachá vazio (há 4 fichas sem
-- crachá hoje). A guarda foi acrescentada — é causa de fan-out, não refactor.
--
-- A ambiguidade fica VISÍVEL, não silenciosa: a coluna nova
-- `employee_match_ambiguous` marca as linhas que tinham mais de um candidato. Sem
-- ela o sintoma sumiria e a causa — crachá reciclado / ficha duplicada —
-- continuaria mordendo em qualquer relatório futuro que junte ponto com
-- funcionário. A coluna entra no FIM da lista: `CREATE OR REPLACE VIEW` aceita
-- coluna acrescentada no fim e PRESERVA `security_invoker` e o ACL; DROP+CREATE
-- apagaria os dois em silêncio (lição de 20261219120000 e 20261224120000).
--
-- FORA DE ESCOPO (registrado, NÃO tocado):
--   · Os 572 registros com crachá anacrônico só deixam de ser mal atribuídos
--     NESTAS 3 VIEWS. Qualquer outro caminho que junte ponto com funcionário pelo
--     crachá continua atravessando a reciclagem.
-- =============================================================================

-- ── 1. v_time_pendings ───────────────────────────────────────────────────────
-- Base: a definição VIGENTE NO BANCO (pg_get_viewdef), não o arquivo do repo.
-- Mudam só os dois JOINs e a coluna do fim.

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
      WHERE COALESCE(h.optional, false) = false
        AND (h.holiday_date = tr.record_date
             OR COALESCE(h.recurring, false)
                AND to_char(h.holiday_date::timestamptz, 'MM-DD') = to_char(tr.record_date::timestamptz, 'MM-DD'))
    ),
    EXTRACT(isodow FROM tr.record_date)::integer BETWEEN 1 AND 5
  ) AS day_summary,
  CASE
    WHEN (CURRENT_DATE - tr.record_date) > 7 THEN 'overdue'
    WHEN (CURRENT_DATE - tr.record_date) > 3 THEN 'aging'
    ELSE 'fresh'
  END AS urgency,
  public.suggest_punches_for_record(tr.id) AS suggestion,
  -- Coluna NOVA, no FIM: mais de uma ficha casou com este registro.
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
      -- `IS TRUE` não é enfeite: com employee_external_id NULL a comparação devolve
      -- NULL, e `ORDER BY <null> DESC` é NULLS FIRST no Postgres — o casamento por
      -- NOME passaria na frente do casamento por CRACHÁ.
      ((emp.external_id = tr.employee_external_id
        AND emp.external_id IS NOT NULL
        AND emp.external_id <> ''
        AND (emp.admission_date IS NULL OR tr.record_date >= emp.admission_date)
        AND (emp.termination_date IS NULL OR tr.record_date <= emp.termination_date)
       ) IS TRUE) AS by_badge,
      -- Janela avaliada ANTES do LIMIT (WINDOW precede LIMIT na execução), então
      -- conta todos os candidatos, não o que sobrou.
      (count(*) OVER () > 1) AS ambiguous
    FROM public.employees emp
    -- ⚠ A vigência entra AQUI, no conjunto de candidatos — não só no ORDER BY. Se o
    -- crachá anacrônico apenas perdesse a ordenação, venceria sempre que o nome não
    -- casasse com ficha nenhuma: exatamente os 572 registros medidos.
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

-- Idem para a jornada. Mesma convenção de generate_bom_operations e do motor de
-- capacidade: entre defaults, o mais antigo por created_at.
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
      WHERE COALESCE(h.optional, false) = false
        AND (h.holiday_date = tr.record_date
             OR COALESCE(h.recurring, false)
                AND to_char(h.holiday_date::timestamptz, 'MM-DD') = to_char(tr.record_date::timestamptz, 'MM-DD'))
    );

REVOKE SELECT ON public.v_time_pendings FROM anon;
GRANT SELECT ON public.v_time_pendings TO authenticated, service_role;

COMMENT ON VIEW public.v_time_pendings IS
  'Pendencias de ponto dos ultimos 90 dias uteis (/rh/pendencias-ponto e badge do '
  'RH Hub). 1 linha por time_record: a ficha e resolvida por LEFT JOIN LATERAL com '
  'precedencia CRACHA VIGENTE NA DATA > nome. O cracha e RECICLADO (23 dos 44 ja '
  'foram de mais de uma pessoa), entao casar pelo external_id sozinho atravessa a '
  'reciclagem e atribui ponto a quem nem estava na empresa; so vale dentro de '
  'admission_date..termination_date. employee_id NULL = ninguem casou, e isso e '
  'melhor que atribuir errado. employee_match_ambiguous marca mais de um candidato. '
  'Contem batida de ponto, nome e departamento: precisa de security_invoker=true '
  'para herdar a RLS de time_records (is_approved_user()). Para acrescentar coluna '
  'use CREATE OR REPLACE no FIM da lista: DROP+CREATE apaga security_invoker e ACL '
  'sem rastro no diff. ATENCAO: esta definicao inclui feriado RECORRENTE, que nao '
  'existe em nenhum arquivo do repo — reescreva a partir de pg_get_viewdef, nunca '
  'do .sql versionado.';

-- ── 2. v_pending_time_records ────────────────────────────────────────────────
-- ⚠ Base: a definição VIGENTE NO BANCO. Ela é a de 20260522180000 (com as CTEs
-- default_sched/records_with_gap e o issue_type 'dia_incompleto_suspeito'), NÃO
-- a de 20260613120002 que está no repo. Reescrever a partir do arquivo teria
-- APAGADO a detecção de jornada curta — que o TS consome
-- (pendingTimeRecordsService.ts:23 e o branch de bulk em :167). As CTEs abaixo
-- são cópia literal do fonte legível de 20260522180000; muda só o JOIN e a
-- coluna do fim.

CREATE OR REPLACE VIEW public.v_pending_time_records
WITH (security_invoker = true) AS
WITH default_sched AS (
  SELECT * FROM public.work_schedules
  WHERE is_default = true
  ORDER BY created_at, id          -- determinismo: ver nota (2) do cabeçalho
  LIMIT 1
),
records_with_gap AS (
  SELECT
    tr.*,
    jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) AS pc,
    -- Para o caso 2-batidas suspeito, calcula gap líquido em minutos:
    -- se ambas as batidas atravessam o almoço (default 12:00-13:00),
    -- deduz 60min; senão usa gap bruto.
    CASE WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) = 2 THEN
      (
        -- minutos entre as 2 batidas
        (
          EXTRACT(HOUR FROM (tr.punches->>1)::time) * 60 +
          EXTRACT(MINUTE FROM (tr.punches->>1)::time)
        ) -
        (
          EXTRACT(HOUR FROM (tr.punches->>0)::time) * 60 +
          EXTRACT(MINUTE FROM (tr.punches->>0)::time)
        )
        -
        -- Se atravessou o almoço, deduz a duração do intervalo
        CASE WHEN
          (EXTRACT(HOUR FROM (tr.punches->>0)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>0)::time)) <=
            (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60 +
             EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
          AND
          (EXTRACT(HOUR FROM (tr.punches->>1)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>1)::time)) >=
            (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60 +
             EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
        THEN
          (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60 +
           EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
          -
          (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60 +
           EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
        ELSE 0 END
      )::int
    ELSE NULL END AS net_minutes_if_2,
    -- Expected daily minutes do schedule default (entrada→almoço + volta→saída)
    (
      (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60 +
       EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time)) -
      (EXTRACT(HOUR FROM (SELECT entry_time FROM default_sched)::time) * 60 +
       EXTRACT(MINUTE FROM (SELECT entry_time FROM default_sched)::time))
      +
      (EXTRACT(HOUR FROM (SELECT exit_time FROM default_sched)::time) * 60 +
       EXTRACT(MINUTE FROM (SELECT exit_time FROM default_sched)::time)) -
      (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60 +
       EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
    )::int AS expected_min
  FROM public.time_records tr
)
SELECT
  rwg.id AS time_record_id,
  rwg.employee_name,
  rwg.employee_external_id,
  e.id AS employee_id,
  rwg.department,
  rwg.record_date,
  EXTRACT(ISODOW FROM rwg.record_date)::int AS dow,
  rwg.punches,
  rwg.pc AS punch_count,
  CASE
    WHEN rwg.pc = 1 THEN 'somente_uma_batida'
    WHEN rwg.pc = 3 THEN 'falta_saida_apos_almoco'
    WHEN rwg.pc = 5 THEN 'batida_extra'
    WHEN rwg.pc % 2 != 0 THEN 'punches_impar'
    WHEN rwg.pc = 2
      AND EXTRACT(ISODOW FROM rwg.record_date)::int BETWEEN 1 AND 5
      AND rwg.net_minutes_if_2 IS NOT NULL
      AND rwg.expected_min > 0
      AND rwg.net_minutes_if_2 < (rwg.expected_min * 0.75)::int
      THEN 'dia_incompleto_suspeito'
    ELSE NULL
  END AS issue_type,
  EXISTS (
    SELECT 1 FROM public.time_record_manual_overrides o WHERE o.time_record_id = rwg.id
  ) AS has_manual_override,
  COALESCE(e.ambiguous, false) AS employee_match_ambiguous
FROM records_with_gap rwg
LEFT JOIN LATERAL (
  SELECT m.id, m.ambiguous
  FROM (
    SELECT
      emp.id,
      emp.active,
      -- `IS TRUE` não é enfeite: com employee_external_id NULL a comparação devolve
      -- NULL, e `ORDER BY <null> DESC` é NULLS FIRST no Postgres — o casamento por
      -- NOME passaria na frente do casamento por CRACHÁ.
      ((emp.external_id = rwg.employee_external_id
        AND emp.external_id IS NOT NULL
        AND emp.external_id <> ''
        AND (emp.admission_date IS NULL OR rwg.record_date >= emp.admission_date)
        AND (emp.termination_date IS NULL OR rwg.record_date <= emp.termination_date)
       ) IS TRUE) AS by_badge,
      -- Janela avaliada ANTES do LIMIT (WINDOW precede LIMIT na execução), então
      -- conta todos os candidatos, não o que sobrou.
      (count(*) OVER () > 1) AS ambiguous
    FROM public.employees emp
    -- ⚠ A vigência entra AQUI, no conjunto de candidatos — não só no ORDER BY. Se o
    -- crachá anacrônico apenas perdesse a ordenação, venceria sempre que o nome não
    -- casasse com ficha nenhuma: exatamente os 572 registros medidos.
    WHERE (emp.external_id = rwg.employee_external_id
           AND emp.external_id IS NOT NULL
           AND emp.external_id <> ''
           AND (emp.admission_date IS NULL OR rwg.record_date >= emp.admission_date)
           AND (emp.termination_date IS NULL OR rwg.record_date <= emp.termination_date))
       OR lower(trim(emp.name)) = lower(trim(rwg.employee_name))
  ) m
  ORDER BY m.by_badge DESC,   -- crachá vigente vence nome
           m.active DESC,     -- ficha ativa vence desligada
           m.id               -- desempate estável
  LIMIT 1
) e ON true
WHERE rwg.pc > 0
  AND (
    rwg.pc % 2 != 0
    OR (
      rwg.pc = 2
      AND EXTRACT(ISODOW FROM rwg.record_date)::int BETWEEN 1 AND 5
      AND rwg.net_minutes_if_2 IS NOT NULL
      AND rwg.expected_min > 0
      AND rwg.net_minutes_if_2 < (rwg.expected_min * 0.75)::int
    )
  );

-- GRANT reafirma o que já existia (só `authenticated`). O REVOKE NÃO é no-op:
-- 20260522180000 recriou esta view com DROP VIEW + CREATE, e DROP+CREATE devolve
-- a view ao default privilege do Supabase, que INCLUI SELECT para `anon`. Ela
-- nunca entrou na varredura de 20261122120000 (que mirava views SECURITY
-- DEFINER). Com security_invoker o anon não lê nada de fato — a RLS de
-- time_records exige is_approved_user() —, mas o grant pendurado é a armadilha
-- de 20261219120000.
REVOKE SELECT ON public.v_pending_time_records FROM anon;
GRANT SELECT ON public.v_pending_time_records TO authenticated;

COMMENT ON VIEW public.v_pending_time_records IS
  'Pendencias de ponto: batidas impares OU 2 batidas em dia util com jornada < 75% '
  'do esperado (issue_type dia_incompleto_suspeito, via CTEs default_sched/'
  'records_with_gap — NAO remova, o TS consome em pendingTimeRecordsService.ts). '
  '1 linha por time_record: ficha resolvida por LEFT JOIN LATERAL, precedencia '
  'CRACHA VIGENTE NA DATA > nome (ver comentario de v_time_pendings). O casamento '
  'por cracha exige external_id nao-nulo e nao-vazio: sem essa guarda, um registro '
  'de cracha vazio casava com toda ficha de cracha vazio. Linha duplicada aqui '
  'fazia bulkApplyDefaultExit gravar a MESMA batida duas vezes '
  '(apply_manual_punch_completion appenda, nao deduplica).';

-- ── 3. v_employee_pending_summary ────────────────────────────────────────────
-- ⚠ Base: a definição VIGENTE NO BANCO — que tem `suspicious_short_day` E o
-- `WHERE e.active = true`, ambos ausentes da versão do repo. Preservados aqui;
-- a view só GANHA o contador de ambiguidade no fim. (Foi o rename implícito
-- desta coluna que fez a primeira tentativa de apply falhar — e foi essa falha
-- que revelou que o repo e o banco divergiam.)

CREATE OR REPLACE VIEW public.v_employee_pending_summary
WITH (security_invoker = true) AS
SELECT
  e.id AS employee_id,
  e.name,
  e.department,
  COUNT(p.time_record_id) AS pending_count,
  MIN(p.record_date) AS oldest_pending,
  MAX(p.record_date) AS newest_pending,
  COUNT(*) FILTER (WHERE p.issue_type = 'somente_uma_batida') AS only_one_punch,
  COUNT(*) FILTER (WHERE p.issue_type = 'falta_saida_apos_almoco') AS missing_exit,
  COUNT(*) FILTER (WHERE p.issue_type = 'batida_extra') AS extra_punch,
  COUNT(*) FILTER (WHERE p.issue_type = 'dia_incompleto_suspeito') AS suspicious_short_day,
  COUNT(*) FILTER (WHERE p.employee_match_ambiguous) AS ambiguous_match_count
FROM public.employees e
LEFT JOIN public.v_pending_time_records p ON p.employee_id = e.id
WHERE e.active = true
GROUP BY e.id, e.name, e.department;

REVOKE SELECT ON public.v_employee_pending_summary FROM anon;
GRANT SELECT ON public.v_employee_pending_summary TO authenticated;

COMMENT ON VIEW public.v_employee_pending_summary IS
  'Resumo de pendencias por funcionario ATIVO. Herda de v_pending_time_records, que '
  'desde 20261226120000 devolve 1 linha por time_record — antes o fan-out do LEFT '
  'JOIN com OR inflava pending_count e atribuia o MESMO registro a dois '
  'funcionarios. ambiguous_match_count > 0 aponta cracha reciclado ou ficha '
  'duplicada em employees. suspicious_short_day e o WHERE e.active existem no BANCO '
  'e nao no repo — nao reescreva esta view a partir do .sql versionado.';

-- =============================================================================
-- VERIFICAÇÃO — rodar ANTES e DEPOIS.
--
-- 1) Fan-out (ANTES: 1547/1521 e 367/363; DEPOIS: iguais dos dois lados)
--   select count(*) linhas, count(distinct id) distintos from public.v_time_pendings;
--   select count(*) linhas, count(distinct time_record_id) distintos
--     from public.v_pending_time_records;
--
-- 2) ⚠ O total CAI mais do que as 26 duplicatas, e isso é esperado: os registros
--    cujo único casamento era um crachá anacrônico passam a ter employee_id NULL.
--    O que NÃO pode cair é o conjunto de ids DISTINTOS.
--   create temp table _antes as select distinct id from public.v_time_pendings;
--   -- (aplicar) --
--   select (select count(*) from _antes) antes,
--          (select count(distinct id) from public.v_time_pendings) depois,
--          (select count(*) from _antes a
--            where not exists (select 1 from public.v_time_pendings v where v.id=a.id))
--            as sumiram;   -- esperado: 0
--
-- 3) ⚠ A distribuição de issue_type NÃO pode mudar — se 'dia_incompleto_suspeito'
--    zerar, as CTEs foram perdidas na reescrita.
--   select issue_type, count(*) from public.v_pending_time_records group by 1 order by 2 desc;
--
-- 4) Onde a atribuição mudou (esperado ~73, todos saindo de ficha admitida depois
--    da batida):
--   select employee_name, employee_external_id, count(*), min(record_date), max(record_date)
--     from public.v_time_pendings where employee_id is null group by 1,2 order by 3 desc;
--
-- 5) Ambiguidade que sobrou (cadastro a corrigir; aparece com badge na UI):
--   select employee_name, count(*) from public.v_time_pendings
--    where employee_match_ambiguous group by 1 order by 2 desc;
--
-- 6) security_invoker e ACL (esperado DEPOIS: as 3 com {security_invoker=true} e
--    anon_le = false nas 3)
--   select c.relname, c.reloptions,
--          has_table_privilege('anon','public.'||c.relname,'SELECT') anon_le
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relname in
--      ('v_time_pendings','v_pending_time_records','v_employee_pending_summary');
--
-- 7) Com um usuário aprovado do RH logado: /rh/pendencias-ponto e o badge do RH Hub
--    continuam listando as mesmas pessoas.
-- =============================================================================
