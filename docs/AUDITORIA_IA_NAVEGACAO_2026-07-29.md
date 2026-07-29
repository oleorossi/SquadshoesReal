# Auditoria de Arquitetura de Informação — menus, abas e perfis

- **Data:** 29/07/2026
- **Ferramenta:** Codex CLI (`gpt-5.6-terra`, reasoning `xhigh`), `codex exec -s read-only`,
  5 fatias independentes. Insumo factual: `docs/ia-inventory.json`, gerado por
  `scripts/ia-inventory.mjs` (novo, read-only, sem dependências).
- **Escopo:** toda a camada de navegação — o modelo (`src/data/navigation.ts`), o roteador
  (`src/App.tsx`), o shell (`src/components/layout/**`, `src/contexts/TabsContext.tsx`),
  as abas dentro das páginas (63 arquivos) e o controle de acesso
  (`src/hooks/useAccessControl.ts`, `src/data/permissionTemplates.ts`).
- **Confiança:** cada achado é marcado **Confirmado** (lido no código) ou **Suspeita**
  (depende de estado de runtime/banco, com o modo de confirmar descrito). Os achados que
  viram edição foram reconfirmados manualmente — ver *Verificações independentes* abaixo.

> ⚠️ **Nada aqui é barrado pelo build.** O TypeScript do projeto é `strict:false` e o
> Vite não type-checa. Além disso, `scripts/check-navigation-access.mjs` (que roda dentro
> de `npm run build`) só valida uma coisa: que toda rota do menu está em
> `ROUTE_MODULE_MAP`. Nenhum dos achados abaixo é detectável pelos guards atuais — e
> `src/lib/navigationAudit.ts`, que checa 5 invariantes em runtime, **hoje reporta zero
> problemas**.

---

## Sumário executivo

O menu já foi reorganizado seis vezes — as rodadas estão documentadas em comentários
dentro do próprio `navigation.ts` ("round-5", "round-6", "remodelagem 2026-07-12"). O
arquivo declara as próprias regras ("máximo 5 itens por grupo", referência SAP Fiori
*Spaces & Pages*) e hoje viola quase todas. A causa não é desleixo: **navegação,
permissão e roteador são três modelos separados que nada obriga a concordar**, e cada
rodada de reorganização mexeu em um sem que os outros acompanhassem.

### O retrato medido

| Medida | Valor |
|---|---|
| Rotas declaradas no roteador | 184 |
| Telas de verdade (sem redirect, sem `:id`, sem moldura) | 104 |
| Redirects legacy acumulados | 72 |
| Itens na sidebar | 54, em 10 grupos (o comentário do arquivo ainda diz "32") |
| Grupos acima do limite de 5 declarado | 4 — Comercial 8, Compras 8, Logística 8, Produção 7 |
| Telas com rota viva e nenhuma entrada de navegação | 25 |
| Arquivos com abas internas | 63 |
| Abas que não escrevem nada na URL | 56 |
| Conjuntos com mais de 5 abas | 13 (o maior tem 16) |

Duas checagens vieram **limpas** e merecem registro: nenhum item de menu aponta para rota
inexistente, e nenhum aponta para redirect. O modelo de menu está íntegro — o problema é
o que ele deixou de fora e como está agrupado.

### Temas transversais

| # | Tema | Gravidade | Onde aparece |
|---|---|---|---|
| **T1** | **A interface oferece caminho que a permissão nega.** Sidebar, BottomNav, FAB, Cmd+K e cards do Dashboard resolvem acesso por caminhos diferentes; só a sidebar é o "vocabulário" de permissão (`resolveMenuOwner` só olha `menuGroups`). Tudo que não é item de menu fica sem dono e é negado em modo granular. | 🔴 Crítico | S1, S2, S4 |
| **T2** | **Estado de navegação que morre.** 56 dos 63 arquivos com abas não escrevem na URL. F5 e o botão Voltar devolvem o usuário à primeira aba. Sete telas guardam a aba em `localStorage`, que ainda ganha do deep-link. | 🟠 Alto | S3 |
| **T3** | **Eixos de navegação demais.** Breadcrumb + `TabBar` de páginas abertas + abas da página + chips de filtro somam **233 px fixos antes do conteúdo** em `/estoque`, com quatro aparências diferentes para quatro significados diferentes. | 🟠 Alto | S2, S3 |
| **T4** | **Mapas paralelos que derivam.** `PageHeader.routeLabels`/`parentGroups`, `usePrefetchRoute`, `BottomNav.PRIMARY_ITEMS` e `ROUTE_MODULE_MAP` são listas mantidas à mão em paralelo a `navigation.ts`. Todas já divergiram. | 🟠 Alto | S2 |
| **T5** | **Aliases sem política.** 72 redirects acumulados, 22 deles passando por um hub morto (`/pcp`) e sofrendo salto duplo. Sem prazo, sem registro de qual é bookmark real. | 🟡 Médio | S1 |
| **T6** | **Padrão que existe e não foi adotado.** `HubTabsList` foi criado explicitamente para padronizar as abas e é usado por 2 arquivos; 7 páginas reimplementaram o mesmo visual à mão. E o próprio `HubTabsList` está com bug (ver F6). | 🟡 Médio | S3 |

---

## Achados que exigem decisão do dono

Estes não são correções técnicas — mudam o produto e precisam de aprovação antes de virar
código.

### D1 — Os 6 relatórios A4 imprimem dados falsos 🔴

**Confirmado.** `src/pages/RelDiarioA4.tsx:24` diz literalmente
`// Dados mock (substituir por hook real)`. Os KPIs são strings fixas
(`'Pares produzidos', v: '1.284'`). O mesmo vale para `RelOpA4`, `RelOeeA4`,
`RelQualidadeA4`, `RelRefugoA4` e `RelSemanalA4`.

O hub (`src/pages/RelatoriosHub.tsx:117-120`) apresenta os cards como relatórios oficiais
prontos para impressão. **A gerência pode imprimir e circular indicadores fictícios como
se fossem números da fábrica.**

Agrava: o módulo `reports` que governa essas rotas **não é concedido a nenhum perfil**
(ver F2) — então hoje só admin consegue abrir. O bug de permissão está, por acidente,
contendo o problema maior.

**Opções:** (a) retirar os cards do hub até haver fonte de dados; (b) manter com aviso
inequívoco de homologação na própria folha; (c) apagar as 6 telas.

### D2 — Aposentar a `TabBar` de páginas abertas?

O `src/contexts/TabsContext.tsx:11-15` documenta a própria limitação: trocar de aba
**desmonta a página e perde o estado interno**. Persiste só `{path, title}`, limita a 6 e
descarta a mais antiga. Ou seja: parece um workspace, funciona como barra de favoritos.

Custo: 37 px fixos no topo de toda tela desktop, e um quarto eixo de navegação competindo
por significado com o breadcrumb.

O sistema já tem navegador com histórico, favoritos persistidos no banco
(`useMenuFavorites`) e Cmd+K. **Recomendação da auditoria: aposentar.** Mas é um recurso
que alguém pode estar usando todo dia — por isso é decisão, não correção.

### D3 — `/producao/analises`: 16 ferramentas numa tela só

Dividir em destinos próprios no menu (Capacidade & Gargalos · Eficiência & Tempos ·
Qualidade & Auditoria · Controle de Lotes) **engorda o grupo Produção de 7 para 10**, o
dobro do limite declarado.

Manter agrupado dentro da página respeita o limite, mas mantém 16 ferramentas atrás de um
único rótulo genérico ("Análises") — e sem `role="tab"` nenhum, hoje.

**A saída provável é a terceira:** o limite de 5 passa a valer **por perfil**, não em
absoluto. Um operador vê 5 itens em Produção; o gerente vê 10. Isso reconcilia o limite
com o Round-7 e é a espinha da proposta — mas muda o significado da regra e precisa da
sua palavra.

### D4 — `/producao/apontamento`: 11 abas de setor

Diferente do D3 de propósito: são **11 postos físicos equivalentes** e o operador trabalha
em um por vez. A auditoria recomenda trocar as 11 abas por um seletor de setor,
preservando `?tab=<setor>`. Menos disruptivo, mas muda o gesto de quem aponta produção
todo dia.

---

## Bugs de acesso (T1) — corrigir independente do redesenho

| # | Achado | Severidade | Onde |
|---|---|---|---|
| **F1** | **A aba "PCP" some do celular.** `BottomNav.PRIMARY_ITEMS` aponta para `/pcp`, que não é item de menu → `resolveMenuOwner` não acha dono → `canAccessRoute` nega em modo granular. Além disso `/pcp` é redirect, então mesmo funcionando abre outra tela e deixa a barra sem item ativo. | 🔴 Crítico | `BottomNav.tsx:9-14` · `useAccessControl.ts:240-262` |
| **F2** | **Os 6 relatórios A4 são admin-only sem ninguém saber.** O módulo `reports` está em `ROUTE_MODULE_MAP` mas **nenhum perfil o lista** em `ROLE_MODULES`. Há comentário no código afirmando que gerente tem acesso — é falso. | 🔴 Crítico | `useAccessControl.ts:78-92` × `:177-214` |
| **F3** | **O botão "Ordem de Produção" leva a uma parede.** `/orders` saiu da sidebar mas continua sendo destino do FAB (`AppLayout.tsx:51`) e dos cards do Dashboard (`Dashboard.tsx:187`). Sem item de menu, não há dono. | 🔴 Crítico | `App.tsx:766` |
| **F4** | **As 12 rotas de Cmd+K não abrem em modo granular.** `secondaryRoutes` não entra em `getAllMenuItems()`, então nenhuma tem dono. SAC, Forecast, Produtividade, Bipagem EAN, Rastreamento, Patrimônio, Perfis Tributários e as 4 de Sistema aparecem na busca e negam no clique. | 🟠 Alto | `navigation.ts:196-220` · `useAccessControl.ts:242` |
| **F5** | **A busca global mostra telas que o usuário não pode abrir.** As consultas de entidade e as ações rápidas passam por `canAccessRoute`; os resultados de "Páginas" e a lista do estado vazio, não. | 🟠 Alto | `GlobalSearch.tsx:508-519, 705-717, 848-861` |

**Correção comum a F1–F4:** o vocabulário de permissão não pode ser "os itens da sidebar".
Precisa ser **uma lista de destinos concedíveis** que inclua `secondaryRoutes` e os
destinos alcançados por ação (FAB, cards). Enquanto `resolveMenuOwner` só olhar
`menuGroups`, todo destino fora do menu nasce quebrado — e foi assim que estes quatro
apareceram.

---

## Achados de integridade

| # | Achado | Severidade |
|---|---|---|
| **F6** | **`HubTabsList` emite dois sinais de seleção.** Monta a pill mas **não passa `indicator="none"`** para o `TabsList`, então recebe também a barra vermelha deslizante do padrão editorial. Corrigir **antes** de migrar qualquer página para ele, senão a inconsistência se espalha. | 🟡 Médio · `HubTabs.tsx:24` |
| **F7** | **Aba fantasma "Consolidada".** `Contractors.tsx:1539` declara o `TabsTrigger` e **não existe `TabsContent value="consolidated"`** (verificado). O hub também não a inclui em `CONTRACTOR_TABS`. Clicar mostra painel vazio. Veredito: **remover**, não há o que promover. | 🟡 Médio |
| **F8** | **Breadcrumb duplica "Produção" e aponta para o hub morto.** `parentGroups['producao'] = { label: 'Produção', to: '/pcp' }` mais o segmento `producao` em `routeLabels` produzem **"Produção › Produção › Kanban"**, e o primeiro leva ao tradutor `/pcp`. Oito segmentos apontam para `/pcp`. | 🟠 Alto · `PageHeader.tsx:95-103, 160-177` |
| **F9** | **O prefetch do hover é no-op em 33 dos 54 itens.** `usePrefetchRoute` é lista manual e não tem **nenhuma** das 7 telas novas de `/producao/*`, nem `/grupos`, `/silks`, `/quotations`, `/cnab`, `/sped` e outras. Os itens de Sistema nem chamam o evento. | 🟡 Médio · `usePrefetchRoute.ts:5-59` |
| **F10** | **Duplicatas de rota com comportamento divergente.** `/inventory` e `/technical-sheets` estão declaradas 2×. A primeira de cada preserva `location.search`; a segunda descarta. Hoje o React Router usa a primeira — trocar a ordem quebraria `/inventory?tab=history` e `/technical-sheets?ref=…` em silêncio. Remover apenas as segundas (linhas 1240 e 1244). | 🟡 Médio · `App.tsx:1077/1240, 750/1244` |
| **F11** | **Código morto no shell.** `PageShell.tsx` (65 linhas) e `src/components/ui/sidebar.tsx` (637 linhas, primitive shadcn nunca adotada) têm **zero importadores**. A sidebar real é a closure `sidebarContent()` dentro do `AppLayout` (~420 linhas). Veredito da auditoria: **deletar os dois**; adotar o primitive exigiria migrar drawer, foco, persistência, favoritos, permissões e drag-and-drop sem resolver nenhuma regra de negócio. | ⚪ Baixo |
| **F12** | **`QualityModule` e `ReportsModule` são redirects para redirects.** Arquivos de 5 linhas que só apontam para outro alias. Deletar. | ⚪ Baixo · `src/modules/*` |

---

## O zumbi `/pcp` (T5)

`PCPHub.tsx` não é mais um hub: virou tradutor de `<Navigate>` (`:16-60`). **22 rotas
legadas redirecionam para dentro dele e sofrem segundo salto.**

```
/shop-floor, /wip-control, /cycle-count, /modules/production → /pcp → /producao/planejamento
/setores                        → /pcp?tab=setores          → /producao/apontamento
/corte …/acabamento (6 setores) → /pcp?tab=setores&sub=X    → /producao/apontamento?sub=X
/pcp-dashboard, /production-dashboard, /production → /pcp?tab=dashboard → /producao/analises?view=dashboard
/gargalos            → /pcp?tab=gargalo-semanal → /producao/analises?view=gargalos
/producao/live       → /pcp?tab=quadro&modo=cartoes  → /producao/kanban
/producao/timeline   → /pcp?tab=quadro&modo=timeline → /producao/analises?view=timeline
/producao/visao-agregada → /pcp?tab=quadro&modo=lote → /producao/analises?view=lote
/producao/fluxo      → /pcp?tab=quadro&modo=matriz   → /producao/analises?view=matriz
/order-flow-audit    → /pcp?tab=auditoria            → /producao/analises?view=auditoria
/lead-time           → /pcp?tab=lead-time            → /producao/analises?view=lead-time
```

Fora do `/pcp`, há mais uma cadeia: `/ponto` → `/timesheet` → `/rh?tab=ponto`.

**Desmonte proposto:** (1) reescrever as 22 origens para o destino final; (2) `/pcp` sem
query vira redirect direto para `/producao/planejamento`; (3) manter o tradutor
exclusivamente para bookmarks `/pcp?tab=…`, sem nenhum redirect interno apontando para
ele; (4) remover após 90 dias sem acesso.

## Política dos 72 redirects

A classificação "URL realmente bookmarcada" é **Suspeita por natureza** — o código prova o
redirect, não prova tráfego. Recomendação: instrumentar `legacy_redirect_hit` por rota e
aplicar a regra **zero usuários distintos em 90 dias ⇒ remover**.

| Política | Quantidade | Exemplos |
|---|---|---|
| **PERMANENTE** | 3 | `/`, `/login`, `/pedidos/:id` |
| **COM PRAZO — até 12/01/2027** (6 meses da remodelagem de 12/07) | ~64 | Todos os aliases de Engenharia/Estoque, Produção, RH, Comercial e Compras |
| **REMOVER JÁ** | 5 | `/wip-control` e `/cycle-count` (levam a tela semanticamente diferente), `/modules/production`, e as duplicatas de `/inventory` (1240) e `/technical-sheets` (1244) |

---

## Destino das 25 telas órfãs

| Rota | Veredito | Destino |
|---|---|---|
| `/estoque/historico` | VIRAR ABA | `/estoque?tab=history` — a tela já está montada lá |
| `/alertas-estoque` | VIRAR ABA | `/estoque?tab=alerts` — incorporar, hoje a aba mostra outra coisa e omite alerta de solado por numeração |
| `/consumo-base` | VIRAR ABA | `/solados`, aba Consumos — duplica `SolesConsumosTab`; migrar os trechos de silk e embalagem |
| `/mrp-advanced` | VIRAR ABA | `/purchase-planning?tab=mrp` — mesma `MrpNeedsTable` |
| `/reports` | VIRAR ABA | `/relatorios?tab=analytics` — é o painel real de analytics, hoje separado do hub |
| `/cost-policies` | VIRAR ABA | `/settings?tab=finance-config` — é configuração administrativa |
| `/rh/pendencias-ponto` | VIRAR ABA | `/rh?tab=ponto&subtab=manual` — já unificada lá |
| `/rh/ausencias` | VIRAR ABA | `/rh?tab=ponto&subtab=ausencias` — a própria página já é reusada embutida |
| `/orders/summary` | VIRAR VISÃO | `/orders?view=resumo` |
| `/orders/grouped-summary` | VIRAR VISÃO | `/orders?view=agrupado` — depende de OPs selecionadas |
| `/sales/consumo` | VIRAR VISÃO | `/sales?view=consumo&ids=…` — sem IDs mostra vazio |
| `/orders` | SÓ Cmd+K | Manter fora da sidebar (decisão do dono) mas **tornar concedível** — ver F3 |
| `/producao/kanban/gestao` | SÓ Cmd+K | Estação em tela cheia, já aberta pelo "Modo Gestão" do Kanban |
| `/fichas-tecnicas/padroes` | SÓ Cmd+K | Configuração global, já alcançada por botão em Fichas |
| `/reservas-estoque` | SÓ Cmd+K | Visão especializada de planejamento, não navegação diária |
| `/unit-audit` | SÓ Cmd+K | Ferramenta eventual de admin |
| `/relatorios/*` (6 telas) | **BLOQUEAR** | Viram abas do hub **só depois de terem dados reais** — ver D1 |
| `/pcp` | DELETAR o hub | Vira compatibilidade temporária — ver acima |
| `/modules/quality`, `/modules/reports` | DELETAR | Redirects para redirects |

Fora dessa conta ficam 8 rotas isentas **por desenho** (login, PWA do representante,
formulários alcançados por ação, ferramentas de dev) — registradas em `EXEMPT_FROM_MENU`
dentro de `scripts/ia-inventory.mjs`.

---

## Contrato único de deep-link (T2)

Fecha o problema das 56 telas. Vira `src/hooks/useUrlTabState.ts`, reusado por todas.

- `tab` é o parâmetro da primeira navegação por abas; `subtab` da filha; `panel` só para
  uma terceira **realmente compartilhável**. Nunca para filtro, diálogo ou formulário.
- **A aba default é a ausência do parâmetro** — ao selecionar o default, remover da URL.
- Clique do usuário faz **push**; normalização de alias ou valor inválido faz **replace**.
- **Preservar todos os parâmetros alheios.** Nunca `setSearchParams({ tab })` — isso
  descarta filtros e contexto.
- Ao trocar `tab`, limpar `subtab`/`panel` incompatíveis.
- **`localStorage` perde para a URL.** Nas 7 telas persistidas, usar o valor salvo apenas
  como migração de uma vez (sem URL → escreve a canônica com `replace`); depois remover a
  persistência de aba.
- `?view=` permanece só onde é seletor de visão real (Planejamento de Compras). `?sub=` do
  Apontamento é legado: ler uma vez e normalizar para `?tab=`.

**Caso `Finance`:** os aliases hoje chegam na área certa e na subaba errada — um link para
Factoring abre Comissões; um para Fluxo de Caixa abre DRE
(`Finance.tsx:738` × `:1467`, `FinanceReportsTab.tsx:574`). Normalizar para `tab`+`subtab`
mantendo as 19 chaves antigas aceitas como entrada.

## Linguagem visual canônica (T6)

- **`HubTabsList` (pill)** — áreas de trabalho paralelas de um hub, trocadas com
  frequência, 3+ destinos. **Corrigir F6 primeiro.**
  Migrar: `Index.tsx`, `TerceirizadosHub.tsx`, `PricingCalculator.tsx`, `RHHub.tsx`.
- **Padrão editorial do `ui/tabs.tsx`** — subáreas locais de um registro, diálogo ou
  painel, até 5 opções.
- **Filtros deixam de ser abas** — período, status, horizonte viram chips ou `Select`
  (`MrpProjectionsTab`, `SheetsAuditPanel`).

---

## Verificações independentes

Regra desta auditoria: achado do Codex que eu não confirmasse no código não vira edição.
Reconferidos manualmente antes de entrar no plano:

| Achado | Verificação | Resultado |
|---|---|---|
| D1 — relatórios com mock | `grep` em `RelDiarioA4.tsx` | ✅ `// Dados mock (substituir por hook real)` na linha 24; KPIs são strings fixas |
| F6 — `HubTabsList` sem `indicator="none"` | leitura de `HubTabs.tsx:22-40` | ✅ monta `<TabsList className=…>` sem a prop |
| F7 — aba "Consolidada" fantasma | `grep 'TabsContent value="consolidated"'` | ✅ não existe; `CONTRACTOR_TABS` não a inclui |
| F8 — breadcrumb duplicado | leitura de `PageHeader.tsx:160-177` | ✅ empurra o pai e depois todos os segmentos → "Produção › Produção › Kanban" |
| F11 — código morto | `grep -rl` por importador | ✅ zero para `PageShell` e `ui/sidebar.tsx` |
| F2 — módulo `reports` órfão | `scripts/ia-inventory.mjs` | ✅ `modulesGrantedToNobody: ['reports']` (6 rotas) |
| F1 — BottomNav quebrado | `scripts/ia-inventory.mjs` | ✅ `bottomNavFindings: ['PCP → /pcp']` |

---

## Status por lote

| Lote | Escopo | Situação |
|---|---|---|
| Fase 0 | `scripts/ia-inventory.mjs` — inventário mecânico | ✅ |
| Fase 1 | Auditoria Codex, fatias S1–S3 (rotas · shell · abas) | ✅ |
| Fase 1 | Fatias S4 (perfis) e S5 (visual/a11y) | 🔄 em execução |
| Fase 2 | Proposta + artifact de aprovação | ⏳ |
| L1 | Guards em modo relatório + baseline | ⏳ |
| L2 | Bugs de acesso F1–F5 | ⏳ |
| L3 | Órfãs e código morto (F7, F10, F11, F12) | ⏳ |
| L4 | Aliases e desmonte do `/pcp` (+ F8, F9) | ⏳ |
| L5 | Reestruturação de `menuGroups` | ⏳ |
| L6 | Abas: `useUrlTabState`, F6, migração visual, ARIA | ⏳ |
| L7 | Menu por perfil (Round-7) | ⏳ |
