# Remodelagem completa do setor de Produção

> Spec fechada em entrevista com o dono em 2026-07-12. Substitui o modelo de
> planejamento por Ondas semanais por um **motor dinâmico diário único**, cria a
> tela central de configuração de Setores (fonte global de verdade), a tela de
> Estouro de Produção, um Kanban de verdade com apontamento por quantidade, e
> reorganiza o menu Produção em itens diretos (sem hub gigante).

## Goal

Dar ao dono uma área de Produção **navegável, confiável e auditável**: um único
motor de cálculo que distribui pares por setor/dia, rola saldo automaticamente,
e alimenta TODAS as telas (planejamento, kanban, estouro, análises) com os
mesmos números. Hoje ele **não usa** as ferramentas existentes porque estão
confusas e ele não confia no motor.

## Background / Problem

Diagnóstico da entrevista (2026-07-12):

1. **Menu confuso e sobreposto** — o hub PCP tem 14 abas em 3 segmentos, o
   "Quadro" tem 4 modos internos, e a sidebar ainda tem 9 itens avulsos que
   abrem o MESMO hub em abas diferentes. O Kanban existe mas o dono não acha
   onde fica.
2. **Sem tela de gestão de setores** — não existe um lugar único pra definir
   fluxo, capacidade, equipe e regras; as capacidades moram espalhadas em
   colunas por ficha técnica e ficam vazias/erradas.
3. **Desconfiança no motor** — (a) telas divergem entre si (números diferentes
   pra mesma coisa), (b) capacidades erradas/vazias na base, (c) o cálculo não
   mostra COMO chegou no resultado. Existem hoje 3 motores de PCP semi-isolados
   (ondas `production_waves`, `sector_distribution_plan`, OS de terceirização).
4. **Sem balanceamento dinâmico** — se o dia planejava 600 pares e saíram 540,
   ninguém rola os 60 pra frente; se saíram 720, ninguém puxa produção futura.

## Scope

### In scope

1. **Motor dinâmico diário** (novo, único) — fila de produção por setor/dia com
   rolagem automática de saldo e recálculo em cascata.
2. **Tela "Setores"** (configuração central) — fluxo, capacidade, equipe, regras.
3. **Tela "Planejamento"** — fila diária do motor + calendário de carga por setor.
4. **Tela "Kanban"** — colunas = setores, cartões = OPs, arrastar = apontamento
   com quantidade.
5. **Tela "Estouro de Produção"** — sobrecargas por setor/dia + decisão
   (terceirizar via OS / resolver manualmente).
6. **Apontamento de chão de fábrica** — telas por setor simplificadas, mesma
   engine do Kanban, com autoria registrada.
7. **Reorganização do menu Produção** — 7 itens diretos, fim do hub de 14 abas,
   redirects de URLs legadas.
8. **Religação das Análises** — Dashboard, Gargalos, Lead Time, Capacidade,
   RCCP, Pós-OP, Auditoria, Qualidade, OEE, Cronoanálise e Setup passam a ler
   exclusivamente do motor novo (todas continuam existindo — o dono vai usar
   todas quando confiar nelas).
9. **Aposentadoria das Ondas** + migração de tudo que está aberto pro motor novo.
10. **Painel de auditoria do cálculo** — todo número derivado mostra o breakdown.

### Out of scope (explicitamente agora não)

- Capacidade derivada de pessoas × produtividade (decidido: **pares/dia direto**;
  equipe é informativa). Cronoanálise continua como ferramenta de análise, não
  alimenta a capacidade automaticamente.
- Sobrescrita de capacidade por dia específico (hora extra pontual) — o ajuste é
  editar a capacidade do setor (que recalcula tudo aberto) ou decidir no Estouro.
- CRUD de setores (criar/renomear/excluir) — lista fixa; só reordenar,
  ligar/desligar e agrupar paralelos.
- Mudanças no fluxo de criação de OP a partir do PV, reserva/débito de material,
  custeio, OS além do ponto de integração do Estouro.
- Mudanças nas fichas de impressão (worksheets) e etiquetas.
- App/tela específica de operador com login individual por funcionário (a
  autoria usa o usuário logado + campo "operador" livre, como já existe em
  `production_pointings.operator`).

## Requirements

Cada item é um "must", numerado pra rastreio no /build.

### R1 — Fonte de verdade da configuração (tela Setores)

1.1. Nova tela **Setores** (rota própria, ex. `/producao/setores`) com a lista
     fixa dos setores: Corte Palmilha, Corte Forração, Aviamento, Costura,
     Silk, Colagem, Montagem, Solagem, Acabamento, Expedição.
1.2. Por setor, configurável: **ordem no fluxo** (drag pra reordenar),
     **ativo/inativo** (toggle), **grupo de paralelismo** (setores no mesmo
     grupo rodam em paralelo — hoje: Corte Palmilha ‖ Corte Forração ‖
     Aviamento ‖ Costura como preparação), **capacidade em pares/dia** (número
     direto), **equipe** (lista informativa de pessoas/qtd de operários — não
     entra no cálculo), **regras de transição** (ver R5).
1.3. **Precedência**: se a ficha técnica da referência tem a parte de setores
     preenchida (`technical_sheets.production_sectors` e/ou capacidades
     específicas `*_capacity_per_day`), vale a ficha PARA AQUELA REFERÊNCIA.
     Se não tem nada preenchido, vale a configuração global desta tela. A UI
     de planejamento/kanban indica quando uma OP está usando override da ficha.
1.4. Salvar mudança de fluxo ou capacidade **recalcula imediatamente todas as
     OPs abertas** (não finalizadas/canceladas). Sem pergunta, sem preview —
     decisão do dono: "recalcula tudo que está aberto".
1.5. Setor desligado sai do fluxo global (OPs pulam ele), mas fichas técnicas
     com override que o citem continuam passando por ele (override vence).

### R2 — Motor dinâmico diário (substitui as Ondas)

2.1. **Entrada na fila**: toda OP entra na fila do motor **na criação**,
     ancorada na **semana de faturamento** do pedido (data de faturamento/
     entrega do PV). O motor agenda os setores pra que a OP termine dentro
     dessa semana (backward a partir do faturamento; se não couber, agenda o
     mais cedo possível e sinaliza estouro/atraso — ver R4).
2.2. **Alocação por dia**: o motor distribui pares de cada OP em cada setor
     respeitando a capacidade diária (pares/dia) do setor e a topologia
     (paralelos ‖ sequenciais). A unidade de alocação é PARES (uma OP pode
     ocupar parte de um dia e continuar no seguinte).
2.3. **Rolagem automática de saldo (backlog)**: no virar do dia, pares
     planejados e não apontados rolam pro dia seguinte **com prioridade** sobre
     o que estava planejado pra aquele dia — o excedente do dia seguinte
     empurra em cascata os próximos dias. Ex. canônico do dono: dia 1 planejou
     600, produziu 540 → os 60 entram na frente do dia 2; se o dia 2 também
     planejava 600 e produz 540, ele faz os 60 atrasados + 480 do próprio dia,
     e 120 rolam pro dia 3 — até zerar.
2.4. **Puxada automática (produção acima do plano)**: se um setor aponta MAIS
     do que o planejado do dia (ex. 720 de 600), o motor puxa pares agendados
     pra dias futuros pra hoje/amanhã, encurtando o cronograma — mesma cascata,
     na direção contrária.
2.5. **Prioridade da fila**: híbrida — ordenação automática por **data de
     entrega/faturamento do pedido** (mais apertado na frente; pares atrasados
     de dias anteriores herdam prioridade), com **override manual**: o dono
     pode fixar/pinar posição de OPs específicas e o motor respeita o pin por
     cima da ordenação automática.
2.6. **Gatilhos de recálculo**: apontamento registrado, OP criada/cancelada,
     mudança na tela Setores (fluxo/capacidade), mudança de override na ficha
     técnica, pin/despin manual, virada de dia. O recálculo é da fila inteira
     de OPs abertas e deve terminar em tempo interativo (< ~3 s pra fila atual
     de ~12 mil pares).
2.7. **Um motor só**: TODAS as telas (Planejamento, Kanban, Estouro, Análises)
     leem os mesmos dados do motor. Nenhuma tela mantém cálculo próprio de
     datas/carga. É proibido dois números diferentes pra mesma pergunta.
2.8. **Explicabilidade**: toda data planejada e toda carga de dia exibida tem
     um "como cheguei nisso" acessível (popover/painel): capacidade usada,
     origem (global × override da ficha), pares na frente da fila, saldo
     rolado, pin manual. Sem isso o dono volta a não confiar.

### R3 — Tela Planejamento

3.1. Visão **calendário/grade por setor × dia**: cada célula mostra pares
     planejados vs capacidade (ex. `540/600`), verde dentro da capacidade,
     âmbar no limite, vermelho estourado.
3.2. Visão **fila**: lista ordenada de OPs com posição, pares restantes por
     setor, data prevista de conclusão, prazo do PV, badge de atraso, e o pin
     manual (drag pra reordenar = criar pin).
3.3. Filtros: setor, semana, cliente/PV, referência, status. Busca padrão do
     sistema (SearchInput + termos AND).
3.4. Mostra explicitamente o que veio de override de ficha técnica (badge).

### R4 — Tela Estouro de Produção

4.1. Lista todo **estouro**: (a) setor×dia com demanda > capacidade, (b) OP cuja
     data recalculada de conclusão ultrapassa a semana de faturamento do PV.
4.2. Cada linha de estouro mostra: setor, dia(s), pares excedentes, OPs
     envolvidas (com prazo), e impacto (quantos dias de atraso projetado).
4.3. Ações por linha/OP: **Enviar pra terceiro** — abre o fluxo existente de
     geração de OS por OP×setor (`generate_op_service_orders`/fluxo do hub de
     Terceirizados) pré-preenchido com a OP e o setor estourado; os pares
     enviados saem da fila interna do setor ao confirmar a OS. **Resolver eu
     mesmo** — atalhos pra repriorizar/pinar OPs ou editar capacidade do setor
     (leva pra tela Setores). **Aceitar atraso** — marca o estouro como ciente
     (some da lista ativa, fica em "aceitos" com autoria/data).
4.4. Os pares que rolaram de dias anteriores (backlog) aparecem destacados
     nesta tela até serem produzidos — é a tela de acompanhamento da dívida de
     produção.

### R5 — Kanban

5.1. Item de menu direto **Kanban**. Colunas = setores ativos na ordem do
     fluxo; cartões = OPs (uma OP = **um card só**, na coluna do setor mais
     avançado que já recebeu apontamento).
5.2. Card mostra: nº da OP, referência + cor, foto (thumb), progresso do setor
     atual `apontado/total` (ex. `120/300`), prazo do PV, badge de atraso.
5.3. **Estados de cor do card**: amarelo = parcial (setor atual apontou > 0 e
     < total); neutro/normal = 100% apontado no setor (aguardando próximo) ou
     ainda não iniciado; o card só "descansa" quando o total do setor foi
     apontado.
5.4. **Arrastar = apontamento real**: soltar o card na coluna seguinte abre um
     diálogo de quantidade (default = saldo restante); confirmar registra o
     apontamento no motor (mesmo ledger `production_pointings` + RPC de
     transição). Com quantidade parcial, o card muda pra coluna de destino
     mostrando `parcial/total` em amarelo; o saldo não apontado fica implícito
     no contador (não existe card residual na coluna de origem).
5.5. Arrastar pra coluna que não é a próxima do fluxo (pular setor / voltar):
     permitido com o mesmo padrão avisar+confirmar de R6.3, registrando quem
     confirmou.
5.6. Somente leitura para quem não tem permissão de apontar (o drag desabilita).
5.7. Os 4 modos legados do Quadro (matriz, cartões, timeline, lote) deixam de
     ser "o quadro": Kanban é o novo padrão; matriz/timeline/lote viram visões
     dentro de Análises, lendo do motor novo.

### R6 — Apontamento (chão de fábrica) e regras de transição

6.1. Telas por setor (evolução das atuais Corte/Costura/Aviamento/Silk/Colagem/
     Montagem/Solagem/Acabamento/SetorCostura) focadas em UMA ação: lista das
     OPs no setor com saldo, botão grande "Apontar", diálogo de quantidade.
     Kanban e telas de setor gravam no MESMO ledger/motor.
6.2. **Autoria obrigatória**: todo apontamento grava quem registrou (usuário
     logado) + campo "operador" (texto, quem executou). Autoria aparece no
     histórico da OP e no hover do card.
6.3. **Regras de transição — avisar + confirmar (nunca trava dura)**:
     - *Limite do setor anterior*: apontar mais do que o setor anterior
       entregou (ex. costurar 200 com 120 cortados) mostra o problema na hora
       ("Corte só entregou 120") e exige OK explícito; grava quem confirmou.
     - *Material reservado/debitado*: iniciar setor sem material
       reservado/debitado da etapa mostra aviso âmbar e exige o mesmo OK
       explícito com autoria.
     - As duas regras têm toggle por setor na tela Setores (ligar/desligar a
       checagem), mas quando ligadas o comportamento é sempre
       avisar+confirmar, nunca bloquear.
6.4. Apontamentos são corrigíveis: lançamento negativo/estorno com motivo
     (padrão já existente no ledger), refletindo no motor no mesmo recálculo.

### R7 — Menu e navegação

7.1. Grupo **Produção** da sidebar passa a ter exatamente estes itens diretos:
     1. **Planejamento** (R3)
     2. **Kanban** (R5)
     3. **Estouro de Produção** (R4)
     4. **Setores** (R1 — a tela central de configuração)
     5. **Apontamento** (R6 — seletor de setor → tela do setor)
     6. **Imprimir Fichas** (existente, inalterada)
     7. **Análises** (R8)
7.2. Somem da sidebar: PCP (hub), os 9 itens avulsos duplicados (Fluxo, Live,
     Timeline, Visão Agregada, Centro de Controle, Qualidade, Cronoanálise,
     Paradas & OEE, Tempos de Setup) — esses utilitários viram entradas dentro
     de Análises.
7.3. **Redirects**: toda URL legada (`/pcp?tab=*`, `/producao/*`,
     `/capacity-planning`, `/centro-controle`, etc.) redireciona pra tela nova
     equivalente. Nenhum link antigo pode dar 404.
7.4. Permissões por menu (sistema existente `user_permissions`/`useCan`)
     cobrem os 7 itens novos; quem só tem Apontamento vê só Apontamento.

### R8 — Análises religadas ao motor único

8.1. Análises é uma tela com navegação interna (cards/abas) contendo:
     Dashboard, Gargalos, Lead Time, Capacidade, RCCP, Pós-OP, Auditoria de
     Fluxo, Qualidade, Paradas & OEE, Cronoanálise, Tempos de Setup, e as
     visões legadas do quadro (matriz/timeline/lote).
8.2. Toda métrica dessas telas deriva de: `order_stages` +
     `production_pointings` + a agenda do motor novo. Remover/reescrever
     qualquer query que leia de `production_waves`/`sector_distribution_plan`.
8.3. Cada KPI mostra a mesma explicabilidade de R2.8 (drill até as OPs que
     compõem o número).

### R9 — Aposentar Ondas + migração

9.1. Todas as OPs abertas (não finalizadas/canceladas) das ondas atuais entram
     automaticamente na fila do motor novo, preservando: progresso por setor
     (`order_stages.quantity_processed`), apontamentos históricos, vínculo com
     PV e semana de faturamento.
9.2. Telas de Ondas (criação/gestão/iniciar/cancelar) saem da navegação.
     Tabelas `production_waves`/`production_wave_stages` ficam no banco como
     histórico (leitura em relatórios), sem escrita nova. Funções SQL do motor
     de ondas (`compute_wave_timeline` etc.) deixam de ser chamadas.
9.3. `sector_distribution_plan` (o 3º motor) também é aposentado — a tela
     Planejamento nova o substitui.
9.4. A migração é idempotente e roda como migration SQL versionada (aplicada
     via MCP, conforme fluxo do projeto).

## Data model / Domain

> Nomes finais podem ajustar no /build; semântica é contratual. Domínio em
> pt-BR nas strings/UI, snake_case em inglês nas tabelas (padrão do projeto).

**Novas tabelas:**

- `sector_settings` — 1 linha por setor (lista fixa, seed na migration):
  `sector` (text, único, = valores canônicos de `sector_display_to_enum`),
  `flow_order` (int), `enabled` (bool), `parallel_group` (text nullable —
  mesmo valor = rodam em paralelo), `daily_capacity_pairs` (int > 0),
  `team_notes` (text) e/ou `team_members` (jsonb informativo),
  `check_prev_sector_limit` (bool default true),
  `check_material_reserved` (bool default true), `updated_at`, `updated_by`.
- `production_queue` — 1 linha por OP aberta no motor:
  `order_id` (FK orders, único), `due_date` (date — derivada da semana de
  faturamento do PV), `pinned_position` (int nullable — override manual),
  `pinned_by/pinned_at`, `status` (na_fila | em_producao | concluida),
  timestamps.
- `production_schedule` — resultado materializado do motor: 1 linha por
  OP × setor × dia: `order_id`, `sector`, `date`, `planned_pairs` (int),
  `carryover_pairs` (int — quanto disso é saldo rolado), `recalc_run_id`
  (uuid — pra auditar cada recálculo), `capacity_source`
  (global | ficha_override). Regravada a cada recálculo (delete+insert por run).
- `overload_acknowledgements` — estouros aceitos (R4.3): `sector`, `date_range`,
  `order_ids`, `reason`, `accepted_by`, `accepted_at`.

**Reutilizadas (já existem):**

- `orders` + `order_stages` (estágios por setor, `quantity_total`/`quantity_processed`) —
  continuam sendo o estado REAL; o motor planeja em cima delas.
- `production_pointings` — ledger de apontamentos (qty, operator, autoria) —
  único caminho de escrita de produção, via `finalize_production_sector`
  (estender pra aceitar confirmação de regra violada: `confirmed_warnings`
  jsonb + quem confirmou).
- `technical_sheets.production_sectors` (jsonb) + `*_capacity_per_day` — o
  override por referência (R1.3). Não muda de shape.
- Fluxo de OS (`generate_op_service_orders`, hub Terceirizados) — ponto de
  integração do Estouro.
- `sale_orders`/`sale_order_items` — fonte da semana de faturamento (due_date).

**Motor (função/serviço):**

- RPC `recompute_production_schedule()` (SECURITY DEFINER, advisory lock pra
  não rodar 2× em paralelo): lê queue + settings + overrides + estado real
  (`order_stages`), grava `production_schedule` num run atômico. Chamada por
  trigger nos gatilhos de R2.6 (ou via chamada explícita do frontend após
  mutações) + agendamento diário (virada de dia).
- Estados de OP no quadro derivam de `order_stages` (setor mais avançado com
  apontamento) — nunca de coluna redundante.

**Migrations implicadas:** criação das 4 tabelas + seed de `sector_settings`
com a topologia canônica atual; RPC do motor; extensão de
`finalize_production_sector`; migração das OPs abertas das ondas pra
`production_queue`; revogação de escrita nova em waves.

## User flows

### Happy path (dia típico do dono)

1. PV é faturado→ OPs criadas → cada OP entra sozinha na `production_queue`
   com due_date = semana de faturamento; motor recalcula e distribui os pares
   nos dias de cada setor.
2. De manhã, dono abre **Planejamento**: vê a grade setor×dia (600/600 no
   Corte hoje), fila ordenada por prazo.
3. Durante o dia, no chão de fábrica: operador do Corte aponta 120 pares na
   tela **Apontamento › Corte** (ou o dono arrasta o card no **Kanban** e
   digita 120). Card da OP vai pra Costura mostrando `120/300` amarelo.
   Autoria gravada.
4. No fim do dia, o setor fez 540 de 600. Na virada do dia o motor rola os 60
   pra frente com prioridade; **Estouro de Produção** mostra o backlog de 60 e
   o efeito cascata nos próximos dias.
5. Dono decide no Estouro: manda 200 pares de Solagem pra terceiro (gera OS
   pré-preenchida) e aceita 1 dia de atraso num PV folgado (fica registrado).
6. Num dia bom (720 de 600), o motor puxa OPs futuras pra mais cedo — o dono
   só vê o cronograma encurtar.

### Alternate / edge flows

- **Referência com ficha preenchida**: OP da referência X (ficha com setores/
  capacidades próprios) é planejada pelos dados da ficha; badge "override da
  ficha" no Planejamento/Kanban.
- **Mudança de capacidade**: dono edita Corte de 600→700 na tela Setores →
  recálculo imediato de toda a fila aberta; grades e datas mudam em todas as
  telas ao mesmo tempo.
- **Pin manual**: cliente ligou cobrando → dono arrasta a OP pro topo da fila
  no Planejamento; pin persiste por cima da ordenação automática até despinar.
- **Apontar acima do limite anterior**: diálogo mostra "Corte só entregou 120",
  pede OK explícito, grava confirmação com autoria.
- **Pular/voltar setor no Kanban**: mesmo padrão avisar+confirmar.
- **Estorno**: apontou 120 mas eram 100 → lançamento de correção (-20) com
  motivo; motor recalcula.

## Edge cases & failure modes

- **OP sem ficha técnica ou ficha sem setores** → usa 100% a config global; se
  um setor global está desligado, a OP pula ele.
- **Setor com capacidade 0 ou vazia** → inválido na UI (min 1); motor trata
  capacidade ausente como "setor não agenda" e acusa no Estouro em vez de
  dividir por zero.
- **Due date no passado** (PV atrasado na criação da OP) → entra no topo da
  fila e aparece imediatamente no Estouro como atraso projetado.
- **Duas pessoas apontando ao mesmo tempo** (Kanban + tela de setor) → ledger é
  append-only; recálculo serializado por advisory lock; última leitura ganha na
  UI via invalidação de query (padrão React Query do projeto).
- **Recálculo concorrente** → advisory lock + `recalc_run_id`; leitores nunca
  veem run parcial (troca atômica).
- **OP cancelada** → sai da queue e do schedule no mesmo recálculo; pares dela
  liberam capacidade (dias seguintes puxam pra frente).
- **Apontamento maior que o total da OP** → avisar+confirmar (mesmo padrão),
  nunca gravar silenciosamente acima de `quantity_total` sem OK.
- **Setores paralelos** → o "setor mais avançado" do card considera a ordem do
  fluxo; entre paralelos, o card fica no grupo de preparação até TODOS os
  paralelos exigidos completarem (a UI do card mostra o progresso de cada
  paralelo pendente no hover/expandido).
- **Migração** — OP de onda com estágio inconsistente (sem `order_stages`,
  gotcha conhecido) ganha estágios backfilled antes de entrar na queue (padrão
  do backfill existente Reservado→Em Produção).
- **~12 mil pares na fila** → recálculo precisa ser set-based (SQL), não
  loop por OP no cliente.

## Constraints & assumptions

- Stack e convenções do projeto: React + Vite + Supabase, Bun, TS loose,
  typecheck só via `bunx tsc -p tsconfig.app.json --noEmit`, tokens de design
  (nada de cor hardcoded fora de print), ícones phosphor, sonner, React Query
  (`useQuery`/`useMutation` + invalidação), busca padrão SearchInput/AND,
  domínio pt-BR / código EN.
- Migrations versionadas em `supabase/migrations/` e aplicadas via MCP (a
  Action de push está quebrada — memória do projeto). Auditar o BANCO, não os
  arquivos.
- Permissões: reusar `user_permissions` por path de menu (os 7 paths novos
  entram na matriz e nos modelos).
- Drag-and-drop: usar lib já presente no projeto (há DnD na sidebar/ordem
  custom); não introduzir framer-motion (transições CSS-only).
- **Assumido (dono delegou/não perguntado, defaults registrados):**
  - Horizonte do Estouro: rolling 30 dias à frente + todo o backlog.
  - "Semana de faturamento" = semana (seg–dom) da data de faturamento/entrega
    do PV; due_date = último dia útil da semana.
  - Dias úteis = seg–sex (sem agenda de feriados na v1; sábado/domingo não
    agendam).
  - Card do Kanban usa thumb via transform do Supabase (padrão existente).
  - Apontamento por quantidade em PARES inteiros.
  - As telas de setor atuais são evoluídas in-place (mesmas rotas), não
    recriadas do zero.
- Não tocar: motor de consumo/reserva/débito de materiais (só LER o status de
  reserva pra regra R6.3), custeio, etiquetas, fichas de impressão.

## Open questions

- Nenhuma bloqueante. (Defaults assumidos listados acima — validar na revisão
  da spec; qualquer ajuste é 1 linha.)

## Definition of Done

- [ ] **R1** Tela Setores existe em rota própria, lista os 10 setores, permite
      reordenar (drag), ligar/desligar, definir grupo paralelo, capacidade
      pares/dia, equipe informativa e toggles das 2 regras — verificado
      configurando Corte=600 e vendo a grade do Planejamento refletir.
- [ ] **R1.3** OP de referência com ficha preenchida usa os dados da ficha
      (badge visível); OP de referência sem nada usa o global — verificado com
      2 OPs lado a lado no Planejamento.
- [ ] **R1.4** Editar capacidade recalcula todas as OPs abertas na hora —
      verificado mudando 600→300 e vendo datas/estouros mudarem no
      Planejamento e no Estouro sem reload manual.
- [ ] **R2.3** Deixar saldo de 60 pares não apontados e virar o dia (ou rodar o
      job) → os 60 aparecem no dia seguinte como carryover prioritário e o
      excedente cascateia — verificado por query em `production_schedule`
      (`carryover_pairs`) e na grade.
- [ ] **R2.4** Apontar acima do planejado do dia puxa pares futuros pra mais
      cedo — verificado com a data de conclusão de uma OP futura encurtando.
- [ ] **R2.5** Pin manual reordena a fila por cima do prazo e persiste após
      recálculo.
- [ ] **R2.7** O MESMO número de pares planejados pra (setor, dia) aparece em
      Planejamento, Kanban (contadores), Estouro e Análises — verificado
      conferindo as 4 telas contra uma query direta.
- [ ] **R2.8** Toda data/carga tem popover "como cheguei nisso" com capacidade,
      origem (global × ficha), fila à frente e carryover.
- [ ] **R4** Tela Estouro lista sobrecargas e atrasos projetados; "Enviar pra
      terceiro" abre OS pré-preenchida (OP+setor) no fluxo existente; "Aceitar
      atraso" grava autoria e some da lista ativa.
- [ ] **R5** Kanban acessível em 1 clique no menu; arrastar card abre diálogo
      de quantidade; apontamento parcial move o card pra coluna seguinte com
      `120/300` em AMARELO; ao completar o total o card normaliza — verificado
      com o cenário canônico 300 pares/120 cortados.
- [ ] **R6.2** Todo apontamento (Kanban ou tela de setor) grava usuário +
      operador; visível no histórico da OP.
- [ ] **R6.3** Apontar 200 com 120 entregues no setor anterior mostra aviso com
      o número real e exige confirmação; a confirmação fica registrada com
      autoria — verificado no banco.
- [ ] **R7** Sidebar Produção tem exatamente os 7 itens; nenhum item legado
      duplicado; TODAS as URLs antigas (`/pcp?tab=*`, `/producao/*`, etc.)
      redirecionam sem 404 — verificado com script/lista de rotas legadas.
- [ ] **R8** Nenhuma tela de Análise consulta `production_waves`/
      `sector_distribution_plan` (grep limpo no src/) e todos os KPIs batem com
      o motor.
- [ ] **R9** Após a migration de cutover: todas as OPs abertas das 13 ondas
      estão na `production_queue` com progresso preservado; telas de Ondas fora
      do menu; zero escrita nova em `production_waves` — verificado por query.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo, `npm run check:tokens`
      limpo, testes de paridade/unidade existentes continuam verdes.
