# Padronização e Melhoria das Buscas de Todo o Sistema

## Goal

Toda busca do sistema (as ~86 barras de tela/dialog/combobox + a busca global ⌘K)
passa a usar **um único motor de match** e **um único componente visual**, de modo
que qualquer registro cadastrado seja encontrável de qualquer lugar — sem
sensibilidade a acento/caixa/espaço, sem "sumir" registro por aba ou por corte de
1000 linhas, e com a mesma experiência (lupa, limpar, contador, atalhos) em todas
as telas.

## Background / Problem

Hoje o sistema tem ~86 campos de busca e três comportamentos diferentes convivendo:

1. **13 arquivos** usam o helper canônico `searchMatchesAllTerms`
   (`src/lib/searchUtils.ts`) — insensível a acento/caixa/pontuação, com
   refinamento AND por `/`.
2. **A maioria dos outros ~70** filtra com `.toLowerCase().includes(...)` ad-hoc —
   sensível a acento ("tamara" não acha "TÂMARA"), sensível a espaço/hífen
   ("SP10" não acha "SP 10") e sem refinamento.
3. **Buscas server-side** (GlobalSearch e poucas telas) usam a coluna gerada
   `search_norm` (migration `20260613120000`), que trata **espaço como AND** —
   comportamento diferente do client-side, onde espaço é colado na string.

Dores confirmadas na entrevista:
- Busca não acha o que existe (acento, espaço, campo não coberto, registro além
  das 1000 primeiras linhas do Supabase).
- Comportamento inconsistente entre telas (com/sem `/`, com/sem acento).
- UX desigual (placeholder genérico, sem botão limpar, sem feedback de vazio).
- Busca global com cobertura incompleta de entidades e sem recentes/ações.
- Bug histórico: lista de PVs filtrava por aba ANTES da busca — registro em outra
  aba "não existia".

## Scope

### In scope
- **Todos os ~86 campos de busca** do sistema: páginas top-level, painéis, abas,
  dialogs/modais, comboboxes/seletores (`SearchableSelect`, `Command`/cmdk,
  `EmployeeCombobox`, seletor de produto/material/cliente etc.), incluindo as
  páginas mobile (`src/pages/mobile/`).
- O motor de match client-side (`src/lib/searchUtils.ts`) e seus testes.
- Um componente padrão de barra de busca em `src/components/ui/` (consolidando o
  `smart-search.tsx` existente — não criar um segundo padrão paralelo).
- Busca server-side via `search_norm` nas telas com dataset potencialmente > 1000
  linhas (migration para estender a coluna gerada às tabelas grandes que faltam).
- Interação busca × abas/filtros de status (busca atravessa abas, com contagem).
- Busca global (⌘K): novas entidades, recentes, navegação por teclado, ações
  rápidas, preview de contexto, mesmo motor de match.
- Atalhos de teclado: ⌘/Ctrl+K (global, já existe — manter) e `/` para focar a
  busca da tela atual.

### Out of scope (explicitamente não agora)
- Persistir o termo de busca na URL (compartilhável/back-button) — fase futura.
- Busca full-text com ranking/relevância (tsvector, pg_trgm com score) — o match
  continua sendo substring normalizada; índice trigram entra só se a performance
  exigir (ver Constraints).
- Histórico de buscas sincronizado entre dispositivos (recentes ficam em
  `localStorage` local).
- Alterar QUAIS colunas as listas exibem — a regra "visível + identificadores"
  parte das colunas que cada tela já mostra hoje.
- Componentes de impressão (worksheets/etiquetas) — não têm busca e são exempt
  de qualquer mudança.

## Requirements

1. **Motor único de match (client-side).** `searchMatchesAllTerms` passa a
   separar termos por `/` **e por espaço**. Semântica: AND entre termos, OR entre
   campos, cada termo insensível a acento/caixa/pontuação (via
   `normalizeForSearch`). Query vazia ou que normaliza para vazio ⇒ não filtra
   (retorna tudo). Ex.: `"napa tamara"` acha registro com "NAPA" num campo e
   "TÂMARA" em outro; `"SP 10"` vira 2 termos, ambos casando "SP 10" e "SP10".
   Testes de `src/lib/__tests__/searchUtils.test.ts` atualizados para a nova
   semântica.
2. **Componente padrão `<SearchInput />`** (evolução/consolidação do
   `src/components/ui/smart-search.tsx`), com: ícone de lupa, botão × para limpar
   (visível só com texto), placeholder específico por tela dizendo **o que**
   aquela busca cobre (ex.: `"Buscar por referência, cliente, cor…"`), hint
   discreto (tooltip/ícone `?`) explicando o refinamento por espaço/`/`, suporte a
   contador de resultados (`"12 de 480"`, via props `resultCount`/`totalCount`),
   debounce configurável (default 0 para filtro local, ~300 ms para server-side),
   e estilo 100 % em design tokens, funcional em 360 px.
3. **Migração dos ~86 call sites.** Todo campo de busca (telas, painéis, dialogs)
   usa o componente padrão + `searchMatchesAllTerms`. Comboboxes baseados em
   cmdk/`Command` e `SearchableSelect` não trocam de shell visual, mas o **filtro
   interno usa a mesma normalização** (custom `filter` fn com
   `normalizeForSearch`/`searchMatchesAllTerms`).
4. **Regra de campos: visível + identificadores.** Cada busca cobre todos os
   campos exibidos na linha da lista **mais** identificadores canônicos mesmo
   quando não visíveis: SKU, CNPJ, telefone, chave de acesso NF-e, números de
   PV/OP/OC/OS/NF (com e sem prefixo/zeros: "PV-00111", "pv00111" e "111" acham o
   mesmo PV).
5. **Busca atravessa abas/filtros de status.** Em telas com abas (PVs, OPs,
   NF-e…): digitou na busca ⇒ o match roda sobre o conjunto todo; a UI mostra a
   contagem de resultados por aba (ex.: badge `"Faturados (3)"`), e a aba ativa
   exibe os seus. Nenhum registro existente pode ficar invisível por causa da aba
   selecionada. Filtros explícitos escolhidos pelo usuário (ex.: dropdown de
   setor) continuam sendo respeitados — a regra vale para abas de status/navegação.
6. **Server-side nas telas grandes.** Telas cujo dataset pode exceder 1000 linhas
   passam a buscar no banco via `search_norm` + `searchNormOrFilter` (debounce
   ~300 ms, spinner discreto). Candidatas identificadas (confirmar volume real na
   implementação): movimentações de estoque (`stock_movements`), NF-e, lançamentos
   financeiros (`financial_entries`), ponto (`time_records` — já tem fonte
   paginada, integrar), auditoria (`audit_logs`), OPs (`orders`), histórico de
   preços. Telas pequenas continuam com filtro local instantâneo.
7. **Migration `search_norm` estendida.** Adicionar a coluna gerada
   `search_norm` (via `public.normalize_search`, mesma da migration
   `20260613120000`) às tabelas do requisito 6 que ainda não têm, concatenando os
   campos da regra "visível + identificadores". Hoje têm: `products`, `clients`,
   `sale_orders`, `technical_sheets`, `suppliers`, `economic_groups`.
8. **Busca global (⌘K) — novas entidades.** Adicionar: Ordens de Compra (número,
   fornecedor), Ordens de Serviço de terceirizados (número, prestador, setor),
   NF-e (número, cliente, chave de acesso), Funcionários (nome) e Grupos de
   estoque (nome — cai na tela de grupos já filtrada). Resultados por seção,
   respeitando as permissões de menu do usuário (`useCan`): entidade cuja tela o
   usuário não pode acessar não aparece.
9. **Busca global — comportamento.** (a) Mesmo motor de match das telas
   (normalização + espaço/`/` = AND) — o que acha numa tela acha no ⌘K; (b) ao
   abrir vazia, mostra os últimos ~10 itens acessados (persistidos em
   `localStorage`); (c) navegação completa por teclado: ↑↓ percorrem, Enter abre,
   Esc fecha; (d) **ações rápidas** ("Criar PV", "Novo cliente", "Ir para
   Diagnósticos"…), filtradas pelas permissões do usuário; (e) cada resultado
   mostra 2–3 dados de contexto (PV: cliente + status + valor; produto: grupo +
   estoque; cliente: cidade + CNPJ); (f) o atalho existente `/xyz` (prefixo de
   grupo econômico) continua funcionando.
10. **Atalho `/` foca a busca local.** Em qualquer tela com barra de busca,
    pressionar `/` com o foco fora de um campo editável foca a busca da tela.
    Dentro de um campo, `/` é caractere normal (é o separador de refinamento).
11. **Estado vazio padrão.** Busca ativa sem resultados ⇒ `<EmptyState />`
    (`@/components/ui/empty-state`) com mensagem `Nenhum resultado para "x"` e
    ação "Limpar busca". Nunca uma área em branco silenciosa.

## Data model / Domain

- **Nenhuma tabela nova.** Mudanças de banco limitadas a colunas geradas:
  - `ALTER TABLE ... ADD COLUMN search_norm text GENERATED ALWAYS AS
    (public.normalize_search(campo1 || ' ' || campo2 …)) STORED` nas tabelas do
    requisito 7. A função `public.normalize_search` já existe e espelha o
    `normalizeForSearch` do TS — **não criar variação**.
  - ⚠ Gotcha conhecido: coluna GENERATED **quebra INSERT que passa valor** —
    clonar registro via spread (`insert({...row})`) estoura erro. Para cada tabela
    que ganhar `search_norm`, auditar os caminhos de INSERT/clone no frontend e
    excluir a coluna do payload.
- **Recentes do ⌘K:** `localStorage`, chave própria (ex.: `globalSearchRecents`),
  array de `{type, id, label, href}`, cap ~10, sem dado sensível.
- **Entidades por seção no ⌘K** (existentes + novas): OPs (`orders`), PVs
  (`sale_orders`), clientes, produtos, fichas (`technical_sheets` +
  `product_references`), fornecedores, grupos econômicos, páginas, **OCs
  (`purchase_orders`), OSs (`service_orders`), NF-e, funcionários (`employees`),
  grupos de estoque (`product_groups`)**.

## User flows

### Happy path (busca de tela)
1. Usuária abre Estoque → Materiais e pressiona `/` — o foco vai para a barra.
2. Digita `napa tamara` — sem tocar em acento ou ordem.
3. A lista filtra na hora (ou com spinner ~300 ms se server-side) para registros
   que contêm "napa" E "tâmara" em qualquer campo coberto; o contador mostra
   `"3 de 812"`.
4. Clica no × para limpar — lista volta ao estado cheio, contador some.

### Happy path (busca global)
1. De qualquer tela, ⌘K abre a paleta; sem digitar, aparecem os recentes.
2. Digita `oc guarany` — a seção "Ordens de Compra" lista a OC do fornecedor
   Guarany com preview (nº, fornecedor, status, valor).
3. ↓ até o item, Enter — navega direto para a OC.

### Alternate / edge flows
- **Registro em outra aba:** na lista de PVs (aba "Em Produção"), busca
  `stx alcineu`; o PV faturado não está na aba atual — badge da aba "Faturados"
  mostra `(1)`; um clique e o PV está lá. Nada some.
- **Ação rápida:** ⌘K → digita `novo pv` → Enter abre o formulário de PV (só se o
  usuário tem permissão para a rota).
- **Busca por identificador oculto:** digita um CNPJ na busca de Clientes — acha o
  cliente mesmo sem coluna CNPJ visível na lista.
- **Combobox:** no seletor de material da ficha, digita `santorine caramelo` — o
  item "NAPA SANTORINE CARAMELO" aparece mesmo com acento/ordem diferente.

## Edge cases & failure modes

- Query só de separadores (`"/"`, `"  "`, `"- -"`) → normaliza para vazio → não
  filtra (mostra tudo), sem erro.
- Termo que normaliza para vazio dentro de query válida (`"stx / -"`) → termo
  vazio é ignorado, os demais aplicam.
- `"SP 10"` → 2 termos ("sp", "10") — ambos casam "SP 10"/"SP10"; achado mantido.
  Risco residual: termos de 1–2 caracteres casam amplamente — aceito (contador
  torna visível).
- Números com prefixo/zeros: `normalizeForSearch("PV-00111") = "pv00111"` contém
  `"111"` → buscar "111" acha. Buscar "pv111" NÃO acha "PV-00111" (zeros no meio)
  — comportamento aceito e documentado no hint.
- Server-side: query vazia ⇒ **não** aplicar `.or()` (o helper
  `searchNormOrFilter` retorna `''`; caller pula o filtro).
- Contagem por aba com dados server-side: usar query de contagem
  (`count: 'exact', head: true`) por aba OU derivar da resposta — não carregar
  todas as abas inteiras só para contar.
- Debounce + resposta fora de ordem: React Query com `queryKey` incluindo o termo
  resolve (resposta antiga não sobrescreve).
- `/` para focar: não disparar quando o foco está em `input`, `textarea`,
  `select` ou `[contenteditable]`; não conflitar com o ⌘K.
- Recentes apontando para registro deletado: ao clicar, a tela de destino mostra
  seu próprio not-found; o item é removido dos recentes na próxima gravação.
- Permissão revogada: ação rápida/seção do ⌘K some na próxima abertura (filtra em
  render, não em cache).
- Tabelas que ganharem `search_norm`: qualquer INSERT/clone client-side que faça
  spread da row precisa excluir `search_norm` (senão 42601/erro de generated
  column). Auditar antes de aplicar a migration.
- Mobile 360 px: contador e hint não podem quebrar a linha da barra — colapsar o
  contador para badge compacto abaixo/dentro do input.

## Constraints & assumptions

- **Convenções do repo:** design tokens (zero cor hardcoded — rodar
  `npm run check:tokens`), ícones `@phosphor-icons/react`, toasts via `sonner`,
  React Query para dados, TS loose com typecheck obrigatório
  `bunx tsc -p tsconfig.app.json --noEmit`, testes Vitest ao lado do módulo.
- **Fonte única de normalização:** `normalizeForSearch` (TS) ↔
  `public.normalize_search` (SQL). Qualquer ajuste em um lado espelha no outro.
- **Migrations:** aplicar via Supabase MCP (o GitHub Action de migrate está
  quebrado); arquivo versionado em `supabase/migrations/` do mesmo jeito.
- **Performance:** filtro local é síncrono e instantâneo; server-side usa
  debounce ~300 ms. `pg_trgm` NÃO está instalado — o `ilike '%…%'` em
  `search_norm` STORED é aceitável na escala atual; se alguma tabela grande ficar
  lenta (> ~500 ms), instalar `pg_trgm` e criar índice GIN trigram na
  `search_norm` dessa tabela (decisão adiada até medir).
- **Não regredir:** o atalho `/xyz` de grupo econômico no GlobalSearch; o
  comportamento de filtros explícitos do usuário (dropdowns); as 13 telas que já
  usam `searchMatchesAllTerms` (a única mudança percebida nelas é espaço virar
  AND).
- **Defaults escolhidos onde o usuário delegou:** consolidar sobre
  `smart-search.tsx` (não criar componente paralelo); recentes em `localStorage`
  cap 10; debounce 300 ms; hint como tooltip no ícone; termo de busca fora da URL.

## Open questions

- Volume real por tabela define a lista final do requisito 6 (server-side) — a
  implementação mede (`select count(*)`) e decide tela a tela; qualquer tela
  < 1000 linhas hoje mas com crescimento previsível (NF-e, movimentações) entra
  mesmo assim.

## Definition of Done

- [ ] R1 — `bun run test:units` verde com os novos casos: `"napa tamara"` casa
  campos separados em qualquer ordem; `"tamara"` casa `"TÂMARA"`; `"sp10"` casa
  `"SP 10"`; `"stx / alcineu"` continua funcionando; query vazia/só separador não
  filtra.
- [ ] R2/R3 — `grep` não encontra mais filtro de busca ad-hoc
  (`toLowerCase().includes`) em campos de busca; amostra de 10 telas + 5 dialogs
  + 2 comboboxes inspecionada usando o componente padrão; todas as barras têm
  lupa, ×, placeholder específico e hint.
- [ ] R4 — na lista de Clientes, digitar um CNPJ (sem coluna visível) acha o
  cliente; na de NF-e, a chave de acesso acha a nota.
- [ ] R5 — na lista de PVs, aba "Em Produção", buscar um PV faturado mostra badge
  de contagem na aba "Faturados" e o PV aparece ao trocar de aba.
- [ ] R6/R7 — numa tabela com > 1000 linhas (ex.: movimentações), buscar um
  registro que NÃO está nas 1000 primeiras o encontra; migration `search_norm`
  aplicada e nenhum INSERT/clone quebrado (testar clonar produto/registro nas
  telas afetadas).
- [ ] R8 — ⌘K acha: uma OC pelo fornecedor, uma OS pelo prestador, uma NF-e pelo
  número E pela chave, um funcionário pelo nome, um grupo de estoque pelo nome —
  cada um navegando ao destino certo.
- [ ] R9 — ⌘K aberto sem digitar mostra recentes; ↑↓/Enter/Esc funcionam;
  `"tamara"` acha "TÂMARA" no ⌘K; `"novo pv"` → Enter abre o formulário; usuário
  sem permissão de /financeiro não vê seção/ações de financeiro; `/lng` (grupo
  econômico) segue funcionando.
- [ ] R10 — em 3 telas diferentes, pressionar `/` foca a busca; dentro de um
  campo de texto, `/` digita o caractere.
- [ ] R11 — busca sem resultado mostra o `EmptyState` com `Nenhum resultado para
  "x"` e o botão "Limpar busca" restaura a lista.
- [ ] Transversal — `bunx tsc -p tsconfig.app.json --noEmit` limpo;
  `npm run check:tokens` limpo; validação rigorosa nas 4 áreas críticas
  (PVs/OPs/fluxo, Estoque/Produtos/Grupos, Clientes/NF-e/Financeiro,
  Fichas/OC/OS) executando os casos acima em cada uma; layout íntegro em 360 px.
