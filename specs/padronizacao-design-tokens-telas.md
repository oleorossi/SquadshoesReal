# Padronização de design tokens — telas fora do padrão (auditoria 2026-07-11)

## Goal
Levar as 22 telas identificadas fora do padrão visual do projeto de volta à conformidade
com o Design Token System (`src/index.css` + CLAUDE.md), eliminando cores de status
light-only que quebram em dark mode, neutros hardcoded fora do token system e um empty
state ad-hoc — e blindar o `check:tokens` pra essa classe de violação não voltar.

## Background / Problem
Auditoria tela a tela (147 arquivos de página + componentes renderizados por cada tela)
feita em 2026-07-11 constatou:

- `npm run check:tokens` passa **limpo**, mas o script só detecta `gray/slate/white`.
- Existem **47 ocorrências** de cores de status em tom claro (`bg-*-50/100/200`,
  `text-*-700/800/900`, `border-*-100/200/300`) **sem variante `dark:`** — em dark mode
  viram badge/banner clarão ilegível ou texto escuro sobre fundo escuro. Esse é
  exatamente o gap já registrado no projeto ("check:tokens não pega status colors").
- 4 ocorrências de neutros `stone-*` fora do sistema de tokens.
- 2 componentes **órfãos** (ninguém importa) contêm violações.
- 1 empty state ad-hoc em página mobile.

O restante do sistema está conforme: EmptyState adotado em 118 arquivos, zero import de
`lucide-react`, z-index arbitrário só em primitives justificadas, hex fora de print
quase zero (e os achados são legítimos — ver Isenções).

## Scope

### In scope
1. Corrigir as 47 ocorrências de status color light-only sem `dark:` (inventário completo abaixo).
2. Corrigir os 4 neutros `stone-*`.
3. Trocar o empty state ad-hoc de `MobilePending` por `<EmptyState />`.
4. Remover os 2 componentes órfãos com violações (código morto).
5. Estender `scripts/check-design-tokens.sh` pra detectar essa classe de violação.

### Out of scope (explicitamente agora não)
- Arquivos de print/etiqueta (EXEMPT_PATTERN do checker) — hardcoded é o padrão correto lá.
- `DesignPreview.tsx` / `DesignSystem.tsx` — páginas internas de showcase do design system.
- Ocorrências de status color **com** par `dark:` correto (~117 linhas, ex.
  `OperationsTab.tsx`, `SolesCadastroTab.tsx`, `StockAdjustmentPage.tsx`) — funcionam nos
  dois temas; migrá-las pro padrão `*-500/10` é cosmético e fica pra depois.
- Auditoria de alturas (h-7/h-8/h-9) por toolbar — não levantada nesta rodada.
- Qualquer mudança de banco/migration — feature é 100% frontend.

## Requirements

1. **Toda ocorrência do Inventário A** (abaixo) deve usar o padrão canônico de status
   color do projeto: `bg-<cor>-500/10 text-<cor>-600 border-<cor>-500/20` (borda
   opcional, `/30` quando precisar de mais presença). Quando o texto precisar de mais
   contraste em light mode, usar par explícito `text-<cor>-700 dark:text-<cor>-400` —
   nunca tom `700+` sozinho.
2. **Nenhuma linha alterada pode perder informação semântica**: a cor (verde=ok,
   âmbar=aviso, vermelho=falta, azul=info) permanece a mesma; muda apenas o formato.
3. **Inventário B (stone)**: `text-stone-600`/`text-stone-400` → `text-muted-foreground`;
   badge `bg-stone-100 text-stone-800 border-stone-200` → `variant="secondary"` sem
   classes de cor (ou `bg-muted text-muted-foreground border-border`).
4. **`MobilePending.tsx`**: substituir o bloco `div text-center py-12` por
   `<EmptyState />` de `@/components/ui/empty-state` (ícone, título "Nenhum pedido
   pendente.", descrição "Pedidos criados offline aparecem aqui.").
5. **Código morto**: deletar `src/components/inventory/TechnicalSheetEditor.tsx` e
   `src/components/logistics/ShippingWizard.tsx` (grep confirmou zero importadores).
   Se ao deletar aparecer uso dinâmico não detectado (build quebra), corrigir as cores
   em vez de deletar.
6. **`scripts/check-design-tokens.sh`** ganha duas detecções novas (mesma mecânica de
   EXEMPT_PATTERN):
   a. linha contendo `\b(bg|text|border)-(red|green|blue|amber|yellow|orange|purple|violet|emerald|teal|cyan|sky|indigo|rose|pink|lime|fuchsia)-(50|100|200|800|900)\b` **e sem** `dark:` na mesma linha;
   b. `\b(bg|text|border)-(zinc|neutral|stone)-[0-9]`.
   Adicionar ao EXEMPT_PATTERN: `nfe/DanfeView` (documento DANFE = papel).
7. **Typecheck e checker limpos** ao final: `bunx tsc -p tsconfig.app.json --noEmit` e
   `bun run check:tokens` (já com as regras novas) sem erro/violação.
8. **Isenções confirmadas não devem ser "corrigidas"** (ver seção Isenções) — o diff não
   pode tocar nesses pontos.

## Inventário A — status colors light-only sem `dark:` (47 ocorrências)

Telas com violação direta:

| Tela / rota | Arquivo:linhas | O que é |
|---|---|---|
| Picking | `src/pages/Picking.tsx:26-30` | mapa de 4 badges de status (`bg-blue-100 text-blue-700 border-blue-300`…) |
| LGPD | `src/pages/LGPD.tsx:18-20` | mapa de 3 badges de status |
| Folha (Payroll) | `src/pages/Payroll.tsx:819,861,867,1304` | `text-amber-800` em avisos (o bg já é tokenizado `amber-500/5`; só o texto quebra) |
| Planej. Capacidade | `src/pages/CapacityPlanning.tsx:498,871,873,874` | `text-emerald-900`, `text-red-900`, `text-amber-900` |
| Segurança | `src/pages/Security.tsx:130` | badge `bg-amber-100 text-amber-700` |
| Navigation Audit | `src/pages/NavigationAudit.tsx:142` | banner `bg-blue-50 border-blue-100 text-blue-800` |
| Mobile · Novo Pedido | `src/pages/mobile/MobileNewOrder.tsx:641` | banner `bg-amber-50 text-amber-900 border-amber-500` |
| Resumo Agrupado | `src/pages/GroupedReportSummary.tsx:482` | badge `bg-stone-100 text-stone-800 border-stone-200` (também é Inventário B) |

Telas com violação via componente:

| Tela / rota | Componente:linhas | O que é |
|---|---|---|
| `/` (Index/Estoque, aba Relatório) | `src/components/inventory/tabs/ReportTab.tsx:50,58,66` | KPI cards `bg-emerald-50`, `bg-blue-50`, `bg-red-50` |
| Financeiro | `src/components/finance/UnifiedFinanceTab.tsx:71`; `UnifiedInvoicesTab.tsx:44,51` | Cards `bg-emerald-50 border-emerald-200`, `bg-amber-50 border-amber-200` |
| NF-e | `src/components/nfe/StandaloneNfePanel.tsx:137` | aviso `bg-amber-50/30 text-amber-800` |
| Edição de OP | `src/components/production/ProductionPipeline.tsx:54` | step concluído `bg-emerald-100 text-emerald-600 border-emerald-500` |
| Pedidos de Venda | `src/components/sale-orders/MarginDialog.tsx:238` | `text-amber-800` |
| PV form (+ SaleOrders, MobileNewOrder, Contractors) | `src/components/sale-orders/SaleOrderItemForm.tsx:1524` | `text-amber-800` (bg já tokenizado) |
| Fichas Técnicas | `src/components/technical-sheets/TechnicalReferencePanel.tsx:42,43,44,167,382` | mapa de status (`bg-blue-100`/`bg-green-100`/`bg-emerald-100`), círculo `bg-green-100`, Card `bg-amber-50/50 border-amber-300/50` |
| Fichas de Componente | `src/components/technical-sheets/SolesComponentSheetTab.tsx:348,353` | badges `bg-emerald-50 border-emerald-200`, `bg-amber-50 border-amber-200` |
| Consumo Base / Detalhe Produto / Solados / Fichas Comp. | `src/components/technical-sheets/SoleTechnicalDetails.tsx:658,668` | botões `border-blue-200 text-blue-700 bg-blue-50/50`, idem purple |
| Consumo Base / Detalhe Produto / Solados | `src/components/technical-sheets/SoleStandardItemsPanel.tsx:314` | aviso `border-amber-300 bg-amber-50/50 text-amber-800` |
| Global (banner) + Diagnostics | `src/components/VersionChecker.tsx:172,189,193,195` | banner update `bg-amber-950 text-amber-50` — ver Open questions |

## Inventário B — neutros stone (4 ocorrências)

- `src/pages/TechnicalSheets.tsx:214` — `text-stone-600` (ícone Solado)
- `src/pages/References.tsx:36` — `text-stone-600` (ícone Solado)
- `src/components/technical-sheets/SilkGlobalPanel.tsx:250` — `text-stone-400` (telas Silks, Cadastro de Silks, Consumo Base)
- `src/pages/GroupedReportSummary.tsx:482` — badge stone (já no Inventário A)

## Inventário C — outros

- `src/pages/mobile/MobilePending.tsx:54-58` — empty state ad-hoc → `<EmptyState />`.
- `src/pages/mobile/MobileNewOrder.tsx:490` — `bg-[#25D366]` (verde WhatsApp) — ver Open questions.
- Código morto: `src/components/inventory/TechnicalSheetEditor.tsx` (blue-50 ×2),
  `src/components/logistics/ShippingWizard.tsx` (red-200/emerald-200) — deletar.

## Isenções (NÃO tocar — verificadas uma a uma)

- Todos os arquivos do EXEMPT_PATTERN do checker (worksheets, etiquetas, Rel*A4,
  EspelhoPonto, PickingListPage, CartaoOP, label-system).
- `src/components/ui/toast.tsx:70` — `group-[.destructive]:text-red-300` é texto sobre
  fundo destructive colorido; legítimo.
- `src/pages/Payroll.tsx:759` e `src/pages/mobile/MobileNewOrder.tsx:621` —
  `background:'#fff'` em iframe de prévia de documento e fundo de imagem de assinatura
  (papel branco real); legítimo.
- `src/components/sale-orders/ArtisanalStrapRollCutBlock.tsx:63` — `#E24B4A` é a cor
  ilustrativa do gráfico do rolo de tira; deliberado.
- `src/components/nfe/DanfeView.tsx` — DANFE é documento fiscal em papel; entra no
  EXEMPT_PATTERN (Req. 6).
- `src/pages/DesignPreview.tsx` — showcase interno.

## Data model / Domain
Nenhuma entidade, coluna ou migration envolvida. Feature 100% frontend (classes Tailwind
e um script bash).

## User flows

### Happy path
1. Usuário abre qualquer tela do Inventário A em **dark mode** (toggle do app).
2. Badges/banners/cards de status aparecem com fundo translúcido tokenizado
   (`*-500/10`) e texto legível (`*-600` ou par `700/dark:400`), consistente com o
   restante do sistema (ex.: modal Consumo de Materiais, que já segue o padrão).
3. Em light mode, a mesma tela mantém a hierarquia semântica de cores de antes.

### Alternate / edge flows
- Dev roda `bun run check:tokens` após qualquer edit visual → as duas regras novas
  acusam regressões de status color light-only e de neutros zinc/stone.
- Tela mobile offline sem pedidos pendentes → `<EmptyState />` padrão em vez do texto solto.

## Edge cases & failure modes
- **Cor com opacidade já parcial** (ex. `bg-amber-50/30`, `bg-amber-50/50`): substituir
  pela forma canônica `bg-amber-500/10` — não empilhar opacidade sobre tom claro.
- **`text-*-800/900` usado como ênfase forte** (CapacityPlanning): usar
  `text-<cor>-700 dark:text-<cor>-400` (mantém peso em light sem sumir em dark).
- **Badges com `border-*-300`**: virar `border-<cor>-500/30`.
- **Falso órfão** (Req. 5): se `bun run build` ou typecheck acusar import dinâmico dos
  arquivos deletados, restaurar e corrigir as cores neles em vez de deletar.
- **Checker (Req. 6) com falso positivo em linha que tem `dark:` de OUTRA classe**: a
  heurística por linha é aceitável (mesma granularidade do script atual); caso apareça
  falso positivo real, resolver movendo o par `dark:` pra mesma classe na mesma linha.

## Constraints & assumptions
- Stack: alterações apenas em `src/**/*.tsx` e `scripts/check-design-tokens.sh`.
- Seguir CLAUDE.md: tokens do `src/index.css`, ícones phosphor, sem Prettier, typecheck
  canônico `bunx tsc -p tsconfig.app.json --noEmit`.
- Commits na branch de trabalho `claude/*`; deploy automático via main (pipeline do repo).
- **Defaults assumidos** (usuário não consultado — sessão autônoma):
  - Padrão de substituição = a forma canônica já documentada no CLAUDE.md
    (`bg-*-500/10 text-*-600`), não pares `light/dark:` novos.
  - Órfãos são deletados, não corrigidos.
  - As ~117 linhas com `dark:` correto ficam como estão (out of scope).

## Open questions
- **`bg-[#25D366]` (WhatsApp, MobileNewOrder:490)**: cor de marca de terceiro. Default
  proposto: manter, com comentário `{/* verde WhatsApp — cor de marca */}` e entrada no
  EXEMPT (é hex único). Alternativa: token `--whatsapp` no index.css.
- **`VersionChecker` (banner `bg-amber-950 text-amber-50`)**: cor fixa de alto contraste
  que funciona nos dois temas — pode ser escolha deliberada de banner de update. Default
  proposto: manter como está e documentar; só tokenizar se o usuário preferir.

## Definition of Done
- [ ] Req. 1–2: `grep -rnE '\b(bg|text|border)-(red|green|blue|amber|yellow|orange|purple|violet|emerald|teal|cyan|sky|indigo|rose|pink|lime|fuchsia)-(50|100|200|800|900)\b' src/pages src/components --include='*.tsx' | grep -v dark:` filtrado pelo EXEMPT_PATTERN retorna **0 linhas** (exceto isenções documentadas).
- [ ] Req. 3: mesmo grep para `(zinc|neutral|stone)` retorna 0 fora de print/showcase.
- [ ] Req. 4: abrir Mobile → Pendentes sem itens e ver `<EmptyState />` renderizado.
- [ ] Req. 5: `TechnicalSheetEditor.tsx` e `ShippingWizard.tsx` não existem mais; `bun run build` passa.
- [ ] Req. 6: introduzir de propósito um `bg-red-100` sem `dark:` num componente qualquer → `bun run check:tokens` acusa; reverter → passa limpo.
- [ ] Req. 7: `bunx tsc -p tsconfig.app.json --noEmit` limpo e `bun run check:tokens` limpo.
- [ ] Verificação visual dark mode (browser) nas 5 telas mais afetadas: Picking, LGPD, Financeiro (cards resumo), Fichas Técnicas (painel referência) e `/` aba Relatório — badges/cards legíveis nos dois temas.
- [ ] Req. 8: diff não toca nenhum arquivo/linha da seção Isenções.
