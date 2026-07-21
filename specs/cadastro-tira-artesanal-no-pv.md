# Cadastro de Tira Artesanal a partir do PV

## Goal
Dar ao vendedor um caminho de **um clique, sem sair do PV**, para cadastrar a cor de
tira que está travando o salvamento — criando o **produto final no estoque** e
**vinculando a receita de produção artesanal** (base = a napa da mesma cor, ex.:
NAPA MADRID), do mesmo jeito que as outras tiras já funcionam. Elimina o bloqueio
`Cor "X" não cadastrada em tira X` sem precisar navegar até Estoque/Terceirizados.

## Background / Problem
Ao salvar um PV, um guard em [SaleOrderForm.tsx:746-757](../src/pages/SaleOrderForm.tsx#L746-L757)
bloqueia se **qualquer tira** de um item tiver `(group_id + color)` sem produto ativo
correspondente em `products`. O grupo da tira vem da ficha (read-only); só a **cor** é
escolhida por PV. A mensagem exata é:

> Cor "CAPUCCINO" não cadastrada em tira CAPUCCINO. Use o botão "Cadastrar" no item
> para registrar a cor antes de salvar o pedido.

Fatos apurados no banco (`ssvxfoybzmjlypnipqzn`, 21/07/2026):

- `CAPUCCINO` **existe** como produto em `Tira chata 8mm` e `TIRA OVERLOCK 5MM`, mas
  **não** em `TIRA CHATA COSTURADA 11MM`, `Tira chata 25mm`, `TIRA STRASS *`, `TRANÇA`.
  A mesma cor precisa ser cadastrada **separadamente em cada largura** — essa é a fricção.
- As tiras finais **são produtos artesanais** (Tira chata 8mm: 6/8 artesanais; 11mm:
  10/10; Overlock 5mm: 23/24; Trança: 8/8). Cadastrar "do jeito certo" = criar o produto
  final **e** garantir a receita.
- Todas as receitas atuais cortam de `NAPA SOFT`. `NAPA MADRID` é uma base mais nova, com
  4 cores até agora — `CAPUCCINO, OFF WHITE, PRETO, ROCHA` — exatamente as cores do PV que
  disparou o erro (NL04 = ROCHA, item que falha = CAPUCCINO). ⚠ `NAPA SOFT` tem cores
  duplicadas por grafia (`CAPUCCINO` **e** `CAPPUCCINO`; `DÁLIA` vs strap `DALIA`).
- **A mesma tira existe nas duas bases** (NAPA SOFT *e* NAPA MADRID) — decisão do usuário
  21/07/2026. Logo a base **não é fixa por tipo**: varia por cor, e a mesma cor pode existir
  nas duas bases.
- Hoje `artisanal_recipes` é **uma receita por tipo** (`artisanal_product_name`), sem
  constraint de unicidade, e o débito/MRP resolvem a base por `base_product_name` (grupo)
  **+ cor exata da tira**. Não há como representar "esse tipo corta de duas bases".
- Já existe UX inline parcial: caixa âmbar "Cores das Tiras" com botões `Cadastrar "{cor}"`
  e `Cadastrar todas (N)` ([SaleOrderItemForm.tsx:1500-1596](../src/components/sale-orders/SaleOrderItemForm.tsx#L1500-L1596)),
  mas ela chama `CreateStrapProductDialog`, que cria **só um produto simples** — não marca
  `is_artisanal` nem cria/associa receita, e não deixa escolher a base (NAPA MADRID).

## Scope

### In scope
- Uma janela **"Cadastrar Tira Artesanal"** aberta a partir do aviso âmbar de tira no PV
  (substitui/estende o `CreateStrapProductDialog` para tiras artesanais).
- A janela cria o **produto final** no grupo da tira **e** grava/atualiza a **receita
  artesanal** com a **base escolhida** (NAPA MADRID por padrão quando aplicável), marcando
  `is_artisanal = true`.
- **Base por cor**: registrar a base daquela cor sem sobrescrever a base das outras cores
  do mesmo tipo. As duas bases coexistem.
- **Checagem de cobertura ao vivo**: avisar se a napa base **não** tem a cor escolhida.
- **Cadastro em lote** das demais cores de tira sem estoque do mesmo PV, na mesma base.
- **Resolução de base por cor** no débito/consumo/custeio: consumir a base correta
  (NAPA MADRID vs NAPA SOFT) conforme a cor, sem quebrar as cores que só existem numa base.
- Preview de design aprovado (artifact) espelhando o visual do app (tokens/shadcn).

### Out of scope (explicitly not now)
- Trocar o guard de bloqueante para não-bloqueante (o usuário optou por **manter a trava** e
  dar esse caminho de cadastro como escape).
- Escolher a base **por OS na hora de produzir** (picker de base no `produceArtisanalOutput`).
  A base padrão por cor é gravada no cadastro; um seletor de base na produção fica como
  follow-up, só se o chão de fábrica precisar alternar caso a caso.
- Deduplicar/normalizar as cores da NAPA SOFT (`CAPUCCINO`/`CAPPUCCINO`, `DÁLIA`) — é
  higiene de dados separada (anotar, não corrigir aqui).
- Backfill retroativo de PVs antigos travados (corrigem-se reabrindo + salvando, como no
  padrão do projeto).
- Mexer no fluxo das tiras **compradas prontas** (sem base/receita) — continuam válidas.

## Requirements
1. No aviso âmbar "Cores das Tiras" do item do PV, o botão `Cadastrar "{cor}"` abre a nova
   janela **"Cadastrar Tira Artesanal"** (não o dialog simples atual) quando o grupo da tira
   é artesanal (ou quando o usuário escolhe uma base).
2. A janela abre **pré-preenchida** com: tipo/grupo da tira, cor (da tira do PV, editável),
   nome derivado `"{tipo}: {COR}"`, SKU derivado, unidade travada em `m`, preço herdado do
   último produto do grupo, estoque inicial `0`, localização.
3. A janela tem uma seção **"Receita de produção (artesanal)"** com: seletor de **base**
   (grupo de matéria-prima), rendimento (m saída / m base), largura de corte (mm), custo
   MO/metro, terceirizado padrão — herdando defaults da receita existente do tipo quando
   houver.
4. A **base** vem **pré-selecionada como NAPA MADRID** quando a cor existir em NAPA MADRID;
   o usuário pode trocar para NAPA SOFT (ou outra) pelo seletor.
5. **Cobertura de base ao vivo**: se a base escolhida **não** tiver a cor selecionada
   cadastrada como produto, mostrar aviso âmbar explicando que a produção travará por falta
   de MP e como resolver (cadastrar a napa base nessa cor OU trocar de base). Verde quando
   coberta. Não deve **impedir** o cadastro do produto final (o aviso é informativo).
6. Ao confirmar, em **uma transação lógica**, o sistema:
   (a) cria o produto final ativo no grupo da tira com a cor (idempotente: se já existe na
   cor, reaproveita e segue); (b) marca `is_artisanal = true`; (c) grava a associação
   **(tipo de tira + cor) → base** com rendimento/largura/MO/terceirizado.
7. **A trava do PV deixa de disparar** para aquela cor imediatamente após o cadastro (as
   query keys de cores/produtos são invalidadas; o `strapMissing` recalcula e some).
8. **Cadastro em lote**: botão "Cadastrar todas (N)" cria todas as cores de tira sem estoque
   do PV usando a base selecionada, pulando as que já existem e reportando criadas/puladas/erros.
9. **Base por (tipo+base) coexistindo**: cadastrar CAPUCCINO com base NAPA MADRID cria uma 2ª
   receita `Tira chata 8mm — NAPA MADRID` **sem** tocar na receita `NAPA SOFT` existente. A
   base efetivamente consumida é escolhida na **criação da OS** (picker de receita). Nenhuma
   cor existente muda de base sem ação explícita. **Sem migration/trigger** — o débito já lê a
   base da receita da OS.
10. Só **uma** unidade-base por produto final: a tira final é **um** produto por `(tipo, cor)`
    (não um por base). A base é atributo da receita/produção, não gera produto duplicado.
11. Seguir convenções do projeto: pt-BR no domínio, tokens de design (sem cores hardcoded),
    ícones `@phosphor-icons/react`, `sonner` para toasts, mobile-first (360px), acesso a dados
    via hooks/React Query, typecheck `bunx tsc -p tsconfig.app.json --noEmit` limpo.

## Data model / Domain
**Decisão de modelo (fechada na implementação): (B) receita por (tipo+base), SEM migration.**
O modelo (A) "override por cor" foi descartado porque o débito **já resolve a base pela
receita escolhida na OS** — não precisa de nova tabela nem de mudar resolvers.

Entidades envolvidas:

- **`products`** — produto final da tira (grupo = largura, ex. `Tira chata 8mm`; `color`;
  `unit='m'`; `is_artisanal`). Fonte única de cor. É o que o guard do PV checa e o que a
  produção da OP debita (`debit_strap_stock`).
- **`product_groups`** — grupos de tira (larguras) e grupos de base (`NAPA MADRID`,
  `NAPA SOFT`). `is_color_agnostic=false` nos dois.
- **`artisanal_recipes`** — `artisanal_product_name` (= **nome exato do grupo da tira**),
  `base_product_name` (nome do **grupo** base), `yield_per_meter`, `cut_width_mm`,
  `labor_cost_per_meter`, `default_contractor_id`, `active`. **Não há unique em
  `artisanal_product_name`** → um mesmo tipo pode ter **2 receitas** (uma por base).

**Por que "mesma tira em duas bases" funciona sem SQL novo (auditado no banco 21/07):**
- O débito da **base** só ocorre ao **PRODUZIR** a tira (OS artesanal), via
  `tg_debit_service_order_base`, que lê `service_orders.artisanal_recipe_id` → a **base
  daquela receita**. A OS é criada escolhendo a receita (o picker em `Contractors.tsx`
  mostra `{nome} — {base} → {tipo} ({yield}×)`, então 2 receitas do mesmo tipo são
  distinguíveis). Logo a base é escolhida por OS; ter 2 receitas coexistindo é suficiente.
- `findProductByNameColor` casa a saída da OS pelo **grupo cujo nome == `artisanal_product_name`**
  → por isso a receita nova grava `artisanal_product_name = groupName` (exato).
- A **OP** consome só o produto final da tira (não a base) → só precisa do produto existir.

**Escrita do cadastro (frontend, `CreateStrapProductDialog`):** (1) cria o produto final no
grupo da tira; (2) `is_artisanal = true`; (3) **upsert idempotente** da receita `(tipo, base)`
— cria só se não existir uma com mesmo `(artisanal_product_name, base_product_name)` normalizados
(`unaccent`+`lower`), preservando as receitas de outras bases. Matching de base/cor é
acento/caixa-insensível (`normKey`), por causa de `DÁLIA`/`DALIA` e `CAPUCCINO`/`CAPPUCCINO`.
Ver [[artisanal-strap-debit-flow]], [[project_straps_in_costing_mrp]].

## User flows

### Happy path (uma cor)
1. Vendedor monta o PV; um item tem tira `Tira chata 8mm` com cor `CAPUCCINO` que não existe
   no estoque dessa largura → caixa âmbar "Cores das Tiras" mostra ⚠ e botão `Cadastrar "CAPUCCINO"`.
2. Clica → abre **"Cadastrar Tira Artesanal"** pré-preenchida (produto final + receita; base
   = NAPA MADRID; cobertura verde ✓).
3. Ajusta o que quiser (preço, rendimento, terceirizado) e clica **"Cadastrar e continuar"**.
4. Sistema cria o produto final, marca artesanal, grava a base da cor; toast de sucesso.
5. O aviso âmbar some para aquela cor; vendedor salva o PV normalmente.

### Lote
1. O PV tem várias cores de tira sem estoque (ex. CAPUCCINO + ROCHA).
2. Na janela, a faixa de lote lista as demais cores; usuário marca as que quer.
3. "Cadastrar todas (N)" cria todas na base selecionada; toast: "N cor(es) cadastrada(s),
   M já existiam".

### Alternate / edge flows
- **Cor não coberta pela base**: escolhe cor/base cuja napa não tem a cor → aviso âmbar de
  cobertura. Pode cadastrar mesmo assim (produto final entra), mas a produção avisará depois;
  ou troca a base para uma que cobre.
- **Produto já existe na cor**: cadastro é idempotente — reaproveita, invalida caches, fecha.
- **Tipo sem receita nenhuma ainda**: cria a primeira receita para aquele tipo com a base
  escolhida.
- **Tira comprada pronta (não artesanal)**: usuário desliga o toggle "É artesanal" → cria só
  o produto final (comportamento do `CreateStrapProductDialog` atual), sem receita/base.

## Edge cases & failure modes
- **Cor com grafia divergente na base** (`CAPPUCCINO`) → o match de cobertura usa
  `unaccent+lower`; ainda assim, se houver duplicata real na base, escolher a canônica e não
  criar produto de tira em grafia inconsistente.
- **`is_color_agnostic` no grupo da tira** → não é o caso das tiras atuais, mas se algum grupo
  for base/agnóstico, o guard já ignora; a janela não deve abrir para esses.
- **Concorrência / duplo clique** → criação idempotente por `(group_id, color)`; retry de SKU
  duplicado (`23505`) como no dialog atual.
- **Falha parcial no lote** → reportar por cor (criadas/puladas/erros); não abortar tudo por
  uma falha.
- **Reserva/estoque** → produto nasce com estoque inicial 0 → aparece como ruptura no consumo
  (correto); a produção via OS artesanal repõe.
- **Débito com base errada** (regressão principal a evitar) → a resolução por cor tem que
  garantir que CAPUCCINO em NAPA MADRID debita NAPA MADRID e não NAPA SOFT (e vice-versa).

## Constraints & assumptions
- Stack: React + Vite + shadcn + Supabase; hooks/React Query para dados; `sonner` p/ toasts;
  ícones phosphor; tokens de design (rodar `npm run check:tokens`); mobile-first 360px.
- Typecheck canônico `bunx tsc -p tsconfig.app.json --noEmit` limpo; `npm run build` compila.
- Migrations em `supabase/migrations/**` com timestamp **maior que a última aplicada**
  (ver [[project_migration_version_must_exceed_remote_max]]); aplicar via MCP e registrar.
- **Decisão implementada:** modelo **(B) receita por (tipo+base)**, **frontend-only, sem
  migration** — o débito já resolve a base pela receita da OS (auditado no banco).
- **Assunção:** a janela é acessível **a partir do PV** (aviso âmbar), reusando o
  `CreateStrapProductDialog` (agora com seção "Produção artesanal"). O dialog artesanal de
  Estoque (`ArtisanalProductDialog`) permanece como está para cadastro fora do PV.
- **Assunção:** guard do PV continua **bloqueante**; esta janela é o caminho rápido de resolver.

## Open questions
- Modelo de base por cor: **(A) tabela de override por cor** vs **(B) receita por (tipo+base)** —
  decidir pelo menor risco nos resolvers de débito/MRP durante a implementação.
- Precisa de seletor de base **na hora de produzir a OS** (quando a cor existe nas duas bases
  com estoque)? Fora do escopo v1; confirmar se surge necessidade real.

## Adendo — Editor de receita multi-base (Terceirizados › Receitas)
Decisão do usuário (21/07): a base é escolhida **no editor de receita artesanal**
(`ArtisanalRecipes.tsx`), e o **rendimento pode mudar por base** (NAPA MADRID ainda com
largura 0mm; NAPA SOFT 1000mm). Implementado:
- O editor deixou de ter **uma** base; agora tem uma **lista de bases** (grupo + rendimento +
  MO por base). Campos compartilhados (tipo/produto artesanal, largura de corte, tempo base,
  terceirizado, notas, ativa) valem pra todas as bases.
- Ao salvar, **materializa uma receita-irmã por base** (upsert idempotente por `(tipo, base)`
  normalizado; apaga as irmãs cujo base foi removido). Mantém o modelo (B) — o débito da OS
  já resolve pela receita escolhida, **sem migration/trigger**.
- Na OS de produção, o picker de receita lista cada base (com rendimento); ao produzir, o
  débito baixa a napa daquela base **na cor da tira** (`tg_debit_service_order_base` casa
  base group + cor). Nenhuma base existente muda sem ação explícita.
- Editar qualquer linha da lista carrega **todas** as bases daquele tipo (reconciliação).

## Definition of Done
- [ ] **Req 1-2**: No PV, clicar `Cadastrar "{cor}"` numa tira sem estoque abre a janela
      "Cadastrar Tira Artesanal" pré-preenchida — verificado abrindo um PV com tira CAPUCCINO
      numa largura sem essa cor.
- [ ] **Req 3-4**: A janela mostra a seção de receita com base **NAPA MADRID** pré-selecionada
      para uma cor que existe nela; herda rendimento/largura da receita do tipo — verificado
      visualmente.
- [ ] **Req 5**: Trocar para uma base/cor sem cobertura mostra aviso âmbar; voltar para uma
      coberta mostra verde — verificado alternando cor/base na janela.
- [ ] **Req 6-7**: Confirmar cria o produto final (`SELECT` em `products` mostra a cor com
      `is_artisanal=true`) + a associação de base por cor, e **o PV salva** sem o toast de
      bloqueio — verificado salvando o PV logo após.
- [ ] **Req 8**: "Cadastrar todas (N)" cria as demais cores do PV na base escolhida; toast
      reporta criadas/puladas — verificado com um PV com ≥2 cores faltantes.
- [ ] **Req 9**: Cadastrar CAPUCCINO com base NAPA MADRID cria a 2ª receita
      `Tira chata 8mm — NAPA MADRID` e **não** altera a receita NAPA SOFT (`SELECT * FROM
      artisanal_recipes WHERE lower(artisanal_product_name)='tira chata 8mm'` mostra as duas).
      Ao criar a OS de produção, o picker lista as duas bases e o débito baixa a escolhida —
      verificado em Terceirizados › OS artesanal.
- [ ] **Req 10**: Não há produto de tira duplicado por base — `SELECT` mostra 1 produto por
      `(grupo, cor)`.
- [ ] **Req 11**: `check:tokens` sem violações novas; `bunx tsc -p tsconfig.app.json --noEmit`
      limpo; `npm run build` ok.
- [ ] Guard permanece bloqueante para cores realmente sem produto (não regrediu para
      não-bloqueante) — verificado tentando salvar um PV com tira sem cadastro e sem usar a janela.
