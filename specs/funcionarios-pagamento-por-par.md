# Pagamento por Par (piece-rate) para Funcionários

## Goal
Permitir que certos funcionários (montadores/soladores) sejam pagos **por par
produzido**, e não por salário/hora. Para eles, a **folha** é calculada a partir
dos pares apontados na **Ficha de Montadores**, valorados por dificuldade
(médio/difícil), e o **relógio de ponto** vira apenas registro de presença — não
influencia o pagamento.

## Background / Problem
Hoje a folha (`src/lib/salaryPayroll.ts` → `computePeriodFolha`) só conhece três
regimes — `mensalista`, `remoto`, `diarista` — todos baseados em salário/diária e
no relógio de ponto (faltas, atrasos, HE). Parte da equipe, porém, ganha por
produção: R$ por par montado, variando pela dificuldade da sandália. Esse
pagamento **já é calculado** dentro da tela **Ficha de Montadores**
(`src/pages/FichaMontadoresPage.tsx`, aba Produtividade: `pago = paresMedio ×
valorMedio + paresDificil × valorDificil`), mas **só para impressão** — nunca
alimenta a folha. Resultado: quem é pago por par não tem folha correta no sistema,
e o ponto desses funcionários gera "faltas" que não fazem sentido. São dois mundos
separados: a folha ignora a produção; a produção ignora a folha.

## Scope

### In scope
- Novo **regime de pagamento "por par"** no cadastro de funcionário
  (`employees.payment_type`), ao lado de mensalista/remoto/diarista.
- Dois campos de **R$/par no cadastro do funcionário**: valor médio e valor
  difícil (fonte única de verdade).
- **Snapshot** desses valores em cada apontamento da Ficha de Montadores no
  momento da gravação, para que reajuste futuro não reescreva folhas passadas.
- **Novo ramo na folha** (`computePeriodFolha`) para o regime por par: soma os
  pares apontados no período, valorados por dificuldade, menos adiantamentos;
  **ignora salário e ponto**.
- Persistir o resultado em `payroll_runs` (igual aos outros regimes) para fluir
  a relatórios/DRE.
- Suporte do regime por par no **comparativo** (mês / 1ª / 2ª quinzena) e nos
  componentes de folha (`payrollComparativo.ts`, `FolhaConsolidada.tsx`,
  `PreFolha.tsx`).
- **Ponto/Espelho**: funcionário por par continua aparecendo e podendo bater
  ponto, mas o sistema **não** calcula horas esperadas/falta/atraso para ele e ele
  **não entra no contador de pendências** (badge do PONTO).
- **KPI "Folha Mensal"** (topo de Funcionários): excluir salário de quem é por par
  e adicionar um card **"Variável (por par)"** com o realizado do período.

### Out of scope (explicitly not now)
- Mudar **como** os pares são apontados na Ficha de Montadores (o fluxo de
  apontamento diário permanece como está).
- Classificar dificuldade no cadastro do modelo/ficha técnica — a dificuldade
  continua sendo escolhida **no apontamento** (médio/difícil por lote de pares).
- Níveis de dificuldade além de **médio** e **difícil** (sem "fácil", sem níveis
  configuráveis).
- Vincular apontamento a OP/pedido para efeito de folha.
- Regime híbrido (salário fixo + parte por par). Por par é **exclusivo**: sem
  salário, sem diária.
- Mudar a lógica de mensalista/remoto/diarista existente.

## Requirements
Cada item é um "must", testável.

1. `employees.payment_type` aceita um novo valor `'producao'` (rótulo de UI:
   **"Por par (produção)"**). O `CHECK` do banco e os tipos TS
   (`useEmployees.ts` `Employee.payment_type`, `salaryPayroll.ts`
   `PeriodFolhaInput.payRegime` / `SalaryPayrollResult.payment_type`) incluem o
   novo valor.
2. O cadastro de funcionário (`src/pages/Employees.tsx`) mostra, quando o regime é
   "por par", dois campos: **R$/par médio** e **R$/par difícil**
   (`employees.valor_par_medio`, `employees.valor_par_dificil`, `numeric`), e
   **esconde/desabilita** salário, diária e demais campos ligados a ponto (pois
   não se aplicam).
3. Ao criar/editar um apontamento "chamada" na Ficha de Montadores para um
   funcionário por par, o sistema grava em `ficha_montadores.valor_par_medio` e
   `.valor_par_dificil` o **valor atual do cadastro** daquele funcionário
   (snapshot). Reajustar o valor no cadastro **não** altera apontamentos já
   gravados.
4. Na folha, para funcionário com regime por par no período `[from, to]`:
   `bruto = Σ_apontamentos (pares_medio × valor_par_medio_do_apontamento +
   pares_dificil × valor_par_dificil_do_apontamento)`, onde os apontamentos são
   as linhas de `ficha_montadores` com `origem='chamada'`,
   `montador_id = employee.id` e `dia ∈ [from, to]`, **de qualquer setor**
   (montagem e solagem). `pares_medio`/`pares_dificil` vêm do `detalhe` jsonb
   (soma por dificuldade), espelhando exatamente a fórmula já usada em
   `FichaMontadoresPage.tsx` (aba Produtividade).
5. `líquido = bruto − adiantamentos do período`. Adiantamentos são os mesmos já
   consumidos pelos outros regimes. **Nenhuma** falta/atraso/HE/salário entra no
   cálculo.
6. O relógio de ponto **não** afeta o valor pago ao funcionário por par em
   nenhuma hipótese.
7. Para funcionário por par, o motor de ponto **não** gera horas esperadas, falta
   nem atraso, e ele **não** é contado nas pendências de ponto (badge do PONTO).
   As batidas dele continuam sendo armazenadas e visíveis em PONTO/ESPELHO como
   presença.
8. O resultado da folha por par é persistido em `payroll_runs` no mesmo fluxo dos
   demais regimes (upsert por funcionário/período em `Payroll.tsx`), com
   `payment_type='producao'`, `bruto`, `descontos=adiantamentos`, `liquido`.
9. O comparativo de folha (`payrollComparativo.ts` — mês, 1ª e 2ª quinzena) e as
   telas `FolhaConsolidada.tsx` / `PreFolha.tsx` calculam corretamente o regime
   por par (bruto/desconto/líquido), sem quebrar mensalista/diarista.
10. O KPI **"Folha Mensal"** (topo de `Employees.tsx`) soma **apenas** salários
    fixos de ativos e **exclui** funcionários por par. Um **card novo "Variável
    (por par)"** exibe o total realizado no período corrente =
    `Σ pares × valor` dos apontamentos do mês desses funcionários.
11. Se um funcionário por par estiver **sem** `valor_par_medio`/`valor_par_dificil`
    definidos, o cadastro avisa ("defina o R$/par médio e difícil") e o cálculo
    trata valor ausente como **0** (não quebra a folha).
12. Moeda sempre em `R$ 0.000,00` (2 casas), usando os helpers de
    `src/lib/utils.ts`. Sem cores hardcoded — usar design tokens
    (`npm run check:tokens` limpo).

## Data model / Domain

### `employees` (alterações — migração necessária)
- `payment_type text` — ampliar `CHECK` para incluir `'producao'`
  (hoje: `mensalista | diarista | remoto`).
- `valor_par_medio numeric NULL` — R$/par para dificuldade "médio".
- `valor_par_dificil numeric NULL` — R$/par para dificuldade "difícil".
- Campos existentes (`salary`, `daily_rate`, `he_normal_rate`, …) permanecem;
  apenas ficam ocultos/ignorados quando o regime é por par.

### `ficha_montadores` (já existe — sem alteração de schema)
- `montador_id uuid` → `employees(id)` (QUEM).
- `dia date` (QUANDO).
- `origem text` — filtrar `= 'chamada'` (modelo diário; 1 linha por dia/montador,
  índice único `(dia, montador_id) WHERE origem='chamada'`).
- `setor text` — `'montagem' | 'solagem'` (ambos entram na folha por par).
- `detalhe jsonb` — `[{ tamanho, medio, dificil }]`: pares por tamanho e por
  dificuldade. `pares_medio = Σ detalhe[].medio`, `pares_dificil = Σ detalhe[].dificil`.
- `valor_par_medio numeric`, `valor_par_dificil numeric` — **snapshot** do R$/par
  no momento do apontamento (já existem; passam a ser preenchidos a partir do
  cadastro do funcionário).
- `total integer` — Σ pares do dia (conferência).

### Folha (`src/lib/salaryPayroll.ts`)
- `PeriodFolhaInput.payRegime` e `SalaryPayrollResult.payment_type`: incluir
  `'producao'`.
- Novo bloco em `computePeriodFolha` análogo ao `if (regime === 'diarista')`,
  mas somando pares × valor (recebe a lista de apontamentos do período do
  funcionário, carregada em `Payroll.tsx`/`payrollComparativo.ts` como
  `advancesList`/`timeRecords` já são carregados).

### `payroll_runs` (sem alteração de schema)
- Recebe o resultado por par no mesmo formato dos demais regimes.

## User flows

### Happy path — configurar e pagar por par
1. RH abre **Pessoas → Funcionários**, edita (ou cria) o funcionário e escolhe o
   regime **"Por par (produção)"**.
2. Os campos de salário/diária somem; aparecem **R$/par médio** e **R$/par
   difícil**. RH preenche (ex.: médio R$ 1,10 / difícil R$ 1,40) e salva.
3. Durante o mês, a produção é apontada normalmente na **Ficha de Montadores**
   (Chamada do Dia), com os pares divididos em médio/difícil. Cada apontamento
   grava o R$/par vigente do funcionário (snapshot).
4. RH vai em **FOLHA**, seleciona o período (mês ou quinzena) e gera a folha.
5. Para o funcionário por par, a folha mostra `bruto = Σ pares × valor`,
   `descontos = adiantamentos`, `líquido`. Salário e ponto não aparecem no
   cálculo.
6. O resultado é salvo em `payroll_runs` e entra nos relatórios/DRE como custo de
   mão de obra.
7. No topo de **Funcionários**, o card "Folha Mensal" não inclui esse funcionário;
   o card "Variável (por par)" reflete o realizado do período.

### Alternate / edge flows
- **Reajuste de R$/par:** RH muda o valor no cadastro. Apontamentos futuros usam o
  novo valor; folhas/apontamentos passados permanecem com o valor congelado.
- **Ponto do por par:** o funcionário bate o relógio para controle de presença. As
  batidas aparecem em PONTO/ESPELHO, mas não geram falta/atraso nem entram no
  badge de pendências, e não mudam a folha.
- **Troca de regime:** funcionário que era mensalista vira por par (ou vice-versa).
  O regime vigente no momento de gerar a folha vale para todo o período
  selecionado (mesmo comportamento dos regimes atuais).

## Edge cases & failure modes
- **Sem produção no período** → `bruto = 0`; `líquido = 0 − adiantamentos`. Se
  houver adiantamento, o líquido fica **negativo** (saldo devedor) — deve ser
  exibido como tal, sem bloquear a folha.
- **R$/par não definido** (null) no cadastro → tratado como 0 no cálculo; cadastro
  exibe aviso pedindo para definir os valores. Não quebra a folha.
- **Funcionário por par sem apontamento na Ficha** (nunca aparece no roster de
  montadores) → produz 0 pares; folha = 0 − adiantamentos. Aceitável.
- **Apontamento legado (`origem='legacy'`, grade por numeração)** → **não** entra
  no cálculo por par da folha (só `origem='chamada'`), para evitar contagem dupla.
- **Mistura de setores** (a pessoa apontou montagem e solagem no período) → ambos
  somam; o valor por dificuldade é o mesmo do funcionário.
- **Concorrência no snapshot** → cada linha de `ficha_montadores` guarda seu
  próprio snapshot; não há estado compartilhado a proteger além do já existente.
- **`payment_type` legado nulo/antigo** → default continua `mensalista`; ninguém
  vira por par sem ação explícita.

## Constraints & assumptions
- **Stack/convenções:** React + Supabase; hooks React Query como camada de dados;
  motor de folha único em `src/lib/salaryPayroll.ts` (não duplicar lógica); UI e
  domínio em pt-BR; moeda `R$ 0.000,00`; design tokens (sem cor hardcoded,
  `check:tokens` limpo); typecheck `bunx tsc -p tsconfig.app.json --noEmit`.
- **Migração:** nova migration em `supabase/migrations/` (ampliar `CHECK` de
  `payment_type`; adicionar `valor_par_medio`/`valor_par_dificil` em `employees`).
  Não editar `integrations/supabase/types.ts` à mão — regenerar.
- **Não tocar:** fluxo de apontamento da Ficha de Montadores; cálculo de
  mensalista/remoto/diarista; schema de `ficha_montadores` (já tem as colunas
  necessárias).
- **Assunções adotadas (onde não foi especificado):**
  - Nome interno do regime = `'producao'`; rótulo de UI = "Por par (produção)".
  - Período da folha por par = mesmo seletor de período dos demais regimes
    (mês / 1ª / 2ª quinzena), filtrando `ficha_montadores.dia`.
  - Card "Variável (por par)" no topo usa o **mês corrente** como período.
  - Qualquer funcionário pode ser marcado por par (sem restrição por cargo); na
    prática só quem tem apontamento na Ficha gera valor.
  - Regime é exclusivo (por par não acumula salário/diária).

## Open questions
- Nenhuma bloqueante. (Confirmar apenas o rótulo do regime na UI — "Por par
  (produção)" — na hora de implementar, se preferir outro texto.)

## Definition of Done
- [ ] **R1** — Editar um funcionário e escolher "Por par (produção)" salva
  `payment_type='producao'`; consulta em `employees` confirma o valor e o `CHECK`
  aceita.
- [ ] **R2** — Com regime por par, o form esconde salário/diária e mostra R$/par
  médio e difícil; salvar grava `valor_par_medio`/`valor_par_dificil`.
- [ ] **R3** — Criar um apontamento "chamada" para esse funcionário e verificar em
  `ficha_montadores` que `valor_par_medio`/`valor_par_dificil` da linha == valor do
  cadastro no momento; depois alterar o cadastro e confirmar que a linha antiga
  **não** muda.
- [ ] **R4/R5** — Gerar folha de um período com apontamentos médio+difícil em
  montagem e solagem: o bruto == `Σ pares×valor` (bate com a aba Produtividade da
  Ficha), o líquido == bruto − adiantamentos, e nenhuma falta/HE/salário aparece.
- [ ] **R6/R7** — Inserir batidas/ausências de ponto para o funcionário por par e
  confirmar que a folha dele **não muda**, que ele não mostra falta/atraso e que o
  badge de pendências do PONTO não o conta; as batidas ainda aparecem em
  PONTO/ESPELHO.
- [ ] **R8** — Após gerar a folha, `payroll_runs` tem a linha do funcionário por
  par com `bruto/descontos/liquido` corretos, e o valor aparece no relatório/DRE
  de mão de obra.
- [ ] **R9** — No comparativo (mês/1ª/2ª quinzena) e em FolhaConsolidada/PreFolha,
  os números do por par batem e mensalista/diarista continuam corretos.
- [ ] **R10** — Card "Folha Mensal" não inclui o salário-fantasma do por par; card
  "Variável (por par)" mostra o realizado do mês (confere com a soma dos
  apontamentos).
- [ ] **R11** — Funcionário por par sem R$/par definido: cadastro avisa e a folha
  calcula 0 sem quebrar.
- [ ] **R12** — `bunx tsc -p tsconfig.app.json --noEmit` limpo,
  `npm run check:tokens` limpo, e valores em `R$ 0.000,00`.
