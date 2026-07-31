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
(`fetchTechnicalSheetsForConsumption`) E o modal do PV buscam por essa constante.
Faltava `sole_drives_consumption` lá → a supressão virou no-op silencioso (TS loose não
acusa `undefined`) e o forro-cabedal fantasma reapareceu no Corte Forração. Guard em
`orderConsumption.test.ts`: extrai os `sheet.*` lidos do próprio motor e trava que todos
estão no `.select()` (auto-derivado — não desatualiza). Isso vale pra QUALQUER coluna
nova que o motor passe a ler, não só esta.

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

### Check for violations
```bash
bun run check:tokens
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
3. **Backlog atual: 4 arquivos** — ver abaixo. Todos os outros 1.298 estão registrados.

### ⚠ As 4 que NUNCA aplicaram (não registrar sem decidir)

| Arquivo | O que faltou | Consequência viva | Bloqueio |
|---|---|---|---|
| `20260515130000_payroll-runs-create-and-migrate` | as 2 views (`v_employee_fgts_provision`, `v_clt_provisions_summary`) — tabela e função aplicaram | nenhuma: **nenhum consumidor no frontend** | re-rodar o arquivo é perigoso (tem `DROP TABLE` + `UPDATE`). Se as views forem desejadas, criar em migration NOVA |
| `20260517150001_purchase-order-total-trigger` | função `recalc_purchase_order_total` + trigger | `purchase_orders.total_value` só é mantido pelo **frontend** (`usePurchaseOrders.ts:404`); nada recalcula no servidor | nenhum técnico, mas o trigger pode brigar com o total gravado pelo app (frete/desconto) — decidir antes |
| `20260518120002_clients-municipio-cnpj-unique` | o índice único de CNPJ (a coluna `codigo_municipio` aplicou) | duplicata de cliente **já aconteceu** (PONTO MIX CONFECCOES, recadastrada em 28/07) | 1 CNPJ duplicado precisa ser resolvido primeiro |
| `20260518150001_wave-items-null-conflict-and-restore-idempotency` | o índice `idx_wave_items_unique` com `NULLS NOT DISTINCT` (a função aplicou) | **199 linhas duplicadas** em `production_wave_items` — o `ON CONFLICT` não dispara quando `sole_product_id` é NULL | as 199 duplicatas precisam ser limpas antes |

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

1. **Resolver as 4 acima** (aplicar via migration nova, ou registrar com justificativa).
   Enquanto o `20260518120002` estiver pendente, o push **falha** no CNPJ duplicado.
2. Cadastrar os 3 secrets em GitHub Settings > Secrets and variables > Actions:
   - `SUPABASE_ACCESS_TOKEN` — PAT de https://supabase.com/dashboard/account/tokens
   - `SUPABASE_DB_PASSWORD` — Database > Settings > Connect > "Reset database password"
   - `SUPABASE_PROJECT_ID` = `ssvxfoybzmjlypnipqzn`
3. Primeira execução manual com `dry_run: true` (Actions tab > Run workflow).

### Migration nova — carimbo

O carimbo é uma **sequência sintética**, não a data de hoje: use um valor **maior que a
maior versão já registrada** (hoje `20261019120000`). Usar a data corrente gera um carimbo
menor que o topo e trava o pipeline. Ao aplicar via MCP, o `apply_migration` grava um
carimbo próprio (`AAAAMMDDHHMMSS` real) — **alinhe o registro ao nome do arquivo** depois,
senão o `db push` re-executa o arquivo.
