# Projeção de compras semanal integrada (avaliar + decidir)

## Goal

Dar ao comprador/PCP, em **uma entrada principal** em `/purchase-planning`, a
visão padrão da indústria calçadista: **o quê / quanto / quando comprar**, com
filtros por **semana civil, quinzena e mês**, por **setor e grupo de material**,
incluindo **R$ para otimizar caixa**, e a ação integrada de **selecionar → fluxo
de OC** — sem export Excel no v1.

## Background / Problem

Hoje o hub de Planejamento de Compras espalha a mesma decisão em 5 abas
(`plano`, `projecoes`, `mrp`, `cronograma`, `saldo-analytics`) com motores e
períodos diferentes (horizonte em dias, semana por **terça** do buy-by, ABC
estatístico, timeline, `v_mrp_needs`). Não há:

- balde **segunda–domingo** alinhado a caixa;
- agregação **quinzenal / mensal** na projeção;
- filtro **setor + grupo** como eixo principal;
- grade que mostre **semana de uso** e, ao mesmo tempo, **comprar até** (lead
  time) com **R$ na semana de compra**;
- uma única porta para **avaliar gap** (projetado × OC × recebido) e **agir**.

A indústria calçadista opera MRP em baldes curtos (semana/quinzena), necessidade
líquida = demanda − estoque − pedido em aberto, time-phasing por lead time, e
revisão gerencial no mês. A remodelagem
[`remodelagem-criacao-ordem-de-compra.md`](remodelagem-criacao-ordem-de-compra.md)
já define necessidade → carrinho → fechamento; esta spec define a **tela de
avaliação/projeção** que alimenta esse fluxo.

## Scope

### In scope (v1)

- Nova **entrada principal** de `/purchase-planning` (substitui na navegação as
  abas `plano`, `projecoes` e `mrp`).
- Grade operacional por **semana civil (segunda–domingo)**, horizonte padrão
  **4 semanas** (ajustável na UI).
- Agregações/filtros de período: **semana**, **quinzena (1ª/2ª do mês civil)**,
  **mês**.
- Filtros de material: **setor** (`product_groups.sector`, principal) + **grupo**
  (`product_groups`).
- Demanda nas 4 semanas padrão: **somente firme** (PV aprovado / OP aberta).
  **Forecast só depois da 4ª semana** (quando o usuário estende o horizonte).
- Necessidade **líquida** (desconta estoque disponível e OC aberta — não
  `draft`/`cancelled`).
- UI opção **B**: grade principal pela **semana de uso**; coluna/destaque
  **Comprar até**; totais de **R$ de caixa** na **semana de compra**
  (`uso − lead time do fornecedor`).
- Valoração: `products.purchase_price` do cadastro; sem preço → **R$ 0 + alerta**
  (linha permanece visível e acionável).
- Modo **mês**: colunas necessidade (qtd + R$), OC aberta (qtd + R$), recebido
  (qtd + R$), gap, % cobertura, atrasados — todos filtráveis.
- Ação integrada: selecionar linhas → enviar ao **fluxo de compra** (carrinho /
  geração de OC canônica; alinhado à remodelagem quando o carrinho existir;
  até lá, `generate_purchase_orders_from_mrp` / command boundary vigente).
- Abas secundárias que **permanecem**: Cronograma; Saldo & Custos.
- Redirects das URLs antigas (`?tab=plano|projecoes|mrp` e aliases legados) para
  a nova entrada.

### Out of scope (explicitly not now)

- Export Excel / PDF da grade.
- Reimplementar do zero o motor de consumo (reusar conversão dm²→unidade e
  regras canônicas já existentes).
- Quinzena de **faturamento de tiras artesanais** (continua em
  `/purchase-orders` — outro domínio).
- Preço por último NF / fornecedor preferencial (só cadastro no v1).
- Remover fisicamente o código das abas antigas na mesma entrega (podem ficar
  inacessíveis na nav; limpeza/delete em follow-up).
- Alterar Cronograma reverso ou Saldo Final além do necessário para coexistir.
- Backfill / “reconciliação” em massa de OCs históricas.

## Requirements

1. `/purchase-planning` abre por padrão na **nova visão** (não em Plano/Wizard).
2. Navegação principal do hub **não lista** mais Plano, Projeções nem MRP;
   lista a nova visão + Cronograma + Saldo & Custos.
3. A grade operacional agrupa colunas por **semana civil segunda–domingo**;
   default = **próximas 4 semanas** a partir da segunda da semana corrente;
   o usuário pode estender/encolher o horizonte na UI.
4. Controles de período permitem filtrar/agregar por **semana**, **1ª quinzena**,
   **2ª quinzena** e **mês civil** (quinzena = dias 1–15 e 16–fim do mês).
5. Filtro **setor** (obrigatório como eixo; valor “Todos” permitido) e filtro
   **grupo de material** (opcional, dependente do setor quando setor ≠ Todos).
6. Cada linha material (produto/cor ou agregação por grupo+cor conforme a
   resolução já usada em `v_mrp_needs`) mostra: qtd líquida na **semana de uso**,
   data/semana **Comprar até**, R$ estimado da necessidade, alertas (sem preço,
   atrasado, etc.).
7. Totais de **fluxo de caixa (R$)** no rodapé/cabeçalho das colunas semanais
   usam a **semana de compra**, não a de uso.
8. Semana de compra = semana civil que contém
   `data_necessidade_uso − lead_time_fornecedor` (mesma fonte de lead time já
   usada em `get_effective_supplier_lead_days` / timeline).
9. Nas semanas 1–4 do horizonte padrão, a demanda incluída é **apenas firme**
   (PV/OP). Forecast do módulo `/forecast` **só entra** em colunas **após a
   4ª semana** quando o horizonte for estendido; linhas/células de forecast
   devem ser distinguíveis visualmente das firmes.
10. Necessidade exibida = **líquida**: bruta − estoque disponível (respeitando
    reserva líquida do padrão do projeto) − quantidade em OC aberta
    (`pending`/`approved`/`sent`/`parcial`; exclui `draft` e `cancelled`).
11. R$ da necessidade sem OC = `qty_net × purchase_price` (unidade coerente com
    a qtd exibida). Sem `purchase_price` (null/0 indevido tratado como
    ausente) → R$ 0 + badge/alerta “Sem preço no cadastro”.
12. Modo **mês** (e filtros equivalentes) expõe por material/grupo:
    necessidade qtd, necessidade R$, OC aberta qtd, OC aberta R$, recebido qtd,
    recebido R$, gap, % cobertura, flag/lista de atrasados — todos usáveis como
    filtro ou ordenação.
13. Usuário pode **selecionar uma ou mais linhas** com necessidade líquida > 0 e
    disparar **Gerar / enviar ao fluxo de OC** na mesma tela; pós-sucesso a
    grade recalcula (necessidade some ou cai).
14. Conversões de área (dm²→m/placa) e unidades seguem as regras canônicas do
    projeto (ficha de componente / motores alinhados a `v_mrp_needs` /
    consumo); não inventar motor paralelo.
15. URLs antigas de Plano/Projeções/MRP redirecionam para a nova visão (replace),
    preservando deep-links externos o máximo possível.
16. Tela usa design tokens do app (não cores hardcoded); header editorial com
    `sectionLabel` coerente com Compras.
17. Typecheck canônico (`bunx tsc -p tsconfig.app.json --noEmit`) limpo nos
    arquivos tocados; testes de contrato cobrem: balde segunda–domingo, offset
    lead time → semana de compra, exclusão de forecast nas 4 primeiras semanas,
    exclusão de OC `draft`/`cancelled` do líquido, R$ 0 + alerta sem preço.

## Data model / Domain

### Conceitos

| Conceito | Definição |
|---|---|
| Semana de uso | Semana civil (seg–dom) em que o material é necessário na fábrica (ancorada na data de necessidade já usada pela timeline / OP). |
| Semana de compra | Semana civil de `data_uso − lead_time_dias_úteis_ou_corridos` — **mesma convenção de lead time já viva** no banco (`add_business_days` / `get_effective_supplier_lead_days`); não misturar com a semana-por-terça do plano legado. |
| Quinzena | 1ª = dias 1–15 do mês; 2ª = dia 16 até o último dia do mês (civil BR). |
| Necessidade líquida | Ver glossário em `src/components/purchase/CONTEXT.md`. |
| Demanda firme | Explosão a partir de PV aprovado / OP não cancelada/finalizada conforme o motor canônico atual (`v_mrp_needs` / consumo de OP). |
| Forecast | Plano de `/forecast` — só após semana 4 do horizonte. |

### Fontes (reuso, não duplicar)

- Necessidades: preferir unificar leitura em cima de `v_mrp_needs` e/ou da
  futura `v_purchase_needs` da remodelagem; se faltar dimensão temporal por
  semana de uso, **estender** view/RPC — não recalcular consumo no client.
- Lead time / buy-by: `get_effective_supplier_lead_days`,
  `compute_po_purchase_by_date`, lógica espelhada em `purchase_projection_timeline`.
- Preço: `products.purchase_price`.
- Setor/grupo: `product_groups.sector`, `product_groups.id/name`.
- OC aberta / recebido: `purchase_orders` + `purchase_order_items` (+ movimentos
  de entrada já usados no app).
- Forecast: módulo/tabelas já usadas por `/forecast` (só pós-semana-4).

### Migrations (se necessário)

- RPC ou view `get_purchase_projection_weekly(...)` (nome final livre) que
  devolva linhas com: product/group/sector, semana_uso, data_comprar_ate,
  semana_compra, qty_gross, qty_on_hand_net, qty_on_order, qty_net, price,
  amount_need, flags (no_price, overdue, forecast).
- Carimbo: `max(arquivo local, schema_migrations)` + 1 — consultar as duas
  fontes na hora de aplicar.
- Não reintroduzir perda de corte; não inventar dm² de solado.

## User flows

### Happy path — decidir compra da semana

1. Usuário abre Compras → Planejamento (`/purchase-planning`).
2. Vê a grade das próximas 4 semanas (uso), filtros setor/grupo, totais R$ por
   **semana de compra**.
3. Filtra setor (ex.: Cabedal) e, se quiser, um grupo (ex.: NAPA SOFT).
4. Identifica linhas com Comprar até na semana corrente / atrasadas.
5. Seleciona linhas → “Enviar para compra” / “Gerar OC”.
6. Fluxo canônico de OC conclui; grade atualiza; qtd líquida e R$ caem.

### Happy path — avaliar o mês

1. Alterna período para **mês** (ou quinzena).
2. Vê necessidade × OC × recebido × gap × % cobertura × atrasados.
3. Filtra atrasados ou gap > 0; decide comprar ou investigar cadastro/preço.

### Alternate / edge flows

- Horizonte > 4 semanas: colunas extras podem incluir forecast (marcadas);
  seleção para compra de linha **só forecast** exige confirmação explícita
  (“demanda não firme”) ou fica desabilitada no v1 — **default v1: seleção de
  compra só para demanda firme**.
- Material sem lead time cadastrado: usar a mesma regra de fallback já viva no
  banco; se lead = 0/null sem fallback, Comprar até = data de uso + alerta
  “Lead time ausente”.
- Sem preço: linha na grade, R$ 0, alerta; ação de compra **permitida**.
- Setor do grupo vazio: linha aparece sob setor “—” / “Sem setor”; filtro
  “Sem setor” disponível.
- Nenhuma necessidade no horizonte: `EmptyState` com CTA para estoque/PV.

## Edge cases & failure modes

| Caso | Comportamento |
|---|---|
| OC `draft` | Não reduz necessidade líquida nem entra em “OC aberta” do mês. |
| OC `cancelled` | Idem. |
| Parcialmente recebida | “Recebido” soma entradas; “OC aberta” soma saldo a receber. |
| Mesmo material em várias OPs/semanas | Uma linha por material (e cor) **por semana de uso**; não colapsar semanas. |
| Solado com grade | Seguir representação já usada no MRP (por produto/cor; grade no detalhe da ação de compra, não inventar coluna de numeração na grade semanal v1). |
| Mudança de lead time no cadastro | Grade recalcula no próximo fetch (ao vivo); OCs já gravadas não são reescritas por esta tela. |
| Permissão financeira | R$ só para quem já vê custo/preço no módulo; demais veem só qtd (seguir gate existente de `canSeeFinancial` / equivalente). |
| Falha ao gerar OC | Toast de erro; seleção mantida; grade não mente que comprou. |

## Constraints & assumptions

- Package manager Bun; typecheck `-p tsconfig.app.json`; tokens de design;
  ícones Phosphor; domínio pt-BR.
- **Não** restaurar perda de corte; **não** usar `GREATEST` na largura.
- Semana operacional **não** é a “próxima terça” do `weeklyPurchasingPlan.ts`
  legado — é segunda–domingo.
- Assunção (usuário deferiu ao padrão indústria + respostas): Cronograma e
  Saldo & Custos **permanecem** como abas secundárias.
- Assunção: ação integrada no v1 conecta ao gerador canônico vigente; quando o
  carrinho da remodelagem estiver live, esta tela passa a alimentar o carrinho
  em vez de criar OC direto — sem segunda UX de compra.
- Assunção: “recebido” no mês = entradas de estoque ligadas a OC no período
  (mesmo critério já usado em analytics de compra, se existir; senão NF/entrada
  de OC).
- Export Excel fora do v1 (pedido explícito).

## Open questions

- Critério exato de “% cobertura” quando há estoque parcial + OC parcial
  (sugerido: `min(1, (estoque_líquido_alocado + on_order) / necessidade_bruta)`
  na janela) — calibrar na implementação com 1 exemplo real de produção.
- Se a remodelagem do carrinho ainda não estiver em produção na mesma release,
  o botão chama o gerador MRP atual; documentar no PR qual caminho ficou ligado.

## Definition of Done

- [ ] Req 1–2 — Abrir `/purchase-planning`: a land page é a nova visão; nav sem
      Plano/Projeções/MRP; Cronograma e Saldo & Custos acessíveis.
- [ ] Req 3–4 — Colunas = semanas seg–dom; default 4 semanas; filtros semana /
      1ª quinzena / 2ª quinzena / mês alteram a agregação corretamente
      (verificar com data fixa de teste).
- [ ] Req 5 — Filtrar um setor e um grupo reduz as linhas ao subconjunto certo
      (`product_groups.sector` + `group_id`).
- [ ] Req 6–8 — Para um material com uso na semana W2 e lead time que empurra
      compra para W1: qtd aparece em W2; “Comprar até” destacado; R$ do rodapé
      de caixa incrementa W1, não W2.
- [ ] Req 9 — Com horizonte 4 semanas, nenhuma célula de forecast; ao estender
      para 8, forecast só nas semanas 5–8 e visualmente distinto; seleção de
      compra em forecast bloqueada ou com confirmação conforme default v1.
- [ ] Req 10 — Material com OC `pending` tem líquido reduzido; OC `draft` não
      reduz.
- [ ] Req 11 — Zerar/`null` em `purchase_price`: linha com R$ 0 + alerta.
- [ ] Req 12 — Modo mês mostra e filtra: necessidade qtd/R$, OC aberta qtd/R$,
      recebido qtd/R$, gap, % cobertura, atrasados.
- [ ] Req 13 — Selecionar linhas firmes → gerar/enviar compra → após sucesso
      a necessidade líquida reflete a nova OC.
- [ ] Req 14 — Material de área (napa) aparece em unidade física coerente com
      `v_mrp_needs` / conversão canônica (não dm² crus como “metros”).
- [ ] Req 15 — `?tab=plano`, `?tab=projecoes`, `?tab=mrp` e aliases legados
      redirecionam para a nova visão.
- [ ] Req 16–17 — `bun run check:tokens` limpo nos TSX tocados;
      `bunx tsc -p tsconfig.app.json --noEmit` limpo; testes de contrato
      listados no req 17 passando em `bun run test` (arquivos novos).
