# Tira "Comprar pronto" só registra cor e metros

> Spec fechada por entrevista com o dono em 11/10/2026 (`/grill-me`, 6 rodadas).
> **Ajuste antes do redesenho** [`tira-material-de-estoque.md`](tira-material-de-estoque.md),
> que continua valendo: lá, Comprar pronto vira empenho/falta → compra. Até ele ser
> construído, vale esta spec. **Vence**, onde divergir, as regras de Comprar pronto de
> `tiras-redesenho.md` (Revisão 2) e as migrations `20270101028600` (sku_acabado sem
> grupo vira Prestador) e `20270101031900` (Comprar pronto acha/cria SKU no grupo da ficha).

## Goal

No PV, escolher **Comprar pronto** numa tira registra só **napa · cor** e **metros** da
tira. Nada mais: sem SKU, sem grupo acabado na ficha, sem variante do Hub, sem reserva,
sem débito, sem OS e sem OC. Quem compra vê o que comprar no PV e numa tela nova em
Compras, onde marca o que já comprou.

## Background / Problem

Print do dono (11/10/2026, PV novo, OB01 em GLOW METALIC · COBRE, multicolor): o botão
**"Todas comprar pronto"** devolve *"Nenhuma tira desta ficha tem grupo acabado
cadastrado. Use «Todas prestador» — comprar pronto exige o grupo na ficha técnica."*

Causa medida:
- A trava está em **três camadas**:
  1. tela: `strapLineAllowsBuyReadyOrigem` (`src/lib/strapPvOrigem.ts`) exige `group_id`
     na linha da ficha. Esconde a opção no seletor e dá o toast no botão em massa;
  2. servidor: `tg_validate_sale_order_item_strap_color_alignment` converte em silêncio
     `sku_acabado` sem grupo para `fabrica` (mig `28600`);
  3. writer + gatilho: `prepare_sale_order_item_internal_straps` acha ou cria o SKU no
     grupo da ficha e grava `finished_product_id`. O gatilho exige esse SKU ativo
     "no grupo/cor da ficha".
- **14 fichas / 43 linhas de tira** `reference_base` não têm `group_id` (a OB01 inteira).
  Nenhuma consegue Comprar pronto hoje.
- Ao escolher Comprar pronto, a tela **troca a cor da tira pela Cor Principal**
  (`color_id: mainColorId` no seletor e no botão em massa). Na multicolor, TIRA 2 em
  NAPA SOFT · ROSADO viraria COBRE.
- O strass (`identity_basis = finished_product_group`, 19 linhas) exige variante ativa do
  Hub no save. Foi isso que derrubou o "Duplicar para lojas" do PV-00148. Mas o **débito**
  do strass na OP (reserva → "Conversão Material" na finalização) acha o SKU por
  grupo + cor: o *Strass 6mm Preto* foi debitado sem variante ativa.
- Metragem não é confiável: **9 linhas Comprar pronto em PV Aprovado** estão sem
  `gross_required_m`. O número só é gravado quando a prévia já estava carregada na hora do
  clique.
- No mesmo print, TIRA 2 e TIRA 3 em **Prestador** mostram *"Variante escolhida nao
  corresponde mais a identidade tecnica atual"* (`variant_snapshot_stale` da prévia). O
  `strap_sourcing` ficou com a variante da napa anterior (GLOW METALIC) depois que a
  tira passou a NAPA SOFT (napa por tira, commit `7f19db42`).

## Decisões do dono (11/10/2026)

| # | Decisão |
|---|---|
| D1 | Comprar pronto **só registra** napa · cor + metros. Não procura nem cria SKU (tira de napa), não exige grupo na ficha, não reserva, não debita, não gera OS/OC/demanda. A napa dessa tira sai do consumo (ninguém manda napa a prestador). |
| D2 | A cor registrada é a do **seletor da tira** (napa + cor). Nunca a Cor Principal por cima. Tira `follow_main` (TRASEIRA) segue a cor do item, como hoje. |
| D3 | Ajuste já. O redesenho `tira-material-de-estoque.md` segue valendo. |
| D4 | Vale para **todas** as tiras em Comprar pronto, **inclusive strass**: o strass para de exigir variante do Hub. |
| D5 | Metros **calculados no servidor a cada save**: Σ (cm/par da numeração × pares da numeração) ÷ 100, pela grade atual. |
| D6 | Cor + metros aparecem em: **card do item no PV**, **Consumo de Materiais** (linha neutra), **Lista de Separação** e **ficha do Aviamento**. |
| D7 | **Exceção do estoque: o strass continua debitando** (reserva no SKU grupo + cor → conversão na finalização da OP), agora sem variante. Tira de napa: nada. |
| D8 | Strass em cor sem SKU no grupo: o save **cria o SKU com estoque 0** (mesma regra da mig `31900`). Sem saldo, vira pendência visível na OP. |
| D9 | PVs abertos (Rascunho, Aprovado, Em Produção) já com Comprar pronto: uma migration **preenche napa · cor + metros**. Faturado e Cancelado intactos. |
| D10 | Tela nova **Compras → "Tiras para comprar"**. |
| D11 | Na tela, entram só PVs **Aprovado + Em Produção**. |
| D12 | Check **"comprado" por PV × tira**. Grava os metros comprados. Se o PV passa a precisar de mais, a diferença volta como "a comprar"; se precisa de menos, a linha mostra a sobra, só como informação. PV cancelado: a linha comprada fica como sobra. |
| D13 | O strass entra na tela **com o saldo do SKU ao lado**. |
| D14 | Custo: tira de napa comprada pronta **fica fora do custeio, com aviso** "sem custo — comprada pronta". O strass segue com o custo do SKU. (Descartado: casar SKU por nome; no grupo OVERLOCK o legado COBRE custa R$ 20,49/m e os SKUs com napa estão a R$ 0.) |
| D15 | A pendência `variant_snapshot_stale` do Prestador (TIRA 2/3 do print) **entra nesta entrega**. |
| D16 | Verificação de produção: **o dono salva o PV real do print**; o agente confere os 4 lugares e a tela de Compras. |

## Requirements

### R-PV (tela)
1. "Comprar pronto" fica disponível em **toda** linha de tira de napa, com ou sem
   `group_id` na ficha. O toast "Nenhuma tira desta ficha tem grupo acabado…" sai.
   `coerceImpossibleBuyReadyStrapOrigem` deixa de converter para Prestador.
2. Escolher Comprar pronto (no seletor da tira ou em "Todas comprar pronto") **preserva a
   napa e a cor** que a tira tem. Linha `select_on_order` sem cor ainda pede a cor, como hoje.
3. O bloco ESTOQUE da tira em Comprar pronto mostra:
   `Comprar pronto · <metros> m de <TIRA> · <NAPA> · <COR>` (strass: sem napa, com o saldo
   do SKU). Sem aviso de pendência, variante ou receita.
4. O mesmo vale no PWA (`MobileNewOrder`), se ele oferecer a origem.

### R-PV (save, servidor)
5. `prepare_sale_order_item_internal_straps`, ramo `reference_base` + `sku_acabado`:
   valida a cor canônica ativa (erro com modelo / cor do item / tira, como hoje), resolve a
   napa da tira (mesmo resolvedor da napa por tira, `private.resolve_technical_strap_material`)
   e congela em `strap_sourcing[linha]`:
   `source_mode = 'buy_ready'`, `color_id`, `base_group_id`, `base_group_name`,
   `gross_required_m`, com `finished_product_id`, `strap_variant_id`, `recipe_id` e
   `base_product_id` **nulos**. Não cria produto e não exige `group_id`.
6. `gross_required_m` é recalculado em **todo** save (D5), para toda linha Comprar pronto.
7. Ramo `finished_product_group` (strass): sem exigência de `artisanal_strap_variants`.
   Resolve o SKU por grupo da identidade + cor canônica e cria com estoque 0 se faltar (D8).
   Congela `finished_product_id` e `gross_required_m`. Mais de um SKU ativo para a mesma
   cor → erro com contexto (não escolhe).
8. `tg_validate_sale_order_item_strap_color_alignment`: aceita `buy_ready` de napa sem
   `finished_product_id`. Sai a conversão `sku_acabado` → `fabrica` da mig `28600`. Para o
   strass, valida que o SKU congelado é do grupo/cor, sem variante.
9. Comprar pronto de napa não gera demanda, intent, OS, OC nem reserva
   (`enqueue_sale_order_strap_demands` e afins pulam a linha). A napa dessa tira não entra
   no consumo, na reserva nem no débito da OP.
10. O débito do strass (reserva + conversão na finalização) continua funcionando sem variante.

### R-Exibição
11. **Consumo de Materiais** (`/sales?view=consumo`): a tira de napa Comprar pronto aparece
    como linha **neutra** (sem verde/vermelho), com napa · cor e metros. Strass como hoje.
12. **Lista de Separação** (`bomConsumption`): linha "Comprar pronto" com napa · cor e metros.
13. **Ficha do Aviamento** (`OperatorWorkSheet`, setor Aviamento/Mesa): bloco com as tiras
    compradas prontas (tira · napa · cor, metros). Segue as regras de print do `CLAUDE.md`
    (inline styles, preto puro, pisos de fonte).

### R-Tela "Tiras para comprar" (Compras)
14. Rota `/compras/tiras` com `ProtectedRoute → Suspense → RouteGuard`, módulo
    `financeiro` (o mesmo de `/compras`), entrada `hub-child` no grupo Compras de
    `src/data/navigation.ts`.
15. Fonte: função **somente-leitura** do servidor que lê as linhas `buy_ready` de
    `sale_order_items.strap_sourcing` dos PVs **Aprovado + Em Produção** (D11). Agrupa por
    tira (tipo/medida) · napa · cor, com detalhe por PV (PV, cliente, modelo, cor do item,
    metros).
16. Colunas: necessário, comprado, **a comprar** (= necessário − comprado, mínimo 0),
    sobra (= comprado − necessário, quando > 0). Strass: + saldo do SKU (D13).
17. Check **"comprado"** por PV × linha de tira: grava os metros comprados no momento
    (tabela nova, com quem e quando). Desmarcar apaga. Regras do D12. Linha de PV cancelado
    só aparece se tiver comprado > 0 (como sobra).
18. Escrita só para quem tem o módulo `financeiro`; RLS com `is_approved_user()`.

### R-Custo
19. No custeio, tira de napa Comprar pronto = **"sem custo — comprada pronta"**, visível
    (não some calada). O strass usa o custo do SKU, como hoje.

### R-Dados existentes
20. Migration de backfill (D9): para PVs Rascunho/Aprovado/Em Produção com linhas
    Comprar pronto, recalcula e grava `gross_required_m`, `base_group_id`/`base_group_name`
    e zera `strap_variant_id`/`recipe_id`/`base_product_id` nas tiras de napa. Strass mantém
    `finished_product_id`. Faturado/Cancelado não são tocados. Antes de aplicar, uma
    simulação lista as linhas afetadas.
21. Reservas de tira já existentes não são liberadas nem recriadas pelo backfill.

### R-Prestador (D15)
22. Trocar napa · cor de uma tira em Prestador atualiza o `strap_sourcing` da linha para a
    identidade nova. A prévia deixa de acusar `variant_snapshot_stale` quando o operador
    só trocou a napa/cor. Se a identidade nova não tiver variante/receita no Hub, aparece o
    aviso **dessa** falta, não o de variante velha.

### R-Documentação
23. `CLAUDE.md`: na seção de tiras, registrar a regra "Comprar pronto só registra" e a
    exceção do strass (D7), com o ponteiro para esta spec. Em `tiras-redesenho.md` e
    `tira-material-de-estoque.md`, uma nota de que esta spec vale até o redesenho.

## Data model

- `sale_order_items.strap_sourcing[<linha>]` (existente): para Comprar pronto de napa,
  `{source_mode:'buy_ready', color_id, base_group_id, base_group_name, gross_required_m}`
  sem SKU; para strass, `+ finished_product_id`.
- Nova tabela `strap_buy_ready_purchases`: `sale_order_item_id`,
  `technical_strap_line_id`, `color_id`, `base_group_id` (nulo no strass),
  `purchased_m numeric > 0`, `purchased_by`, `purchased_at`; único por
  (`sale_order_item_id`, `technical_strap_line_id`).
- Migrations com carimbo pelas **duas fontes** do `CLAUDE.md`; writer redefinido sobre o
  **corpo vivo** (`pg_get_functiondef`), preservando o ramo
  `napas_da_referencia_por_tira_20270101035700`.

## Edge cases

- Cor inativa/inexistente → erro com modelo, cor do item e tira; nada é gravado.
- Grade alterada depois do clique → metros recalculados no save (D5).
- PV aumenta depois do "comprado" → a diferença volta a "a comprar". Se diminui → sobra.
- PV cancelado com compra marcada → a linha fica como sobra.
- Strass com dois SKUs ativos da mesma cor → erro com contexto (não escolhe sozinho).
- Strass sem saldo na finalização → pendência `pending_reconciliation` (caminho existente).
- Troca Comprar pronto → Prestador → volta ao fluxo Prestador atual, sem resíduo de
  `buy_ready`.
- Snapshot comprometido (Aprovado/Em Produção) continua travando origem já escolhida
  (`isStrapPvOrigemChoiceLocked`).

## Out of scope

- Empenho/falta/compra automática de tira (é o redesenho).
- Mudar o fluxo Prestador além do R22.
- Lista de compras virar OC automaticamente.
- Mexer em PVs faturados/cancelados.

## Definition of Done

- [ ] **R1/R2** — Na OB01 multicolor, "Todas comprar pronto" não dá toast; TIRA 2 continua
      NAPA SOFT · ROSADO e TIRA 3 NAPA SOFT · NEW WHISKY.
- [ ] **R5/R6/R8** — Salvar o PV: `strap_sourcing` com `buy_ready`, napa, cor e
      `gross_required_m` = Σ(cm × pares)/100; nenhum `products` criado para tira de napa
      (contagem antes/depois).
- [ ] **R7/R10** — PV com strass em cor sem variante salva; SKU criado se faltava; a OP
      reserva o strass.
- [ ] **R9** — Nenhuma reserva, demanda, OS ou OC para a tira de napa Comprar pronto, e a
      napa dela fora do consumo.
- [ ] **R11–R13** — Cor + metros visíveis no Consumo de Materiais (neutro), na Lista de
      Separação e na ficha do Aviamento.
- [ ] **R14–R18** — `/compras/tiras` lista, soma, mostra o saldo do strass; "comprado" grava
      e recalcula "a comprar"/sobra; rota sob `RouteGuard`.
- [ ] **R19** — O custeio mostra "sem custo — comprada pronta".
- [ ] **R20** — Simulação conferida; depois, as 9 linhas aprovadas têm metros.
- [ ] **R22** — Trocar napa de uma tira Prestador não deixa `variant_snapshot_stale`.
- [ ] **R23** — `CLAUDE.md` e as specs atualizadas.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit`, `bun run lint`, `bun run test`,
      `bun run check:tokens` verdes.
- [ ] **Produção (regra 7, D16)** — depois do deploy em `main`, o dono salva o PV do print;
      um agente de navegador confere o card, o Consumo, a Lista de Separação, a ficha do
      Aviamento e `/compras/tiras`.
