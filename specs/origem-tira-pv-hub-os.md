# Origem da tira no PV + Hub otimizado + OS de remessa

## Goal

Tirar a decisão “feita na fábrica vs prestador / SKU acabado” da ficha técnica e
colocá-la no **Pedido de Venda (desktop)**, com pré-definição no **Hub de Tiras**,
napa-base correta na ficha (nunca dublado), e **Ordem de Serviço** como dona da
remessa/custódia/retorno — para engenharia, vendas e PCP operarem sem origem
travada por posição na ficha.

## Background / Problem

1. Na ficha (Range Aviamento), “Base da identidade” parece fixar Tira 1 =
   artesanal e Tira 2 = comprada, porque o select só lista o que o catálogo da
   **medida** permite. A origem real da fábrica não é propriedade da ficha.
2. Com cabedal `NAPA SOFT + MASSABOX`, o badge “Napa-base definida pela
   referência” mostra o **composto**. Tira artesanal corta a **camada de napa**,
   nunca o dublado.
3. “Comprada pronta” na prática da Squad (exceto Strass) é **remeter napa ao
   prestador e receber tira**, com custo de mão de obra e frete — não só comprar
   SKU de prateleira. Esse ciclo precisa viver na **OS**, não só no Hub.
4. O Hub de Tiras está denso (muitas abas/fluxos); precisa redesign completo de
   abas e fluxo junto com os campos novos (origem, preços, prestador, frete).

Specs relacionadas (não substituem esta; ler em conjunto):
- [`tira-base-napa-por-ficha-tecnica.md`](tira-base-napa-por-ficha-tecnica.md) —
  roteamento por referência (já implementado; esta spec **estende** com peel de
  dublado).
- [`materiais-cabedal-por-posicao.md`](materiais-cabedal-por-posicao.md) —
  política de material por posição.
- [`gerar-os-terceirizacao-opcional.md`](gerar-os-terceirizacao-opcional.md) /
  [`os-consolidada-por-prestador.md`](os-consolidada-por-prestador.md) — OS de
  setores/OP. **Para tiras desta spec, a regra do dono é 1 OS por PV** (recibo
  do prestador com nº do pedido). Consolidação cross-PV por prestador não se
  aplica a este fluxo de tira nesta entrega.

## Scope

### In scope

- Remover “Base da identidade” da ficha técnica; ficha só define família/medida,
  consumo, política de material/cor e napa-base.
- Hub: origem por família/medida (`sempre_fabrica` | `sempre_sku_acabado` |
  `escolhe_no_pv`), preços (artesanal + prestador), prestador padrão, frete por
  prestador; flag SKU acabado com default sugerido se o nome contém STRASS;
  preço por cor **somente** em famílias Strass (regra fixa no sistema).
- Redesign completo de abas/fluxo do Hub de Tiras.
- PV desktop: escolha por posição quando Hub = `escolhe_no_pv`; botões em massa
  “todas fábrica” / “todas prestador”; esconder seletor quando origem for fixa;
  Strass fora do menu (sempre SKU acabado).
- Napa-base na ficha: default segue referência, com exceção de material
  diferente; **padrão fixo**: se o grupo resolvido for composto/dublado, a tira
  usa a **camada de napa** (`product_group_layers`), nunca o composto.
- Consumo do pedido: em origem prestador, **mostrar** napa necessária
  (material/cor/metragem) sem debitar napa pelo motor de consumo do PV.
- OS automática no save do PV (1 OS por PV) com remessa, custódia, retorno;
  descrição/recibo (valor, qtd por cor, nº do pedido do cliente); custos mão de
  obra/m + frete/m (napa **não** entra no custo do prestador).
- Hub incompleto → diálogo no PV para completar parâmetros antes de fechar.
- Editar PV aberto → exigir nova origem.
- Strass / SKU acabado: verificar estoque; se faltar, gerar **OC automática**.
- Auditorias alinhadas a essas regras (material a material, cor a cor).

### Out of scope (explicitamente agora)

- Seletor de origem no PWA `/m` (mobile).
- Reescrever/migrar em massa PVs já finalizados ou OSs históricas.
- Explodir dublado no débito de **cabedal** (continua indivisível); o peel é
  **só para tira**.
- Cotação multi-prestador / leilão de frete.
- Mudar a regra canônica de perda de corte (continua inexistente).

## Requirements

1. A ficha técnica **não** exibe nem grava `identity_basis` / “Base da
   identidade”. Salvar ficha não exige origem artesanal vs comprada.
2. Cada família/medida no Hub tem `origem_padrao` ∈
   `{ sempre_fabrica, sempre_sku_acabado, escolhe_no_pv }`.
3. Flag/campo “SKU acabado (sem remessa)” no Hub; ao cadastrar/editar família
   cujo nome normalizado contém `STRASS`, o sistema **sugere e pode aplicar**
   `sempre_sku_acabado` nos tipos cadastrados dessa família.
4. Hub cadastra **preço artesanal** (R$/m) e **preço prestador / mão de obra**
   (R$/m). Em famílias Strass, preço é **por cor**; nas demais, **único** por
   família/medida (regra fixa no código, não flag).
5. Prestador padrão da família/medida elegível a OS; frete **editável por
   prestador** no modelo “R$ X a cada Y metros” (ex.: R$ 60–80 / 1.600 m),
   gerando frete/m = X/Y.
6. Redesign do Hub: reorganizar abas primárias e fluxos (Operação /
   Configuração / Controle e subviews) para o cadastro de origem/preço/
   prestador/frete ser descobível; remessa/custódia de tira deixa de ser o
   caminho principal no Hub e passa à OS gerada pelo PV.
7. No PV desktop, para cada posição de tira:
   - `sempre_fabrica` → origem fábrica, sem seletor;
   - `sempre_sku_acabado` → SKU acabado, sem seletor (Strass);
   - `escolhe_no_pv` → seletor **Fábrica** | **Prestador (OS)**.
8. Botões em massa no item/PV: “Todas fábrica” e “Todas prestador”, aplicando
   só em posições `escolhe_no_pv` (fixas não mudam).
9. Napa-base na ficha: `follow_reference` continua default; políticas
   `fixed_group` / `select_on_order` seguem para exceções. Em qualquer resolução
   `follow_reference` (UI, `resolve_strap_base_group_id`, consumo, OS), se o
   grupo for composto com camada de napa, o UUID efetivo da tira é o da
   **camada de napa**.
10. Consumo do PV com origem prestador: lista napa (tipo, cor, metros) como
    **informativo** (ciência para remessa); **não** reserva/debita napa no
    motor de consumo do PV.
11. Origem fábrica: debita/reserva napa conforme regras atuais + peel; custo
    unitário da tira no custeio usa o **preço artesanal do Hub**.
12. Origem prestador: custo unitário da tira = mão de obra/m + frete/m do
    prestador. **Napa não entra** nesse custo (já custeada na OC de material).
13. Ao salvar PV (criar ou editar aberto) com ≥1 posição prestador: gera
    **automaticamente 1 OS por PV** contendo todas essas posições; remessa de
    napa, custódia e retorno de tira ocorrem **nessa OS**.
14. A OS / recibo do prestador inclui: tipo de napa, cores, quantidade de tira,
    metragem por linha, valores (MO + frete), número do pedido do cliente.
15. Se faltar prestador, preço MO ou frete no Hub no momento do save: abre
    **diálogo no PV** para preencher; só então conclui save + OS.
16. Strass / SKU acabado no save: consulta estoque do SKU na cor; se houver
    necessidade de compra, gera **OC automática** para o fornecedor do Hub;
    não gera OS de remessa.
17. Auditorias/relatórios de consumo e consistência refletem peel de napa,
    origem por posição e a distinção informativo vs debitável.
18. Mobile `/m` não ganha seletor nesta entrega; não pode gravar origem
    ambígua que o desktop exigiria (bloquear ou herdar só origens fixas do Hub —
    ver Assumptions).

## Data model / Domain

| Conceito | Onde | Notas |
|---|---|---|
| `origem_padrao` | Hub (família/medida / variante catálogo) | `sempre_fabrica` \| `sempre_sku_acabado` \| `escolhe_no_pv` |
| Preço artesanal R$/m | Hub | Custeio fábrica |
| Preço MO prestador R$/m | Hub | Custeio OS; Strass: por cor |
| Prestador padrão | Hub → contractor | OS de tira |
| Frete prestador | Cadastro do prestador | `freight_amount` + `freight_per_meters` → R$/m |
| Origem efetiva | Snapshot da linha de tira no item do PV | Gravada no save; usada por consumo/OS/OC |
| Napa efetiva | Resolução ficha + peel de `product_group_layers` | Nunca UUID do composto dublado |
| OS de tira | `service_orders` (+ itens) | 1 por PV neste fluxo; ciclo remessa→custódia→retorno |
| OC Strass | Fluxo de compra existente | Só se estoque insuficiente |

Remover da UX da ficha (e parar de exigir no save técnico): edição de
`identity_basis` em `strap_colors`. Snapshots comerciais do PV passam a carregar
a origem escolhida no pedido. Migrations novas acima do maior carimbo
repo+banco; validar objetos no banco (regra de ouro de migrations).

## User flows

### Happy path — tira com escolha

1. Hub: família Overlock-like = `sempre_fabrica`; Strass = `sempre_sku_acabado`;
   outra família = `escolhe_no_pv` com preços, prestador e frete.
2. Ficha 1702: cabedal Soft+Massabox; tiras `follow_reference` → badge/resolução
   mostra **NAPA SOFT** (camada), não o composto.
3. PV desktop: Tira Strass sem menu; Overlock sem menu (fábrica); demais com
   seletor. Usuário marca algumas “Prestador”, usa botão em massa se quiser.
4. Save → OS do PV criada com linhas (napa, cor, metros, valores) + recibo.
5. Consumo do PV mostra napa das posições prestador sem debitar; fábrica debita
   Soft.
6. OS: remete napa (custódia), recebe tira, fecha financeiro MO+frete.

### Happy path — Strass

1. Posição Strass no PV sem seletor.
2. Save: se estoque da cor cobre, só demanda/reserva SKU; se não, OC automática
   ao fornecedor do Hub.

### Alternate / edge flows

- Hub incompleto no save com prestador → diálogo modal no PV → preenche → OS.
- Editar PV aberto sem origem nova → bloqueia save até escolher (posições
  `escolhe_no_pv`).
- Botão em massa não sobrescreve Strass nem `sempre_fabrica`.
- Prestadores diferentes entre posições do mesmo PV → ver Open questions /
  Assumption abaixo.

## Edge cases & failure modes

| Caso | Comportamento |
|---|---|
| Composto sem camada de napa identificável | Bloquear save da ficha / avisar na resolução; não usar o composto |
| Receita/rendimento ausente para (medida, napa) | Mesmo padrão atual: aviso, sem converter às cegas |
| PV só com origens fixas | Save sem seletor; OS só se houver prestador |
| Cancelar PV / remover posição prestador | OS/linhas: cancelar ou estornar conforme regra de OS existente; não deixar custódia órfã |
| Frete Y metros = 0 | Validação: Y > 0 |
| Mobile tenta salvar item com família `escolhe_no_pv` sem origem | Bloquear com mensagem para concluir no desktop (Assumption) |

## Constraints & assumptions

- Stack: Bun, React Query, Supabase; typecheck `bunx tsc -p tsconfig.app.json --noEmit`; tokens de design; domínio pt-BR.
- Peel de dublado **não** altera débito de cabedal composto.
- Assumption: se um PV tiver posições prestador com **prestadores diferentes**, o
  diálogo do PV exige unificar o prestador da OS daquele PV **ou** o save
  bloqueia até todas as posições prestador apontarem o mesmo prestador (default
  escolhido: **bloquear com mensagem clara** — evita 1 OS com dois donos).
- Assumption: mobile bloqueia famílias `escolhe_no_pv` até haver origem gravada
  no desktop (ou o item já veio com origem de edição desktop).
- Assumption: preço artesanal do Hub **substitui** o uso de
  `transformation_cost_per_m` da receita no **custeio comercial da tira**; a
  receita continua para rendimento/geometria.
- Conflito consciente com [`os-consolidada-por-prestador.md`](os-consolidada-por-prestador.md):
  neste fluxo de tira, **1 OS por PV**, não contêiner aberto cross-PV.

## Open questions

- IA exata das novas abas do Hub (nomes/labels finais) — a implementar com
  redesign editorial alinhado ao restante do app; validar com o dono na 1ª
  revisão visual.
- Unidade do recibo impresso (PDF vs tela imprimível) — default: layout
  imprimível no padrão de print do projeto (inline styles).

## Definition of Done

- [x] Ficha 1702 (e qualquer ficha) **não** mostra “Base da identidade”; save da
      ficha não exige `identity_basis` — verificar na UI Range Aviamento.
- [x] Com cabedal Soft+Massabox e tira `follow_reference`, UI e
      `resolve_strap_base_group_id` / consumo resolvem **NAPA SOFT** — peel TS +
      SQL (`peel_strap_base_group_id`); consumo debitável ainda usa a resolução
      canônica (validar em runtime após migration).
- [x] Hub permite `origem_padrao` + preços; frete no cadastro do prestador; nome
      STRASS sugere `sempre_sku_acabado` (backfill + sugestão no editor).
- [ ] Hub redesenhado (abas/fluxo) navegável sem as telas mortas do fluxo antigo
      de remessa como caminho principal — walkthrough manual.
- [x] PV desktop: seletor só em `escolhe_no_pv`; botões em massa; Strass/SKU
      fixo sem menu; aviso + bloqueio de save sem origem.
- [ ] Save com prestador cria **1 OS** com napa/cores/metros/valores/nº pedido;
      consumo mostra napa sem debitar — UI consumo + OS.
- [ ] Custo prestador = MO/m + frete/m **sem** napa — conferir totais na OS.
- [ ] Hub incompleto abre diálogo no PV — hoje: toast bloqueante para MO
      ausente; diálogo modal + frete/prestador unificado pendente.
- [ ] Editar PV aberto exige origem nova — abrir PV legado editável.
- [ ] Strass com falta de estoque gera OC; com estoque, não — dois cenários.
- [ ] `/m` sem seletor novo; não grava origem ambígua — tentativa mobile.
- [ ] Typecheck `bunx tsc -p tsconfig.app.json --noEmit` e testes unitários/
      contract das libs de origem, peel e política Hub verdes.
- [ ] Auditoria/consumo material×cor coerente com as regras — caso PV misto
      fábrica+prestador+Strass.

## Implementation status (2026-09-07)

| Fatia | Estado |
|---|---|
| Peel Soft+Massabox → napa (`strapBaseNapaPeel`, mig `18100`) | feito; objetos no banco; carimbo local `18100` (evita colisão com série audit remota `17000`–`17400`) |
| Remover Base da identidade da ficha | feito |
| Hub: `origem_padrao` + preços na medida | feito (UI + colunas) |
| Prestador: frete R$/Y m | feito (colunas + form) |
| PV: seletor + bulk + guard de save | feito |
| OS automática 1/PV + remessa | **próxima fatia** (motor ainda usa container por contractor) |
| Strass → OC se faltar estoque | **próxima fatia** (reusar `materialize_strap_purchase_orders`) |
| Consumo informativo (prestador) | pendente |
| Redesign abas Hub | pendente |
