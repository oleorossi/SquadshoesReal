# Tiras — redesenho do subsistema

> Decidido em sessão de grill com o dono em 10/10/2026. **Substitui** as specs
> `tiras-artesanais-unificacao.md`, `origem-tira-pv-hub-os.md`,
> `tira-artesanal-fonte-unica-e-os-cabedal.md`, `cadastro-tira-artesanal-no-pv.md`,
> `identidade-variantes-e-tiras-compradas.md` e `cores-independentes-por-tira-no-pv.md`
> naquilo em que divergirem. `tira-base-napa-por-ficha-tecnica.md` (napa-base
> pela ficha, nunca o dublado) e `calculadora-tiras-cortes-parciais.md` (cálculo
> de corte do rolo) **continuam valendo**.

## Goal

Trocar o subsistema de tiras atual — 37 tabelas, ~12 vocabulários para
"fazer vs comprar", 2–4 fontes de verdade por conceito — por um modelo de
**três conceitos e um vocabulário**, do qual consumo, reserva, compra, corte
e custo são **derivados**. Junto, corrigir os dois sintomas que motivaram o
trabalho: cópia de PV com tiras e quantidade/metragem de tira na tela
Consumo de Materiais.

## Background / Problem (medido em 10/10/2026)

- **37 tabelas** `*strap*`/`*tira*`; ~20 vazias (lotes de produção, recebimentos,
  capacidade/calendário de executor, conciliações, migração).
- "Fazer vs comprar" tem ~12 nomes: `identity_basis`, `source_mode`,
  `pv_origem`, `origem_padrao`, `executor_type`, `origin_type`,
  `internal_production_enabled`, `purchase_enabled`, `is_artisanal`,
  `is_artisanal_strap`, `min_stock_replenishment_mode`, lista fixa
  `NOMINAL_BUY_READY_STRAP_*` em `src/lib/strapIdentity.ts`.
- Fontes duplicadas: linha de tira (ficha, referência, PV), decisão do PV
  (`sale_order_items.strap_sourcing` + `sale_order_strap_demands`), receita
  (`artisanal_recipes` legado + `artisanal_strap_recipes`).
- `sale_order_strap_demands`: **11.838 linhas `superseded`** para 109 itens
  (PV-00162 sozinho: 3.087 superseded × 34 vivas) — todo save regrava tudo.
- Specs ativas contraditórias sobre quem decide a origem.
- **Cópia de PV** — dois caminhos com regras diferentes:
  - "Duplicar para lojas" (`DuplicateToStoresDialog.tsx` +
    `remapLegacyStrapsForDuplicate.ts`) perde o `base_group_id` escolhido por
    posição ⇒ ficha com material `select_on_order` faz **todas as lojas
    falharem**; casa linha por posição quando o nome não bate ⇒ cor vai pra
    tira errada sem aviso; confia em `color_id` sem checar se está ativo;
    toast mostra só as 3 primeiras falhas.
  - "Copiar p/ novo PV" (`SaleOrderForm.tsx` `buildCopySeedPayload`) não
    recupera cor de PV legado (posições "1"/"2"), e o mesmo PV se comporta
    diferente nos dois botões.
- **Consumo de Materiais** (`SummaryConsumptionPanel` → `pvConsumption.ts` →
  RPC `calculate_consumption_report_batch` → `canonicalStrapDemandPreview.ts`
  → `alignConsumptionToStockUnit.ts`): metros brutos corretos (cm/par × pares
  ÷ 100, TS = SQL), mas a apresentação erra:
  - tira interna convertida **some da tabela** (`isConvertedInternalStrap`) e
    só aparece como "Napa para tiras";
  - linha converte napa com bloqueio grave, bloco mostra "—" ⇒ compra conta
    napa que o bloco nega;
  - chave de agrupamento sem cor ⇒ cores diferentes fundidas;
  - merge do bloco subconta napa de linhas que só trouxeram rendimento;
  - modo "Por PV e modelo" joga tiras em "PV / SEM REF";
  - PV rascunho divergente da ficha apaga o pin do "Comprar pronto".

Dados vivos afetados: 27 PVs abertos com tira, 43 fichas com tira, 42 receitas
aprovadas + 20 legado, 64 variantes, 569 m de tira pronta em estoque (19 SKUs),
7 OCs com tira (1 rascunho, 6 pendentes), 38 OS de prestador `Pendente`
(mai–jul/2026), 167 mil linhas de audit log.

## Decisões do dono (grill 10/10/2026)

| # | Decisão |
|---|---|
| D1 | **Redesenho** do subsistema (não remendo). |
| D2 | Quem **cadastra/edita o PV** decide a origem de cada tira: **Fazer** ou **Comprar**. O catálogo não decide. |
| D3 | **Prestador sai** como origem/executor de tira. |
| D4 | **Uma função de cópia** usada pelos dois botões ("Duplicar para lojas" e "Copiar p/ novo PV"). |
| D5 | Na cópia, cor/material só são herdados quando o **nome da tira bate exato e único** na ficha atual; o resto fica em branco e destacado com o nome da tira. Nunca casar por posição. Em "Duplicar para lojas", falha vira erro **daquela loja** com o motivo, listando todas. |
| D6 | Tabelas/funções sem uso **são apagadas**. |
| D7 | Demanda de tira: **só a versão atual** (sem histórico por save). |
| D8 | No consumo, **tira e napa em linhas separadas**, sem somar uma na outra (ver R-Consumo). |
| D9 | Sem receita/rendimento: mostra metros de tira, napa "—" com o motivo em linha, bloco e PDF; **nunca** entra na compra. |
| D10 | "Quantidade" de tira = **metros de tira (total e por numeração) + pares**. Peças/cortes só na calculadora do rolo. |
| D11 | Caso de teste de referência: **PV-00224**. |
| D12 | Modelo de 3 conceitos (abaixo) aprovado. |
| D13 | Origem no PV vem **pré-preenchida com sugestão editável**: "Comprar" se existe SKU pronto com saldo para a cor; senão "Fazer". |
| D14 | Origem editável **livre até a OP ser gerada**; depois só admin, com aviso de que reserva/compra será refeita. |
| D15 | **Tira pronta em estoque é consumida primeiro**, qualquer que seja a origem; só a falta vai pra corte/compra. Consumo mostra "X m do estoque · Y m a fazer/comprar". |
| D16 | As **38 OS de prestador pendentes são canceladas** ("prestador descontinuado"), após o dono confirmar que nenhuma está fisicamente fora; napa em custódia volta ao estoque. |
| D17 | Dados históricos a apagar são **exportados (CSV no Drive) antes**; tabelas vazias apagam direto. |
| D18 | **Corte único**: motor novo construído ao lado, comparado nos 27 PVs abertos; quando bater, troca de uma vez. PVs faturados ficam como estão (só leitura). |
| D19 | Os 27 PVs abertos são convertidos por **migração automática**; o que não converter sem chute vai pra uma lista de pendências resolvida na tela. |
| D20 | Tira "Fazer" é **etapa da própria OP**: a ficha de corte mostra "cortar X m de tira Y da napa Z"; débito da napa na **finalização da OP** (mecanismo `settle_open_reservations_for_order`). Sem documento próprio de tira. |
| D21 | Tira "Comprar" entra na **sugestão de compra existente**: falta = necessidade − tira pronta em estoque − compras em aberto. Dono aprova e gera OC. Sem compra automática. |
| D22 | Tira **entra no custo do par**: Fazer = metros de napa × custo da napa + metros de tira × mão de obra/m (campo único no catálogo, opcional, vazio = R$ 0). Comprar = metros × custo do SKU. |
| D23 | **Sem estoque mínimo** de tira (e em todo o sistema — spec separada `remover-estoque-minimo.md`). |

## Modelo novo

### 1. Tira (catálogo)
Uma linha por **medida × napa-base × cor**.
- `medida` (ex.: Chata 8 mm), `napa_base` (grupo/SKU da napa, nunca dublado),
  `cor` (canônica).
- `rendimento_m_por_m` — metros de tira por metro de napa (obrigatório para
  "Fazer" calcular napa; vazio ⇒ D9).
- `mao_de_obra_por_m` — opcional (D22).
- `sku_pronto` — produto em estoque quando a tira existe comprada pronta
  (opcional; define se "Comprar" é possível e a sugestão D13).

### 2. Ficha técnica
Por linha de tira do modelo: nome da linha (chave estável para cópia — D5),
medida, cm/par por numeração, política de cor (`segue o modelo` |
`escolhe no pedido`) e de material (`segue o modelo` | `fixo` | `escolhe no
pedido`).

### 3. Item do PV
Por linha de tira: `cor`, `material` (napa-base), `origem: fazer | comprar`.
**Gravado num único lugar.** Tudo o mais (metros, napa, reserva, compra,
corte, custo) é derivado na hora.

### Vocabulário único
Na UI e no código novo: **Fazer** / **Comprar**. Nenhum outro termo para origem.

## Requisitos

### R-Cópia
1. Uma função (`copySaleOrderItemsStraps` ou equivalente) consumida pelos dois
   botões.
2. Leva cor + material + origem de cada tira; valida contra a ficha **atual**,
   cor/material ativos e permitidos (`allowed_material_group_ids`).
3. Regra D5 de herança; nada por posição.
4. "Duplicar para lojas": resultado por loja com motivo, lista completa.

### R-Consumo (tela Consumo de Materiais e PDF)
1. Linha de **tira**: metros de tira (total + por numeração), pares, cor,
   origem, "X m do estoque · Y m a fazer/comprar" (D15).
2. Bloco **Napa para cortar** (só origem Fazer): metros de napa = metros a
   fazer ÷ rendimento; por napa-base e cor.
3. Total de compra: napa das tiras Fazer + tira pronta das Comprar, só a falta.
4. Sem rendimento: D9, consistente em linha, bloco, PDF e compra.
5. Agrupamento inclui **cor**; linhas carregam PV e referência (modo "Por PV e
   modelo" correto).
6. Paridade TS×SQL travada por teste; PV-00224 conferido à mão.

### R-PV
1. Seletor Fazer/Comprar por tira no item, com sugestão D13.
2. Regra de edição D14.
3. Save do PV **não** gera linha nova se cor/material/origem/metros não mudaram (D7).
4. Erro de tira no save diz **qual item e qual tira** (não string crua do Postgres).

### R-Produção / Compra / Custo
D20, D21, D22 como descritos.

### R-Limpeza
1. Remover: tabelas de lote/recebimento/capacidade/calendário/conciliação/
   migração de tira, `sale_order_strap_demands` + clocks + jobs (substituídos
   pela derivação), `artisanal_recipes` legado, financial snapshots de tira,
   campos de prestador/frete de tira, `min_stock_*` de variantes,
   `NOMINAL_BUY_READY_STRAP_*`.
2. Export CSV antes (D17).
3. Telas: Central de Tiras vira **uma** tela de catálogo (tiras + rendimento +
   mão de obra + SKU pronto). Abas de demanda/produção/desempenho/migração saem.
4. Atualizar `CLAUDE.md` (seção de tiras) e marcar specs substituídas.

## Entregas (ordem)

1. **E1 — Cópia unificada** (R-Cópia) sobre o modelo atual. Alívio imediato.
2. **E2 — Consumo correto** (R-Consumo) sobre o modelo atual, travado pelo PV-00224.
3. **E3 — Modelo novo em paralelo**: catálogo + ficha + item do PV novos,
   motor derivado; relatório de comparação nos 27 PVs abertos.
4. **E4 — Migração e corte** (D18/D19): converte os 27 PVs, troca o motor,
   lista de pendências na tela.
5. **E5 — Produção/compra/custo** (D20–D22) no motor novo.
6. **E6 — Limpeza** (R-Limpeza, D16, D17).

E1 e E2 podem ir pra produção antes do redesenho porque o dono sente o
problema hoje; o código delas é escrito pra ser reaproveitado ou descartado
no corte, não estendido.

## Fora de escopo
- Remoção do estoque mínimo do sistema inteiro → `remover-estoque-minimo.md`.
- Recalcular/reconciliar PVs faturados.

## Definition of Done
- [ ] Os dois botões de cópia usam a mesma função; PV com material
      `select_on_order` duplica para N lojas sem falha; tira com nome
      divergente aparece destacada.
- [ ] PV-00224 no Consumo: metros de tira por cor e numeração batem com a conta
      manual; napa = metros a fazer ÷ rendimento; nada some, nada se funde.
- [ ] Origem Fazer/Comprar no item do PV com sugestão; travada após OP (exceto admin).
- [ ] Save sem mudança não cria linha de demanda.
- [ ] 27 PVs abertos convertidos; pendências listadas na tela.
- [ ] Ficha de corte da OP mostra a tira a cortar; débito da napa na finalização.
- [ ] Tira Comprar aparece na sugestão de compra; tira entra no custo do par.
- [ ] Tabelas/telas removidas, export feito, 38 OS canceladas com confirmação.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit`, `bun run lint`, `bun run test` verdes.
- [ ] Verificado no site de produção por agente de navegador (regra 7 do CLAUDE.md).
