# Auditoria de cálculo — RH: ponto, hora extra e folha

- **Data:** 29/07/2026
- **Escopo:** núcleo do RH — importação de batidas, minutos trabalhados, jornada esperada, hora extra, faltas/atrasos/abonos, folha e regimes, persistência e autorização. Rescisão, provisões CLT e capacidade/PCP ficaram **fora**.
- **Ferramentas:** Codex CLI (`gpt-5.6-terra`, reasoning `xhigh`, sandbox read-only) para a leitura estática, fatiada por domínio; Claude para verificação adversarial, consulta ao banco de produção e execução do motor real contra dados reais.
- **Natureza:** auditoria **read-only**. Nenhum arquivo de `src/` ou `supabase/` foi alterado; nada foi escrito no banco.

> **O que diferencia este laudo dos anteriores:** os números não vêm de leitura de código. Vêm de rodar o motor real (`splitDayMinutes`, `calculateSalaryPayroll`) contra as **4.076 batidas de produção** (out/2025 → jul/2026) e de comparar com o motor SQL na mesma entrada. Achado sem prova empírica está marcado como tal.

---

## Sumário executivo

**29 defeitos confirmados** (11 críticos, 13 altos, 5 médios), **5 decisões de política respondidas pelo dono** (P1–P5, nenhuma pendente), **6 itens de código morto**, **4 defeitos reais sem exposição hoje** e — igualmente importante — **7 suspeitas refutadas** que não devem consumir esforço.

**O achado com maior efeito prático não é de código: a tabela de ausências está vazia.** Nunca foi registrado um atestado, uma licença ou uma falta justificada — e existem **1.044 dias úteis sem batida** no histórico. Como o motor só abona um dia se houver linha de ausência cobrindo a data, **todos eles viraram falta com desconto**. O mecanismo de abono funciona; ninguém o alimenta. Ver **D21**.

Nos defeitos de código, o RH não tem problema de fórmula — tem problema de **fronteira**. O motor que paga (`salaryPayroll` + `splitDayMinutes`) e o motor que fiscaliza (`calculate_day_summary`, no banco) discordam em quatro regras, e nada obriga o pagamento a respeitar o que a fiscalização marcou como irregular. O resultado prático é que **62 dias reais estão simultaneamente listados como pendência na tela de Ponto e pagos como jornada de 13h a 21h30 na folha**.

| Tema | Gravidade | Efeito |
|---|---|---|
| **T1 — Dois motores, uma folha** | 🔴 | O SQL zera o dia irregular; o TS paga o intervalo inteiro. 62 dias, até 21h32 pagas num único dia. |
| **T2 — Nada limita o resultado** | 🔴 | Não há teto de plausibilidade. Hora inválida (`29:59`) é aceita e paga como ~21h. 93 dias com span > 14h. |
| **T3 — Ordenação destrói a cronologia** | 🔴 | O `sort` antes do pareamento torna inalcançável o tratamento de meia-noite. Turno noturno de 8h paga **15h**. |
| **T4 — RPC contorna a RLS** | 🔴 | `complete_punches` é `SECURITY DEFINER` sem checagem de papel e com `EXECUTE` para `authenticated` — passa por cima da policy criada em 28/07. |
| **T7 — O dinheiro sai sem trava** | 🔴 | Nada limita o pagamento ao líquido (aceita R$ 3.000 numa folha de R$ 2.000); períodos sobrepostos permitem pagar a mesma competência 2×; o pagamento pode apontar para outro funcionário. |
| **T5 — Controles mortos na tela de Escalas** | 🟡 | "Multiplicador HE" e "Mín. HE para contar" não alteram a folha. O usuário edita e nada muda. |
| **T6 — O abono não existe na prática** | 🔴 | 0 ausências cadastradas, 1.044 dias úteis sem batida. Todo atestado foi descontado. E quando começarem a cadastrar, `justified` é ignorado — vai abonar até o que não deve. |

---

## Decisões de política — respondidas pelo dono em 29/07/2026

Registradas aqui porque mudam a classificação dos achados.

### P1 — Almoço mínimo de 1 hora: **é REGRA, não bug** ✅

Quando o dia passa de 6h e cruza o meio-dia, o motor desconta 1h de almoço **mesmo que a pessoa tenha batido a volta antes disso**.

Medição sobre os dados reais: **653 dias** afetados, **5.172 minutos (86,2 horas)** descontados além do intervalo efetivamente tirado.

> **Decisão:** intervalo de 1h é obrigatório. Comportamento atual está **correto**. Nenhuma correção.
> Consequência: os `-52 min` observados no bucket de 4+ batidas do diferencial TS↔SQL são **esperados** — é o TS aplicando a regra e o SQL não.

### P2 — Dia com número ímpar de batidas (≥5): **deve virar pendência** ⚠️

Hoje a folha paga da primeira à última batida. Nos 62 dias reais com esse padrão isso produziu jornadas de 13h a 21h30.

> **Decisão:** deve **virar pendência para o RH revisar**, não ser pago automaticamente.
> Isto reclassifica o comportamento atual de "política" para **DEFEITO** (item D2).

### P3 — Turno atravessando meia-noite e exceções em geral: **fluxo manual** ⚠️

> **Decisão (palavras do dono):** *"Às vezes vai ter turno atravessando, tem que ver uma forma de que isso vá pra que eu faça manualmente. Todas essas exceções é a mesma coisa quando o funcionário faltar com atestado e que aquele horário ou dia não será descontado."*

Requisito derivado: **um único lugar** onde toda exceção (turno atravessando meia-noite, ímpar ≥5, atestado/abono) é listada, resolvida à mão, e a resolução é **respeitada pelo motor da folha**.

A infraestrutura para isso **já existe e está subaproveitada**: tabela `time_exceptions`, view `v_time_pendings`, página `TimePendings` (`/rh/pendencias-ponto`) e `PROBLEM_STATUSES = ['inconsistent','irregular','partial','absent']` em `src/hooks/useTimePendings.ts:69`. O elo que falta é o motor da folha **consultar** essa resolução — hoje ele não consulta (ver D1).

---

## Defeitos confirmados

### 🔴 D1 — A folha paga dias que a própria tela de Ponto marca como irregulares

- **Onde:** `src/lib/hourlyPayroll.ts:90-166` (`splitDayMinutes`), `src/lib/salaryPayroll.ts:326-385`, `src/hooks/useTimePendings.ts:69`
- **O que acontece:** o conceito de "pendência" existe em dois lugares que não conversam. O motor TS marca `incomplete` **apenas** para 1 ou 3 batidas (verificado por fuzzing: `incomplete ⟺ n ∈ {1,3}`, 0 violações em 4.000 casos). O motor SQL marca `irregular` também para ímpar ≥ 5. A tela de pendências usa o **status do SQL**; a folha usa o **`incomplete` do TS**.
- **Efeito:** o mesmo dia aparece como pendência a resolver **e** é pago integralmente.
- **Prova (dados reais, motor real):**

| Funcionário | Data | Batidas | Folha (TS) | Ponto (SQL) |
|---|---|---|---|---|
| Thais Batista | 26/02/2026 | `00:00, 08:00, 16:23, 17:26, 22:32` | **1.292 min = 21h32** | `irregular`, 0 min |
| Gisele Bastos | 25/02/2026 | `00:40, 07:58, 12:02, 13:15, 22:16` | **1.236 min = 20h36** | `irregular`, 0 min |
| daiane | 09/02/2026 | `01:17, 08:01, 12:16, 13:17, 21:57` | **1.180 min = 19h40** | `irregular`, 0 min |

- **População:** 62 dias. Divergência média de **1.107 min/dia** (18h27) entre os dois motores.
- **Correção (conforme P2):** fazer `splitDayMinutes` devolver `incomplete: true` para ímpar ≥ 5, alinhando com o SQL. O dia passa a aparecer na fila de pendências existente e não é pago até resolução manual.

### 🔴 D2 — Turno que atravessa a meia-noite paga quase o dobro

- **Onde:** `src/lib/hourlyPayroll.ts:104-109` (o `sort`), `:123-161` (o ramo `b < a`, inalcançável)
- **O que acontece:** as batidas são ordenadas numericamente **antes** do pareamento. O único ramo que trata travessia de meia-noite depende de `b < a`, condição que a ordenação torna impossível. `['22:00','06:00']` vira `['06:00','22:00']`.
- **Prova (motor real):**

| Batidas | Turno real | Pago hoje | Erro |
|---|---|---|---|
| `22:00 → 06:00` | 480 min (8h) | **900 min (15h)** | +420 min |
| `23:00 → 07:00` | 480 min (8h) | **900 min (15h)** | +420 min |
| `18:00 → 02:00` | 480 min (8h) | **900 min (15h)** | +420 min |

- **Exposição atual:** nenhum funcionário ativo trabalha em turno noturno hoje — mas o dono confirmou que **vai haver** (P3). Há 13 dias no histórico com primeira batida antes das 05:00.
- **Correção (conforme P3):** não é para "consertar o cálculo" — é para **detectar e mandar para o fluxo manual**. Um par cujo segundo horário é menor que o primeiro deve virar exceção, não ser reordenado em silêncio.

### 🔴 D3 — Um minuto a mais de trabalho custa 59 minutos de pagamento

- **Onde:** `src/lib/hourlyPayroll.ts:34-39` (`LONG_DAY_MIN = 360`), `:145-161`
- **O que acontece:** o desconto de almoço só entra quando o dia passa de 6h. Na fronteira exata, um minuto adicional dispara o desconto inteiro de 1h.
- **Prova (motor real, varredura minuto a minuto da saída):**

| Entrada | Saída | Span | Pago |
|---|---|---|---|
| 08:00 | 14:00 | 360 min | **360 min (6h00)** |
| 08:00 | 14:01 | 361 min | **301 min (5h01)** |

Reproduz em qualquer horário de entrada (testado 07:00→13:01 e 09:00→15:01: mesmo salto de −59 min).

- **Nota:** isto **não** é o mesmo que P1. P1 é sobre descontar 1h de quem tirou menos — decidido como regra. D3 é sobre a **descontinuidade**: quem trabalha *mais* recebe *menos*. Um piso de 6h que penaliza o minuto 361 é defeito independentemente da regra do almoço.
- **Correção:** aplicar o desconto de forma contínua (proporcional ao que falta para 1h) ou mover a fronteira para um marco que não inverta o incentivo.

### 🔴 D4 — `complete_punches` contorna a RLS criada em 28/07

- **Onde:** função `complete_punches(uuid, text[], text)` em produção; `src/hooks/useTimePendings.ts:139,176`
- **O que acontece:** a policy `time_records_write` restringe escrita a `user_has_any_role(['admin','gerente','rh'])`. Mas `complete_punches` é `SECURITY DEFINER` **sem nenhuma checagem de papel, de dono do registro ou de período**. Como `SECURITY DEFINER` roda com os privilégios do criador, ela **passa por cima da policy**.
- **Verificado no banco:** `has_function_privilege('authenticated', …, 'EXECUTE')` = **true** (`anon` = false). Ou seja, qualquer usuário logado — aprovado ou não, de qualquer papel — pode chamá-la.
- **Efeito em dinheiro:** trocar a pendência `['08:00']` por `['08:00','18:00']` transforma o dia em 540 min trabalhados e 60 min de HE. Com jornada 08:00–17:00 e HE a R$ 20/h, são **R$ 20,00** a mais na folha recalculada — por chamada, sem rastro de papel.
- **Efeito:** qualquer usuário autenticado pode reescrever a batida de qualquer funcionário, em qualquer data, inclusive de competência com folha já aprovada. A correção de RLS do batch 4-RH (`05ca849`) está **incompleta**.
- **Correção:** exigir papel de RH dentro da própria função e validar que a data não pertence a competência com `payroll_runs` não-rascunho.

### 🟠 D5 — Hora inválida é aceita e paga

- **Onde:** `src/lib/hourlyPayroll.ts:62-69` (`timeToMin` sem validação); regex `^[0-2][0-9]:[0-5][0-9]$` em `complete_punches`
- **O que acontece:** `timeToMin` faz `(h||0)*60 + (m||0)` sem verificar faixa. O regex da RPC aceita `[0-2][0-9]` — ou seja, **`29:59` é uma hora "válida"** para o banco.
- **Prova (motor real):** `['08:00','29:59']` → `normal=540, premium=719` = **1.259 min (20h59) pagos**.
- **Correção:** validar `HH ≤ 23` no `timeToMin` e trocar o regex por `^([01][0-9]|2[0-3]):[0-5][0-9]$`.

### 🟠 D6 — Batida completada pela RPC perde o marcador de "lançada à mão"

- **Onde:** `complete_punches` (regex rejeita `*`); `src/components/timesheet/ManualEntryTab.tsx:96,101,172`
- **O que acontece:** a tela marca batida manual com sufixo `*`. A RPC `complete_punches` — usada por `useCompletePunches` e `useBulkApplySuggestions` — **rejeita** o `*` no regex e grava o horário limpo. A batida completada fica indistinguível de uma registrada pelo relógio.
- **Rastro que sobra:** `import_batch = 'manual_completion:<uid>'` (só se o lote ainda não era manual) e uma linha em `weekly_balance_audit_log`. O `*` que a UI exibe some.
- **Correção:** preservar o marcador, ou expor a origem da batida no espelho de ponto.

### 🟠 D7 — O comentário que promete paridade TS↔SQL é falso

- **Onde:** `src/hooks/useTimesheet.ts:631` — *"A função SQL `calculate_day_summary` é atualizada em LOCKSTEP (mesma regra)"*
- **Prova (diferencial sobre batidas reais, amostra estratificada por padrão de pareamento):**

| Padrão | Dias na população | Delta médio (TS − SQL) | Causa |
|---|---|---|---|
| 2 batidas cruzando almoço | 582 | **0 min** | concordam |
| 3 batidas | 82 | **0 min** | ambos zeram |
| 2 batidas sem cruzar almoço | 156 | **+60 min** | o SQL desconta 1h de almoço que não houve |
| 4+ batidas (par) | 1.589 | **−13 min** | o TS aplica o almoço mínimo (regra P1); o SQL não |
| **Ímpar ≥ 5** | **62** | **+1.107 min** | o TS paga o intervalo; o SQL zera |

- **Correção:** ou o SQL replica o TS, ou o comentário sai e as telas decisórias param de usar o SQL. Manter a promessa falsa é o que fez os dois motores divergirem sem ninguém notar.

### 🟠 D8 — A "Visão Geral" mostra hora extra diferente da que a folha paga

- **Onde:** `src/components/timesheet/OverviewTab.tsx:150,155,162`; `src/hooks/useTimeAnalytics.ts:121`; contra `src/pages/Payroll.tsx:616,647`
- **O que acontece:** a folha calcula HE **por dia** e não compensa déficit entre dias. A Visão Geral calcula HE **por semana ISO** e aplica `compensatedOT = max(0, HE − déficit)`, valorando com campos legados (`overtime_hourly_rate`, `overtime_multiplier`) em vez de `he_normal_rate`.
- **Exemplo fechado (Codex, confirmado no código):** segunda com +60 min e terça com −60 min, `he_normal_rate = R$ 20/h` → **folha paga R$ 20,00; Visão Geral mostra R$ 0,00**. Com apenas a segunda, a Visão Geral mostra R$ 15,00 (2200÷220×1,5) contra R$ 20,00 da folha.
- **Correção:** derivar a Visão Geral de `computePeriodFolha`.

### 🟠 D9 — Ausência abonada não chega às telas que mostram falta

- **Onde:** `src/hooks/useRH.ts:103` (query key `['absences']`) e `src/hooks/useEmployeeAbsences.ts:31` (query key `['employee_absences']`) — **ambos sobre a mesma tabela `employee_absences`**
- **O que acontece:** registrar um atestado em `EmployeeAbsences` invalida apenas `['employee_absences']`. `RelatorioFaltas`, `RelatorioAtrasos` e `EspelhoPontoPage` consomem `useAbsences`, cuja key não é invalidada — seguem com cache velho (`staleTime` 30s) mostrando falta já abonada.
- **Ligação com P3:** é exatamente o caso que o dono citou — *"quando o funcionário faltar com atestado e que aquele dia não será descontado"*. O abono existe, mas não se propaga.
- **Correção:** uma query key só, ou invalidar as duas em ambos os hooks.

### 🟠 D10 — Identidade do ponto é o nome, não a matrícula

- **Onde:** `src/hooks/useTimesheet.ts:1104-1157` (dedupe por `employee_name + record_date`), `src/lib/employeeMatching.ts:69-83`, e dentro de `complete_punches`: `WHERE e.external_id = ... OR LOWER(TRIM(e.name)) = ... LIMIT 1`
- **Exposição medida no banco:** 73 nomes distintos em `time_records` para 20 funcionários ativos; **23 matrículas associadas a mais de um nome**; **3 nomes associados a mais de uma matrícula**. Exemplo real: a matrícula `13` aparece como `"erick"` (23 dias) e `"Erick Cesar"` (132 dias).
- **Efeito:** atribuição errada de minutos entre grafias. O cenário de pagamento em dobro por homônimo está **latente** — hoje não há nome nem matrícula duplicados na tabela `employees`.
- **Correção:** resolver matrícula → `employee_id` antes de persistir e deduplicar por identidade estável.

### 🟡 D11 — "Multiplicador HE" da escala não altera a folha

- **Onde:** `src/pages/Timesheet.tsx:224` (o campo), `src/lib/salaryPayroll.ts:571,596,396`
- **O que acontece:** `premiumMult` é lido da escala e passado ao motor, mas `computePeriodFolha` **sempre** monta a `SalaryPolicy`, e a fórmula canônica paga R$/h absoluto. O multiplicador só teria efeito no ramo legado, que nenhum caller vivo usa. O comentário em `:570` afirma o contrário.
- **Prova:** com 60 min de HE e `he_normal_rate = R$ 20/h`, trocar a escala de 1,5× para 2,0× mantém a folha em **R$ 20,00 → R$ 20,00**.
- **Correção:** remover o controle da tela e o comentário enganoso.

### 🟡 D12 — "Mín. HE para contar" da escala também não altera a folha

- **Onde:** `src/pages/Timesheet.tsx:223`; `src/lib/salaryPayroll.ts:590` (piso fixo em 10); `src/lib/weeklyTimeCalculation.ts:120,137`
- **O que acontece:** a folha fixa o piso em 10 min e **não** lê `schedule.minimum_overtime_minutes`. Só a tela semanal lê.
- **Prova:** escala com mínimo 60 e HE diária de 15 min a R$ 20/h → folha paga **R$ 5,00**; Visão Geral mostra **0 min / R$ 0,00**.

### 🟠 D13 — O histórico de importação nunca gravou nada

- **Onde:** tabela `time_import_logs`, view `v_time_import_archive`, `src/components/timesheet/ImportHistoryPanel.tsx`, `src/hooks/useTimeImportLogs.ts`
- **Prova (banco):** `time_import_logs` tem **0 linhas**, enquanto `time_records` registra **21 lotes distintos** de importação (`import_batch`).
- **Efeito:** não há rastro de qual arquivo do relógio originou quais batidas, nem quem importou e quando. O painel de histórico exibe vazio. O requisito 1 da spec (`specs/gestao-de-pessoas.md` — *"arquivos de ponto salvos e buscáveis"*) **não está cumprido na prática**, embora a tabela e a tela existam.
- **Relevância:** numa contestação trabalhista, é o rastro que liga o espelho de ponto ao arquivo bruto do relógio.
- **Correção:** verificar por que o insert em `time_import_logs` não acontece (ou falha em silêncio) dentro de `useImportTimeRecords`.

### 🟡 D14 — Batida duplicada some sem virar pendência

- **Onde:** `src/lib/hourlyPayroll.ts:90-166`
- **Prova (motor real):** `['08:00','08:00']` → `normal=0, premium=0, incomplete=false`. O dia é tratado como trabalhado-zero, ou seja, **falta**, sem sinalizar que a causa foi batida duplicada.
- **Nota:** o motor SQL dedupa batidas com menos de 5 min de intervalo; o TS não. 70 dias no bucket de 4+ batidas e 18 no de 2 batidas sofrem dedupe no SQL e não no TS.

### 🔴 D15 — "Dar baixa" nos vales quita adiantamento futuro que ainda não foi descontado

- **Onde:** `src/hooks/useEmployees.ts:242-255` (`useSettleEmployeeAdvances`); `src/components/hr/AdvancesPanel.tsx:309-318,441-453`
- **O que acontece:** a mutação recebe apenas o funcionário e marca como `paid` **todos** os vales `pending` dele — sem filtrar período nem `payroll_run_id`.
- **Impacto:** um vale lançado para a competência seguinte é baixado hoje. Como a folha só desconta vales com `status='pending'`, o valor **nunca é recuperado**.
- **Exemplo fechado:** funcionário com vale de R$ 300 em julho (já descontado) e vale de R$ 500 com `advance_date = 2026-08-10`, ambos `pending`. Um clique em "Dar baixa" quita os dois. Em agosto a folha não desconta os R$ 500 — **R$ 500 perdidos**.
- **Correção:** baixar apenas IDs explícitos do período liquidado e vinculá-los ao `payroll_run_id` correspondente. *(Reconfirma achado P09 de 28/07, ainda aberto.)*

### 🔴 D21 — O abono nunca foi usado: todo atestado está sendo descontado

Este é o achado de maior efeito prático imediato, e é exatamente o que você levantou em P3.

- **Prova (banco):** a tabela `employee_absences` tem **0 linhas**. Nunca foi registrada uma ausência. Ao mesmo tempo há **1.044 dias úteis sem nenhuma batida** (dia de semana, fora de feriado), distribuídos por 33 grafias de funcionário.
- **Efeito:** o motor só abona um dia quando existe linha de ausência cobrindo a data (`excused`). Sem nenhuma linha, **todo dia útil sem batida virou falta com desconto** — inclusive atestado, licença e falta justificada verbalmente.
- **Ordem de grandeza:** a R$ 100/dia (salário R$ 2.200, 22 dias úteis), os 1.044 dias equivalem a **R$ 104.400 em descontos** de falta. ⚠ Este é um **teto bruto**, não uma perda apurada: parte desses dias cai fora do vínculo do funcionário, parte em datas sem cobertura de importação (que o motor neutraliza), e nem todos têm salário de R$ 2.200. O número serve para dimensionar o risco, não para lançar contabilmente.
- **Correção:** antes de qualquer coisa no código — cadastrar as ausências reais. O mecanismo funciona; simplesmente não está sendo alimentado. Depois, ver D22, que quebra o abono na direção oposta.

### 🔴 D22 — Falta injustificada é abonada como se fosse justificada

- **Onde:** `src/lib/ponto/periodDates.ts:70-85` (`expandAbsenceDatesByEmployee`), `src/pages/Payroll.tsx:575-581`, `src/hooks/useEmployeeAbsences.ts:46-82`
- **O que acontece:** dois erros que se somam. (a) A folha busca apenas as **datas** da ausência; `expandAbsenceDatesByEmployee` **não olha o campo `justified` nem o tipo** — qualquer linha vira `excused = true`. (b) A tela de lançamento (`useCreateAbsence`) grava **sempre `justified: true`**, inclusive para `suspensao` e `outro`.
- **Impacto (salário R$ 2.200, 22 dias úteis):** uma linha `{ absence_type: 'falta_injustificada', justified: false }` deveria descontar **R$ 100,00**; a folha devolve dia abonado e **R$ 0,00**.
- **Por que importa agora:** hoje é inofensivo porque a tabela está vazia (D21). No instante em que você começar a cadastrar ausências — que é o que precisa acontecer — este defeito passa a abonar tudo, inclusive o que deveria descontar.
- **Correção:** propagar `justified` na consulta e expandir só ausências justificadas; parar de forçar `true` no lançamento.

### 🔴 D23 — Cobertura é global: a batida de um funcionário faz o dia "contar" para todos

- **Onde:** `src/hooks/useTimesheet.ts:929-972` (`useTimesheetCoverage`), `src/lib/salaryPayroll.ts:304-312`, `src/pages/Timesheet.tsx:800-815`
- **O que acontece:** `coveredDates` é um `Set` **global de datas**. Basta um funcionário ter batido para a data ser "coberta" — e então quem não aparece no arquivo naquele dia vira **falta**, em vez de ficar neutro por ausência de dado.
- **Impacto:** em 08/06 o arquivo traz batidas da Ana mas nenhuma linha do Bruno → Bruno leva falta falsa de **R$ 100,00**, quando o correto seria neutro até haver cobertura dele.
- **Agravante:** a tela de Ponto chama a folha **sem** `coveredDates` nem `maxCoveredDate` (`Timesheet.tsx:800-815`), então nem a proteção parcial existente vale ali. Importação declarada até 05/06 mas com batidas só até 03/06 exibe **duas faltas falsas** na tela.
- **Ligação com D21:** este é o mecanismo que transformou parte dos 1.044 dias vazios em falta.
- **Correção:** cobertura por funcionário (ou confirmação explícita de arquivo completo), e passar `coveredDates`/`maxCoveredDate` também na tela de Ponto.

### 🟠 D24 — Espelho de Ponto marca falta antes da admissão e depois da demissão

- **Onde:** `src/pages/EspelhoPontoPage.tsx:125-185`
- **O que acontece:** o Espelho percorre o mês inteiro sem recortar por `admission_date`/`termination_date`. A folha recorta (`salaryPayroll.ts:541-546`); o Espelho não.
- **Impacto:** admitido em 11/06 aparece com três faltas em 08–10/06. O Espelho é o **documento legal** (Portaria MTE 671/2021) — mostrar falta antes do vínculo é problema numa fiscalização, mesmo sem efeito na folha.
- **Correção:** limitar o laço ao intervalo contratual.

### 🟠 D16 — O Excel "Detalhe dia a dia" desconta falta pelo divisor legado

- **Onde:** `src/lib/printTimesheet.ts:671-672,727-729` (`evaluationDetail`); `src/lib/exportFolhaExcel.ts:62-79,94-100`
- **O que acontece:** a folha gravada usa a política canônica (falta ÷ dias úteis), mas o detalhe exportado recalcula com `salário ÷ 30` e `salário ÷ 220`.
- **Impacto (salário R$ 2.200, mês de 22 dias úteis):** uma falta sai como **R$ 73,33** no Excel contra **R$ 100,00** na folha — **R$ 26,67 de diferença por falta**. Uma hora de atraso sai R$ 10,00 em vez de R$ 11,11.
- **Relevância:** é o arquivo que vai para o contador. *(Reconfirma o item B2 da auditoria de 03/07, ainda aberto.)*

### 🟠 D17 — Folha e Comparativo discordam em um salário inteiro no período multi-mês

- **Classificação:** POLÍTICA — **decidida** em P4: rejeitar intervalo multi-mês
- **Onde:** `src/pages/Payroll.tsx:507-518` (o guard) contra `src/lib/payrollComparativo.ts:106-109,156,176-199` (sem guard)
- **O que acontece:** ao calcular, a folha limita `periodDays` ao mês inicial e emite `toast.warning`. O comparativo/Excel não limita e usa todos os dias do intervalo.
- **Impacto no período real `2026-05-15_2026-07-15` (62 dias), salário R$ 2.200:** folha grava **R$ 2.200,00**; comparativo/Excel mostra **R$ 4.400,00** (`2200 × 62 ÷ 31`).
- **Exposição medida:** **118 das 395 folhas** têm período maior que 40 dias.

### 🟠 D18 — Comparativo desconta vale já pago ou já vinculado a outra folha

- **Onde:** `src/pages/Payroll.tsx:560-566` (`payroll_run_id IS NULL` **AND** `status='pending'`) contra `src/lib/payrollComparativo.ts:140-144` (`.or('payroll_run_id.is.null,status.eq.pending')`)
- **O que acontece:** a folha exige as duas condições; o comparativo aceita qualquer uma. São conjuntos diferentes.
- **Exemplo fechado:** vale de R$ 500 com `status='pending'` **e** `payroll_run_id` de uma folha anterior → folha: líquido R$ 2.200; comparativo/Excel: líquido **R$ 1.700**. O inverso ocorre com vale `paid` e `payroll_run_id` nulo.

### 🔴 D25 — Nada limita o pagamento ao líquido da folha

- **Onde:** `src/components/hr/RegistrarPagamentoDialog.tsx:57,75,81`; `src/hooks/usePayrollPayments.ts:181`; trigger `tg_payroll_payment_guard` e `recompute_payroll_paid`
- **Verificado no banco:** `recompute_payroll_paid` compara a soma paga com `total_liquido` usando **`>=`** — marca a run como `pago` quando atinge o líquido, mas **não rejeita o excedente**. A UI só exige valor positivo.
- **Impacto:** folha aprovada de líquido R$ 2.000 aceita um pagamento de **R$ 3.000**. Total pago R$ 3.000, status `pago`, **R$ 1.000 a mais** sem nenhum alerta.
- **Correção:** registrar pagamento por RPC transacional com lock na run, calculando saldo e rejeitando `amount > saldo` (tolerância de centavos).

### 🔴 D26 — Períodos sobrepostos permitem pagar a mesma competência mais de uma vez

- **Onde:** constraint `payroll_runs_employee_id_period_key`; `src/pages/Payroll.tsx:65` (`rangeToPeriod`)
- **Verificado no banco:** a unicidade é `UNIQUE (employee_id, period)` — sobre o **texto** do período. Aceita simultaneamente `2026-06`, `2026-06-01_2026-06-15` e `2026-06-16_2026-06-30` para o mesmo funcionário. `recompute_payroll_paid` soma pagamentos de **uma** run, sem enxergar cobertura das outras.
- **Impacto:** salário R$ 3.000 sem descontos → as três runs podem ser aprovadas e quitadas: **R$ 6.000 pagos** para uma competência de R$ 3.000.
- **Exposição real:** já existem sobreposições gravadas — Erick Cesar tem `2026-06` (aprovada) coexistindo com cinco rascunhos que cobrem o mesmo intervalo. Nenhuma foi paga ainda.
- **Correção:** persistir início/fim como datas e criar restrição de exclusão (`EXCLUDE USING gist`) por funcionário para runs ativas.

### 🟠 D27 — Pagamento pode apontar para outro funcionário e forjar o autor

- **Onde:** `src/hooks/usePayrollPayments.ts:210`; trigger `tg_payroll_payment_guard`
- **Verificado no banco:** o corpo do `tg_payroll_payment_guard` (707 caracteres) **não menciona `employee_id`** — só confere o status da run. `payroll_run_id` e `employee_id` têm FKs independentes, e `created_by` vem do cliente (só cai para `auth.uid()` quando nulo).
- **Impacto:** via PostgREST, um pagamento pode quitar a run da Ana registrando o valor no histórico do Beto, com autoria da Carla.
- **Correção:** no trigger, comparar `NEW.employee_id` com `payroll_runs.employee_id` e sempre forçar `NEW.created_by := auth.uid()`.

### 🟠 D28 — Recálculo concorrente da mesma competência: o último escritor vence em silêncio

- **Onde:** `src/hooks/useRH.ts:231,246,250`
- **O que acontece:** a chave única evita linha duplicada, mas o `upsert` faz `ON CONFLICT DO UPDATE` sem checar versão nem status. Dois operadores que leem "não existe run" gravam a mesma linha e o segundo sobrescreve o primeiro sem aviso.
- **Impacto:** salário R$ 3.000, junho com 22 dias úteis. Operador A calcula R$ 3.000; Operador B calcula com uma falta, R$ 2.863,64. O valor final depende de quem gravou por último.
- **Correção:** RPC transacional com `updated_at` esperado, devolvendo conflito explícito ao segundo escritor.

### 🟡 D29 — Não há trava no banco contra editar insumo de folha já aprovada

- **Onde:** `src/hooks/useRH.ts:49` (`assertNoClosedPayroll`, **só no cliente**); `src/components/timesheet/ManualEntryTab.tsx:199`
- **O que acontece:** `tg_payroll_lock_finalized` protege a **própria** `payroll_runs` finalizada. Mas os **insumos** dela — batidas em `time_records` e linhas de `employee_absences` — não têm trava equivalente no banco. A validação é client-side e a tela de ponto nem a chama.
- **Efeito:** pelo PostgREST direto (ou por `complete_punches`, ver D4), dá para alterar o ponto de uma competência já aprovada e paga. A folha gravada não muda sozinha, mas qualquer recálculo ou relatório passa a divergir do que foi pago.

### 🟡 D19 — Arredondamento quebra a soma exata das quinzenas em meses de 28 e 30 dias

- **Onde:** `src/lib/salaryPayroll.ts:194,272-274,411`
- **O que acontece:** cada quinzena é arredondada a centavos separadamente; em empate de meio centavo, ambas sobem.
- **Prova:** salário R$ 2.200,01 em mês de 30 dias → `1.100,01 + 1.100,01 = R$ 2.200,02` (esperado R$ 2.200,01). Só acontece em meses de 28 e 30 dias; 29 e 31 não têm o empate.
- **Isto explica** as 62 folhas com `total_liquido ≠ proventos − descontos` de ±R$ 0,01 medidas nas invariantes (D20).
- **Correção:** calcular a 2ª parcela como `salário − 1ª parcela`, ou arredondar só o consolidado.

### 🟡 D20 — Folhas históricas com hora extra incoerente

- **Prova (invariantes sobre as 395 `payroll_runs`):**

| Verificação | Violações | Onde |
|---|---|---|
| HE em R$ > 0 com 0 minutos de HE gravados | **10 runs** | todas ≤ 08/07/2026 |
| Minutos de HE > 0 com R$ 0,00 pago | **4 runs** | todas ≤ 08/07/2026 |
| `total_liquido ≠ proventos − descontos` | 62 runs | **todas ±R$ 0,01 — arredondamento, não corrupção** |

- **Valor de HE não paga nas 4 runs:** **R$ 105,75** (ex.: Gisele Bastos, 05/2026, 401 min de HE registrados e R$ 0,00 pagos).
- **Delimitação honesta:** **zero violações** nas 188 runs criadas a partir de 09/07/2026 (política canônica). O motor atual grava as duas colunas coerentemente. Isto é **passivo histórico**, não bug vivo.

---

## Código morto e resíduos

| # | Item | Situação |
|---|---|---|
| M1 | `calculate_weekly_he_breakdown(uuid,date)` | Existe em produção como `SECURITY DEFINER`, **`authenticated` tem EXECUTE**, `anon` não. **Zero callers em `src/`**. Não está versionada nas migrations deste checkout. |
| M2 | `snapshot_all_employees_week`, `unlock_week`, `tg_block_edit_in_locked_week` | Sobreviveram ao drop do banco de horas (mig `20260910130000`). `snapshot_all_employees_week` chama `snapshot_employee_week`, que **não existe** — a função captura a exceção por funcionário e devolve erro para todos. Nunca gravou nada. |
| M3 | Tabela `overtime_resolutions` | 0 linhas; a função que a alimentava (`resolve_monthly_overtime`) foi dropada. |
| M4 | Invalidação de `['bank_hours_balance']` | `src/hooks/useEmployeeAbsences.ts:80,100` invalida uma view que não existe mais. Idem `useTimesheet.ts:1290-1291,1330`, `useTimePendings.ts:149,189`. |
| M5 | Componentes órfãos (0 refs) | `PreFolha.tsx`, `KPIsRH.tsx`, `SeveranceSimulator.tsx`, `EmployeeScheduleEditor.tsx` |
| M6 | Páginas órfãs (sem rota) | `AbsenceReport.tsx`, `HeadcountReport.tsx`, `PunchReconciliationPage.tsx` |

Além disso: **13 escalas cadastradas, 12 delas idênticas** à padrão (08:00–18:00, almoço 12:00–13:00, 44h), uma por funcionário. Não causa erro de cálculo — é ruído de cadastro que dificulta manutenção.

---

## Suspeitas REFUTADAS — não gastar esforço aqui

Levantadas na sondagem inicial ou pelo Codex e derrubadas na verificação. Registradas para não voltarem.

| Suspeita | Veredito |
|---|---|
| Tabela `absences` fantasma sendo consultada | **Falso.** Não existe tabela `absences`; os dois hooks leem `employee_absences`. O problema real é a query key (D9). |
| Batida `*` é uma saída fabricada pelo sistema e pagar por ela é fraude | **Falso.** O `*` marca batida **lançada manualmente pelo RH** (`ManualEntryTab.tsx:96,101`) — correção legítima. O problema real é o inverso: a RPC **remove** o marcador (D6). |
| 5 funcionários sem `work_schedule_id` geram falta/HE falsas | **Sem impacto hoje** — mas verifique. Todas as 13 escalas ativas são idênticas (08:00–18:00, almoço 12:00–13:00, 44h), então a herdada é igual à própria. As três telas (`Payroll.tsx:609`, `Timesheet.tsx:746,803`, `EspelhoPontoPage.tsx:88`) usam o mesmo fallback. ⚠ Isto só vale se a jornada **real** desses 5 for mesmo 9h — se algum deles trabalha 8h de fato, são 60 min de atraso falso por dia (R$ 244,44 em 22 dias, salário R$ 2.200). Confirme com eles. |
| HE sai R$ 0,00 em silêncio quando falta `he_normal_rate` | **Falso.** `salaryPayroll.ts:400` sinaliza `he_rate_missing` e `Payroll.tsx:683` exibe toast explícito. |
| Sábado sofre dupla contagem (premium do split × taxa da policy) | **Falso.** O split marca premium, mas a folha classifica a tarifa pelo dia: sábado usa `heNormalMin`. |
| Corte das 18:00 cria HE indevida em jornada deslocada | **Falso.** Entrada 10:00 / saída 20:00 com 1h de almoço = 540 min contra 540 esperados → **0 min de HE**. O corte só separa os campos `normal`/`premium`. |
| O status `cancelado` não existe na constraint, então o estorno da folha é inalcançável | **Parcialmente falso.** A constraint viva **aceita** `cancelado`: `CHECK (status = ANY (ARRAY['rascunho','aprovado','pago','cancelado']))`. O que bloqueia o estorno é `tg_payroll_lock_finalized` e a máquina de estados da UI, não o schema. A correção é menor do que o relatado. |

---

## Defeitos reais, sem exposição hoje

Confirmados no código, com zero incidência nos dados atuais. Não priorizar, mas não esquecer — viram dinheiro no dia em que o cadastro mudar.

| Item | Onde | Por que está dormindo |
|---|---|---|
| **Valor-hora de atraso usa a jornada padrão, não a do dia** — `expectedDayMinutes(inp.schedule)` é chamado sem `dow` ao montar `policy.journeyMinutes` | `src/lib/salaryPayroll.ts:581-587` | **Nenhuma das 17 escalas tem `works_saturday`.** Numa escala seg–sáb com sábado 08:00–12:00, 239 min de atraso descontariam R$ 37,45 em vez de R$ 84,26. |
| **Saldo devedor do regime produção aparece como "Quitado"** e não pode ser cobrado | `src/lib/salaryPayroll.ts:644-663`; `src/components/hr/RegistrarPagamentoDialog.tsx:57-75,125-128` | **0 funcionários ativos com `payment_type='producao'`.** Líquido negativo (ex.: −R$ 50 de adiantamento sem produção) é lido como quitado pelo diálogo. |
| **Regime remoto persiste métricas de ponto** — zera o financeiro mas mantém `expected_minutes` e `workdays` | `src/lib/salaryPayroll.ts:600-610` | 1 funcionário em escala "Home Office (sem ponto)". Faz o comparativo classificá-lo como "Sem ponto importado". |
| **Feriado móvel cadastrado como recorrente cai no dia errado nos anos seguintes** — `resolveHolidaysInRange` repete pelo mesmo `MM-DD` | `src/lib/ponto/periodDates.ts:16-45` | **Verificado: nenhum dos 8 feriados recorrentes é móvel** (sem Carnaval/Corpus Christi/Sexta-Feira Santa entre eles). Os 84 restantes são datas fixas. A UI comenta que móveis não devem ser recorrentes, mas não impede o cadastro. |

---

## Decisões de política — parte 2 (respondidas em 30/07/2026)

### P4 — Período que cruza mais de um mês: **rejeitar, uma folha por competência** ✅

O sistema tem **118 folhas com período maior que 40 dias** (ex.: `2026-05-15_2026-07-15`, 62 dias). Os dois caminhos discordavam em um salário inteiro:

| | Cálculo | Resultado (salário R$ 2.200) |
|---|---|---|
| Folha gravada | limita a 1 mês: `2200 × 31 ÷ 31` | R$ 2.200,00 |
| Comparativo / Excel | usa o intervalo cheio: `2200 × 62 ÷ 31` | R$ 4.400,00 |

> **Decisão:** **rejeitar** intervalos que cruzam mês. A tela passa a exigir uma folha por competência (mês cheio ou quinzena dentro do mês). Elimina a ambiguidade na raiz em vez de escolher entre os dois números.

**Implicações para quem for implementar:**
- Validar em `Payroll.tsx` antes de calcular, substituindo o `toast.warning` do guard (`:507-518`) por bloqueio.
- Aplicar a mesma restrição em `payrollComparativo.ts` — hoje ele não tem guard nenhum.
- As **118 folhas multi-mês já gravadas** são todas `rascunho`; decidir se ficam como histórico inerte ou são apagadas. Não recalcular: foram feitas sob outra regra.
- Ligação com **D26**: se o período passar a ser sempre uma competência fechada, a restrição de sobreposição fica muito mais simples de expressar.

### P5 — Folhas aprovadas antes do sincronizador financeiro: **fazer backfill** ✅

`tg_payroll_sync_financial_entry` é forward-only por decisão registrada na própria migration (`20260831120000`): folha aprovada antes dela nunca virou despesa em `financial_entries`.

> **Decisão:** executar **backfill** para completar o histórico do DRE.

**Implicações:**
- O backfill precisa ser **idempotente** — há índice único parcial em `(reference_id, reference_type)` filtrando `reference_type='payroll_run'`, então reexecutar não duplica; ainda assim, escrever com `ON CONFLICT DO NOTHING`.
- **Impacto real hoje é mínimo:** existe **1** folha não-rascunho no sistema, e ela é de **R$ 0,00** (a anomalia do Erick Cesar, abaixo). O backfill é preventivo — vale fazer antes de o volume de folhas aprovadas crescer, não depois.
- Mexe em competências já fechadas: avisar o contador antes de rodar.

---

## Anomalia que precisa de explicação

**A única folha não-rascunho do sistema é um R$ 0,00 aprovado.** Erick Cesar, competência `2026-06`, status `aprovado`, criada em 01/06/2026: `base_salary` R$ 2.000, `expected_minutes` 10.560, `worked_minutes` 0, `absent_days` **0**, `absence_discount` **R$ 0,00**, `total_proventos` **R$ 0,00**.

Ele tem 30 registros de ponto em junho, **todos com `punches` vazio** — não bateu. Mas 30 dias úteis sem batida deveriam produzir falta e desconto, e produziram zero de ambos. Os números não fecham com nenhum ramo documentado do motor. A run é anterior a várias correções (Tier histórico), então provavelmente reflete um motor antigo — mas convém confirmar antes de aprovar qualquer folha nova por esse caminho.

---

## Prioridade sugerida

**Antes de mexer em código:**

0. **D21** — começar a cadastrar as ausências reais (atestado, licença, falta justificada). Nenhuma linha da fórmula precisa mudar para isso; sem esse passo, todo dia parado continua virando desconto. Corrigir **D22** junto, senão o cadastro passa a abonar também o que deveria descontar.

**Correção pontual, alto retorno** (cada uma é localizada e fecha dinheiro):

1. **D15** — "Dar baixa" só nos vales do período liquidado. Hoje um clique perde vale futuro inteiro. Uma cláusula `WHERE`.
1b. **D23** — cobertura por funcionário, e passar `coveredDates` também na tela de Ponto. É o mecanismo que converte dia sem dado em falta.
2. **D1 + P2** — ímpar ≥5 devolve `incomplete: true`. Fecha os 62 dias pagos a 13h–21h32 e implementa sua decisão. Uma condição em `splitDayMinutes`.
3. **D5** — validar `HH ≤ 23` no `timeToMin` e no regex da RPC. Elimina o pagamento de 21h por digitação.
4. **D9** — unificar a query key das ausências. Uma linha, e o abono passa a chegar no relatório de faltas.
5. **D18** — trocar o `.or(...)` do comparativo pelos mesmos filtros da folha.

**Segurança e trava de dinheiro** (nada aqui é erro de conta — é ausência de guarda):

6. **D25** — teto no pagamento. Uma folha de R$ 2.000 aceita pagamento de R$ 3.000 hoje.
7. **D26** — restrição de sobreposição de período. Já existem runs sobrepostas gravadas; falta só alguém aprovar as duas.
8. **D27** — o trigger de pagamento passar a conferir `employee_id` contra a run e forçar `created_by := auth.uid()`.
9. **D4** — exigir papel de RH dentro de `complete_punches` e bloquear competência fechada. A correção de RLS de 28/07 está incompleta enquanto isso não for feito.
10. **D29** — trava no banco contra editar batida/ausência de competência já aprovada.

**Precisa de desenho, não só de patch:**

11. **D2 + P3** — o fluxo único de exceção manual (turno atravessando meia-noite, ímpar ≥5, atestado). Reaproveitar `time_exceptions` / `v_time_pendings` / `TimePendings`, que já existem e estão subaproveitados.
12. **D17 + P4** — bloquear intervalo multi-mês na tela e no comparativo (uma folha por competência), e decidir o destino das 118 folhas multi-mês em rascunho.
13. **D28** — persistência da folha por RPC transacional, resolvendo de uma vez a concorrência e a idempotência.

**Consistência de relatório:**

14. **D16** — fazer o Excel do contador consumir os valores da folha em vez de recalcular ÷30/÷220.
15. **D24** — Espelho de Ponto recortar por admissão/demissão (é o documento legal).
16. **D8, D11, D12** — alinhar a Visão Geral à folha; remover da tela de Escalas os dois controles que não fazem nada.
17. **D3, D19** — descontinuidade do minuto 361 e o arredondamento de quinzena.

**Limpeza:**

18. **P5** — backfill idempotente do DRE para as folhas aprovadas anteriores ao sincronizador (`ON CONFLICT DO NOTHING`; avisar o contador). Preventivo — hoje só 1 folha não-rascunho existe.
19. **D13** — descobrir por que `time_import_logs` nunca gravou.
20. **M1–M6** — revogar `EXECUTE` de `calculate_weekly_he_breakdown` antes de removê-la; derrubar os órfãos do banco de horas.

---

## Apêndice — metodologia e reprodutibilidade

**Camada 1 — leitura estática (Codex).** Seis fatias de domínio, cada uma com um dossiê de contexto (`CONTEXTO_RH.md`) contendo a política canônica, o estado verificado do banco, o mapa de arquivos e a lista do que já havia sido corrigido — para o auditor não re-descobrir o conhecido nem repetir os falsos positivos de julho. Sandbox read-only.

**Camada 2 — verificação adversarial.** Todo achado com dinheiro foi confrontado com o código real e com o banco antes de entrar. Seis suspeitas caíram (seção acima), incluindo duas do próprio Codex e três minhas.

**Camada 3 — prova empírica.** Scripts em `scratchpad/audit-rh/`:

- `props.ts` — invariantes de `splitDayMinutes` sob fuzzing determinístico (seed 20260729, 4.000 casos × 28 combinações de dia/feriado). Achou D2 e D3.
  > Nota de honestidade: a primeira formulação da invariante "desconto de almoço ≤ 60 min" produziu 1.250 falsos positivos — para 4+ batidas o intervalo real é legitimamente excluído. Reformulada para n=2 em `props2.ts`: **0 violações em 4.416 casos**.
- `props2.ts` — casos dirigidos (meia-noite, descontinuidade, ímpar ≥5, corte das 18:00).
- `diff_ts_sql.ts` — diferencial TS × SQL sobre amostra estratificada de batidas reais, com o lado SQL colhido de `calculate_day_summary` em produção.
- Invariantes de `payroll_runs` e contagens populacionais: SQL direto no banco via MCP.

**Limitações declaradas.** O diferencial TS↔SQL usou **amostra estratificada** (5 casos extremos por padrão de pareamento), não as 4.076 linhas uma a uma — `time_records` tem RLS e só a chave anônima está disponível no ambiente, o que impede rodar o motor TS contra o corpus completo localmente. As **contagens populacionais** (62, 156, 582, 653, 1.589 dias) vêm do banco inteiro; os **deltas por dia** vêm da amostra. Para fechar isso seria preciso credencial `psql` e um script de replay completo — desenhado, não executado.

**Não coberto:** rescisão, provisões 13º/férias/FGTS, exportação AEJ, e a reconciliação completa da folha (recálculo de `computePeriodFolha` contra as 395 runs gravadas), que exige o mesmo acesso direto ao banco.
