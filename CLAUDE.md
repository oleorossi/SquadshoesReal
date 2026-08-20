# Squad Shoes — Claude Code Guide

## Deployment Architecture

- **Deploy:** Vercel (auto-deploy a cada push em `main`).
- **Production URL:** https://squadshoes-real.vercel.app
- **Branch de deploy:** `main`
- **Branch de trabalho:** `claude/zen-knuth-4c26c5` (ou qualquer `claude/*`).
- **Banco:** Supabase project `ssvxfoybzmjlypnipqzn` (us-west-2). Migrations aplicadas via MCP ou SQL Editor.

> **Histórico:** o projeto saiu de uma fase usando Lovable como editor + deploy. Em mai/2026 migrou pra Vercel + Claude Code. O pacote `lovable-tagger` ainda fica em `devDependencies` por compatibilidade com lockfile (não é mais usado em build — removido do `vite.config.ts`). Pra desinstalar de vez: rode `bun remove lovable-tagger` localmente e commite o novo lockfile.

## Automatic Sync (bidirectional)

Both hooks use **rebase** instead of merge to keep a clean linear history and avoid silent data loss.

| Hook | Script | When | What it does |
|------|--------|------|--------------|
| `SessionStart` | `~/.claude/session-start-sync.sh` | Start of session | Fetches `main`, **rebases** current branch on top. Falls back to merge `-X theirs` if rebase has conflicts. |
| `Stop` | `~/.claude/stop-hook-git-check.sh` | End of turn | Faz commit + push da feature branch. Se a branch está ahead de main sem divergência, fast-forwarda main via push refspec (worktree-safe). Se diverge, faz merge local com `-X theirs`. |

## Pipeline completo de auto-deploy (toda mudança vai pra produção)

```
SUA MUDANÇA NO CÓDIGO
     ↓
git commit + push (manual ou via stop hook)
     ↓
GitHub feature branch atualizada
     ↓ (stop hook auto-merge)
GitHub main atualizada
     ↓ (Vercel GitHub integration)
Vercel build → site live em ~1-2min
     ↓ (se mexeu em supabase/migrations/**)
GitHub Action `supabase-migrate.yml`
     ↓
supabase db push → DB live
```

**Status / configuração**: rode `bash scripts/setup-cicd.sh` pra ver o status atual, URLs e os passos pendentes (especialmente os 3 secrets do Supabase que precisam ser cadastrados manualmente).

## Conflict Resolution Strategy

| Direction | Strategy | Rationale |
|-----------|----------|-----------|
| Remote → Claude (session start) | `git rebase origin/main` | Commits remotos primeiro, Claude por cima — linear, sem overwrite. |
| Claude → main (session end) | rebase + `--ff-only` on main | Branch rebased fast-forwards main limpo. |
| Fallback (real conflict) | merge `-X ours` while on feature branch | "ours" = feature branch = trabalho atual. |

## Developer Rules

1. **Always commit before stopping** — the stop hook will block if uncommitted changes exist.
2. **Never force-push main** — Vercel depende de um histórico limpo pra deploy correto.
3. **Migrations go in `supabase/migrations/`** — aplicar via Supabase MCP (preferido) ou SQL Editor.
4. **TypeScript must stay clean** — run `bunx tsc -p tsconfig.app.json --noEmit` before committing.
   ⚠ **NÃO** use `bunx tsc --noEmit` (raiz): o `tsconfig.json` é um *solution file*
   (`files: []`, só `references`) e **não checa NADA** — retorna limpo sempre. O build
   Vite/esbuild também **não** type-checa. Logo, símbolo não-definido (ex.: `sharedSpecs`)
   ou import de export inexistente (ex.: ícone lucide importado do phosphor) passa direto
   e vira **ReferenceError em produção**. O typecheck de verdade é só com `-p tsconfig.app.json`.
5. **Após edits visuais** — run `bun run check:tokens` to detect hardcoded colors that should be design tokens.
   ⚠ **`npm` NÃO existe nesta máquina** (verificado 31/07/2026: `npm -v` →
   "command not found"). O package manager é o **Bun** — use sempre `bun run <script>`
   / `bunx`. E `node` é um *symlink pro próprio bun* (`~/.bun/bin/node -> bun`), então
   `node -v` imprime o help do `bun run` em vez da versão; os scripts `.mjs` do build
   rodam sob o shim, mas não confie no `node` como se fosse Node.js de verdade.
6. **Fonte em fichas/etiquetas/cartões** — sempre a **MAIOR que couber** na moldura, nunca
   abaixo dos pisos. Quando não couber, remova conteúdo antes de reduzir. Ver
   "Tamanho de fonte em print" na seção *Design Token System*.

## Padrões de Código (CANÔNICO — seguir em toda sessão)

> Convenções **observadas no código real** (não são aspiracionais). Ao criar/editar
> arquivos, siga o padrão do módulo vizinho — este é o resumo pra não ter que
> reengenhar toda vez. Quando um arquivo existente contradisser esta seção, o padrão
> local do módulo vence; abra a divergência em vez de "corrigir" em massa.

### Stack e ferramentas
- **Package manager: Bun.** `bun.lock` é a fonte de verdade (existe um `package-lock.json`
  obsoleto — ignorar). Use `bun run <script>` / `bunx`.
- **Typecheck canônico:** `bunx tsc -p tsconfig.app.json --noEmit` (ver Regra 4 acima —
  a raiz não checa nada).
- **Lint:** `bun run lint` (`eslint .`, flat config em `eslint.config.js`). **Sem Prettier** —
  não introduzir; siga o estilo do arquivo vizinho. `@typescript-eslint/no-unused-vars` está
  **off**, então limpe imports/vars mortos você mesmo.
- **TS é LOOSE de propósito** (`tsconfig.app.json`: `strict:false`, `noImplicitAny:false`).
  Não ligar `strict` global. Como o compilador é permissivo, um símbolo indefinido só
  estoura em runtime — por isso o typecheck com `-p tsconfig.app.json` é obrigatório.
- **Import alias `@/` → `src/`** (declarado em `tsconfig.app.json` e espelhado em
  `vite.config.ts`). Sempre `import { x } from '@/lib/...'`, nunca caminho relativo longo
  (`../../../`).

### Estrutura de pastas (onde cada coisa mora)
| Pasta | Papel |
|---|---|
| `src/pages/` | 1 arquivo por rota/tela, flat, PascalCase, `export default function`. Rotas em `src/App.tsx`. |
| `src/components/<domínio>/` | Componentes por feature (~43 subpastas: `clients/`, `production/`, `finance/`…). |
| `src/components/ui/` | Primitives shadcn + próprias. **Named export** + `React.forwardRef` + `cva`. Arquivos **kebab-case**. |
| `src/hooks/` | ~200 `use*` — **camada primária de acesso a dados** (React Query sobre Supabase), 1 por entidade. |
| `src/lib/` | Lógica de domínio pura / helpers de print/export. Testes colocados (`*.test.ts`). |
| `src/services/` | Orquestração pesada / chamadas a RPC Supabase (`costingService`, `consumptionService`…). |
| `src/integrations/supabase/` | `client.ts` (singleton) + `types.ts` (**gerado — não editar à mão**). |
| `src/types/` | Tipos de domínio compartilhados por área. |
| `src/data/` | Dados estáticos/seed/config (`navigation.ts`, `permissionTemplates.ts`). |

### Componentes
- **Página/feature:** `export default function Nome()` (declaração nomeada, não arrow const).
  Arquivo **PascalCase**.
- **Primitive em `ui/`:** named export com `forwardRef` + `cva` (ver `button.tsx`); expõe também
  `nomeVariants` e a interface de props.
- **Props: `interface`** (padrão dominante — `interface Props { … }` local). `type` só quando
  precisar de união/interseção.
- **shadcn:** importar de `@/components/ui/*`. **Ícones: `@phosphor-icons/react`**, aliasando
  pros nomes estilo-lucide quando ajudar a legibilidade (`import { CircleNotch as Loader2 } from '@phosphor-icons/react'`).
  Não importar de `lucide-react` (não é a lib do projeto — vira ReferenceError).

### Primitives de página — use antes de reinventar (auditado 10/08/2026)

> Existem primitives que resolvem tela de listagem inteira e **quase ninguém importa** —
> enquanto **36 telas escrevem `<table>` cru** e há ~25 estados vazios ad-hoc. O problema
> é **descoberta**, não disciplina: ninguém acha o que não sabe que existe. Esta tabela é
> o índice. ⚠ Dois dos cinco **não devem ser usados** — ver veredito.

| Primitive | Importações | Veredito |
|---|---|---|
| `ui/data-list-page` → `DataListPage` | 5 de 144 telas | ✅ **USE** — resolve a listagem inteira |
| `ui/data-table` → `DataTable` | 0 | ✅ **USE** quando os dados já estão em memória |
| `ui/page-container` → `PageContainer`/`PageHeader` | 0 | ❌ **NÃO USE — briga com o `AppLayout`. Candidato a apagar** |
| `ui/StatusCard.tsx` → `StatusCard` | 0 | ❌ **NÃO USE — redundante com `StatCard` (52 arquivos). Candidato a apagar** |
| `ui/mini-mark` → `MiniMark` | 0 | ⚠ **quebrado no destino pra que foi feito** (etiqueta) |

Comparativo de adoção, pra calibrar: `ui/panel` **91**, `EditorialPageHeader` **128**,
`ui/stat-card` **52**. Cauda que já funciona e vale reusar: `ui/selectable-table` (1),
`ui/list-pagination` (3), `ui/selection-totals-bar` (2 — **específico de financeiro**:
a API é `count/total/paid/pending/onGeneratePdf`, não serve de barra genérica).

#### `DataListPage` — a que evita as 36 tabelas cruas

Entrega, num componente só: header (`EditorialPageHeader` quando recebe `sectionLabel`),
**a própria query Supabase**, `StatGrid`/`StatCard`, tabela dentro de `Panel flush`,
estado de carregando, `EmptyState` e — opcional — checkbox por linha + `BulkActionsBar`
com exclusão em massa confirmada (`confirmAndBulkDelete`). Você **não** escreve o `useQuery`:
passa `table` e ele monta `.select().order().limit()` + `.eq()` por `filters`.

```tsx
<DataListPage
  sectionLabel="Compliance" title="Solicitações LGPD" table="lgpd_requests"
  columns={[{ key: 'subject_name', label: 'Titular' },
            { key: 'status', label: 'Status', align: 'right',
              render: r => <Badge className={REQ_STATUS[r.status]}>{r.status}</Badge> }]}
  enableBulkDelete entityLabel="solicitação" displayLabel={r => `• ${r.subject_name}`} />
```

**QUANDO usar:** listagem chapada de UMA tabela, com filtros de igualdade, ≤100 linhas.
**Quando NÃO usar:** precisa de `join`/view com agregação, busca textual, ordenação pelo
usuário, paginação, ou edição inline — aí o custo de contornar o componente passa o de
escrever a tela. Não force `filters` a virar filtro complexo: ele só faz `.eq()`.

⚠ **A query key vem de `dataListPageKey(table)`** (exportado do mesmo arquivo) — a
mutation da sua página tem que invalidar com **`dataListPageKey(table)`**, nunca com a
string literal `['data-list-page']` (chave morta que ninguém registra — era o bug medido
em 10/08/2026, quando 4 dos 5 call sites invalidavam no-op). **CORRIGIDO** (verificado
18/08/2026): os call sites importam o helper e o contrato está travado por
`ui/__tests__/data-list-page-key.test.ts`, que prova que a chave literal antiga NÃO
invalida. Em código novo, use sempre o helper.

⚠ **`limit` default = 100 e NÃO há paginação.** A 101ª linha some **sem aviso**. Acima
disso, ou sobe o `limit`, ou a tela não é caso de `DataListPage` (ver `ui/list-pagination`).

⚠ **`enableBulkDelete` faz `DELETE` direto na `table` da query** — sem soft-delete e sem
checar FK. Em tabela com dependente, o registro ou trava no erro do Postgres ou cascateia.
Só ligue em tabela folha.

⚠ **Sem `sectionLabel` o header cai no modo compacto legado** (`h1` + ícone), fora do
padrão editorial das outras 128 telas. Em página de rota, **sempre passe `sectionLabel`**;
omita só quando o componente estiver embutido dentro de aba/card.

⚠ **NÃO faz `document.title`** — se a tela precisa, faça na página. E `EmptyModulePage`,
exportado do mesmo arquivo, tem **0 usos**: é stub de módulo recém-criado, não substituto
do `EmptyState`.

#### `DataTable` — tabela client-side sobre dados que você já buscou

Genérico (`DataTable<T>`), sobre as primitives `Table` do shadcn. Dá busca textual
(`normalizeForSearch`, ignora acento), ordenação (`useTableSort` + `SortableTableHead`),
seleção com checkbox, menu de ações por linha, paginação client-side e skeleton de load.
Todas as dependências existem e conferem — está **são**, só nunca foi adotado.

```tsx
<DataTable data={pedidos} getRowId={p => p.id} searchable pageSize={20}
  columns={[{ key: 'codigo', title: 'Código' },
            { key: 'total', title: 'Total', render: p => formatCurrency(p.total) }]}
  actions={[{ label: 'Excluir', variant: 'destructive', onClick: p => remover(p.id) }]} />
```

**QUANDO usar:** os dados **já estão em memória** (hook React Query próprio) e você ia
escrever `<table>` na mão. É o substituto direto das 36 tabelas cruas quando `DataListPage`
não serve porque a query é sua.
**Quando NÃO usar:** dataset grande com paginação **server-side** — ele filtra, ordena e
pagina tudo em memória. E a barra de seleção dele é **própria**, não é a `BulkActionsBar`:
se a tela já usa `BulkActionsBar`/`useTableSelection`, prefira `ui/selectable-table` pra
não ter duas UIs de seleção diferentes no mesmo módulo.

#### `PageContainer` / `PageHeader` (`ui/page-container`) — ❌ não use, apague

**Briga com o `AppLayout` nas três coisas que ele faz** (`AppLayout.tsx:953`):

| Prop | O que faz | Por que conflita |
|---|---|---|
| `density='default'` | `p-6` fixo | o `<main>` já aplica `px-4 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6` → **padding dobrado**, e troca o padding responsivo por um fixo |
| `animate=true` (default) | classe `page-enter` | o `AppLayout` **já** envolve os filhos em `<div key={pathname} className="page-enter">` → anima duas vezes, aninhado |
| `maxWidth` | `max-w-*` + `mx-auto` | reintroduz exatamente o cap de largura que o dono mandou **remover** em 19/05/2026 ("sempre se adequar à resolução de quem está acessando") |

O `PageHeader` exportado junto é uma versão pobre do `EditorialPageHeader` (128 arquivos)
e ainda **colide de nome** com `src/components/layout/PageHeader.tsx`, que é outra coisa
(breadcrumb mobile). Para header de página use `EditorialPageHeader`; para espaçamento,
`<div className="space-y-4">` como as demais telas.

#### `StatusCard` (`ui/StatusCard.tsx`) — ❌ não use, apague

Redundante com `ui/stat-card` → `StatCard`, adotado em **52 arquivos** e com API superset
(`unit`, `hint`, `delta`/`deltaTone`/`deltaLabel`, `icon`, `tone`, `onClick` acessível por
teclado, + `StatGrid`). O `StatusCard` só tem `title/value/icon/trend/type` e pinta o card
inteiro de cor. Nada que ele faça falta no `StatCard`. É também o **único arquivo
PascalCase** entre os primitives de `ui/` (a convenção é kebab-case) — foi por isso que
ninguém achou. Use `StatCard` com `tone`.

#### `MiniMark` (`ui/mini-mark`) — ⚠ não serve pro que o próprio docblock promete

O comentário diz "marca d'água nos cantos de **etiquetas**, fichas e cards de OP". **Em
etiqueta não funciona:** `printLabels.ts` monta o documento num `window.open` com apenas
Google Fonts + `<style>` inline — **sem Tailwind e sem `src/index.css`** —, então
`bg-primary`, `border-current` e `font-display` não resolvem lá; sai um quadrado sem borda,
sem "S" e sem o ponto. Por isso a etiqueta usa SVG inline (`silk-mark`), não este componente.

Sobra o uso inline no app (ficha/cartão), e aí ele esbarra na **regra 5 de print**: o único
sinal de marca é o quadradinho `bg-primary` (vermelho), que no **laser P&B da fábrica** vira
cinza. Antes de adotar, decida um destino: reescrever como SVG com cores hardcoded (aí serve
a etiqueta, conforme as regras de print) ou apagar. Não o use como está.

### Acesso a dados (padrão React Query)
- Supabase singleton: `import { supabase } from '@/integrations/supabase/client'`.
- **Query:** hook `use<Entidade>` com `useQuery({ queryKey: ['entidade'], queryFn, staleTime, gcTime })`;
  sempre `if (error) throw error;` antes de retornar.
- **Mutation:** `useMutation` + `useQueryClient`; `onSuccess` invalida a(s) query key(s) e dispara
  `toast.success(...)`; `onError` → `toast.error(...)`.
- **Notificações: `sonner`** (`import { toast } from 'sonner'`) — é a convenção viva (o radix
  toast/`use-toast` existe mas não é o padrão).
- Cast de payload Supabase com `as X` / `as unknown as X` é aceito aqui (consequência do TS loose +
  types gerados) — não é smell a "consertar".

### Formulários
- **Padrão dominante: `useState` controlado** + submit via mutation hook (objeto `form`/`setForm`
  passado por props).
- `react-hook-form` + `zod` (`zodResolver`, wrapper `ui/form.tsx`) **existe mas é exceção** (poucos
  arquivos). Use-o só se o formulário for genuinamente complexo; não migrar forms simples pra RHF.

### Rotas e controle de acesso (auditado 05/08/2026)

Rota autenticada precisa dos **dois** invólucros: `ProtectedRoute` (exige login +
`profiles.approved`) **e** `RouteGuard` (exige o módulo em `ROUTE_MODULE_MAP`,
`src/hooks/useAccessControl.ts`). `ProtectedRoute` sozinho **não** checa papel nem permissão —
rota que fica só com ele está aberta a qualquer usuário aprovado. Ao criar rota nova, copie o
encadeamento de `/producao/kanban/gestao`: `ProtectedRoute → Suspense → RouteGuard`.

- **PWA `/m/*` estava fora do `RouteGuard`.** As 4 rotas mobile ficavam só sob
  `ProtectedRoute`, e `MobileLayout` não checa nada → qualquer aprovado criava PV por
  `/m/new` (a policy de `sale_orders` só exige `is_approved_user()`), contornando a
  allow-list que valia pra ele no desktop. ⚠ `profiles.is_sales_rep` **não é portão**: só escolhe
  o destino do redirect pós-login (`AuthRoute`/`RootRedirect`), nunca bloqueia URL digitada.
  Fechado com `'/m': 'vendas'` no `ROUTE_MODULE_MAP` — o match é por prefixo **com fronteira**
  (`/` ou `?`), então uma entrada cobre as 4 rotas e não casa `/mrp`, `/mdfe`, `/montagem` —
  mais `<RouteGuard>` em volta do `<MobileLayout />`.
  ⚠ **Lacuna em aberto:** `/m` não é destino concedível em `src/data/navigation.ts`, então no
  modo granular por PATH um representante com grant em `/sales` é **negado** no `/m`. Hoje não
  afeta ninguém (ninguém tem `is_sales_rep`), e o comportamento está travado em
  `src/hooks/__tests__/isRouteAllowed.test.ts`. Decisão de produto pendente: dar um destino
  concedível ao `/m`, ou fazer o dono de `/m` resolver pra `/sales`.
- **`/design-preview` só existe em DEV.** Era declarada no mesmo nível de `/auth` (sem
  `ProtectedRoute`, sem `RouteGuard`, sem módulo) → abria em produção **sem login**. Agora vem
  de `DESIGN_PREVIEW_ROUTES` sob `import.meta.env.DEV`: em produção o array é vazio, a URL cai
  no `NotFound` do catch-all e o chunk não entra no bundle. Carregada pela propriedade `lazy`
  **do router**, não por `React.lazy` no topo do arquivo — um const no topo continuaria retido
  pelo bundler mesmo com a rota removida.
- ⚠ **`scripts/ia-inventory.mjs` porteia o build e varre `App.tsx` com regex que NÃO pula
  comentários.** Escrever nome de propriedade de rota seguido de dois-pontos dentro de um
  comentário do `App.tsx` corrompe o inventário e quebra o build com dezenas de violações
  falsas ("ghost-nav-entry") que não apontam pra causa.

### Nomenclatura / idioma (regra load-bearing)
- **Domínio em português, framework em inglês.** Entidades, colunas de banco, nomes de página,
  strings de UI e comentários → **pt-BR** (`razao_social`, `nfe_emitidas`, `'Cliente cadastrado!'`).
  Nomes de hook/util e **React Query keys** → inglês (`useCreateClient`, `queryKey: ['clients']`).
  Entidades fiscais/fabris permanecem em português mesmo no código.
- Locale pt-BR: `Intl.NumberFormat('pt-BR', …)`, moeda `BRL` (usar helpers de `src/lib/utils.ts`).

### Testes
- **Vitest** (`vitest/globals`). Colocar em `__tests__/` ao lado do módulo, ou `*.test.ts` direto
  ao lado do fonte. Sufixos usados: `.units.test.ts`, `.integration.test.ts`, `.edge-cases.test.ts`.
- Rodar: `bun run test` / `bun run test:units`.

**Estado atual (verificado 07/08/2026 rodando os dois):** `test` roda a suíte inteira e
`test:units` é um **subconjunto** dela — não há mais exclusão.

| Script | O que roda |
|---|---|
| `bun run test` | `vitest run` — **tudo**, inclusive os 4 `.units` |
| `bun run test:units` | só `conversao.units`, `rpc-parity.units`, `units.edge-cases`, `materialConsumption.units` (atalho pra iterar rápido) |
| `bun run test:db` | os 4 de banco, com `RUN_DB_INTEGRATION=1` — **sob demanda**, ver abaixo |

### Testes de banco — `bun run test:db` (11/08/2026)

⚠ **Skip não é verde, e isto custou caro.** Os 4 testes de banco
(`consumptionService.parity`, `consumptionService.integration`, `debitGuards.integration`,
`consumptionParity.integration`) ficaram em skip desde sempre. Quando finalmente rodamos as
funções, `run_consumption_integration_tests()` estava com **3 casos vermelhos** havia tempo
indeterminado — o fixture gravava consumo direto em `sole_technical_specs`, que virou tabela
**ESPELHO** de `sole_group_standard_items`. E o gatilho `tg_sole_specs_freeze_consumption` é
**assimétrico**: no UPDATE dá `RAISE`, no INSERT apenas **sobrescreve**. Os dm² viravam NULL
sem erro nenhum. Corrigido na migration `20261231121100`.

**A fricção que mantinha o skip era o `psql`.** Três dos quatro chamavam
`execSync('psql …')`, exigindo binário de Postgres e `PGHOST`. Como as três funções são
`public` + SECURITY DEFINER, passaram a rodar por **RPC do supabase-js**
(`src/test/dbGuards.ts`) — uma credencial destrava os quatro.

| variável | para quê |
|---|---|
| `VITE_SUPABASE_URL` | a de sempre |
| `SUPABASE_SERVICE_ROLE_KEY` | cobre as 4. `run_consumption_integration_tests` dá EXECUTE só a `authenticated`/`service_role`; `consumptionParity` lê tabelas sob `is_approved_user()` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | plano B — roda só `parity` e `debit_guards` (as que dão EXECUTE a `anon`) |

⚠ **Estas suítes ESCREVEM no banco de produção** — a de integração cria fixture em
`products`, `technical_sheets`, `sole_group_standard_items` e `sole_technical_specs` (UUIDs
fixos, limpa no fim). Por isso **não estão no CI**: decisão do dono em 11/08/2026. Rode à mão
ao mexer em consumo, custeio ou débito.

⚠ **`runGuardSuite` trata 0 casos como ERRO, não como suíte verde** — sem isso uma
credencial sem permissão devolveria vazio e passaria. Verificado: com a publishable, o de
integração falha com `permission denied … code=42501` em vez de fingir verde.

⚠ **Os pisos de `expect(rows.length)` estão no valor MEDIDO** (22 / 13 / 23 em 11/08/2026),
não num número folgado. O piso da paridade era 13 enquanto o comentário do próprio arquivo
dizia "total vivo: 22" — quase metade da suíte podia sumir sem ninguém notar.

<details>
<summary>Histórico: a armadilha do <code>--exclude</code> (resolvida)</summary>

Até 05/08/2026 o script era
`vitest run --exclude conversao.units --exclude rpc-parity.units --exclude units.edge-cases --exclude materialConsumption.units`,
e os dois scripts eram **disjuntos**: `test` rodava tudo MENOS esses 4, `test:units` rodava
exatamente esses 4. Durante a exclusão da perda de corte, 6 testes desses arquivos ficaram
vermelhos por vários pushes enquanto `bun run test` reportava **1.535 verdes** — ele excluía,
por construção, o único lugar onde o problema aparecia.

O `--exclude` saiu no commit `2f334d1` (05/08/2026), **como efeito colateral de um commit de
segurança** (`revogar SELECT de anon em 13 views SECURITY DEFINER`) que não tinha nada a ver
com testes. Ninguém decidiu remover a armadilha; ela caiu junto — e por isso esta seção ficou
desatualizada por dois dias descrevendo um comportamento que não existia mais.

A lição que sobrevive: **script de teste muda sem ninguém anunciar**. Antes de concluir "está
tudo passando", olhe o `package.json` em vez de confiar nesta tabela.
</details>

## Regra de cálculo de consumo de materiais (CANÔNICA)

> Fonte de referência do cálculo exibido na tela **"Consumo de Materiais"**
> (`/sales?view=consumo&ids=…` → `SummaryConsumptionPanel` +
> `MaterialConsumptionView`) e na lib `src/lib/materialConsumption.ts`. Toda
> mudança de consumo deve respeitar isto.

**Princípio central:** um valor de consumo armazenado como **dm²/par (área)** NUNCA pode
ser exibido/usado cru como se fosse a unidade linear do produto. Ele tem que ser
convertido para a unidade física do produto usando as dimensões da **ficha de
componente** (`component_sheets`).

### Conversões
- **Material de ÁREA cortado de bobina** (napa, couro, forro): `quantity_per_unit` /
  `*_consumption` está em **dm²/par**.
  - → **metros lineares** = `dm² ÷ (largura_mm / 10)` quando o produto é
    unidade linear (m/cm) e a ficha tem largura. (`convertDm2ToLinearMeters`)
  - → **placas** = `dm² ÷ área_da_placa_dm²` quando a unidade é placa.
    (`convertDm2ToPlates`)

⚠ **LARGURA é `dimensions_width`, não `GREATEST(width, length)`** (mig
`20261231120000`, 07/08/2026). O divisor linear usa a largura da bobina; a ÁREA da
placa é que usa largura × comprimento. Espelhado em `getLinearWidthMm`
(`materialConsumption.ts`) — fonte única, os dois motores importam dela.

<details>
<summary>Por que o <code>GREATEST</code> existia e por que caducou — não o restaure</summary>

`20260812120000_conversion-info-greatest-dimension` introduziu o `GREATEST` **de
propósito**: 25 fichas de napa estavam gravadas `1000×1370` (campos trocados), o SQL
lia largura=1000 → divisor 100 e o TS já fazia `max()` → 137, superestimando ~37% o
custeio. O `GREATEST` casou os dois lados sob a premissa escrita de que *"a maior
dimensão cadastrada é sempre a largura da bobina (≤1500mm)"*.

A premissa **caducou**: o grupo PALMILHA cadastrou `1000 × 1500 mm`, onde 1500 é o
COMPRIMENTO da placa — o próprio teto de 1500 citado como seguro virou o
contraexemplo. Pior, `1000×1500` dá **área 150 dm²**, numericamente igual ao divisor
errado que estava em uso: o número certo para PLACA estava sendo aplicado como se
fosse dm²/metro linear. Consumo de palmilha saía **33% subestimado**.

O fix conserta a CAUSA (normaliza as fichas invertidas) em vez de compensar no
cálculo. Napas continuam em 137; só PALMILHA muda (150 → **100**). Com o dado já
normalizado, voltar ao `GREATEST` quebra a palmilha de novo e não conserta mais nada.

⚠ **Sobrevivente**: as 26 fichas de `TIRA OVERLOCK 5MM` foram normalizadas para
`1370×1000` só para manter o número — mas uma tira de 5 mm não tem 1,37 m de largura.
É cadastro copiado de napa. Hoje é inócuo (a tira chega por `order_strap_needs`, que
não divide por `dm2_per_unit`, e não está em `sheet_materials`); vira erro de 137× no
dia em que alguém puser essa tira no BOM. Remoção é decisão de cadastro, não foi feita.
</details>
- **Item linear DIRETO sem ficha de componente** (tiras, elásticos): `quantity_per_unit`
  já está na unidade nativa (metro/contagem) → **NÃO converter**.
- **Solado**: por par, segmentado por **numeração** (`sizeBreakdown`), nunca por área.

### ⚠ Perda de corte NÃO existe neste sistema (decisão do dono, 03/08/2026)

A fórmula acima já terminou em `× (1 + perda%)`. **Esse fator foi arrancado de propósito**
— não é dívida nem esquecimento. **Nenhum caminho de consumo aplica perda**: nem os 5
motores TS (`materialConsumption`, `bomConsumption`, `orderConsumption`,
`weeklyPurchasingPlan`, `purchaseRequisition`), nem o SQL, nem custeio, MRP ou compra.

**Por quê:** os valores cadastrados na ficha (dm²/par, g/par, un/par) **já consideram o
rendimento real do material**. Somar um percentual por cima conta a mesma perda **duas
vezes** e infla, em cascata, consumo → reserva → débito → custeio → compra.

**O sintoma que expôs o bug (PV-00150):** itens de **mesma grade e mesma quantidade**
saíam com consumos **diferentes por COR** na ficha de Corte Forração — a mesma napa
fechava **81,09 m** no PRETO e **87,57 m** no NEW WHISKY/OFF WHITE, razão exata **1,08**,
porque a perda estava cadastrada por cor (0 no PRETO, 8 nas outras).

**Como foi feito** — em duas etapas, de propósito, pra TS e SQL pararem juntos sem janela
de drift (o drift de 8% entre os dois lados está em `docs/AUDITORIA_MOTORES_2026-07-21.md`):

| Etapa | Onde | O que fez |
|---|---|---|
| `20261112120800_remover-perda-de-corte-do-sistema` | dado | zerou `waste_pct` em todas as linhas e trocou o **DEFAULT 8** (herdado da criação da tabela na fase Lovable) por 0 |
| `20261115120300_excluir-perda-de-corte-do-sistema` (commit `2fde316`, 03/08/2026) | conceito, lado SQL | arrancou o `× (1 + waste/100)` das funções/views e **dropou as colunas** |
| commits `9a0ea69` + `ad1cc18` | lado TS | tirou a perda dos 5 motores, da UI, dos hooks e do caminho legado |
| commit `d69b725` | testes | rebaselinou os 6 testes que ainda cobravam a perda (ver a armadilha do `bun run test` em *Testes*) |

**Colunas que deixaram de existir** (verificado no banco em 05/08/2026):
`component_sheets.waste_pct` e `technical_sheets.consumption_loss_pct`. Se um código novo
referenciar qualquer uma das duas, ele está reintroduzindo a regra morta.

⚠ **Ao repetir um expurgo desse tipo, varra `pg_views` também.** A varredura original achou
7 pontos de aplicação; o 8º só apareceu durante a migration e era a **VIEW**
`purchase_projection_timeline` — view não aparece em varredura de `pg_proc`.

⚠ **Sobrevivente conhecido — DEFAULT 0 RATIFICADO pelo dono, destino do módulo AINDA em
aberto:** `technical_reference_materials.waste_factor` é outra tabela (módulo
**Referências Técnicas**, fora dos 5 motores de consumo) e **continua multiplicando**
`× (1 + waste_factor / 100)` em `TechnicalReferencePanel.tsx`,
`useTechnicalReferenceValidation.ts:193` e `:236`.

O que mudou (migration `20261126120000` + commit `dd86998`): só o **DEFAULT da coluna**
(5 → 0) e o **pré-preenchimento do painel** (8% cabedal / 3% solado / 5% palmilha / 10%
cola → 0). É **prevenção, não conserto** — a tabela tem **0 linhas** e nenhuma função ou
view de consumo, custeio, MRP ou compra a lê (a única que a referencia é `merge_product_into`,
que só remapeia `product_id`), então hoje o valor morre na própria tela. O risco era futuro:
com `DEFAULT 5`, toda linha nova nascia com perda, e no dia em que o módulo fosse religado a
algum cálculo a duplicidade voltaria sozinha, sem ninguém ter decidido nada.

O que **NÃO** mudou, de propósito: a coluna fica, as multiplicações ficam, e não houve
`UPDATE` de backfill (tabela vazia — se um dia houver linha legada com `waste_factor > 0`,
ela precisa de decisão explícita, não de um UPDATE escondido numa migration de DEFAULT).

**Decisão do dono, 05/08/2026: MANTER em 0.** O zero deixou de ser um meio-termo aplicado
por engenharia à espera de revisão — foi levado ao dono, com a alternativa de voltar o
DEFAULT para 5, e ele optou por manter. Então isto está **fechado** e não precisa ser
reaberto: ⚠ **não "restaure" os percentuais achando que zero é bug**, e não reabra a
pergunta a cada sessão.

**O que continua em aberto é OUTRA coisa:** o destino do módulo Referências Técnicas —
se as multiplicações `× (1 + waste_factor / 100)` e a própria coluna devem sumir, ou se o
módulo volta a ter um conceito de perda próprio. Isso é decisão de produto **não tomada**,
e vale a regra de sempre: não decida sozinho pelos dois lados — nem apagar as
multiplicações "por coerência" (com DEFAULT 0 elas são no-op hoje, então não há pressa),
nem ressuscitar a perda nos 5 motores de consumo por analogia com este módulo.

### Variante de material do item do PV (2026-07-11)
O item do PV pode apontar uma **variante de material** (`sale_order_items.material_variant_id`
→ `reference_material_variants`): mesma geometria de consumo da ficha, materiais de
ORIGEM diferente. Precedência por componente (cabedal/forro/palmilha):
`produto legado pinado > grupo da variante (+cor do PV) > pin da ficha > grupo da ficha`
(resolvers SQL `resolve_*_material_for_variant`, mig `20260907120500`). Solado: pin
direto via `resolve_sole_for_variant` (também honrado no débito por grade desde a mig
`20260911140000`). BOM: `sheet_materials.material_variant_id` NULL = linha compartilhada;
preenchido = específica da variante (override por `product_id`, semântica
`get_effective_bom`). O motor TS (`orderConsumption.ts` — modal + fichas de operador —
e `bomConsumption.ts` — Lista de Separação) espelha essa resolução; a conversão dm²→m
usa a largura da ficha de componente do grupo **da variante**. Débito/reserva/custeio
derivam a variante server-side via `orders.sale_order_item_id` (não há coluna de
variante em `orders`).

### Forro/palmilha: fonte de verdade = SOLADO da referência (anti-duplicidade)
O consumo de **forro** e **palmilha** vem dos valores preenchidos no **solado** da
referência (`sole_technical_specs`: `lining_consumption_dm2` = forro do cabedal,
`insole_lining_consumption_dm2` = forro da palmilha, `insole_consumption_dm2` = placa)
— a ficha do modelo só **escolhe o grupo/cor** do material; a ÁREA por numeração é do
solado. Espelha o SQL `calculate_order_consumption_by_grade`.

**Invariante anti-duplicidade (mig `20260911120000`):** quando o solado dirige o forro
da PALMILHA (`insole_lining_consumption_dm2 > 0`) e NÃO tem forro de cabedal
(`lining_consumption_dm2` nulo), o `lining_consumption` (escalar) da ficha É a área da
palmilha digitada no campo errado → **NÃO emitir a linha "Forração" (cabedal)**, senão a
mesma napa é contada 2× (bug PV-00146; sintoma: dois consumos na ficha de Corte
Forração). A supressão (`suppressCabedalForracao` no TS `orderConsumption.ts`,
`v_suppress_cabedal_lining` no SQL) exige `sole_drives_consumption = true`.

**Regra load-bearing (não repetir o bug 2026-07-15):** o motor TS lê essa flag + os
campos de consumo via `sheet.*`. **TODO campo lido tem que estar em
`TECHNICAL_SHEET_CONSUMPTION_COLUMNS`** (`orderConsumption.ts`) — a ficha de operador
(`fetchTechnicalSheetsForConsumption`) E a tela de consumo do PV buscam por essa constante.
Faltava `sole_drives_consumption` lá → a supressão virou no-op silencioso (TS loose não
acusa `undefined`) e o forro-cabedal fantasma reapareceu no Corte Forração. Guard em
`orderConsumption.test.ts`: extrai os `sheet.*` lidos do próprio motor e trava que todos
estão no `.select()` (auto-derivado — não desatualiza). Isso vale pra QUALQUER coluna
nova que o motor passe a ler, não só esta.

### Finalizar a OP DEBITA — não cancela a reserva (CANÔNICO, 07/08/2026)

> Decisão do dono. `hybrid_debit_stock_for_order` marca cabedal, forração, palmilha,
> forração de palmilha, fachete e quase todo o BOM como `debit_mode='soft'`: cria
> `material_reservations` e **não** mexe em `products.quantity`. A baixa real é outro
> passo.

**O que estava acontecendo:** `tg_release_reservations_on_order_terminal` cancelava
("auto-liberada") **toda** reserva ainda em `reserved` quando a OP entrava em
`Finalizado`, sem gerar `stock_movements`. O material saía da fábrica e voltava para o
estoque contábil. Medido: **188 OPs `Finalizado` → 810 reservas canceladas contra 71
consumidas**; `list_stock_debit_holes(400)` acusava **1.191 linhas em 187 OPs, ~223 mil
unidades, R$ 226.858** com `actual_quantity = 0`.

**Agora:** `settle_open_reservations_for_order()` debita `LEAST(disponível, reservado)`,
gera o `stock_movements` e transforma o saldo que faltou em `pending_reconciliation` —
pendência **visível**, nunca `cancelled`. Chamada pelo gatilho
`trg_aa_settle_reservations_on_finalize` (mig `20261231120200`).

| Camada | O quê |
|---|---|
| `settle_open_reservations_for_order` | variante **tolerante** do picking: por numeração no solado, `LEAST` nos demais |
| `trg_aa_settle_reservations_on_finalize` | dispara na transição para status final |
| `tg_release_reservations_on_order_terminal` | **não mudou** — em OP finalizada já não acha nada em `reserved`; em OP **Cancelada** segue liberando, que ali é o certo |

⚠ **NÃO troque a chamada por `consume_all_reservations_for_order`.** Aquela dá
`RAISE EXCEPTION` quando falta estoque — num gatilho de finalização, um cadastro
divergente **impediria a OP de fechar** e travaria o chão de fábrica. A tolerância é o
ponto da função nova, não um relaxamento.

⚠ **O NOME do gatilho é load-bearing.** Triggers do mesmo evento disparam em ordem
**alfabética**. `trg_aa_…` precisa vir antes de `trg_record_consumption_on_finalize`,
senão `production_consumptions.actual_quantity` é calculado antes dos
`stock_movements` existirem e o relatório de furos continua acusando 0. Renomear para
algo depois de `trg_r…` reintroduz o furo **sem quebrar teste nenhum**.

⚠ **Histórico NÃO foi tocado** (decisão do dono): as 187 OPs já finalizadas seguem com
o furo, visíveis em `list_stock_debit_holes()`. Debitar 223 mil unidades retroativas
jogaria vários materiais a zero e desmentiria inventários já conferidos. Se um código
novo "reconciliar" essas OPs em massa, está desfazendo a decisão.

### Cobertura de spec do solado — existir ≠ cobrir a numeração (07/08/2026)

`consumption_consistency_report()` tinha um ponto cego: `solado_dirige_consumo_sem_specs`
pergunta se **existe** linha em `sole_technical_specs`; existindo uma, dá verde.

Os 3 solados que dirigem consumo (`01`, `INFANTIL`, `180 SALTO BLOCO`) têm specs só de
**34–40** — o `INFANTIL` inclusive tem estoque na faixa **23–36**, ou seja, as specs
foram copiadas do adulto. As fichas infantis vendem 25–34. Para tamanho sem spec o motor
cai no escalar da ficha, e `insole_lining_consumption` é NULL/0 em **26 das 27** fichas
com `sole_drives_consumption` ⇒ o forro da palmilha contribui **ZERO**.

Caso vivo: PV-00151 / I90 OFF WHITE, 180 pares na grade 28–34 → snapshot congelou
`Forração Palmilha = 1,000 m`; só os 24 pares do nº 34 entraram. **156 de 180 pares sem
débito de forro.** Alcance: **6.148 pares** vendidos em tamanhos 25–33 sem spec.

Fechado por dois checks novos (`solado_sem_spec_na_faixa_vendida`,
`forro_palmilha_debita_zero`) + `list_sole_spec_gaps()`, que devolve a lista acionável
(solado, numeração, pares vendidos, fichas, PVs).

⚠ **A migration NÃO inventa os dm² que faltam** — é dado de engenharia do dono.
Extrapolar consumo por numeração dentro de migration seria fabricar cadastro. Enquanto
as 9 numerações do INFANTIL não forem preenchidas, o forro segue debitando zero nelas —
agora com alarme.

⚠ **Isto nunca foi divergência TS×SQL:** `orderConsumption.ts` produz o mesmo zero
(`calculateGradeBasedDm2` com fallback 0). Os dois lados concordam no número errado — a
tela mostra exatamente o que o estoque debita.

### `stock_grade = '{}'` é "sem numeração" — NUNCA NULL (CANÔNICO, 20/08/2026)

> A coluna `products.stock_grade` tem **`DEFAULT '{}'::jsonb`**. Medido em 20/08/2026:
> **0 produtos com `stock_grade` NULL**, 200 com `'{}'` e 11 com numeração real.
> Todo código que pergunta "esse produto tem grade?" tem que contar **buckets reais**
> (chave que não começa com `_`) — testar `IS NOT NULL` responde "sim" para a base inteira.

**O que quebrou.** `check_grade_quantity_coherence` (mig `20270101000900`) usava a guarda
`WHEN (NEW.stock_grade IS NOT NULL)` e, dentro da função, comparava `sum(grade)` com
`quantity`. Como `'{}'` não é NULL, ela rodava nos 211 produtos; nos 200 sem numeração a
soma dava **0** e estourava contra qualquer `quantity <> 0`:

```
Incoerência de grade no produto 3b063cbb-…: soma 0 difere de quantity 89.8838…
```

Efeito prático: **toda escrita de saldo travada** — estorno de OP
(`restore_product_stocks_for_order`, o sintoma reportado: cancelar as 3 OPs do PV
3e33f8a3 falhava), débito, `/ajuste-estoque` (`adjust_stock_batch` abortava com o erro
cru do gatilho, não com um `error` estruturado) e criação de produto com estoque inicial
(`ProductFormDialog` envia `stock_grade: {}`).

**Era regressão, não cadastro errado.** A versão original (mig `20260429230000`) tinha a
escapatória escrita com todas as letras — *"evita falsos positivos com grades vazias =
produto sem numeração configurada"* — e ela sumiu na reescrita de `20270101000900`.

⚠ **Por que ninguém percebeu por meses:** `20260430175247` fez `DROP FUNCTION … CASCADE`,
o que **derrubou o próprio gatilho junto**, e não o recriou. A função ficou errada e
inofensiva até `20270101000900` recriar o gatilho — aí quebrou tudo de uma vez, e não
gradualmente. Ao fazer `DROP … CASCADE` em função de gatilho, confira o que foi junto.

**Como está agora** (mig `20270101006000`): a conferência é pulada quando o produto **não
é rastreado por numeração** — nem a grade nova nem a antiga têm bucket real. O que
continua barrado, de propósito:

| Caso | Veredito |
|---|---|
| sem numeração (`{}`): mover `quantity`, INSERT com saldo inicial | ✅ passa |
| com numeração: mexer só em `quantity` | ❌ barra (é a invariante) |
| com numeração: esvaziar a grade **com saldo sobrando** | ❌ barra (perda silenciosa) |
| com numeração: esvaziar a grade **junto com `quantity = 0`** | ✅ passa |
| bucket negativo / não-numérico / fração em unidade discreta | ❌ barra (inalterado) |

⚠ **`OLD` só existe em UPDATE.** O mesmo `check_grade_quantity_coherence` serve aos dois
gatilhos (`trg_…` de UPDATE e `trg_…_insert`). Tocar `OLD.stock_grade` sem checar
`TG_OP = 'UPDATE'` dá *"record old is not assigned yet"* em toda criação de produto.
Travado por `src/__tests__/gradeCoherenceEmptyGradeMigration.contract.test.ts`.

⚠ **Armadilha vizinha, NÃO resolvida** (decisão de produto em aberto): o ramo de "resíduo
escalar" de `restore_product_stocks_for_order` credita `quantity` de produto **com**
numeração **sem tocar `stock_grade`** — o que viola a invariante por construção e cai no
mesmo `RAISE`. Hoje isso não afeta o estorno de solado (o `v_pending_sole` zera o
resíduo), mas há resíduo vivo: medido em 20/08/2026, **8 OPs `Finalizado` do produto
`238`** (12 a 16 un cada) estourariam se fossem canceladas. Corrigir exige decidir de onde
sai a numeração desse crédito — não dá pra inventar dentro de migration. Não "conserte"
pelos dois lados sozinho.

### Quando converter (sinal de decisão)
Presença de **ficha de componente com largura > 0**. Caminhos que aplicam a regra:
upper (cabedal), lining (forro), insole (palmilha) e **sheet_materials (BOM)** — este
último foi corrigido em **2026-05-30** (antes multiplicava `quantity_per_unit × qtd`
direto → inflava ~100×, ex.: napa 5,7 dm²/par × 720 = 4104 "m" em vez de ~30 m no
PV-00116). A largura mora em `component_sheets.dimensions_width` (+ `dimensions_unit`),
por produto.

### Ficha de área SEM largura
Não dá pra converter → manter o valor e marcar `widthMissing` (aviso âmbar; o consumo
fica ~100× inflado até cadastrar a largura em **Materiais → Ficha de Componente →
Dimensões**). A UI deixa a linha **neutra** (não verde/vermelho), pois a comparação
com estoque é inválida nesse caso.

### Disponibilidade (verde = em estoque / vermelho = em falta)
Marcada no momento da consulta:
- **Não-solado**: disponível = `products.quantity − reserved_stock` (líquido), somado
  entre produtos do grupo que casam na cor. Verde se cobre o consumo.
- **Solado**: por **número**, usando `stock_grade` (bruto — não há reserva por
  numeração). Baldes conjugados (`"33/34"`) são **distribuídos** entre os números que
  cobrem (proporcional à necessidade), pra não contar o mesmo balde duas vezes.

### ⚠ Divergência conhecida (servidor)
O custeio e o MRP usam funções SQL (`calculate_order_consumption*`) — caminho
**separado** do modal. Não há garantia de que apliquem esta mesma regra; ao mexer em
consumo de área, verificar se o lado SQL também converte dm²→unidade física, senão
custeio/MRP divergem do modal.

> **Status (auditoria 2026-06-16):** as divergências foram FECHADAS em produção —
> `calculate_order_consumption` (escalar) e `..._by_grade` usam a condição de
> palmilha pronta unificada (`insole_ready_made` OU `sole_classification='palmilha_pronta'`,
> **sem** o legado `insole_mode`), aplicam conversão dm²→unidade via
> `get_material_conversion_info` e incluem Fachete. Pra **impedir regressão**:
> - **`run_consumption_parity_tests()`** (migration `20260722120000`) trava esse
>   contrato no lado SQL (wrapper vitest: `consumptionService.parity.test.ts`,
>   skip sem `RUN_DB_INTEGRATION`). O lado TS é travado por `orderConsumption.test.ts`.
> - **`consumption_consistency_report()`** lista gaps de cadastro que reintroduzem
>   consumo errado (largura faltando, palmilha pronta inconsistente, solado sem
>   specs, **solado fachetado sem consumo de fachete**). Rodar em /diagnostics.

### Unidades de medida — lista CANÔNICA (1 unidade-base por produto)

Padrão industrial: cada produto tem UMA unidade-base (`products.unit` = estoque +
consumo). Grafias devem ser sempre canônicas — normalizado em massa em 2026-05-30
(migration `20260702120000`, ver `docs/UNIDADES_E_CONVERSOES.md` + `docs/AUDITORIA_UNIDADES_PRODUTOS.md`).

| Categoria | Canônica | Sinônimos proibidos (normalizar) |
|---|---|---|
| Linear | `m` (`cm`/`mm` p/ dimensões) | `metro`, `metros`, `mt`, `mts` |
| Área | `dm²` (`m²`/`cm²`) | `dm2`, `m2`, `cm2` |
| Contagem | `un`, `par` | `unid`, `unidade`, `und` |
| Placa | `placa` | `chapa` |
| Massa | `kg`, `g` | `gr`, `grama`, `gramas` |
| Volume | `L`, `ml` | `litro`, `litros`, `l` |

**Invariante:** `purchase_unit == unit` ⇒ `conversion_rate = 1`. O fator só existe
quando a unidade de compra é diferente da de estoque (ex.: PLACA EVA `placa`→`dm²`,
rate 150). `conversion_rate = 0` é sempre inválido. ⚠ A conversão dm²→metro de
material de área (napa) NÃO vai em `conversion_rate` — mora na **largura da ficha de
componente** (senão infla o estoque na entrada de compra).

**Importação de NF (entrada):** `convertNfToStockUnit` (`src/lib/nfUnitConversion.ts`)
normaliza a unidade da NF (`uCom`, ex.: `KG`/`MT`/`METRO`/`CHAPA`) ao canônico via
`toCanonical`. Se o canônico da NF == canônico do produto, entra a qtd como está; se
diferir, converte por `conversion_rate`/`CONVERSOES`/`package_weight_kg`; se não houver
regra segura, **bloqueia o item** (`needsConfig`) em vez de gravar qtd errada. Ao
adicionar unidade nova, atualizar `toCanonical` E `src/lib/materialConsumption.ts`
(`LINEAR_UNITS`/`PLATE_UNITS`).

## Regra de empacotamento em caixas (CANÔNICA, 05/08/2026)

> Fonte: `src/lib/boxPacking.ts` (TS) e `packing_boxes_for_grade()` (SQL, migration
> `20261208120000`). Os dois lados são espelho — mexer em um sem o outro quebra os testes.

A ficha rende mais pares do que a colmeia comporta. O excedente **não viaja solto**:

```
sobra = Σgrade − capacidade, retirada das numerações do MENOR para o MAIOR
      → consolidada por (item do PV, numeração) → caixas de UMA numeração só
```

PV-00151 (curva `28:2 29:2 30:2 31:2 32:3 33:2 34:2` = 15, colmeia 12), por cor: sobra da
ficha = `28:2 · 29:1`; × 12 fichas → **2 caixas do nº 28 + 1 do nº 29** + 12 colmeias = 15
volumes. 45 no PV inteiro.

⚠ **"do menor pro maior" é quem vai pra SOBRA, não quem fica na colmeia.** Inverter dá um
resultado plausível e errado (sairia o nº 32, que é a numeração de contagem ímpar). Essa
inversão passou por duas rodadas de revisão antes de ser pega.

⚠ **A caixa de numeração única NÃO nasce na ficha** — a ficha sobra DUAS numerações (28 e
29). Ela nasce na **consolidação do item**. Cálculo por ficha isolada nunca chega lá.

⚠ **A regra só vale quando a grade É uma ficha** (`Σgrade < 2 × capacidade`). PVs antigos
gravaram `fichas = 1` com a grade somando o pedido inteiro (PV-2026-00013: 120 pares numa
"ficha"); ali a regra fabricaria caixa quase vazia — o PV-2026-00097 (24 pares, caixa 12)
viraria 1 colmeia + 3 caixas de 4 pares em vez de 2 cheias. Fora da guarda, os dois lados
devolvem vazio/0 linhas e o chamador cai no legado `CEIL(pares / capacidade)`.

**Capacidade vem do SOLADO** (`product_groups.pairs_per_box_<tipo>` pela tela de solado),
resolvida por `compute_sale_order_box_breakdown` — a MESMA função que a NF usa pra contar
volumes. Etiqueta, NF e débito de embalagem leem daí, então não podem divergir.

**Grade da ficha vem de `sale_order_items.grade`** (Σ = pares por ficha). ⚠ `orders.grade`
usa a convenção OPOSTA (já multiplicada, Σ = quantity) — usar a da OP e reescalar
distorce a curva por arredondamento (15 pares viravam 14 no PV-00151) e muda quem vai pra
sobra.

**Peso:** par sempre de `technical_sheets.weight_per_pair_kg`, default 238 g só quando a
ficha não tem; tara da caixa em `box_types.empty_weight_kg`.

### ⚠ Volumes da NF NÃO conhecem `box_grouping` — MANTIDO ASSIM (dono, 11/08/2026)

`compute_sale_order_box_breakdown` conta `CEIL(total_pares ÷ capacidade)`. Isso vale pro
modo `grade`, onde a caixa leva a curva inteira. Em **caixa fechada por numeração**
(`sale_orders.box_grouping = 'numeracao_unica'`, migration `20261231120500`) a caixa é de UM
número só, então o físico é `Σ CEIL(pares_da_numeração ÷ capacidade)` — **maior** sempre que
alguma numeração não fecha caixa cheia. A função **não olha `box_grouping`**, e NF, etiqueta
e débito de embalagem leem dela.

Medido em 11/08/2026: nos **dois** PVs em numeração única (PV-00147 e PV-00157) a diferença
é **zero** — as numerações são múltiplos da capacidade (24/48/72 com caixa de 12), que é
como esses pedidos são colocados. Mas na base ativa **83,4% das células** (456 de 547) não
fecham caixa cheia, e **6 de 10 PVs** divergiriam se o modo fosse ligado neles — no pior
caso medido, a NF declararia **90 volumes a menos** que o físico.

**Decisão do dono: MANTER.** Não corrigir a função, nem avisar na tela. O risco só se
materializa se alguém ligar o modo num pedido de numeração quebrada.

⚠ Então: **não "conserte" a função por coerência** ao mexer em empacotamento — a divergência
é conhecida e a escolha foi consciente. E **não conclua que está tudo certo** só porque os
PVs em numeração única batem hoje: eles batem por causa da curva, não porque a função saiba
do modo.

⚠ O resumo "Caixas por Numeração" da ficha de Expedição (`ExpedicaoWorkSheet`) usa a conta
**física** (`Math.ceil` por numeração), não a da NF. Nos pedidos de hoje os dois dão o mesmo
número; num pedido de numeração quebrada a ficha mostraria MAIS caixas que a NF — e a ficha
é que estaria certa.

## Rota de produção — Expedição é obrigatória (CANÔNICO, 07/08/2026)

> Decisão do dono. A rota de uma OP nasce de `technical_sheets.production_sectors`
> (`promote_sale_order_item`), e **toda rota termina em `Expedição`**.

**O sintoma:** arrastar BT01/BT02 pra Expedição no Kanban devolvia *"Esta OP não passa
por Expedição (ou o setor já está concluído)"* ([`pointingPlan.ts:101`](src/components/production/kanban/pointingPlan.ts#L101)).
O toast estava **certo** — OP-2026-00968/00969/01146 tinham 10 etapas terminando em
Acabamento.

**A causa:** as 6 listas canônicas de `ConstructionConfigPanel.tsx` terminavam todas em
Acabamento, então escolher o modelo de produção da ficha **arrancava a Expedição**. O
default do SQL sempre a incluiu — os dois lados discordavam. Medido: **16 de 53 fichas**
sem a etapa, gerando **29 OPs** (9 finalizadas, 20 abertas).

⚠ **O arrasto recusado era o sintoma barato.** O caro era silencioso: `finalize_production_sector`
marca `Finalizado` quando nenhuma etapa fica pendente, então a OP **encerrava no Acabamento**
e nunca entrava no romaneio — o filtro `orderInRoteiro(…, 'Expedição')` de
`PrintWorkSheetsPage.tsx` já excluía BT01 por isso, e ninguém tinha ligado uma coisa à outra.

### Onde a regra mora agora

| Camada | O quê |
|---|---|
| **Banco (a trava)** | `tg_normalize_production_sectors` **acrescenta** Expedição em toda gravação de `production_sectors`. Vale pra qualquer porta — painel, SQL Editor, import. Mig `20261230120000`. |
| React (higiene) | as 6 listas + `routingLabel()` de `ConstructionConfigPanel.tsx`. Não é a defesa; serve pra tela não mostrar uma rota e o banco gravar outra. |
| Teste | `technical-sheets/__tests__/constructionRouting.test.ts` varre `CANONICAL_ROUTINGS` inteiro — **lista nova já nasce coberta**. |

⚠ **Rota VAZIA continua vazia de propósito.** `production_sectors` null/`[]` significa "sem
restrição de roteiro" (é assim que `PrintWorkSheetsPage` lê). O trigger sai cedo nesse caso —
injetar Expedição numa lista vazia criaria ficha cuja rota inteira é a expedição.

### Quem fecha a Expedição — DOIS caminhos

`production_pointings` tinha **zero** lançamentos em Expedição: ninguém nunca apontou lá
pelo Kanban (os 168 `concluido` que existiam são legado migrado). Tornar a etapa obrigatória
sem isso faria as OPs empacarem na última coluna e nunca chegarem a `Finalizado` — que é o
filtro de `PostOPAnalysis`, custeio e KPIs.

1. **Romaneio (automático)** — `register_order_shipment` fecha **toda** etapa não concluída
   das OPs do PV expedido, com `quantity_total`, e marca as OPs `Finalizado`. Mig `20261230120100`.
2. **Kanban (manual)** — segue permitindo apontar a Expedição na mão, como qualquer setor.

⚠ A condição no romaneio é `status <> 'concluido'`, **não** `= 'pendente'` como no gatilho
`tg_close_stages_on_op_finalize`: etapa com apontamento PARCIAL fica `em_andamento` e escapava
dele, deixando a OP `Finalizado` com etapa aberta — e o card **seguia no Kanban**, que deriva
o card das ETAPAS, não do status da OP. O escopo maior fica contido na função da expedição;
o gatilho compartilhado não mudou.

### Backfill — o que foi e o que NÃO foi tocado

- **16 fichas** ganharam Expedição no fim (roteiro custom de cada uma preservado; o trigger
  reordena pro canônico).
- **20 OPs abertas** ganharam a etapa. `stage_order = GREATEST(canonical, max+1)`.
- ⚠ **As 9 OPs já `Finalizado` ficaram INTACTAS**, de propósito: dar etapa pendente a elas as
  ressuscita no quadro (`deriveCard` volta a devolver card) e desmente um encerramento que já
  aconteceu. Se um código novo "completar" essas 9 por coerência, está desfazendo a decisão.

### Cópias da rota — eram 4 fontes divergentes

`canonical_stage_order` é a referência. Auditado 07/08/2026:

- ✅ `promote_sale_order_item`, `tg_normalize_production_sectors`, `sector_settings`,
  `PRODUCTION_STAGES` (`useOrderStages.ts`) — corretos.
- 🔧 `resync_op_atomic` — fallback usava `'Costura'` (grafia **morta** desde o split de
  `20261001120000`; a RPC de apontamento não conhece esse nome) e numerava por **ORDINALITY**
  em vez de `canonical_stage_order`. Daí OP-2026-01245/46/47 terem Acabamento em 9 e o resto
  da fábrica em 10 — **duas convenções na mesma tabela**. Corrigido. Esta função **DELETA e
  recria** `order_stages`, então é a porta que reintroduz qualquer erro de rota.
- 🗑 `advance_order_to_sector` — **dropada**. `v_flow` tinha `'Costura'` e punha `'Aviamento'`
  ANTES da costura; como ela fecha como `concluido` todo setor de posição menor que o destino,
  a inversão fecharia a costura ao avançar pro aviamento. Zero chamadores em `src/`.

## Organização de Grupos de Estoque (product_groups)

> Reorganizado em 2026-07-01: os dois fluxos de criação de grupo (tela **Estoque →
> Grupos** e a aba **Materiais** do Estoque) foram unificados em
> `src/components/groups/GroupCreateDialog.tsx` — não recriar um form de criação
> separado; é a fonte única (nome, Setor, grupo-pai, embalagem, checagem de duplicata).

- **Nomenclatura:** nome do grupo em **CAIXA ALTA**, padrão
  `MATERIAL[ + VARIANTE/BITOLA]` (ex.: `SOLADO 01`, `NAPA SANTORINE`,
  `TIRA CHATA 8MM`) — convenção já usada pelos grupos de solado, agora sugerida no
  dialog de criação. Índice único case-insensitive em `product_groups.name`
  (`lower(trim(name))`, migration `20260901140000`) trava duplicata que escapar do
  aviso da UI.
- **Hierarquia (`parent_group_id`):** use pra agrupar variações do mesmo material sob
  uma família (ex.: `COMPONENTES` como pai de `TIRA CHATA 8MM`, `TIRA STRASS 15MM`
  etc.). Helpers em `src/lib/groupHierarchy.ts` (`flattenGroupTree`,
  `getDescendantIds`, `canBeParent`, `getGroupPath`) — reusar, não duplicar lógica de
  árvore. A tela **Estoque → Grupos** (`src/pages/Groups.tsx`) já renderiza nessa
  ordem hierárquica com indentação; vincular/desvincular subgrupo fica na aba
  "Hierarquia" do `GroupEditDialog.tsx`.
- **Setor (`product_groups.sector`):** define a categoria (`products.category`) de
  todos os produtos do grupo — mover o grupo de setor cascateia automaticamente
  (trigger `tg_group_sector_cascade`, migration `20260629140000`). **Obrigatório na
  criação** desde a unificação acima (antes um grupo novo nascia com `sector = NULL`
  até alguém lembrar de editar, e os produtos caíam silenciosamente em "Componente").
  Valores válidos = `SECTOR_OPTIONS` (`src/lib/categoryFromGroup.ts`), com `CHECK`
  constraint espelhando no banco (migration `20260901140000`).

## Design Token System — DO NOT use hardcoded colors

This project uses **CSS custom property tokens** defined in `src/index.css`. Using
hardcoded Tailwind color classes (e.g. `bg-white`, `text-gray-400`) breaks the
unified visual system and makes dark mode impossible.

### Mapping: old → correct

| ❌ Hardcoded (Tailwind default) | ✅ Design token |
|-------------------------------|-----------------|
| `bg-white` | `bg-card` (surfaces) or `bg-background` (page) |
| `bg-gray-50`, `bg-slate-50` | `bg-muted/30` or `bg-muted/50` |
| `bg-gray-100`, `bg-slate-100` | `bg-muted` |
| `border-gray-100`, `border-slate-200` | `border-border` or `border-border/60` |
| `text-gray-400`, `text-slate-400` | `text-muted-foreground` |
| `text-gray-600`, `text-slate-600` | `text-muted-foreground` |
| `text-gray-900`, `#0D0D0D` | `text-foreground` |
| `hover:bg-gray-50` | `hover:bg-muted/40` |
| `bg-green-500/10 text-green-600` | ✅ Keep — semantic status color |
| `bg-amber-500/10 text-amber-600` | ✅ Keep — semantic status color |
| `bg-red-500/10 text-red-600` | ✅ Keep — semantic status color |

### Exempt files (print layouts — must use print colors)
- `EtiquetaProduto.tsx`
- `PrintWorkSheetsPage.tsx`
- `OperatorWorkSheet.tsx`
- `PalmilhaWorkSheet.tsx`
- `SilkMontageWorkSheet.tsx`
- `SolagemWorkSheet.tsx`
- `ExpedicaoWorkSheet.tsx`
- `ManagementReport.tsx`
- `worksheet/*.tsx` (SignatureFooter, WorksheetHeader, TallyBox, ProductImageBlock, SectorAlerts)
- `CartaoOP.tsx` e `CartaoLote.tsx` (cartões de posto/lote — 12 por A4 paisagem)
- Qualquer componente em `src/components/label-system/`

### ⚠ Regras críticas pra componentes de print

**NÃO usar primitives shadcn** (Card, Badge, Button, Table, Tabs) em
worksheets/etiquetas. As primitives evoluem com o design system (F1-F6 do
Industrial Editorial Pro mudaram bordas, rounded, paddings, fontes) e fichas
de impressão precisam de **garantia visual previsível em papel A4 / etiqueta
térmica**, independente do que acontece nas telas do app.

**Usar inline styles com cores hardcoded:**
```tsx
<div style={{ border: '1.5px solid #000', fontFamily: "'Anton', Impact, sans-serif" }}>
```

**NUNCA usar tokens com alpha em print:**
- ❌ `className="border-foreground/15"` — 15% alpha contra background branco
  de papel = bordas quase invisíveis quando impresso
- ✅ `style={{ border: '1.5px solid #000' }}` — preto puro garantido

**Fontes em print — DUAS famílias, NÃO confundir** (auditoria 2026-06-08):
- **Fichas de operador** (SolagemWorkSheet, PalmilhaWorkSheet, SilkMontageWorkSheet,
  OperatorWorkSheet, ExpedicaoWorkSheet, ManagementReport): renderizam INLINE no app,
  então usam as fontes do **`index.css`** = **`'Fira Sans'`** (body), **`'Fira Code'`**
  (mono), **`'Anton'`** (display). ⚠ NÃO trocar pra Inter Tight/JetBrains Mono — NÃO
  estão no index.css → fallback feio no print.
- **Etiquetas térmicas** (`src/lib/printLabels.ts`): abrem em `window.open` próprio com
  `<link>` que carrega **`'Inter Tight'`** (body) + **`'JetBrains Mono'`** (mono) +
  **`'Anton'`** (display). Essas fontes valem SÓ no contexto da etiqueta.
- Display em ambos: `'Anton', Impact, sans-serif` (uppercase decisive).

### Tamanho de fonte em print — a MAIOR que couber (CANÔNICO, 2026-07-26)

**Regra:** todo bloco de ficha/etiqueta/cartão usa a **maior fonte que couber na sua
moldura**, sem estourar folha nem quadro. Fonte pequena é o **último** recurso — antes
de reduzir, **remova conteúdo que não é do operador**. Abaixo do piso da tabela, o item
**sai do papel**; não encolhe. Ilegível no chão de fábrica = ausente.

**Por que existe** (`docs/PRINT_SPEC.md` §2.2): o scaling dinâmico global chegou a
`scale 0.55` e o texto saiu com **4.7pt — ilegível na prática de fábrica**. Daí o piso do
auto-fit (`AUTO_FIT_FLOOR 0.80`) e a tabela abaixo.

**Ordem de prioridade** — quem cresce primeiro e encolhe por último:
1. **Identidade** — nº da OP, cor, nome do setor (lido a 1m; erro aqui é caro)
2. **Números operacionais** — grade por numeração, pares, placas, metros, quantidade
3. **Metadados** — PV, razão social, datas, códigos de rastreio

**Pisos por papel** (em `px` — unidade real dos componentes de print; pt ≈ px × 0,75):

| Papel | Alvo | Piso | Referência viva |
|---|---|---|---|
| Identidade (Anton) | 20–28px | 14px | nome do setor no `WorksheetHeader` (28→22px adaptativo) |
| Números de grade (Anton) | 15–20px | 12px | `displayPx` dos buckets (20→12) |
| Célula de dados / mono | 10–12px | 8px | `cellPx` (12→8) |
| Texto corrido (ref, material) | 9–10px | 7.5px | `textPx` (10→7.5) |
| Rótulo mono UPPERCASE | 8–9px | 6.5px | rótulos do FlowRail (6.5px) |
| Nº dentro do tally | 9.5–11px | 7px | `getFontSize()` do `TallyBox` (md 11/9.5/7.5 · sm 10/8/7) |
| Campo manuscrito (nome, qtd, data) | 22px (~5,8mm) | 20px (~5,3mm) | `CompletionFooter` (campos 22px) |
| Linha só de rubrica/visto | 15px (~4mm) | 15px | `CompletionFooter` (visto 15px) |
| QR **acionável** (escanear → apontar) | 18–22mm | 15mm | — |

⚠ O QR atual do `WorksheetHeader` é `size={46}` (~12mm), **abaixo do piso de acionável**:
hoje ele serve só como identificação visual (payload = texto com os PVs). Quando virar
URL que abre a OP, subir pra **≥ 15mm**.

**Helpers — reusar, não reinventar:**
- `adaptiveFontSize()` (`src/lib/adaptiveFontSize.ts`) — UM texto em largura fixa.
  Diretriz desde 22/05: todo elemento de largura fixa com texto dinâmico usa.
- `adaptiveTableFont()` / `gradeTableFont()` (`src/components/production/worksheet/adaptiveFont.ts`)
  — dimensiona a TABELA inteira pelo nº de colunas (buckets já calibrados).
- Auto-fit do `PaginatedSheet` — escala o documento inteiro.

⚠ **Lacuna conhecida:** o auto-fit do `PaginatedSheet` só **encolhe** (`AUTO_FIT_FLOOR 0.80`,
`AUTO_FIT_STEP 0.01`) e só quando isso remove uma folha — **nunca cresce** quando sobra
espaço, então ficha com meia página vazia sai com fonte de página cheia (contraria a regra).
Ao implementar o lado que cresce: a escala é **por documento, não por página** — senão a
mesma tabela sai em tamanhos diferentes entre folhas do mesmo maço.

Auditoria de 22/05/2026 confirmou que TODOS os worksheets seguem esse padrão
(inline styles + cores hardcoded), por isso sobreviveram intactos às 6 fases
de redesign do Industrial Editorial Pro nos primitives shadcn.

### Preferências de impressão (CANÔNICO, 31/07/2026 — decisões do dono)

Regras de produto, não de implementação. Valem pra QUALQUER ficha, cartão ou
etiqueta nova. Quando contradisserem `docs/PRINT_SPEC.md`, **esta seção vence**
(o PRINT_SPEC é histórico de decisão; ver a errata do §3-B item 6).

**1. Densidade vem de tirar espaço morto, NUNCA de reduzir fonte.**
Foi a regra que conciliou dois pedidos que pareciam opostos ("mais informação
por folha" + "legibilidade vence o auto-fit"). Ordem de ataque, nesta sequência:
repetição → espaço vazio → largura desperdiçada → só então repensar o conteúdo.
Reduzir corpo de letra não está na lista.

**2. Altura é do CONTEÚDO. Nunca trave um formato.**
Travar o cartão em A6 (`aspect-ratio: 148/105`) com o rodapé empurrado por
`margin-top: auto` gerou 45mm de papel morto — 43% do cartão. O bloco termina
onde o conteúdo termina; quem empacota é o `PaginatedSheet` (fichas) ou o
fragmentador do browser com `break-inside: avoid` (cartões, ficha reduzida).

**3. Maços de setor FLUEM contínuos + linha de corte na emenda.**
Sem folha nova por setor. A folha compartilhada é dividida na tesoura pela marca
`✂ CORTAR AQUI · MUDA DE SETOR`. A linha é **obrigatória**: sem ela a separação
entrega trabalho de uma bancada para outra. Ver PRINT_SPEC §3-B item 6.

**4. Largura mínima antes de estreitar qualquer coisa: a GRADE manda.**
Grade de 7 numerações precisa de **~93mm** (8 colunas com número de 3 dígitos +
rótulo). Abaixo disso o `table-layout: fixed` do CSS de print **CORTA** o número
— o operador lê "18" onde estava "180". Por isso o cartão de lote é 99mm e não
84mm (que caberia mais por folha). **Nunca troque legibilidade da grade por
densidade**: o corte é silencioso, não vaza.

**5. Destaque = vermelho `#C00000` PAREADO com corpo grande (Anton).**
Referência e cor são identidade e vão em vermelho. Mas a fábrica imprime **laser
P&B** (`WorksheetHeader.tsx:44`), onde o vermelho vira cinza — então o vermelho
nunca pode ser o ÚNICO sinal. Sempre acompanhado de peso/tamanho, pra o realce
sobreviver em monocromático.

**6. Formato do cartão de lote: 99 × ~51mm, 3 colunas em A4 PAISAGEM (12/folha).**
Escolhido sobre A6 retrato/paisagem e A5 por geometria: a grade e o trajeto são
horizontais por natureza. Ver `CartaoLote.tsx`.

**7. O auto-fit NUNCA fura o piso — legibilidade vence densidade.**
`floorSafeScale()` (`worksheet/adaptiveFont.ts`) devolve a menor escala que um
bucket suporta sem levar nenhum elemento abaixo do piso, e cada ficha passa isso
ao `PaginatedSheet` via `minScale`. O piso efetivo é
`max(AUTO_FIT_FLOOR, minScale)`:

| bucket | grade | escala mínima | efeito |
|---|---|---|---|
| 0–1 | ≤ 12 colunas | 0,750 | o 0.80 global manda |
| 2 | 13–16 | 0,833 | encolhe menos |
| 3 | 17–20 | 0,938 | quase não encolhe |
| 4 | > 20 | **1,000** | **não encolhe** — ganha folha |

Antes o `AUTO_FIT_FLOOR = 0.80` aplicava zoom sobre fontes que já estavam no
piso (bucket 4: célula 8px → 6,4px; grade 12px → 9,6px). Travado por
`__tests__/floorSafeScale.test.ts`. **Ao criar bucket novo em `BUCKETS`, o teste
já cobre** — ele varre a tabela inteira, não valores fixos.

### Check for violations
```bash
bun run check:tokens
```

⚠ **Pontos cegos do check:tokens:** ele NÃO valida se uma `var(--x)` referenciada
existe no CSS, e só varre `*.tsx` em `src/components` + `src/pages` — classes de cor
em `src/services/`, `src/lib/`, `src/data/` e `src/hooks/` passam sem acusar. Foi
assim que os tokens `--chart-*` ficaram meses sendo usados sem definição e as classes
de `purchaseProjectionService.ts` escaparam. Ao mexer em cor fora desses diretórios
(ou criar token novo), confira manualmente.

### Height conventions (Tailwind h-*)
Padrão de altura por contexto pra manter consistência visual:

| Classe | px | Uso |
|--------|----|----|
| `h-7`  | 28 | Toolbars dentro de tabelas, ações inline em listas densas (via `className`) |
| `h-8`  | 32 | Filtros/sub-actions densos (via `className` — **NÃO** é o `size="sm"`) |
| `h-9`  | 36 | Tamanho `size="sm"` do shadcn (`button.tsx`) — header de página, formulários |
| `h-10` | 40 | Tamanho **default** do shadcn — CTAs primários, botões em modais |
| `h-11`+ | 44+ | Apenas hero CTAs (`size="lg"` = h-12; raro, não usar em UI normal) |

> **Nota (auditoria 01/08/2026):** esta tabela dizia `size="sm"` = h-8 e default = h-9,
> mas `src/components/ui/button.tsx` sempre implementou `sm: h-9` / `default: h-10`.
> A divergência foi resolvida **a favor do código**: `size="sm"` tem ~969 call-sites e
> mudar o primitive reflowaria o app inteiro. Não "corrija" o button.tsx pra tabela
> antiga — quem quiser h-8/h-7 usa override explícito de `className`.

Em cards de OP / linhas de tabela, prefira `h-7`. Em toolbars de página
top-level, use `h-9`. Mistura entre h-7/h-8/h-9 numa MESMA toolbar é
sintoma de inconsistência — alinhar pelo mais alto.

### Z-index utilities (em vez de `z-[100]`)
```css
.z-dropdown   /* 100 */
.z-sticky     /* 200 */
.z-overlay    /* 300 */
.z-modal      /* 400 */
.z-popover    /* 500 */
.z-toast      /* 600 */
.z-tooltip    /* 700 */
```

### Empty states
Use `<EmptyState />` de `@/components/ui/empty-state` em vez de criar
variações ad-hoc. Provê ícone, título, descrição e ação opcional com
visual consistente (ícone em círculo bg-muted, título semibold).

### Root causes of past dual-visual-system bug
1. **CSS scope contamination** — class definitions (`.glass-sidebar`, `@keyframes`) were
   nested inside `:root {}`. Everything after them lost CSS variable scope. Fixed in
   commit `d090211`. **Rule**: `:root {}` must contain ONLY `--variable: value` declarations.
2. **AI assistants frequentemente geram cores hardcoded** — Lovable, ChatGPT, etc. não sabem
   dos tokens custom desse projeto, então defaultam pra classes Tailwind padrão. Sempre rode
   `check:tokens` após edits gerados por AI.
3. **Git hooks tinham direção errada de merge** — `git checkout main && git merge branch -X ours`
   mantinha a versão do main, não da branch de trabalho. Fixed: hooks usam rebase agora.

## Migrations — estado do registro (auditado 30/07/2026)

**Project ID atual:** `ssvxfoybzmjlypnipqzn` (migrado em mai/2026 do antigo `qrdvwoijghmgugejponz`, que ficou inacessível).

SQL Editor: https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new
Dashboard: https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn

> **Nota:** Existe um segundo projeto Supabase chamado **"SquadShoes Correto"** (ID `vffuwxirbxvnekdgfogq`, sa-east-1, criado em mai/06) que está **completamente vazio** — sem tabelas. O nome é enganoso. O sistema rodando hoje continua em `ssvxfoybzmjlypnipqzn` (us-west-2).

### Regra de ouro: a verdade é o BANCO, não a lista de arquivos

Durante ~2 meses as migrations foram aplicadas via **MCP** (`apply_migration`) ou pelo
SQL Editor, que **não** gravam em `supabase_migrations.schema_migrations`. Isso criou um
backlog de 368 arquivos "não registrados" que na prática já estavam no banco. Antes de
concluir que algo está pendente, **verifique o objeto no banco** (função, view, coluna,
índice, trigger) — não confie no nome do arquivo nem nesta lista.

### O que foi feito em 30/07/2026

1. **Deduplicação de versões.** `version` é PK de `schema_migrations`, e havia **92
   versões duplicadas (114 arquivos)** — com isso `supabase db push` nunca poderia
   funcionar. Os 114 foram renomeados com `git mv` (conteúdo intacto), preservando o
   carimbo original no arquivo citado pelo código/documentação.
2. **Registro retroativo de 365 migrations** já aplicadas, verificadas objeto a objeto no
   banco (371 checagens: funções, views, tabelas, colunas, índices, triggers, policies).
   Toda ausência foi rastreada até um `DROP` deliberado posterior.
3. **Backlog daquela auditoria: 4 arquivos** — hoje são **3**; ver abaixo.

⚠ **Contagem não prova estado — nem então, nem hoje.** Este item dizia "todos os outros
**1.298** estão registrados" e envelheceu em uma semana. Medido em **05/08/2026 (fim do
dia)**: `schema_migrations` tem **2.196 linhas** e o repo tem **1.365 arquivos** `.sql` —
e ambos os números já haviam mudado *dentro do mesmo dia* (eram 2.191 / 1.361 de manhã).
Os dois **não se comparam**, e a diferença não é backlog — existem as duas direções:
**registro sem arquivo** (o `apply_migration` grava um carimbo com a data real; vários
nunca viraram arquivo no repo) e **arquivo sem registro** (aplicado por MCP/SQL Editor sob
outro carimbo). Vale a Regra de ouro acima: **verifique o objeto no banco**, não a
aritmética.

### ⚠ As 3 que NUNCA aplicaram (não registrar sem decidir)

> Eram 4 até 05/08/2026. O `20260517150001_purchase-order-total-trigger` **saiu da lista**:
> a função `recalc_purchase_order_total` e o trigger passaram a existir no banco pela
> migration `20261124120000` (commit `7033ca7`), que resolveu o mesmo problema por um
> arquivo novo em vez de re-rodar o antigo — que é o caminho recomendado aqui. O arquivo
> de 2026-05-17 continua sem registro e **deve continuar assim**: re-executá-lo hoje
> recriaria objetos que já existem sob outra definição.

| Arquivo | O que faltou | Consequência viva | Bloqueio |
|---|---|---|---|
| `20260515130000_payroll-runs-create-and-migrate` | as 2 views (`v_employee_fgts_provision`, `v_clt_provisions_summary`) — tabela e função aplicaram | nenhuma: **nenhum consumidor no frontend** | re-rodar o arquivo é perigoso (tem `DROP TABLE` + `UPDATE`). Se as views forem desejadas, criar em migration NOVA |
| `20260518120002_clients-municipio-cnpj-unique` | o índice único de CNPJ (a coluna `codigo_municipio` aplicou) | duplicata de cliente **já aconteceu** (PONTO MIX CONFECCOES, recadastrada em 28/07) | **1 CNPJ duplicado** — `32168100000118`, 2 linhas com a MESMA `razao_social` (PONTO MIX CONFECCOES LTDA). Precisa de decisão de qual sobrevive + remapeamento das FKs antes do índice |
| `20260518150001_wave-items-null-conflict-and-restore-idempotency` | o índice `idx_wave_items_unique` com `NULLS NOT DISTINCT` (a função aplicou) | **199 linhas excedentes** em `production_wave_items` — o `ON CONFLICT` não dispara quando `sole_product_id` é NULL | as duplicatas precisam ser limpas antes. Recorte medido em 05/08/2026: **34 grupos** `(wave_id, reference_id, sole_product_id, color)`, **todos com `sole_product_id` NULL** (confirma a causa raiz), todos de mai/2026 — 135 linhas em ondas `planning`, 36 em `running`, 18 `cancelled`, 8 `finished`, 2 `draft`. As 36 de onda `running` são as delicadas: a onda está no chão de fábrica |

**`20260525120002_fix-profiles-self-approval-rls` também nunca aplicou** — mas está
registrada como **SUPERSEDIDA**, porque aplicá-la hoje **reabriria** um furo de segurança
(ver abaixo). Não desregistrar.

### 🔒 P0 fechado em 30/07/2026 — auto-aprovação em `profiles`

`profiles.approved` é o portão de **297 policies RLS** (via `is_approved_user()`), e o
trigger `on_auth_user_created` cria a linha no signup com `approved = false`. A policy
`profiles_update` permitia ao próprio usuário dar `UPDATE` na sua linha **sem restrição de
coluna** ⇒ qualquer autenticado rodava `SET approved = true` e ganhava o ERP inteiro.

Causa: `20260525120002` criava essa guarda mas nunca aplicou; três dias depois
`20260528130000_perf-audit-fixes` (essa sim aplicada) consolidou as policies de UPDATE
numa só e recriou o predicado **sem** a guarda.

Corrigido por `20261019120000_fix-profiles-self-approval-escalation` com **duas camadas**:
o trigger `tg_profiles_block_privilege_escalation` (congela `approved`/`is_sales_rep` para
não-admin) **e** o `WITH CHECK` da policy. O trigger existe justamente porque a guarda
anterior vivia só na policy e foi apagada por uma reescrita de RLS — **não remover o
trigger em nome de "simplificar"**.

### Antes de ligar o GitHub Action

`.github/workflows/supabase-migrate.yml` roda `supabase db push` quando
`supabase/migrations/**` muda em `main`. Requisitos:

1. **Resolver as 3 acima** (aplicar via migration nova, ou registrar com justificativa).
   Enquanto o `20260518120002` estiver pendente, o push **falha** no CNPJ duplicado.
2. **Decidir o destino dos 4 renomeados em 05/08/2026** (`20261116120000`–`20261116120300`):
   já aplicados no banco, mas sem registro sob o carimbo novo → um push os re-executa. Ver
   *Regressão de carimbo duplicado* abaixo. ⚠ Reconferido em 05/08/2026 (fim do dia):
   os 4 seguem com **0 registros**.
3. Cadastrar os 3 secrets em GitHub Settings > Secrets and variables > Actions:
   - `SUPABASE_ACCESS_TOKEN` — PAT de https://supabase.com/dashboard/account/tokens
   - `SUPABASE_DB_PASSWORD` — Database > Settings > Connect > "Reset database password"
   - `SUPABASE_PROJECT_ID` = `ssvxfoybzmjlypnipqzn`
4. Primeira execução manual com `dry_run: true` (Actions tab > Run workflow).

### Migration nova — carimbo

O carimbo é uma **sequência sintética**, não a data de hoje: use um valor **maior que a
maior versão já registrada**. Usar a data corrente gera um carimbo menor que o topo e trava
o pipeline. **Não confie em número escrito aqui** — esta linha já ficou desatualizada três
vezes (dizia `20261019120000` com o banco em `20261110120000`, auditoria de 03/08/2026; de
manhã em 05/08/2026 o topo era `20261120120000`, e no fim do MESMO dia já era
`20261202120000`).

⚠ **`max(version)` sozinho NÃO basta — consulte as DUAS fontes.** O topo do banco ignora
arquivo que existe no repo mas ainda não foi registrado; se houver um acima do topo, pegar
`max(version) + 1` recria uma colisão de PK. Use sempre o **maior dos dois**:

```sql
-- fonte 1: topo REGISTRADO
select max(version) from supabase_migrations.schema_migrations;
```

```bash
# fonte 2: maior ARQUIVO local (pode estar ACIMA do topo registrado)
ls supabase/migrations/*.sql | tail -1
```

⚠ **Worktree compartilhado:** outra sessão pode registrar um carimbo mais alto — ou criar um
arquivo mais alto — enquanto você trabalha. Reconsulte na hora de aplicar, não só na hora de
criar o arquivo.

Ao aplicar via MCP, o `apply_migration` grava um carimbo próprio com a **data real de hoje** —
que hoje é MENOR que o topo da sequência sintética, então o registro sai fora de ordem.
**Alinhe o registro ao nome do arquivo** depois, senão o `db push` re-executa o arquivo:

```sql
update supabase_migrations.schema_migrations
set version = '<carimbo_do_arquivo>', name = '<nome-do-arquivo-sem-carimbo>'
where version = '<carimbo_que_o_MCP_gravou>';
```

### ⚠ Regressão de carimbo duplicado — aconteceu DE NOVO em 08/2026

A deduplicação de 30/07 (92 versões / 114 arquivos) não imunizou nada: em **05/08/2026**
havia **4 novas colisões**, todas geradas por **sessões paralelas em worktrees diferentes**
trabalhando sobre o mesmo repo e o mesmo banco.

**A mecânica** (caso `20261115120400`, o mais didático): o arquivo `pv-pendencias-report`
foi criado em 03/08 e **não** chegou a ser registrado. Em 05/08 outra sessão consultou
`max(version)` no banco — que não conhecia esse arquivo —, leu o carimbo como "livre" e
criou `contractor-metrics-open-balance-parity` com ele. Ninguém errou o procedimento
escrito; **o procedimento é que era incompleto**, por olhar só o banco. Daí a regra das duas
fontes acima. Os outros 3 pares (`20261102120000`, `20261102120100`, `20261115120300`)
vieram da mesma raiz.

**Como foi resolvido:** de cada par colidido, o arquivo **já registrado no banco manteve o
carimbo** e só o **não registrado** foi renomeado (`git mv`, conteúdo SQL intacto), para uma
faixa nova acima do topo real — `20261116120000`–`20261116120300`, espaçados de 100 e
deixando a faixa do dia 15 livre pra sessão que ainda estava criando migrations. A ordem
relativa foi preservada onde importava (`pv-promotion-engine-mrp` continua depois de
`pv-promotion-engine`, que ele faz `CREATE OR REPLACE`; o backfill continua antes de
`payroll-runs-pares-produzidos`). As referências a carimbo no código foram reapontadas
(`useRH.ts`, `usePayrollPayments.ts`); as que citavam o arquivo **que ficou** não mudaram.

⚠ **Renomear resolve a colisão de PK, mas NÃO destrava o `db push`:** os 4 renomeados já
estão **aplicados** no banco e agora estão **sem registro** sob o carimbo novo — um push os
**re-executaria**. Antes de ligar o GitHub Action, decidir por arquivo: registrar
retroativamente ou aceitar a re-execução. O de maior risco é o backfill
`20261116120000`, que recalcula valor/par de folha a partir da agregação atual da Ficha de
Montadores (folha em rascunho ajustada à mão voltaria ao valor recalculado).

### ⚠ Antes de auditar migration, rode `git worktree list`

Terceira forma de drift, descoberta em **05/08/2026** e **não coberta** pelas duas
direções descritas acima ("registro sem arquivo" / "arquivo sem registro"): a migration
está **aplicada E registrada corretamente** no banco, sob o carimbo certo, e mesmo assim
**não existe no repo** — porque o arquivo vive **não commitado numa worktree paralela**.

Foi o caso de `20261126120000` (waste_factor) e `20261202120000` (exposição de crédito):
ambas aplicadas via MCP e registradas, com `20261202120000` sendo inclusive o **topo da
sequência**, enquanto os `.sql` estavam apenas como `??` no `git status` de
`/Users/leonardomonnerat/Downloads/squadshoes-fix-conhecidos`. Uma auditoria feita só no
diretório principal veria "topo registrado = `20261202120000`, arquivo inexistente" e
concluiria **registro órfão** — quando na verdade era trabalho vivo por commitar.
Commitá-las não reaplicou nada; só alinhou o repo ao banco.

**Antes de concluir qualquer coisa sobre o estado das migrations:**

```bash
git worktree list                       # onde mais existe trabalho vivo
git -C <cada-worktree> status --short   # inclusive os ?? de supabase/migrations/
git stash list                          # há 6 stashes de sessões antigas neste repo
```

⚠ Uma worktree cujo **diretório não existe mais** continua listada se estiver `locked` —
o `git worktree prune` a preserva de propósito. Confira com
`git log --oneline main..<branch>` se ela ainda guarda commit não integrado antes de
tratá-la como lixo (a `worktree-os-recibo-modelo-a` não guardava: zero commits à frente
de `main`).
