-- =============================================================================
-- Guard de identidade do relógio de ponto.
--
-- CONTEXTO
-- `20261226120000` fez as 3 views de pendência casarem ponto × funcionário por
-- "CRACHÁ VIGENTE NA DATA > nome", porque o crachá do relógio é um SLOT
-- RECICLADO: 23 dos 44 números já pertenceram a mais de uma pessoa (o `6` era da
-- "camila" e hoje é do "Admilson"; o `3` era do "junior" e hoje é da "CAMILA").
--
-- O ARQUIVO DO RELÓGIO NÃO TEM COMO RESOLVER ISSO SOZINHO. Conferido nos três
-- exports do equipamento (RegistroPresença / RelatórioPresença / RelatórioAnormal,
-- 07/08/2026): os únicos campos de identidade são `IDUsuário`, `Nome` e `Dep.` —
-- e `Dep.` é "DEP1" para todo mundo. Não há PIS, CPF nem matrícula. O `IDUsuário`
-- É o `employees.external_id`, e é exatamente ele que recicla. Logo a vigência da
-- ficha é a ÚNICA âncora temporal disponível, e é ela que esta migration protege.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A CONSTRAINT — o ponto frágil da regra nova
--
-- Em `20261226120000` o casamento por crachá é:
--     (emp.admission_date IS NULL OR tr.record_date >= emp.admission_date)
-- NULL foi tratado como "sem limite inferior" DE PROPÓSITO, pra uma ficha sem
-- data não sumir do casamento em silêncio. O efeito colateral é que uma ficha
-- nova SEM `admission_date` volta a casar com o histórico inteiro do crachá —
-- ou seja, reintroduz exatamente o bug que a migration anterior fechou, sem
-- ninguém perceber.
--
-- A constraint fecha esse caminho na origem: quem tem crachá tem que ter
-- admissão. Passa nos dados de hoje (23/23 fichas têm `admission_date`), e o
-- formulário já default a data corrente (`src/pages/Employees.tsx:45`), então
-- não muda o fluxo normal de cadastro — só impede o estado que quebra a regra.
--
-- ⚠ Se um dia esta constraint for removida, a regra de vigência degrada
-- silenciosamente para o comportamento antigo. O check `ficha com crachá sem
-- admissão` do relatório abaixo existe como sentinela justamente pra isso.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_cracha_exige_admissao;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_cracha_exige_admissao
  CHECK (COALESCE(external_id, '') = '' OR admission_date IS NOT NULL);

COMMENT ON CONSTRAINT employees_cracha_exige_admissao ON public.employees IS
  'O cracha do relogio (external_id) e um slot RECICLADO — 23 dos 44 ja foram de '
  'mais de uma pessoa. O casamento ponto x funcionario so e correto quando '
  'ancorado na vigencia da ficha, e admission_date e essa ancora. Sem ela, a '
  'regra de 20261226120000 trata o cracha como valido desde sempre e reatribui o '
  'historico de quem usou o numero antes. Ver timeclock_identity_report().';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O RELATÓRIO — visibilidade contínua do que a constraint não cobre
--
-- Mesma forma dos relatórios que já existem (`consumption_consistency_report`,
-- `cost_consistency_report`): TABLE(check_name, severity, item_count, sample),
-- pra reusar o `CheckRow` de `src/pages/SystemDiagnostics.tsx` sem UI nova.
-- Vocabulário de severidade em pt-BR ('alto'/'medio'/'baixo'), como o de consumo.
-- `item_count = 0` é o estado verde.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.timeclock_identity_report()
RETURNS TABLE(check_name text, severity text, item_count integer, sample text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
  -- Resolve cada registro de ponto pela MESMA regra das views (crachá vigente >
  -- nome). Fica aqui repetida de propósito: se a regra da view mudar e esta não,
  -- o check `ponto sem funcionario` passa a divergir e denuncia o drift.
  WITH uso_por_nome AS (
    -- Janela de uso de cada (crachá, nome) no ponto. Base do check de troca de dono.
    SELECT employee_external_id AS cracha, lower(trim(employee_name)) AS nome,
           min(record_date) AS de, max(record_date) AS ate
      FROM public.time_records
     WHERE COALESCE(employee_external_id,'') <> ''
       AND COALESCE(trim(employee_name),'') <> ''
     GROUP BY 1, 2
  ),
  resolvido AS (
    SELECT tr.id, tr.record_date, tr.employee_name, tr.employee_external_id, e.id AS employee_id
    FROM public.time_records tr
    LEFT JOIN LATERAL (
      SELECT m.id FROM (
        SELECT emp.id, emp.active,
               ((emp.external_id = tr.employee_external_id
                 AND emp.external_id IS NOT NULL AND emp.external_id <> ''
                 AND (emp.admission_date IS NULL OR tr.record_date >= emp.admission_date)
                 AND (emp.termination_date IS NULL OR tr.record_date <= emp.termination_date)
                ) IS TRUE) AS by_badge
        FROM public.employees emp
        WHERE (emp.external_id = tr.employee_external_id
               AND emp.external_id IS NOT NULL AND emp.external_id <> ''
               AND (emp.admission_date IS NULL OR tr.record_date >= emp.admission_date)
               AND (emp.termination_date IS NULL OR tr.record_date <= emp.termination_date))
           OR lower(trim(emp.name)) = lower(trim(tr.employee_name))
      ) m
      ORDER BY m.by_badge DESC, m.active DESC, m.id
      LIMIT 1
    ) e ON true
    WHERE tr.record_date >= CURRENT_DATE - INTERVAL '90 days'
  )

  -- A. Ficha com crachá e sem admissão. Deve ser SEMPRE 0 — a constraint acima
  --    impede. Se aparecer, a constraint foi removida e a regra de vigência está
  --    degradada. É a sentinela da constraint, não um check de cadastro.
  SELECT 'Ficha com cracha e SEM data de admissao (constraint furada)'::text,
         'alto'::text,
         count(*)::int,
         COALESCE(string_agg(name, ', ' ORDER BY name), '—')::text
    FROM public.employees
   WHERE COALESCE(external_id,'') <> '' AND admission_date IS NULL

  UNION ALL
  -- B. Crachá que bate ponto e não tem ficha nenhuma. O ponto dessa pessoa não
  --    entra em banco de horas nem em folha — some, não fica errado.
  SELECT 'Cracha bate ponto mas nao tem ficha no sistema'::text,
         'alto'::text,
         count(*)::int,
         COALESCE(string_agg(t.amostra, ', ' ORDER BY t.amostra), '—')::text
    FROM (
      SELECT DISTINCT tr.employee_external_id || ' (' || tr.employee_name || ')' AS amostra
        FROM public.time_records tr
       WHERE COALESCE(tr.employee_external_id,'') <> ''
         AND tr.record_date >= CURRENT_DATE - INTERVAL '90 days'
         AND NOT EXISTS (
           SELECT 1 FROM public.employees e
            WHERE e.external_id = tr.employee_external_id AND COALESCE(e.external_id,'') <> ''
         )
    ) t

  UNION ALL
  -- C. Registro de ponto recente que não resolve funcionário nenhum. É o efeito
  --    visível de B e de D somados, medido em registros e não em pessoas.
  SELECT 'Registro de ponto (90d) sem funcionario resolvido'::text,
         'alto'::text,
         count(*)::int,
         COALESCE(string_agg(DISTINCT employee_name, ', '), '—')::text
    FROM resolvido
   WHERE employee_id IS NULL

  UNION ALL
  -- D. Ficha ativa sem crachá. Só casa se o nome do relógio bater EXATAMENTE com
  --    o nome da ficha — e no cadastro real quase nunca bate (o relógio grava
  --    "thais", a ficha diz "Thais Batista").
  SELECT 'Ficha ativa sem cracha do relogio'::text,
         'medio'::text,
         count(*)::int,
         COALESCE(string_agg(name, ', ' ORDER BY name), '—')::text
    FROM public.employees
   WHERE active = true AND COALESCE(external_id,'') = ''

  UNION ALL
  -- E. Crachá que TROCOU DE DONO. Não é erro a corrigir — é o fato do
  --    equipamento, e é a razão de a vigência existir. Se este número cair a
  --    zero, alguém passou a numerar direito e a regra virou só rede de segurança.
  --
  --    ⚠ "Mesmo número com nomes diferentes" NÃO serve como critério: dá 23 e a
  --    maioria é variação de grafia. Em 12/02/2026 o relógio passou por uma
  --    RENOMEAÇÃO EM MASSA ("catia"→"catia silva", "marcela"→"marcela andrade",
  --    "elton"→"elton johnson"...), e essas trocas também têm janelas de uso sem
  --    sobreposição — ou seja, nem o critério temporal sozinho basta. Por isso
  --    aqui exigem-se os DOIS: janelas disjuntas E primeiro nome diferente.
  --    Continua sendo heurística: "pretao"→"valmir - pretão" é a mesma pessoa e
  --    entra na conta. Por isso a severidade é 'baixo' — é painel, não alarme.
  SELECT 'Cracha que trocou de dono (janelas disjuntas + nome distinto)'::text,
         'baixo'::text,
         count(*)::int,
         COALESCE(string_agg(t.amostra, ', ' ORDER BY t.cracha), '—')::text
    FROM (
      SELECT a.cracha,
             a.cracha || ': ' || string_agg(DISTINCT
               CASE WHEN a.ate < b.de THEN a.nome || '→' || b.nome
                    ELSE b.nome || '→' || a.nome END, ' / ') AS amostra
        FROM uso_por_nome a
        JOIN uso_por_nome b
          ON a.cracha = b.cracha
         AND a.nome < b.nome
         AND (a.ate < b.de OR b.ate < a.de)                       -- nunca coexistiram
         AND split_part(a.nome,' ',1) <> split_part(b.nome,' ',1) -- não é grafia do mesmo
       GROUP BY a.cracha
    ) t

  UNION ALL
  -- F. Ponto anterior à admissão da ficha que hoje detém o crachá: é o histórico
  --    que a vigência DEIXA de atribuir (corretamente). Informativo — mede
  --    quanto ponto antigo ficou órfão por herança de crachá.
  SELECT 'Ponto anterior a admissao do dono atual do cracha (orfao por heranca)'::text,
         'baixo'::text,
         count(*)::int,
         COALESCE(string_agg(DISTINCT tr.employee_name, ', '), '—')::text
    FROM public.time_records tr
    JOIN public.employees e
      ON e.external_id = tr.employee_external_id AND COALESCE(e.external_id,'') <> ''
   WHERE e.admission_date IS NOT NULL AND tr.record_date < e.admission_date
$fn$;

REVOKE ALL ON FUNCTION public.timeclock_identity_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_identity_report() TO authenticated;

COMMENT ON FUNCTION public.timeclock_identity_report() IS
  'Saude do casamento ponto x funcionario, no formato dos demais '
  '*_consistency_report (check_name/severity/item_count/sample), exibido em '
  '/diagnostics. item_count = 0 e verde. O relogio so exporta IDUsuario, Nome e '
  'Dep., e o IDUsuario e reciclado — entao a vigencia da ficha '
  '(admission_date..termination_date) e a unica ancora que impede atribuir ponto '
  'a quem nem estava na empresa. O primeiro check e sentinela da constraint '
  'employees_cracha_exige_admissao.';


-- =============================================================================
-- VERIFICAÇÃO
--   select * from public.timeclock_identity_report();
--   -- esperado em 07/08/2026: A=0 (constraint), B/C/D > 0 (cadastro a fechar),
--   --                         E=23 (fato do equipamento), F>0 (histórico órfão)
--
--   -- a constraint pega o estado ruim:
--   -- insert into employees(name, external_id, admission_date) values ('x','99',null);
--   -- → ERROR: new row violates check constraint "employees_cracha_exige_admissao"
-- =============================================================================
