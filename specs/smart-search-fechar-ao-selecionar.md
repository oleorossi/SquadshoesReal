# SmartSearch — fechar o popover ao selecionar (e manter fechado)

## Goal
Ao clicar (ou confirmar com Enter) uma sugestão no `SmartSearch`, o popover de
sugestões fecha e **permanece fechado** até o usuário alterar o texto de novo —
eliminando o "popup teimoso" que hoje reabre sozinho logo após a seleção.

## Background / Problem
`SmartSearch` (`src/components/ui/smart-search.tsx`) mostra um popover de
sugestões enquanto o usuário digita. Ao selecionar uma sugestão, `handleSelect`
faz `setOpen(false)` e em seguida `inputRef.current?.focus()`. Como o input tem
`onFocus={() => setOpen(true)}`, o próprio re-foco reabre o popover; e como o
`value` passou a ser o nome completo selecionado, as sugestões ainda contêm aquele
match (`flatList.length > 0`), então `showPopover` volta a `true`. Resultado: a
caixinha reaparece por cima dos resultados já filtrados (ex.: selecionar
"LNG 10 CONFECCOES LTDA" na lista de PVs deixa a sugestão sobreposta à tabela),
obrigando o usuário a clicar fora pra dispensá-la. É um atrito recorrente porque o
componente é a busca principal de várias telas.

## Scope
### In scope
- Comportamento de abertura/fechamento do popover de `SmartSearch` após uma
  seleção (clique numa sugestão ou Enter com item destacado).
- A regra de "quando o popover pode reaparecer" (ver Requirements).
- Vale automaticamente para **todos** os consumidores do componente
  (`SaleOrders.tsx`, `StockReservations.tsx`, `inventory/tabs/MaterialsTab.tsx`),
  por ser a mesma instância compartilhada.

### Out of scope (explicitamente não agora)
- Qualquer mudança no motor de busca (`searchMatchesAllTerms`), no `SearchInput`
  base, no filtro que a seleção aplica, ou no formato/estilo das sugestões.
- O comportamento do popover **enquanto se digita** (continua abrindo/atualizando
  normalmente conforme o texto muda).
- Busca global `⌘K` (`GlobalSearch`) — usa `cmdk`, não `SmartSearch`.
- Remoção do foco do input após selecionar (o foco continua no campo).

## Requirements
1. Ao selecionar uma sugestão — por **clique** no item ou por **Enter** com um
   item destacado (`activeIdx >= 0`) — o popover fecha imediatamente e o
   valor/seleção é aplicado como hoje (mesma chamada a `onSelect`/`onChange`).
2. Após a seleção, o popover **não reabre** por re-foco do input. Especificamente:
   o re-foco programático feito por `handleSelect` (`inputRef.focus()`) não pode
   reabrir o popover.
3. O popover só volta a aparecer quando o usuário **alterar o texto** do campo
   (digitar ou apagar). Focar/clicar de volta no campo com o **mesmo texto** não
   reabre o popover.
4. O foco permanece no input após a seleção (o usuário pode continuar editando ou
   limpar), mas **sem** o popover aberto.
5. Enquanto o usuário digita (antes de selecionar), o popover continua abrindo e
   atualizando as sugestões exatamente como hoje — nenhuma regressão nesse fluxo.
6. `Esc` continua fechando o popover quando ele está aberto (comportamento atual
   preservado); teclas ↑/↓ para navegar as sugestões continuam funcionando.

## Data model / Domain
Nenhuma. Mudança puramente de UI em um componente React; sem tabelas, migrations
ou tipos afetados.

## User flows
### Happy path
1. Na lista de Pedidos de Venda, o usuário digita "LNG" na busca.
2. O popover abre com a sugestão "LNG 10 CONFECCOES LTDA".
3. O usuário clica na sugestão → a lista filtra para os PVs desse cliente **e o
   popover fecha**.
4. O popover permanece fechado; a tabela de resultados fica totalmente visível.
5. Para uma nova busca, o usuário apaga/edita o texto → o popover volta a abrir
   com sugestões do novo termo.

### Alternate / edge flows
- **Seleção por teclado:** usuário digita, usa ↓ para destacar uma sugestão e
  aperta Enter → mesmo resultado do clique (fecha e mantém fechado).
- **Reclicar no campo sem mudar texto:** popover permanece fechado (só reabre ao
  mudar o texto).
- **Limpar com o "×" (ou Esc):** limpa o texto; como o valor mudou para vazio,
  não há sugestões e o popover fica fechado (sem regressão).

## Edge cases & failure modes
- Digitar imediatamente após selecionar → popover reabre (é "alteração de texto",
  esperado pelo Req. 3/5).
- Consumidor que passa `onSelect` custom (que não altera `value`) → o popover
  ainda deve fechar e permanecer fechado; não depende do `value` mudar.
- `getSuggestions` assíncrono que resolve **depois** da seleção → não pode reabrir
  o popover sozinho; enquanto o usuário não digitar, permanece fechado.
- Blur real (clicar fora do campo) → continua fechando o popover como hoje.

## Constraints & assumptions
- Stack/convenções do projeto: React + shadcn (`Popover`), ícones
  `@phosphor-icons/react`, sem cores hardcoded (design tokens), TS loose;
  typecheck `bunx tsc -p tsconfig.app.json --noEmit` deve ficar limpo.
- Não introduzir dependência nova nem novo padrão de componente; alterar apenas
  `src/components/ui/smart-search.tsx` (e, se necessário, ajuste mínimo em como o
  `SearchInput` sinaliza foco — sem mudar a API pública do `SearchInput`).
- **Assunção (decisão do usuário):** a regra de reabertura é "só ao alterar o
  texto"; focar de novo no mesmo texto não reabre. (Alternativa "foco sempre
  reabre" foi descartada.)
- **Assunção:** manter o foco no input após selecionar (não foi pedido removê-lo).

## Open questions
- Nenhuma pendente.

## Definition of Done
- [ ] Req. 1/2 — Na lista de PVs, digitar "LNG", clicar na sugestão: a lista
  filtra e o popover **não** reaparece (verificar visualmente que a caixinha some
  e fica sumida).
- [ ] Req. 3 — Após selecionar, clicar de novo no campo (sem digitar) **não**
  reabre o popover; apagar/editar o texto **reabre**.
- [ ] Req. 1 (teclado) — Digitar, ↓ até destacar uma sugestão, Enter: mesmo
  comportamento (fecha e mantém fechado).
- [ ] Req. 5 — Digitar do zero ainda abre e atualiza o popover normalmente
  (nenhuma regressão no fluxo de digitação) em SaleOrders, StockReservations e
  MaterialsTab.
- [ ] Req. 6 — Esc fecha o popover aberto; ↑/↓ navegam as sugestões.
- [ ] Transversal — `bunx tsc -p tsconfig.app.json --noEmit` limpo;
  `npm run check:tokens` limpo; nenhum outro consumidor de `SearchInput`/
  `SmartSearch` teve comportamento alterado além do descrito.
