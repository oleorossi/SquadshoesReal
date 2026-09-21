# Montagem + Solagem — Apontamento e marcação de produtividade

> Spec fechada por grill (2026-09-21). Programa único: otimizar **Apontamento**
> Montagem/Solagem e a **Chamada do Dia** (Ficha de Montadores), nesta ordem.
> Direção de UI: Industrial Editorial Pro (tokens do app), denso, desktop/PCP.
> Skills aplicadas na entrevista: ui-ux-pro-max + frontend-design + grill-me.

## Goal

O PCP, no **desktop no dia seguinte**, consegue (1) fechar a **Semana** de
Montagem e Solagem na Chamada com faltantes e totais claros, (2) apontar OPs nas
duas abas com a **mesma casca** de gesto, e (3) ver a capacidade de M+S na
Produtividade por Modelo **derivada da Chamada** — sem estender o programa aos
outros setores nem redesenhar o produto.

## Background / Problem

1. A Ficha de Montadores já é a Chamada só de **Montagem e Solagem**
   (`pays_by_pair` / `SETORES_POR_PAR_FALLBACK`). Todos nesse ofício são pagos
   **por par** — o lançamento é dinheiro e medição ao mesmo tempo.
2. A disciplina de preenchimento é o gargalo real (histórico: Montagem parou de
   lançar). A visão Semana existe, mas faltam **faltantes explícitos** e totais
   de pares por pessoa fáceis de conferir no atraso.
3. `Montagem.tsx` e `Solagem.tsx` compartilham o fluxo de apontamento mas não a
   casca; Solagem tem bloco extra de demanda de solado/silk que deve permanecer.
4. Capacidade medida (`SectorPeopleProductivity` / engine) ainda não está
   amarrada de ponta a ponta só em M+S neste programa — fase C fecha isso sem
   tocar nos outros 9 setores.

## Scope

### In scope

- **Fase B** — Chamada / visão Semana (M+S): highlight de células vazias em dias
  úteis, resumo de faltantes, totais de pares/pessoa na semana, polish de
  teclado/densidade; **1 Salvar** (já existe). Default da aba Lançar = Semana.
- **Fase A** — Casca comum de Apontamento (filtros, seleção, finalizar, busca,
  empty/erro); Solagem mantém slot de solado/silk.
- **Fase C** — Capacidade do motor usa soma da Chamada **somente** Montagem e
  Solagem; demais setores intactos. Dia incompleto: usa o que houver (sem badge
  novo além do que já existe em `SectorPeopleProductivity`).

### Out of scope (explícito)

- Atribuir apontamento de OP a pessoa.
- Estender Chamada aos outros 9 setores.
- Redesign visual grande / nova identidade / paleta nova.
- Mudar regra de dificuldade da Solagem (continua sem médio/difícil).
- Kanban / Planejamento Diário além do mínimo necessário à fase C.
- Print de fichas de operador / worksheets.
- Trilha separada folha × capacidade (uma linha só).

## Requirements

### Decisões de produto (grill)

| ID | Decisão |
|----|---------|
| G1 | Escopo = Apontamento + Chamada |
| G2 | Marcação = pares/pessoa/dia na Chamada (não por OP) |
| G3 | Usuário = PCP desktop, dia seguinte |
| G4 | Ordem de entrega = B → A → C |
| G5 | Uma linha da Chamada = folha + capacidade |
| G6 | Gesto principal da Chamada = visão **Semana** |
| G7 | Solagem sem dificuldade; Montagem com médio/difícil |
| G8 | Semana: faltantes + totais (sem trava policial, sem import planilha) |
| G9 | Apontamento: casca comum; extras só na Solagem |
| G10 | Capacidade motor só M+S via Chamada |
| G11 | Dia incompleto na capacidade: usa o disponível, sem badge novo |
| G12 | DoD inclui verificação no site live |

### Fase B (esta entrega começa aqui)

1. **R-B1** — Em dias úteis (seg–sex), célula sem pares no tamanho ativo (e sem
   pares em outros tamanhos no mesmo dia/dificuldade agregada do dia) recebe
   highlight de faltante; sáb/dom vazios não gritam (produção de fim de semana
   é opcional).
2. **R-B2** — Resumo no topo da Semana: quantas pessoas do roster têm ≥1 dia útil
   sem lançamento; lista curta ou contagem com link visual nas linhas.
3. **R-B3** — Por pessoa: total de **pares** da semana (todos os tamanhos) visível
   ao lado da prévia R$ / fichas.
4. **R-B4** — Aba Lançar abre em **Semana** por padrão (PCP no dia seguinte).
5. **R-B5** — Helpers de faltante/totais testáveis fora da página (vitest).
6. **R-B6** — `check:tokens` limpo nas alterações de UI; contraste ≥ 4.5:1 nos
   highlights; alvos de input da matriz ≥ h-10 (já); `prefers-reduced-motion`
   respeitado (sem animação nova obrigatória).

### Fase A / C (seguem após B)

- **R-A1** — Extrair casca compartilhada Montagem/Solagem sem mudar o ledger
  (`finalizeSectorTask` / apontamento).
- **R-C1** — `get_sector_measured_capacity` / painel Equipe: M+S leem Chamada;
  outros setores não mudam de contrato neste programa.

## User flows

### Happy path (PCP)

1. Abre Ficha de Montadores → Lançar → **Semana** (default) → escolhe setor
   Montagem ou Solagem → navega à semana anterior se necessário.
2. Vê quem falta (resumo + células); preenche matriz; Tab/Enter; **Salvar**.
3. Opcional: Salvar e conferir → aba Produção / pagar.
4. Em Apontamento, mesma casca em M e S para finalizar OPs.
5. Em Produtividade por Modelo, capacidade M+S reflete a Chamada.

### Edge

- Dia já na folha ou pago: input travado (já existe) — faltante **não** se aplica
  a dia fechado sem lançamento? Se estiver travado e vazio, continua faltante
  visual até alguém com permissão tratar fora deste fluxo (não reabrir folha).
- Roster vazio: empty state existente; sem resumo de faltantes falso.

## Constraints & assumptions

- Stack: React + shadcn + tokens do `index.css`; ícones Phosphor.
- Não introduzir tipografia/paleta do ui-ux-pro-max search (teal etc.) — só
  padrões de densidade/touch/feedback dentro do design system do ERP.
- Pagamento por par já ativo: qualquer UX que incentive “zerar pra fechar” é
  perigosa — faltante ≠ forçar zero.

## Definition of Done

- [x] Spec neste arquivo com decisões G1–G12.
- [x] Fase B: R-B1…R-B6 + testes do helper.
- [x] Fase A: casca comum (`SectorApontamentoShell` + `filterSectorQueueOrders` +
      `finalizeSelectedSectorOrders`); Solagem mantém demanda de solado/silk.
- [x] Fase C: capacidade medida já lê Chamada (`sector_measured_capacity` no banco;
      contrato em teste); M+S com pessoas em regime por par entram na soma.
- [x] `bunx tsc -p tsconfig.app.json --noEmit` limpo nas mudanças.
- [ ] Verificado em https://squadshoes-real.vercel.app: lançar semana M ou S →
      ver faltantes/totais → capacidade refletida (após deploy em `main`).
