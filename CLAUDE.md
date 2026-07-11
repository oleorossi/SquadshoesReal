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
5. **Após edits visuais** — run `npm run check:tokens` to detect hardcoded colors that should be design tokens.

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

### Nomenclatura / idioma (regra load-bearing)
- **Domínio em português, framework em inglês.** Entidades, colunas de banco, nomes de página,
  strings de UI e comentários → **pt-BR** (`razao_social`, `nfe_emitidas`, `'Cliente cadastrado!'`).
  Nomes de hook/util e **React Query keys** → inglês (`useCreateClient`, `queryKey: ['clients']`).
  Entidades fiscais/fabris permanecem em português mesmo no código.
- Locale pt-BR: `Intl.NumberFormat('pt-BR', …)`, moeda `BRL` (usar helpers de `src/lib/utils.ts`).

### Testes
- **Vitest** (`vitest/globals`). Colocar em `__tests__/` ao lado do módulo, ou `*.test.ts` direto
  ao lado do fonte. Sufixos usados: `.units.test.ts`, `.integration.test.ts`, `.edge-cases.test.ts`.
- Rodar: `bun run test` (exclui suítes pesadas) / `bun run test:units`.

## Regra de cálculo de consumo de materiais (CANÔNICA)

> Fonte de referência do cálculo exibido no modal **"Consumo de Materiais"** do PV
> (`src/components/sale-orders/MaterialConsumptionDialog.tsx`) e na lib
> `src/lib/materialConsumption.ts`. Toda mudança de consumo deve respeitar isto.

**Princípio central:** um valor de consumo armazenado como **dm²/par (área)** NUNCA pode
ser exibido/usado cru como se fosse a unidade linear do produto. Ele tem que ser
convertido para a unidade física do produto usando as dimensões da **ficha de
componente** (`component_sheets`).

### Conversões
- **Material de ÁREA cortado de bobina** (napa, couro, forro): `quantity_per_unit` /
  `*_consumption` está em **dm²/par**.
  - → **metros lineares** = `dm² ÷ (largura_mm / 10) × (1 + perda%)` quando o produto é
    unidade linear (m/cm) e a ficha tem largura. (`convertDm2ToLinearMeters`)
  - → **placas** = `dm² ÷ área_da_placa_dm²` quando a unidade é placa.
    (`convertDm2ToPlates`)
- **Item linear DIRETO sem ficha de componente** (tiras, elásticos): `quantity_per_unit`
  já está na unidade nativa (metro/contagem) → **NÃO converter**.
- **Solado**: por par, segmentado por **numeração** (`sizeBreakdown`), nunca por área.

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

Auditoria de 22/05/2026 confirmou que TODOS os worksheets seguem esse padrão
(inline styles + cores hardcoded), por isso sobreviveram intactos às 6 fases
de redesign do Industrial Editorial Pro nos primitives shadcn.

### Check for violations
```bash
npm run check:tokens
```

### Height conventions (Tailwind h-*)
Padrão de altura por contexto pra manter consistência visual:

| Classe | px | Uso |
|--------|----|----|
| `h-7`  | 28 | Toolbars dentro de tabelas, ações inline em listas densas |
| `h-8`  | 32 | Tamanho `size="sm"` do shadcn — uso geral em filtros/sub-actions |
| `h-9`  | 36 | Tamanho default — header de página, formulários principais |
| `h-10` | 40 | CTAs primários, botões em modais |
| `h-11` | 44 | Apenas hero CTAs (rara, não usar em UI normal) |

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

## Pending DB Migrations

**Project ID atual:** `ssvxfoybzmjlypnipqzn` (migrado em mai/2026 do antigo `qrdvwoijghmgugejponz`, que ficou inacessível).

SQL Editor: https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new
Dashboard: https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn

> **Nota:** Existe um segundo projeto Supabase chamado **"SquadShoes Correto"** (ID `vffuwxirbxvnekdgfogq`, sa-east-1, criado em mai/06) que está **completamente vazio** — sem tabelas. O nome é enganoso. O sistema rodando hoje continua em `ssvxfoybzmjlypnipqzn` (us-west-2). Decidir se vai migrar pra `vffuwxirbxvnekdgfogq` (e replicar tabelas) ou deletar — fora do escopo das migrations.

### ✅ Aplicadas em 2026-05-08 via MCP (auditoria + Frentes 1-2-4)

As 7 migrations abaixo foram aplicadas diretamente em `ssvxfoybzmjlypnipqzn` via Supabase MCP:
- `20260524120000_audit-fix-conversion-and-parallelism.sql` ✅
- `20260524130000_refine-list-materials-missing-width.sql` ✅
- `20260524140000_strap-debit-preventive-hardening.sql` ✅
- `20260524150000_audit-round-2-fixes.sql` ✅ (split em 4 partes pelo MCP)
- `20260525120000_add-costura-to-default-lead-times.sql` ✅
- `20260525130000_timesheet-import-files-archive.sql` ✅
- `20260525140000_sheet-materials-variant-id.sql` ✅

**Atenção pro GitHub Action:** como essas foram aplicadas via MCP (não via `supabase db push`), elas NÃO estão registradas em `supabase_migrations.schema_migrations`. Se você ativar o GitHub Action e rodar `supabase db push --linked`, ele vai tentar re-aplicar. Como são idempotentes, não vai quebrar — mas o ideal é rodar `supabase migration repair --status applied <timestamp>` pra cada uma antes do primeiro push automático. Use `scripts/repair-applied-migrations.sh`.

### Auto-apply via GitHub Actions

`.github/workflows/supabase-migrate.yml` aplica migrations automaticamente quando arquivos em `supabase/migrations/**` mudam em `main`. Também pode ser disparado manualmente via Actions tab > "Run workflow" (com `dry_run: true` recomendado na primeira vez).

**Setup (uma vez só):**
1. Criar Personal Access Token em https://supabase.com/dashboard/account/tokens (escopo: leitura+escrita)
2. Pegar senha do banco em Database > Settings > Connect > "Reset database password" (não copiar a anterior — gerar nova)
3. Ir em GitHub Settings > Secrets and variables > Actions > Secrets, e cadastrar:
   - `SUPABASE_ACCESS_TOKEN` = o PAT do passo 1
   - `SUPABASE_DB_PASSWORD` = a senha do passo 2
   - `SUPABASE_PROJECT_ID` = `ssvxfoybzmjlypnipqzn`
4. Disparar primeira run manualmente com `dry_run: true` pra ver quais migrations o sistema considera pendentes.
5. Se houver backlog (migrations já aplicadas via SQL Editor mas não rastreadas), editar `scripts/repair-applied-migrations.sh` adicionando os timestamps em `ALREADY_APPLIED` e rodar localmente.
6. Quando estiver tranquilo, dispare `dry_run: false` ou faça push de uma migration nova — vai aplicar automaticamente.

**Aplicação manual (fallback):**
Apply **in order** (oldest first). Migrations com GUIDs no nome (legacy do tempo do Lovable) já estão aplicadas no banco — só as listadas abaixo precisam de aplicação manual via SQL Editor ou MCP.

### Grupo 1 — Correções anteriores (verificar se já aplicadas)
- `20260419120147_fix-sole-double-debit-and-grade-restore.sql` — corrige duplo débito de solado em OPs com grade
- `20260419130000_fix-production-wave-engine.sql` — motor de ondas de produção
- `20260419140000_perf-restore-product-stocks.sql` — performance de restauração de estoque
- `20260420100000_erp-improvements.sql` — melhorias gerais do ERP
- `20260420110000_supplier-price-history.sql` — histórico de preços de fornecedores

### Grupo 2 — Pendentes confirmadas (listadas na versão anterior do CLAUDE.md)
- `20260421090000_fix-strap-color-fallback.sql` — remove fallback silencioso de cor errada nas tiras
- `20260421100000_add-minimum-overtime-to-work-schedules.sql` — mínimo de horas extras em escalas
- `20260421120000_artisanal-recipes.sql` — receitas artesanais
- `20260424120000_consumption-per-size-single-source.sql` — consumo por numeração como fonte única (versão anterior, substituída pelo grupo 3)
- `20260424140000_fix-production-sector-flow.sql` — corrige fluxo de setores de produção
- `20260424180000_fix-packaging-debit-stock-movements.sql` — registra stock_movements no débito de embalagem
- `20260425155923_fa87b65c-113c-42ed-bb26-a8eb7d4be2b6.sql` — adiciona `adjust_stock()` RPC com controle de concorrência (obrigatório para StockAdjustmentPage)

### Grupo 3 — Novas desta sessão (obrigatórias)
- `20260426120000_consumption-per-size-as-primary-source.sql` — **CRÍTICA**: atualiza `calculate_order_consumption()` e `calculate_order_consumption_by_grade()` para usar `technical_sheets.*_consumption_per_size` como fonte primária (dados da ficha técnica prevalecem sobre sole_technical_specs)
- `20260426130000_sole-size-conjugations.sql` — **NOVA**: cria tabela `sole_size_conjugations`, função `get_sole_size_key()` e atualiza `debit_sole_stock_by_grade()` com suporte a numerações conjugadas (23/24 etc.)
- `20260426140000_fix-conjugation-debit-legacy-fallback.sql` — **CRÍTICA**: corrige bug no débito conjugado — usa key conjugado apenas se ele existir no stock_grade, senão usa keys individuais (compatibilidade com dados existentes)

### Grupo 4 — Sessão atual (Gestão de Solados / consumo by-grade)
- `20260518120000_fix-graded-consumption-fachete-and-fallback.sql` — **CRÍTICA**: (1) adiciona componente "Fachete" em `calculate_order_consumption_by_grade` (faltava — solados fachetados em PV com grade não consumiam o forro extra); (2) marca `source='fallback_average'` e adiciona `consumption_warning` quando algum tamanho cai na média escalar da ficha (UI alerta o usuário); (3) cria helper `list_missing_sole_consumption_sizes(uuid)` para validação no editor.
- `20260518130000_extend-unit-audit-soles.sql` — Estende `audit_unit_divergences()` com checks de `fachete_lining_consumption_dm2 < 1`, valores `< 1` dentro do JSONB `*_consumption_per_size` (cobre cabedal/forro/palmilha por tamanho), e solados com `unit ≠ par`.
- `20260520110000_null-orphan-shoe-category-fks.sql` — Pré-requisito: zera 21 `shoe_category_id` que apontavam pra `silk_shoe_category` deletadas (corruption pré-existente). Sem isso, qualquer UPDATE em `technical_sheets` aborta com 23503.
- `20260520120000_aviamento-label-and-pronto-na-cor.sql` — **CRÍTICA**: (1) backfill de `technical_sheets.production_sectors` JSONB substituindo `Mesa`→`Aviamento`, `Corte`→`Corte Palmilha`, `Forração`/`Costura`→`Corte Forração`; (2) trigger BEFORE INSERT/UPDATE em `technical_sheets` que remove `Corte Palmilha` e `Corte Forração` automaticamente quando `insole_ready_made=true`.
- `20260520130000_fix-pronto-na-cor-backfill-fk-safe.sql` — Corrige falha do backfill da migration acima quando rows têm `shoe_category_id` órfão. Faz UPDATE direto em `production_sectors` (não toca `insole_ready_made`) e usa DO/EXCEPTION para pular rows com FK quebrado pré-existente. **APLICAR LOGO APÓS** a 20260520120000.
- `20260521120000_add-costura-sector.sql` — **PR 2**: novo setor "Costura" entre Corte Forração e Aviamento. Adiciona coluna `costura_capacity_per_day` em `technical_sheets` e `costura_start_date` em `production_waves`. Reaproveita enum value `costura` (era legacy de Corte Forração). Atualiza `stage_order()`, `sector_display_to_enum()`, `compute_wave_timeline()`, `update_wave_timeline()` e `v_wave_detail`. Trigger `tg_strip_cut_sectors_when_ready_made` agora também remove "Costura" quando `insole_ready_made=true`. Backfill JSONB insere "Costura" nas fichas que devem ter (FK-safe).
- `20260522120000_parallelism-prep-sectors.sql` — **PR 3**: refactor de `compute_wave_timeline` para suportar paralelismo entre Corte Palmilha ‖ Corte Forração ‖ Aviamento (apenas estes 3 são paralelos). Costura/Silk/Colagem/Montagem/Solagem/Acabamento continuam sequenciais. Lead time da onda passa a ser `MAX(prep) + soma(sequenciais)` ao invés de `soma(todos)`, refletindo a realidade da fábrica. `material_ready_date` agora usa o início mais antigo dos 3 prep para garantir matéria-prima disponível antes do primeiro setor arrancar.

**PR 4 — Per-sector grouping (apenas frontend, sem migration)**:
A ficha de operador agora agrupa por **solado + cor** em 6 setores (Silk, Montagem, Corte Forração, Costura, Aviamento, Acabamento), substituindo o agrupamento legado por Ref + Cor que só fazia sentido em alguns. O componente `SilkMontageWorkSheet.tsx` foi generalizado pra aceitar todos esses 6 setores, com tema de cor próprio por setor e checkboxes "Frente / Traseira" extras em Aviamento e Acabamento (pra equipe marcar). Silk continua mostrando a imagem da arte do silk no topo. Acabamento foi removido da rota legada por loja/cliente — agora agrupa por solado igual ao Aviamento. Apenas Expedição mantém agrupamento por loja (LOJA-A-LOJA, conforme requisito do usuário). Colagem continua por Ref + Cor.

**PR 5 — Expedição loja-a-loja (apenas frontend, sem migration)**:
Ficha nova dedicada à Expedição em `ExpedicaoWorkSheet.tsx`. Uma ficha por cliente/CNPJ (não por OP) com: header (cliente + CNPJ + cidade + total pares), seção "Embalagem" agrupada por solado mostrando pares + pares/caixa + caixas + ✓ pra conferência, e tabela "Itens · Conferência" listando cada OP em uma linha com OP/ref/cor/solado/grade/total + ✓. Sem agrupamento dos itens (conforme requisito). `pairs_per_box_individual` puxado do `product_groups` do solado de cada OP; default 12 pares/caixa quando faltar. Removido o uso de `groupOrdersByStore` em `PrintWorkSheetsPage.tsx`.

- `20260523120000_drop-unused-technical-sheets-columns.sql` — **PR 7**: DROP de 47 colunas mortas em `technical_sheets`. Auditoria via `sql-scripts/audit-technical-sheets-fill-rate.sql` mostrou 75 colunas com 0% fill rate em 22 fichas. Cruzando com código (src/ + funções SQL atuais), separamos: colunas usadas pela fórmula (capacidades por setor, fachete, consumption_per_size, insole_ready_made, etc.) → MANTER (estão vazias só porque ninguém configurou); puros stubs do form (`useTechnicalSheets.ts`) sem display nem lógica → DROP. Removidos: stubs de marketing/etiqueta (acceptance_criteria, care_instructions, certifications, country_origin, keywords, label_info, legal_composition, storage_instructions), versionamento manual (approvals, change_log, data_ultima_revisao, responsavel_revisao, responsible_person, qtd_prevista), specs técnicos manuais (heel_base/material/type, insole_thickness, lining_weight, upper_finish, stitch_spec, material_solado_tipo, sole_code, last_*), cola (cola_cure_time, cola_type), embalagem manual (packaging_box_dimensions, packaging_notes, packaging_tissue, palletization), capacidades legacy (daily_capacity_pairs, palmilha_daily_capacity, handling_time_minutes), QC (quality_tests, sampling_plan, tolerances, machine_settings, measurements), e específicos (acabamento_tiras, obs_harmonizacao, assembly_instructions, commercial_description). View `purchase_projection_timeline` recriada usando `mesa_daily_capacity` (substituto correto pra `lead_time_mesa_dias`, era handling_time_minutes legacy). Frontend atualizado: `useTechnicalSheets.ts` (interface + initial state), `TechnicalSheets.tsx` (4 inputs removidos), `VersionsTab.tsx` (ApprovalsEditor + ChangeLogEditor + responsible_person input removidos), `OperationsTab.tsx` (write de daily_capacity_pairs removido).

**PR 8 — Polimento A4 da impressão (apenas frontend, sem migration)**:
Refinamento dos print styles em `PrintWorkSheetsPage.tsx`: adiciona `break-inside: avoid` nos cards de cor/grupo (via classe `keep-together`), `print-color-adjust: exact` pra cores fiéis na impressão (sem desbotamento), `display: table-header-group/footer-group` pra cabeçalhos/rodapés repetirem em tabelas multipágina, e `font-size: 10pt` base. Cards `keep-together` adicionados em SilkMontageWorkSheet (cada cor), PalmilhaWorkSheet (cada solado), SolagemWorkSheet (cada banda de cor), ExpedicaoWorkSheet (resumo de embalagem).

**PR 6 — Relatório gerencial (apenas frontend, sem migration)**:
Componente novo `ManagementReport.tsx` — uma ficha A4 gerencial por PV (sale order) com info COMPLETA pra acompanhamento gestor. Diferente das fichas de operador (minimalistas pra execução), aqui o foco é "olho de gestor" sobre o pedido. Seções: header (PV + cliente + CNPJ + cidade + deadline + status), KPIs (OPs/pares/receita/margem), tabela de OPs com matriz de status por setor (✓/●/○ pra cada estágio do fluxo), tabela de custos (material/MO/overhead/total/receita/margem por OP + total agregado). `PrintWorkSheetsPage.tsx` ganha opção 'Relatório Gerencial' no dropdown; novos queries `order_costs` e `order_stages` carregam só nesse modo. Custos puxados de `order_costs` (resultado de `calculate_order_cost`); status por setor de `order_stages`. Quando custos não foram calculados, mostra alerta âmbar pedindo pra rodar "Calcular Custos" no PV. Footer com 3 assinaturas: PCP / Comercial / Financeiro.

- `20260524120000_audit-fix-conversion-and-parallelism.sql` — **Auditoria fix**: dos 35 achados de auditoria nas 4 áreas (estoque/unidades/ondas/compras), 33 foram falsos positivos. 2 bugs reais: (1) Frontend `sectorCapacity.ts` calculava cascata sequencial mas `compute_wave_timeline` (PR 3) é paralelo — datas divergiam entre UI e relatório do server. **Corrigido** em `sectorCapacity.ts` + `leadTime.ts` (refletindo paralelismo Corte P‖Corte F‖Mesa + Costura sequencial). (2) `get_material_conversion_info` retornava `dm2_per_unit=1` em silêncio quando produto linear (m/cm) não tem `dimensions_width` em `component_sheets` → UI mostrava valor "metros" que era dm² (~100× errado). **Corrigido**: função agora retorna campo extra `conversion_warning` (text nullable) descrevendo o problema, e nova função `list_materials_missing_width()` lista materiais afetados. Compatível com callers existentes (todos usam `SELECT * INTO v_conv` RECORD).
- `20260524130000_refine-list-materials-missing-width.sql` — Refina `list_materials_missing_width()` filtrando falsos positivos. V1 listava todos os produtos lineares sem largura (50 entradas, ~47 eram tiras/elásticos que usam fluxo `debit_strap_stock` em cm/par e NÃO passam por `get_material_conversion_info`). V2 filtra: exclui produtos cujo nome OU grupo casa com /tira|elastic|strass|tranç/, e mantém só os que SÃO referenciados em alguma `sheet_materials` ou em `upper/lining/insole_material` de uma ficha técnica. Adiciona coluna `used_in_sheets` mostrando quantas fichas usam o material — facilita priorizar correção.
- `20260524140000_strap-debit-preventive-hardening.sql` — Hardening DEFENSIVO em `debit_strap_stock` (auditoria mostrou que está OK em produção, fix preventivo): (#A) advisory lock por order_id + check de stock_movements duplicado pra evitar débito 2× em retries; (#C) `CEIL` no cálculo de fichas (era `round`, podia arredondar pra menos em qty fracionária); (#D) `unaccent()` no match de cor (Café=Cafe, Carmim=Carmín). Requer extensão pg_unaccent (já vem no Supabase). Compatível com fluxo atual.
- `20260524150000_audit-round-2-fixes.sql` — **Auditoria Round 2 — 3 bugs reais**: (#1 CRÍTICO) `calculate_order_cost` tinha unit mismatch — sole_standard_items emitidas em `g` eram multiplicadas por unit_price em `R$/kg`, gerando custo até 1000× errado. Corrigido com nova função `convert_to_product_unit(qty, src, tgt)` aplicada antes da multiplicação. Breakdown agora expõe `required_in_product_unit + consumption_unit + product_unit` pra auditoria. (#3 MENOR) `get_wave_material_needs` podia duplicar produtos que estavam em `sheet_materials` E também via `resolve_sole_color` se a categoria não casasse com `%solado%` — corrigido com anti-join (`NOT IN sole_product_ids`); stock_qty também deduz reserved_stock agora. (#4 MENOR) `purchase_projection_timeline` view não deduzia `reserved_stock` em `estoque_atual` — relatórios eram otimistas. Recriada com `GREATEST(0, m.quantity - reserved_stock)` e adiciona `estoque_bruto` + `estoque_reservado` pra auditoria. Frontend: `useCreatePurchaseOrder` ganhou idempotência client-side por hash do payload (Map TTL 30s) — bloqueia double-click criar 2 POs.
- `20260524160000_audit-round-6-reservation-financial-rh-fixes.sql` — **Auditoria Round 6 — 4 bugs em áreas não cobertas**: (#1 CRÍTICO) `release_order_reservations` (cancelamento de OP) não devolvia `products.reserved_stock` — apenas marcava `material_reservations.status='cancelled'`. Cada OP cancelada vazava reservas indefinidamente, fazendo frontend (8+ pontos: OrderMatrixForm/MrpUnifiedContent/PurchasePlanningWizard/...) mostrar "disponível" cada vez menor. Reescrita pra calcular `SUM(quantity_reserved-quantity_consumed)` por product e devolver via UPDATE. **(⚠ atualização auditoria 2026-06-29: a função VIVA hoje sincroniza `reserved_stock` via trigger `tg_sync_reserved_stock`/`sync_product_reserved_stock`, NÃO via UPDATE manual — drift=0 verificado no banco. NÃO reintroduzir UPDATE manual: causa duplo-decremento com o trigger.)** (#2 CRÍTICO) `try_reserve_materials` inseria em `material_reservations` mas NUNCA atualizava `products.reserved_stock` — coluna lida por todo o frontend pra calcular disponível, ficava sempre 0/subestimada. Adicionado trigger `tg_sync_reserved_stock_on_insert` AFTER INSERT que incrementa reserved_stock automaticamente. UPDATE/DELETE não cobertos pra evitar duplo-decremento com funções legacy (convert/debit) que já decrementam manualmente. (#3 CRÍTICO) `financial_entries` não tinha unique constraint em `(reference_id, reference_type)` — race em retry de "Faturar" duplicava receita nos relatórios. Adicionado UNIQUE INDEX parcial filtrando `reference_type='sale_order' AND status NOT IN ('cancelado','cancelled','estornado')` (estornos legítimos podem ter mesmo ref_id). (#4 MÉDIO) VIEW `bank_hours_balance` ignorava o derivado de timesheet (só somava `bank_hours_movements`) — RH/Hub mostrava saldo divergente entre lista (errado, sem timesheet) e detalhe individual (correto, RPC inclui timesheet). View recriada com LATERAL JOIN à `calculate_employee_bank_balance(employee_id)` pra ficar consistente; views dependentes (`v_bank_hours_summary`, `v_bank_hours_per_sector`) reaplicadas. **Backfill incluso**: ressincroniza `reserved_stock` com soma real de reservas ativas em todos os products (corrige drift histórico do bug #1+#2).
