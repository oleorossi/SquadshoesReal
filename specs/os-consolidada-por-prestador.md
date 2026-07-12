# OS consolidada por prestador (contêiner + linhas)

## Goal
Parar de criar uma Ordem de Serviço (OS) nova a cada demanda de terceirização e
passar a **acumular todas as novas demandas do mesmo prestador numa única OS
aberta** (contêiner), com **linhas** que listam cada serviço + o PV e a OP de
origem. A OS trava quando o material é **Enviado**, e a **entrega é por linha**
(entrega parcial), firmando o **contas a pagar por linha entregue**. Serve o setor
de terceirização/PCP, que hoje afoga na lista de OS (7 OS só de tiras de um PV/um
prestador — ver print).

## Background / Problem
Hoje há vários fluxos que criam OS, cada um gerando **uma OS por demanda**:
- **Tiras artesanais** (`StrapShortageDialog`) → 1 OS por tira (o print: OS-00365…371,
  todas FÁBRICA · PV-00145, uma por TIRA 1/2/3/5/TRASEIRA…).
- **OP×setor** (`generate_op_service_orders`, mig 20260703120000) → 1 OS por OP×setor
  (constraint `uq_os_per_op_sector`).
- **Avulso** (`useAvulso`) → 1 OS manual.

Resultado: a lista de OS explode com dezenas de OS minúsculas do mesmo prestador,
impossível de gerir/enviar/pagar. O modelo `service_orders` é **flat** (um
`sale_order_id`, um `order_id`, um `material_name`/`description` por OS).

## Scope

### In scope
- **Modelo contêiner + linhas**: `service_orders` vira o contêiner por prestador;
  nova tabela `service_order_items` guarda cada demanda (linha) com seu PV, OP,
  setor/serviço, material, quantidade, preço e status de entrega.
- **Uma OS ABERTA por prestador**: qualquer demanda nova (tira, OP×setor, avulso) do
  mesmo prestador vira **linha** na OS aberta dele; se não houver OS aberta, cria uma.
- **Ciclo de vida do contêiner**: `Pendente` (aberta, acumula) → **`Enviada`**
  (material enviado, TRAVA — demandas novas do prestador abrem uma OS nova) →
  `Concluída` (quando TODAS as linhas foram entregues). `Cancelada` cobre o descarte.
- **Entrega por linha (parcial)**: cada linha pode ser marcada `Entregue`
  individualmente; a OS conclui quando todas as linhas entregarem.
- **Financeiro por linha na entrega**: ao entregar uma linha, firma o valor
  (tarifa × qtd) em **contas a pagar** daquela linha. Linha não entregue não paga.
- **Cabeçalho lista todos os PVs e todas as OPs** contidos (conjunto distinto das
  linhas), como pedido.
- **Migração one-time**: consolidar as OS **Pendentes** existentes do mesmo prestador
  numa OS aberta com as respectivas linhas. Enviadas/Concluídas ficam intactas.
- Adaptar os 3 fluxos de criação (`StrapShortageDialog`, `generate_op_service_orders`,
  `useAvulso`) pra "find-or-create OS aberta do prestador → inserir linha".
- Adaptar a UI de Terceirizados (`Contractors.tsx`): OS como cabeçalho expansível com
  linhas; badge de status; PVs/OPs no cabeçalho; envio por OS, entrega por linha.

### Out of scope (explicitly not now)
- Cotação/orçamento pré-execução do fluxo de **gargalos** (`pending_quote`/`quoted`)
  — mantém o comportamento atual; não faz parte da consolidação.
- Reagrupar por tipo de serviço/setor (foi decidido **1 OS por prestador**, tudo junto).
- Pagamento parcial dentro de uma linha (uma linha = paga inteira na entrega).
- Reescrever o fluxo de **remessa/PDF** de OS (só garantir que ele lê o novo modelo).

## Requirements
Numerados, testáveis, cada um é um "must".

1. Existe a tabela **`service_order_items`** com, no mínimo: `id`,
   `service_order_id` (FK → service_orders, ON DELETE CASCADE), `sale_order_id`
   (FK sale_orders, nullable), `order_id` (FK orders/OP, nullable), `target_sector`
   / `sector` (text, nullable), `material_name`/`description` (text), `quantity`
   (numeric), `unit_price` (numeric), `total_value` (numeric),
   `delivered_at` (timestamptz null), `delivered_qty` (numeric null),
   `line_status` (text: `Pendente`|`Entregue`|`Cancelado`), `source_item_key`
   (text, pra idempotência), `created_at`.
2. **Uma OS aberta por prestador**: garantido por índice único parcial em
   `service_orders(contractor_id)` quando o status é do conjunto **aberto**
   (`Pendente`) — não pode haver 2 OS abertas pro mesmo contractor.
3. Ao chegar uma demanda de terceirização de um prestador, o sistema faz
   **find-or-create** da OS aberta desse prestador e **insere uma linha**
   (`service_order_items`). Não cria OS nova se já existe uma aberta.
4. **Idempotência**: reprocessar a mesma demanda (mesma `source_item_key`) **não**
   duplica a linha. (Substitui o papel do `uq_os_per_op_sector`, que passa a valer
   por linha dentro da OS aberta.)
5. Marcar a OS como **`Enviada`** trava o contêiner: novas demandas do prestador
   **não** entram mais nela — abrem/entram numa OS aberta nova. O envio é por OS
   inteira (todas as linhas juntas).
6. **Entrega por linha**: marcar uma linha `Entregue` grava `delivered_at`,
   `line_status='Entregue'`, e **firma o contas a pagar** da linha (tarifa × qtd via
   `contractor_service_rates`; sem tarifa → R$ 0 + aviso, como hoje).
7. A OS vira **`Concluída`** automaticamente quando **todas** as linhas não-canceladas
   estão `Entregue`.
8. O **cabeçalho** da OS expõe o conjunto **distinto** de números de PV e de OP das
   suas linhas (ex.: "PV-00145, PV-00146 · OP-…01, OP-…07"). Visível na UI e no
   PDF/remessa.
9. `total_value` do cabeçalho = soma dos `total_value` das linhas
   (não-canceladas). O contas a pagar total = soma das linhas entregues.
10. **Migração one-time** (idempotente): pra cada prestador, junta as
    `service_orders` com status **Pendente** numa OS aberta (a mais antiga vira o
    contêiner) e converte cada uma em **linha**. OS Enviadas/Concluídas/Canceladas
    ficam **intactas**. Não duplica AP nem perde vínculo de PV/OP.
11. Os 3 fluxos de criação passam a inserir **linha na OS aberta**:
    `StrapShortageDialog` (tira artesanal), `generate_op_service_orders` (OP×setor),
    `useAvulso` (avulso).
12. A UI de Terceirizados mostra a OS como **cabeçalho expansível** (prestador,
    status, PVs/OPs, total, nº de linhas) com as **linhas** dentro; ação de **enviar**
    por OS e **entregar** por linha. Sem quebrar filtros/métricas existentes.

## Data model / Domain

### `service_orders` (contêiner — existente, ajustado)
- Mantém: `id, contractor_id, order_number, status, service_date, notes,
  created_at, updated_at, dispatch_tracked, is_avulsa`.
- **Deprecar (manter nullable p/ back-compat)**: `sale_order_id, order_id,
  target_sector, sector, material_name, description, quantity, unit_price,
  source_sale_order_id, source_item_key` — a verdade das demandas migra pras linhas.
  (Consumidores legados que leem esses campos continuam funcionando; novos leem linhas.)
- `total_value` passa a ser derivado/atualizado por trigger a partir das linhas.
- **Status canônicos** (`osStatusMachine.ts`): hoje `enviada`→`Em Andamento`. Decidir
  se `Enviada` vira status de 1ª classe (Open question) — funcionalmente é o **gate
  de trava**. `Pendente`=aberta; `Enviada`=travada/em execução; `Concluída`=tudo entregue.

### `service_order_items` (novo — as linhas)
Ver requisito 1. Uma linha = uma demanda (tira/serviço/OP×setor/avulso). `line_status`
governa a entrega parcial; `delivered_at`/`delivered_qty` alimentam o financeiro.

### Índices/constraints
- **Único parcial** `service_orders(contractor_id) WHERE status ∈ {aberto}` → 1 OS
  aberta por prestador.
- **Único** `service_order_items(service_order_id, source_item_key)` (ou
  `(order_id, target_sector)` por OS) → idempotência (substitui `uq_os_per_op_sector`;
  o índice antigo é **dropado** ou reescopado pra linha).

### Financeiro
- `contractor_service_rates` (tarifa) resolve `unit_price` da linha. Entrega da linha
  → `accounts_payable` (mesma trilha de `ServiceOrderReturnDialog`/`useContractors`,
  agora por linha). Sem tarifa → R$ 0 + toast (comportamento atual do StrapShortage).

## User flows

### Happy path
1. Um PV é aprovado / uma tira falta / um OP×setor é terceirizado → gera demanda pro
   prestador **FÁBRICA**.
2. Sistema acha a **OS aberta** de FÁBRICA (ou cria `OS-00365` Pendente) e insere a
   **linha** (PV-00145 · OP-…01 · TIRA 1 OFF WHITE, qtd, tarifa).
3. Chegam mais demandas de FÁBRICA (outras tiras, uma costura de PV-00146) → viram
   **novas linhas na MESMA OS-00365**. O cabeçalho passa a listar PV-00145, PV-00146
   e as OPs.
4. Operador **envia o material** → OS-00365 vira **Enviada** (travada). Uma demanda
   nova de FÁBRICA depois disso abre **OS-00390** (aberta).
5. Prestador devolve a TIRA 1 pronta → operador marca a **linha Entregue** →
   `line_status=Entregue`, firma **contas a pagar** dessa linha.
6. Quando **todas** as linhas de OS-00365 estão Entregues → OS-00365 vira **Concluída**.

### Alternate / edge flows
- **Sem OS aberta** → cria uma nova Pendente e insere a 1ª linha.
- **Demanda repetida** (mesmo `source_item_key`) → não duplica linha (req 4).
- **Cancelar linha** → `line_status=Cancelado`; não conta pra conclusão nem paga.
- **Cancelar a OS inteira** → status `Cancelada`; linhas canceladas.
- **Migração**: as 7 tiras Pendentes de FÁBRICA → OS-00365 (a + antiga) com 7 linhas.

## Edge cases & failure modes
- **Concorrência no find-or-create**: dois inserts simultâneos criando a OS aberta →
  o índice único parcial (req 2) faz um falhar; tratar com `ON CONFLICT`/retry pra
  cair na OS existente (não estourar erro pro usuário).
- **Prestador sem tarifa** → linha entra com `unit_price=0`; entrega firma AP R$ 0 +
  aviso pra cadastrar tarifa (não bloquear).
- **Envio com a OS vazia** (0 linhas) → bloquear/avisar (nada pra enviar).
- **Entregar linha de OS ainda Pendente (não enviada)** → decidir: permitir só a
  partir de Enviada? (Open question) — provável: só entrega o que foi enviado.
- **Migração com FK órfã** (PV/OP cancelado) → linha migra mesmo assim; não abortar o
  lote (padrão do projeto: DO/EXCEPTION FK-safe).
- **Métricas/relatórios de contratado** que somam por `service_orders` → revisar pra
  somar por **linhas** (senão subcontam após consolidação).
- **`dispatch_tracked`/remessa/PDF** — garantir que leem o novo modelo (linhas).

## Constraints & assumptions
- Stack: Supabase (Postgres + RLS) · React + TS · **PT-BR** · datas `dd/MM/yyyy` ·
  moeda `R$ 0.000,00` · mobile-first 360px · **design tokens** (`check:tokens`).
- Migrations em `supabase/migrations/` (aplicar via MCP/pipeline); idempotentes.
  RLS: `service_order_items` precisa de policies `is_approved_user()` (ver bug de
  `box_types` — RLS ligado sem policy quebra INSERT).
- Typecheck real: `bunx tsc -p tsconfig.app.json --noEmit`.
- **Assumption (default):** `Enviada` = status de 1ª classe visível (o print já mostra
  o badge ENVIADA); `osStatusMachine` ganha o gate de trava. Confirmar no build.
- **Assumption:** entrega de linha só a partir de `Enviada` (não se entrega o que não
  foi enviado). Ajustável.
- **Assumption:** o cabeçalho deriva PV/OP das linhas em runtime (ou via view), não
  duplica os números numa coluna.
- **Não tocar**: fluxo de gargalos/cotação; o débito de matéria-prima artesanal
  (`tg_debit_service_order_base`) — só garantir que dispara por linha, não por OS.

## Open questions
- **`Enviada` como 5º status canônico** vs. sub-estado de `Em Andamento`? Default:
  1ª classe (gate de trava). Confirmar.
- **Entrega antes do envio**: permitir marcar linha Entregue só quando a OS está
  Enviada? Default: sim (só entrega o enviado).
- **Débito de matéria-prima artesanal**: hoje dispara na criação da OS de tira; com
  linhas, dispara **por linha** (confirmar que não duplica nem some).
- **`order_number` da OS**: mantém a numeração sequencial no cabeçalho; as linhas não
  têm número próprio (usam PV/OP). Confirmar.

## Definition of Done
- [ ] `service_order_items` existe com as colunas do req 1 — verificado por `\d`/`SELECT`. 
- [ ] Não é possível ter 2 OS abertas pro mesmo prestador — verificado tentando criar
      a 2ª (índice único parcial barra) / por `SELECT contractor_id, count(*) … WHERE
      status='Pendente' GROUP BY 1 HAVING count(*)>1` retornando 0. (Req 2)
- [ ] Gerar 3 demandas de tira do mesmo prestador cria **1** OS com **3 linhas**
      (não 3 OS) — verificado na tela de Terceirizados. (Req 3, 11)
- [ ] Reprocessar a mesma demanda não cria linha duplicada. (Req 4)
- [ ] Marcar a OS **Enviada** trava: a próxima demanda do prestador abre uma OS nova
      (não entra na travada). (Req 5)
- [ ] Marcar **uma linha** Entregue firma **um** contas a pagar (tarifa×qtd) e não
      conclui a OS enquanto houver linha pendente. (Req 6, 9)
- [ ] Entregar a **última** linha vira a OS `Concluída`. (Req 7)
- [ ] O cabeçalho mostra todos os PVs e OPs distintos das linhas (UI + PDF). (Req 8)
- [ ] Migração: as OS Pendentes de um prestador viram 1 OS + N linhas; Enviadas/
      Concluídas intactas — verificado por `SELECT` antes/depois. (Req 10)
- [ ] `check:tokens` limpo, layout ok em 360px, `tsc -p tsconfig.app.json` limpo. (Req 12)
