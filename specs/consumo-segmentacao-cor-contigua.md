# Consumo — segmentação por Cor com materiais contíguos (sem repetir cabeçalho)

## Goal
Corrigir a **segmentação por clique** da tela de consumo de materiais para que,
ao agrupar por **Cor** (e por **Grupo de material**), cada valor apareça em **um
único cabeçalho**, com os materiais diferentes daquele valor listados **um logo
abaixo do outro** dentro dele — nunca fundindo materiais distintos, nunca
repetindo o nome da cor em vários cabeçalhos. Serve o time de PCP/Comercial que
usa o **Consumo Consolidado** (vários PVs) para planejar compra/consumo.

## Background / Problem
A tela de **Consumo Consolidado** (`SummaryConsumptionPanel`, rota
`/sales/consumo?ids=…`, título "CONSUMO CONSOLIDADO") e o modal de consumo do PV
individual (`MaterialConsumptionDialog`) compartilham o **mesmo** componente de
apresentação `MaterialConsumptionView` e o **mesmo** motor
(`computeConsumptionForItems`). A "segmentação" é o comportamento de clicar num
cabeçalho de coluna (Grupo de material / Aplicação / Cor / Unidade) para
reagrupar as linhas por aquele valor.

Hoje, ao clicar em **"Cor ↕"**, a mesma cor aparece **duas ou mais vezes como
cabeçalho de topo**. Ex.: com PV-00145 + PV-00146, a cor **PORCELANA** existe no
**Cabedal** (grupo NAPA PALHA) e na **Forração Palmilha** (grupo NAPA SOFT). O
código quebra cada cor por **família de napa** e emite **uma seção de topo
separada por (cor × família)**, repetindo "PORCELANA" em cada cabeçalho (um com
selo `NAPA PALHA`, outro com selo `NAPA SOFT`). Para o usuário isso lê como
"PORCELANA duas vezes" e parece a segmentação "não funcionar".

O usuário **concorda** que materiais diferentes não podem ser fundidos numa linha
só apesar de terem a mesma cor (NAPA PALHA ≠ NAPA SOFT), mas quer que apareçam
**agrupados sob um único cabeçalho da cor**, um após o outro. A visão por
**Grupo de material** já se comporta assim (um cabeçalho por grupo, cores
diferentes listadas dentro); só a visão por **Cor** está quebrada.

### Causa raiz (identificada na leitura do código)
`src/components/sale-orders/MaterialConsumptionView.tsx`, no `useMemo` `grouped`
(≈ linhas 337–397), função interna `emitSection` (≈ 369–383): quando `key ===
'color'`, para cada cor ela cria **uma entrada de seção por família** com a chave
`` `${label}${SECTION_SEP}${f}` `` (mais uma seção "neutra" com a própria cor).
O render (≈ 715–740) divide `componentType` por `SECTION_SEP` em
`[secLabel, secFamily]` e desenha **um cabeçalho por seção** com `secLabel` (a
cor) + badge `secFamily`. Resultado: N cabeçalhos repetindo a mesma cor.

## Scope
### In scope
- Ajustar a segmentação **por Cor** em `MaterialConsumptionView` para produzir
  **um único cabeçalho por cor**, com os materiais/famílias diferentes daquela
  cor exibidos **contíguos** dentro da mesma seção (um após o outro), mantidos
  como linhas/itens **distintos** (sem merge).
- Garantir que a segmentação **por Grupo de material** siga a mesma regra
  (um cabeçalho por grupo, cores diferentes contíguas dentro) — confirmar que já
  é o caso e não regredir.
- A correção vive no **componente compartilhado**, então **as duas telas**
  (Consumo Consolidado multi-PV e modal do PV individual) passam a se comportar
  igual — é o resultado desejado (consistência).

### Out of scope (explicitamente não agora)
- **Filtros com dropdown** (Filtrar por Cor / Filtrar por Grupo que **escondem**
  as demais linhas). O usuário decidiu que **só segmentação** basta. Não
  reintroduzir os `groupFilter`/`colorFilter`/abas removidos no commit `ef42fdd`.
- **Recalcular os totais do topo** conforme o agrupamento. Os totais
  (`6.967,20 m · 5.016 par · … · N itens · N em falta`) permanecem **globais**
  (todos os PVs), independentemente da segmentação. (Já é assim — preservar.)
- Qualquer mudança no **motor de cálculo de consumo** (`orderConsumption.ts`) ou
  na **chave de merge** de linhas (`orderConsumption.ts:414`) — o problema é de
  **apresentação/agrupamento**, não de cálculo.
- Migração de banco (não há).
- Mudança no PDF ("Gerar PDF") — só a visão em tela da segmentação.

## Data model / Domain
- **Nenhuma migração de banco.** Mudança puramente de frontend/apresentação.
- Linha de consumo = `ConsumptionRow` (`src/lib/consumptionRows.ts`), campos
  relevantes: `componentType`, `groupName`, `materialName` (aplicação), `color`,
  `productUnit`, `materialFamily`, `totalQuantity`, `available`/`soleSizeStock`.
- Motor `computeConsumptionForItems` (`src/lib/orderConsumption.ts`) agrega
  linhas idênticas pela chave
  `componentType||groupName||materialName||color||productUnit||materialFamily`
  (linha 414). Material idêntico vindo de PVs diferentes **soma** (não duplica).
  Portanto materiais **diferentes** (grupos/famílias diferentes) permanecem
  **linhas distintas** por design — a correção **não** deve fundi-los.
- `rowFamily` (MaterialConsumptionView ≈ 51–58) define a "família" de uma linha
  (napa: o próprio grupo quando casa `BASE_GROUP_PATTERN`; tiras:
  `materialFamily`; demais: `null`). Hoje é usada para criar seções separadas;
  passa a ser, no máximo, um **sub-rótulo dentro** da seção da cor.
- Ordenação canônica de materiais dentro de uma seção: `COMPONENT_ORDER` → grupo
  → aplicação → cor (função `sortWithin`, ≈ 348–355). Mantida.

## User flows
### Happy path — Consumo Consolidado, agrupar por Cor
1. Usuário seleciona ≥2 PVs (ex.: PV-00145 + PV-00146) e abre **Consumo
   Consolidado**. Vê a visão padrão agrupada por componente (CABEDAL, PALMILHA,
   FORRAÇÃO PALMILHA…).
2. Clica no cabeçalho **"Cor ↕"**.
3. A lista reagrupa por cor: **um cabeçalho por cor**. Dentro de **PORCELANA**,
   aparecem NAPA PALHA (Cabedal) e NAPA SOFT (Forração Palmilha) como
   linhas/blocos separados, **um abaixo do outro**. Não existe um segundo
   cabeçalho "PORCELANA".
4. Clica de novo em "Cor" → inverte a ordem (desc); clica de novo → volta ao
   agrupamento padrão por componente. (Comportamento de toggle atual preservado.)

### Happy path — agrupar por Grupo de material
1. Clica em **"Grupo de material ↕"**.
2. Um cabeçalho por grupo (ex.: NAPA SUDANI), com as cores diferentes daquele
   grupo (CAPUCCINO, COGUMELO…) listadas contíguas dentro. (Já funciona; não
   regredir.)

### Modal do PV individual
- O mesmo clique em "Cor"/"Grupo" no modal individual produz o mesmo layout
  (um cabeçalho por valor, materiais contíguos). Como só há 1 PV, normalmente há
  menos casos de mesma cor em famílias diferentes, mas quando houver, o
  comportamento é idêntico ao consolidado.

## Edge cases & failure modes
- **Cor com um só material** → um cabeçalho, uma linha. Sem badges de família
  redundantes.
- **Cor presente em ≥2 famílias/grupos** (NAPA PALHA + NAPA SOFT em PORCELANA) →
  um cabeçalho da cor, os dois materiais contíguos dentro, **distintos**
  (nunca somados numa linha só).
- **Materiais sem família** (não-napa, não-tira: placa de palmilha, químicos,
  binóculos, embalagem) → entram na mesma seção da cor como linhas normais,
  contíguos; não somem e não são fundidos com materiais de grupo diferente
  (a agregação por `grupo||cor||unidade` já separa em bandas).
- **Linhas sem cor** (`color` vazio/`—`) → seção "Sem cor" no topo, como hoje.
- **Solado** → continua renderizado pela matriz por numeração (`SoleSection`);
  a mudança de agrupamento por Cor não deve quebrar a seção Solado.
- **Mesma cor, mesmo grupo, mesma aplicação, vinda de 2 PVs** → já **somada**
  pelo motor (chave 414); deve aparecer como **uma** linha (com band de "Total do
  item" se houver múltiplas aplicações). Não pode reaparecer duplicada.
- **Totais do topo** não mudam ao segmentar (invariante).
- **Contagem "em falta" por seção** (`countShort`) passa a refletir a seção-cor
  inteira; conferir que soma bate com o total global.

## Constraints & assumptions
- **Componente compartilhado**: a fonte única é
  `src/components/sale-orders/MaterialConsumptionView.tsx`. Não recriar lógica de
  agrupamento nos wrappers (`SummaryConsumptionPanel`, `MaterialConsumptionDialog`).
- **Design tokens** obrigatórios (nada de cores hardcoded na tela). Rodar
  `npm run check:tokens` após edits visuais.
- **Sem migração** e **sem tocar** no motor/SQL de consumo.
- **Idioma pt-BR**, unidades canônicas, formatação `Intl.NumberFormat('pt-BR')`
  (helpers já usados no componente).
- **Typecheck canônico** antes de commit:
  `bunx tsc -p tsconfig.app.json --noEmit` (a raiz não checa `src/`).
- **Assunção (default escolhido):** dentro da seção de uma cor, quando houver
  materiais de famílias/grupos diferentes, cada material é identificado pela
  coluna **"Grupo de material"** (e pela band "Total do item" quando tiver várias
  aplicações). Um **sub-rótulo/divisória leve** por material dentro da cor é
  **opcional** — só adicionar se a separação visual ficar fraca; não é requisito
  duro. A tabela já tem a coluna de grupo, que satisfaz o mock do usuário.
- **Assunção:** o toggle atual (asc → desc → sem agrupamento) e os ícones de
  ordenação (`SortIcon`) permanecem inalterados.

## Open questions
- Precisa de um **sub-rótulo/divisória** por material dentro da seção da cor
  (além da coluna "Grupo de material"), ou a coluna já basta? → Default: coluna
  basta; adicionar divisória só se, ao construir, a leitura ficar ambígua.

## Definition of Done
- [ ] **Uma cor = um cabeçalho.** No Consumo Consolidado com PV-00145 + PV-00146,
      clicar em "Cor" mostra **um único** cabeçalho "PORCELANA" (não dois) —
      verificado visualmente na tela.
- [ ] **Materiais distintos, contíguos.** Dentro de "PORCELANA", NAPA PALHA
      (Cabedal) e NAPA SOFT (Forração Palmilha) aparecem como
      linhas/blocos **separados**, **um logo abaixo do outro**, sem serem
      fundidos numa linha só e sem estarem espalhados por outras cores —
      verificado na tela.
- [ ] **Grupo mantém o padrão.** Clicar em "Grupo de material" mostra um
      cabeçalho por grupo com as cores contíguas dentro; nada regrediu —
      verificado na tela.
- [ ] **Paridade individual × consolidado.** Abrir o modal de consumo de um PV
      individual que tenha a mesma cor em duas famílias e clicar em "Cor" produz
      o mesmo layout (um cabeçalho por cor) — verificado na tela.
- [ ] **Totais globais preservados.** A faixa de totais do topo
      (`… m · … par · … · N itens · N em falta`) **não muda** ao alternar entre
      agrupamento padrão / por Cor / por Grupo — verificado na tela.
- [ ] **Sem duplicata real.** Nenhuma linha idêntica (mesmo grupo+cor+aplicação+
      unidade) aparece duas vezes em nenhum modo de agrupamento — verificado na
      tela com os 2 PVs.
- [ ] **Sem filtros/dropdown novos** e **sem recálculo de totais** foram
      introduzidos (escopo respeitado) — verificado no diff.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo e `npm run check:tokens`
      sem violações novas.
