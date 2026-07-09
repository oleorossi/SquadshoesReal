# Gestão de Pessoas (RH) — Ponto → Cálculo → Folha

## Goal
Ter um módulo de RH **enxuto e confiável** onde o fluxo é linear: importar as batidas
do relógio físico (Knup KP1028) → o sistema calcular **sozinho** todas as variações que
afetam o pagamento (atrasos, horas extras, faltas) → fechar a folha do mês com números
que **fecham** (um único motor de cálculo, sem divergência). Serve o dono/RH da fábrica,
que hoje não confia nos números e se perde nos menus.

## Background / Problem
O subsistema de RH passou por churn pesado e uma virada de modelo de pagamento, e ficou
quebrado em duas frentes:

1. **Cálculo não fecha.** A auditoria `docs/AUDITORIA_RH_COMPATIBILIDADE.md` (2026-07-03)
   documenta **4 motores de HE que discordam** (`calculate_employee_bank_balance` weekly,
   `resolve_monthly_overtime`, `salaryPayroll.ts` per-day, `weeklyTimeCalculation.ts`) e
   **2 modelos de pagamento conflitantes** commitados com 2 dias de diferença
   (`hourlyPayroll.ts` "modelo único" 2026-06-01 vs `salaryPayroll.ts` "salário − descontos"
   2026-06-03). Bugs concretos: atraso com `tolerance || 10` sobrescrevendo o 0 configurado
   (A2); CSV do contador mostra HE em minutos mas R$ 0,00 (A1); `employee_absences` com dois
   vocabulários incompatíveis (A5).
2. **Menus confusos.** `RHHub.tsx` tem 6 abas + abas "aposentadas" (`painel`, `fechamento`,
   `banco-horas`) que remapeiam pra `folha` mas cujas páginas continuam vivas por outras
   rotas; dois conceitos de "fechamento" (semanal e mensal); banco de horas meio-removido.

A **entrada de batidas já funciona** (`src/lib/timeClockParser.ts` lê o AGL_001.TXT do KP1028)
— o problema é do parser pra frente.

## Scope

### In scope
- Consolidar o cálculo num **único motor mensalista** (com diarista como exceção).
- Implementar as regras de cálculo negociadas (abaixo), que **não seguem CLT**.
- Reorganizar o menu de RH em **4 telas** dentro de "Pessoas".
- Persistir e permitir **buscar** os arquivos de ponto importados.
- Tela de **registro de falta/atraso justificado**.
- **Remover** o Banco de Horas (não usado neste modelo).

### Out of scope (explicitly not now)
- **Terceirizados** (`/terceirizados`) e **Ficha Montadores** (`/fichas-montadores`) — continuam
  telas separadas, fora do menu de RH, intocadas.
- Integração automática/API com o relógio (continua sendo import de arquivo).
- Cálculo de rescisão (`SeveranceSimulator`), FGTS/INSS legais, eSocial, AEJ/AFD legais —
  fora deste esforço (não são CLT).
- DSR (descanso semanal remunerado) e reflexos CLT sobre HE — **não se aplicam** (não-CLT).
- Migração dos dados históricos de `bank_hours_movements` (ver Open Questions).

## Requirements
Numerados, testáveis, cada um um "must".

**Entrada de batidas**
1. Os arquivos de ponto importados (`.txt`/`.xls` do KP1028) ficam **salvos no sistema** e
   podem ser **buscados/consultados** depois (não é importar e descartar). Reaproveitar
   `time_import_logs` / `v_time_import_archive` / `ImportHistoryPanel`; garantir que o arquivo
   original seja recuperável e a lista filtrável por data.

**Modelo de pagamento**
2. O modelo canônico é **Mensalista**: salário fixo no mês; as batidas **descontam** falta/
   atraso e **somam** hora extra. Deve existir **UM único motor** de cálculo — os
   `salaryPayroll.ts`/`hourlyPayroll.ts`/`weeklyTimeCalculation.ts` conflitantes são
   eliminados ou fundidos nesse motor único.
3. **Diarista é exceção por funcionário** (ex.: Cátia), acionada por toggle na janela do
   funcionário (`payment_type='diarista'` + `daily_rate`). Cálculo por dia trabalhado, com
   **meia-diária**: ≥6h no dia → 1 diária; 2–6h → 0,5; <2h → 0.

**Hora extra**
4. HE é **paga na folha do mês** (não vai pra banco de horas).
5. Os valores de HE são **por funcionário** (negociação individual), definidos como **valor
   absoluto em R$/hora** (não multiplicador, não derivado do salário). Dois campos no
   cadastro: **HE normal** e **HE domingo/feriado** — ambos R$/h. **Não há taxa noturna
   separada**: hora extra noturna usa a **HE normal** do funcionário (decisão do dono
   2026-07-09).
6. Só vira hora extra o tempo que **passar de 10 minutos** além da jornada (mínimo global de
   10 min; abaixo disso, descartado). `minimum_overtime_minutes = 10`.
7. Domingo/feriado usa a taxa **HE domingo/feriado** do funcionário; **todas as demais** horas
   extras (dia útil, sábado, noturna) usam a **HE normal**.

**Atraso**
8. **Zero tolerância de atraso** para todos: qualquer minuto batido depois do horário de
   entrada conta como atraso. Remover o `tolerance_minutes || 10` bugado.
9. Atraso **desconta proporcional ao tempo**, usando o **mesmo divisor da falta** (req. 11):
   valor da hora de desconto = `(salário ÷ dias_úteis_do_mês) ÷ horas_da_jornada_diária`.
   A jornada diária sai da escala (`work_schedules`) do funcionário.

**Falta**
10. Falta **justificada** (atestado etc.) **não desconta**. Deve haver uma **tela onde o RH
    registra** a falta ou o atraso como justificado; ao marcar ali, o desconto correspondente
    é zerado no cálculo.
11. Falta **injustificada** (dia inteiro) desconta `salário ÷ dias_úteis_do_mês`.

**Menu / navegação**
12. O RH ("Pessoas", rota `/rh`) passa a ter exatamente **4 telas**:
    1. **Funcionários** — cadastro: salário, escala/jornada, toggle diarista + `daily_rate`,
       e os 3 valores de HE em R$/h.
    2. **Ponto** — importar arquivo do KP1028 + histórico de arquivos (req. 1) + corrigir
       batidas faltantes + registrar falta/atraso justificado (req. 10), tudo num lugar.
    3. **Espelho do funcionário** — por pessoa, no período: batidas, atrasos, HE, faltas.
    4. **Folha** — fechar o mês → calcula tudo → gera pagamento + histórico de pagamentos.
13. As abas/rotas "aposentadas" e os dois "fechamentos" duplicados são **removidos** (não só
    remapeados): `painel`, `fechamento`/`fechamento-semanal`/`FechamentoMensal`, KPIs órfãos.
14. **Banco de Horas excluído de vez** (decisão do dono 2026-07-09): rotas
    `/rh/banco-de-horas` + aliases, abas de banco, telas/hooks associados **e** as tabelas/
    views no banco (`bank_hours_movements`, `bank_hours_balance`, `v_bank_hours_summary`,
    `v_bank_hours_per_sector`, funções de saldo) são **removidas** via migration.

**Qualidade / consistência**
15. Todos os pontos onde HE/atraso/falta são calculados passam a chamar o **motor único** —
    Espelho, Folha, PreFolha (CSV do contador) e relatórios batem no mesmo número (fecha
    A1/A2/B1–B5 da auditoria).

## Data model / Domain

**`employees`** (novas colunas):
- `he_normal_rate numeric` — R$/hora extra normal (usada também pra HE noturna).
- `he_sunday_holiday_rate numeric` — R$/hora extra domingo/feriado.
- (já existem) `salary`, `payment_type` (`mensalista|diarista`), `daily_rate`,
  `work_schedule_id`, `active`, `admission_date`, `termination_date`.

**`work_schedules`** — fonte da jornada (entry/lunch/exit, saturday_entry/exit,
`tolerance_minutes` que passa a ser **0**, `minimum_overtime_minutes` = **10**). Manter uma
escala por funcionário via `employees.work_schedule_id`.

**`time_records`** (`punches jsonb`) — inalterada; alimentada por `parseTimeClockFile` +
`groupPunchesByDay`. Overrides manuais em `time_record_manual_overrides` (mantido).

**`time_import_logs` / `v_time_import_archive`** — arquivo de imports (req. 1).

**`employee_absences`** — **unificar o vocabulário** (hoje 11 tipos em `useRH` vs 6 em
`useEmployeeAbsences`). É a fonte do "justificado". Corrigir a FK (`employee_id` aponta pra
`auth.users`, deveria apontar pra `employees`). É esta tabela que a tela do req. 10 escreve.

**`punch_clock_params`** (versionado por `valid_from/valid_to`) — guardar `tolerance = 0` e
`minimum_overtime_minutes = 10` como parâmetros globais correntes.

**`payroll_runs` / `payroll_payments`** — resultado da folha e histórico de pagamentos
(mantidos; `payroll_runs` trava quando finalizado).

**A remover / descontinuar:** `bank_hours_movements` e views `bank_hours_balance`,
`v_bank_hours_summary`, `v_bank_hours_per_sector` (ver Open Q sobre drop vs deprecate);
duplicatas mortas `salaryPayroll.ts`, `hourlyPayroll.ts`, `weeklyTimeCalculation.ts`.

**Migrations**: vão em `supabase/migrations/` (aplicar via Supabase MCP, projeto
`ssvxfoybzmjlypnipqzn`). Novas colunas de HE + ajuste de params + unificação de absences +
descontinuação de banco de horas.

## User flows

### Happy path — fechar o mês
1. RH entra em **Pessoas → Ponto**, sobe o arquivo do KP1028 (`AGL_001.TXT`). Sistema parseia,
   agrupa por funcionário/dia, salva batidas e **arquiva o arquivo**.
2. Sistema aponta **pendências** (dia sem par de batida, entrada sem saída). RH corrige na
   mesma tela (batida manual, auditada).
3. RH abre a tela de **falta/atraso justificado** e marca os casos com atestado (não descontam).
4. RH abre **Espelho** de um funcionário e confere: batidas, atraso (zero tol.), HE (>10 min,
   R$/h negociada), faltas.
5. RH vai em **Folha**, escolhe o mês, roda o cálculo. Sistema computa por funcionário:
   `líquido = salário − faltas_injustificadas − atrasos + HE(normal/dom-fer/noturna)`.
   Diaristas entram por dia × `daily_rate` (com meia-diária).
6. RH finaliza a folha (trava) e registra os **pagamentos** (com recibo).

### Alternate / edge flows
- **Diarista (Cátia):** não tem "falta/atraso descontado" — dias sem batida simplesmente não
  geram diária; dias com 2–6h geram meia.
- **Reimportar o mesmo arquivo:** idempotente — não duplica batidas (dedupe por
  funcionário+data+hora); import logado.
- **Funcionário sem escala:** bloquear cálculo de atraso/HE e sinalizar (não chutar jornada).

## Edge cases & failure modes
- **Batida ímpar / faltando** → vira pendência, não entra no cálculo até resolver (não inventar
  horário). Consistente com o motor único.
- **Feriado** (tabela `holidays`) num dia trabalhado → horas contam como HE domingo/feriado.
- **Sábado** → é dia de trabalho se a escala tem `saturday_entry/exit`; conta como dia útil no
  divisor da falta.
- **HE ≤ 10 min** → descartada (req. 6), não vira R$ 0,01 de ruído.
- **Atraso + saída antecipada no mesmo dia** → ambos descontam (proporcional).
- **Falta justificada em dia que também teve atraso** → o justificado zera o desconto daquele dia.
- **Reabertura de mês já finalizado** → respeitar a trava de `payroll_runs` (não recalcular
  silenciosamente por cima de folha fechada).
- **Import com nomes que não casam com `employees`** → reconciliação por `EnNo`/`external_id`
  (mapa `punch_device_map`); não gravar batida órfã.

## Constraints & assumptions

**Constraints (do CLAUDE.md):**
- Stack **Bun**; typecheck canônico `bunx tsc -p tsconfig.app.json --noEmit` (a raiz não checa
  nada). Rodar antes de commitar.
- **Design tokens** obrigatórios (`npm run check:tokens`), sem cores hardcoded fora dos prints.
- Ícones **@phosphor-icons/react** (nunca lucide). Componentes de página `export default
  function`; primitives em `ui/` named export.
- Dados via **React Query** hooks (`use*`), Supabase singleton, `sonner` pra toast.
- **Domínio em pt-BR**, framework em inglês. Locale pt-BR, moeda BRL (`src/lib/utils.ts`).
- Migrations em `supabase/migrations/`, aplicadas via Supabase MCP; idempotentes.
- Não tocar `integrations/supabase/types.ts` à mão (é gerado).

**Assumptions (defaults escolhidos onde o usuário deferiu — revisar):**
- **A1 — Janela noturna:** HE "noturna" = trabalho entre **22:00 e 05:00** (default; ajustável
  em params). Confirmar faixa.
- **A2 — Dias úteis do mês:** = dias em que o funcionário está **escalado para trabalhar** no
  mês (segunda a sábado conforme a escala), **excluindo domingos e feriados**. Sábado conta se
  a escala inclui sábado.
- **A3 — Horas da jornada diária** (divisor do atraso): derivadas da escala do funcionário
  (entrada→saída menos almoço). Ex.: 8h48 numa 44h/sem com sábado, ou 8h sem sábado.
- **A4 — Tolerância aplica-se a todos** (global 0), não por funcionário.
- **A5 — "Justificado"** é marcado manualmente por alguém do RH na tela do req. 10 (não vem de
  documento automático); anexo de atestado é opcional.
- **A6 — Meia-diária:** thresholds ≥6h→1 / 2–6h→0,5 / <2h→0 (reaproveita a regra já existente
  em `calculate_employee_bank_balance`).

## Open questions
- **Dias úteis inclui sábado?** (assumido: sim, se a escala tem sábado) — confirmar.

_(Resolvidas 2026-07-09: banco de horas → **excluir de vez** (tabelas + UI); HE noturna → usa
a **HE normal** individual, sem taxa noturna nem janela noturna separada.)_

## Definition of Done
Checklist verificável item a item:

- [ ] **Req 1** — Importar `AGL_001.TXT` em Pessoas → Ponto salva as batidas **e** o arquivo
      aparece no histórico, filtrável por data e recuperável. *(Verificar: subir o arquivo, ver
      as batidas gravadas e o arquivo listado no histórico.)*
- [ ] **Req 2** — Existe **um único** motor de cálculo. *(Verificar: `salaryPayroll.ts`,
      `hourlyPayroll.ts`, `weeklyTimeCalculation.ts` removidos/fundidos; grep não acha motores
      paralelos.)*
- [ ] **Req 3** — Cadastro tem toggle diarista; Cátia calcula por dia com meia-diária.
      *(Verificar: marcar diarista, rodar um mês com um dia de 4h → 0,5 diária.)*
- [ ] **Req 4/5/6/7** — Um mensalista com HE conhecida: espelho e folha mostram
      `minutos_HE(>10) × R$/h` na taxa certa (HE normal em dia útil/sábado/noturno; HE
      domingo-feriado nos domingos/feriados). *(Verificar com um caso montado à mão vs cálculo
      manual.)*
- [ ] **Req 8/9** — Atraso de X min desconta `X × ((salário÷dias_úteis)÷jornada)`, sem
      tolerância. *(Verificar: bater 20 min atrasado → desconto proporcional; nenhum "|| 10".)*
- [ ] **Req 10** — Marcar uma falta/atraso como justificado na tela zera o desconto daquele dia.
      *(Verificar: antes marca desconto; depois de marcar, some.)*
- [ ] **Req 11** — Falta injustificada de 1 dia desconta `salário÷dias_úteis`. *(Verificar vs
      cálculo manual.)*
- [ ] **Req 12** — Menu "Pessoas" tem exatamente as 4 telas descritas. *(Verificar navegação.)*
- [ ] **Req 13/14** — Abas aposentadas, fechamentos duplicados e Banco de Horas **não existem**
      mais (rotas somem, não só redirecionam). *(Verificar rotas `/rh/banco-de-horas` etc.
      removidas.)*
- [ ] **Req 15** — Espelho, Folha e PreFolha (CSV contador) mostram o **mesmo** valor de HE em
      R$ para o mesmo período (fecha A1/A2). *(Verificar cruzando as três telas.)*
- [ ] **Gate técnico** — `bunx tsc -p tsconfig.app.json --noEmit` limpo e `npm run check:tokens`
      limpo.
