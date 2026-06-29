# Catálogo de Unidades de Medida e Conversões — Squad Shoes

> ✅ **DECISÕES FECHADAS (atualizado 2026-06-29).** Este documento nasceu como
> *snapshot pra decisão* (2026-05-30); as decisões já foram tomadas e aplicadas:
> - **Lista canônica** = `m` · `cm` · `mm` · `dm²` · `m²` · `cm²` · `un` · `par` ·
>   `placa` · `kg` · `g` · `L` · `ml` (ver tabela em `CLAUDE.md` › Unidades canônicas).
> - **Grafias proibidas normalizadas** via `toCanonical` (`src/lib/nfUnitConversion.ts`)
>   e `normalize_product_unit` (SQL): `metro`/`metros`/`mt`/`mts`→`m`,
>   `dm2`→`dm²`, `m2`→`m²`, `cm2`→`cm²`, `unid`/`unidade`/`und`→`un`,
>   `chapa`→`placa`, `gr`/`grama`/`gramas`→`g`, `litro`/`litros`/`l`→`L`.
> - **`chapa` e `gr` NÃO são mais órfãs** — mapeiam pra `placa`/`g` (a Tabela A
>   abaixo é histórica; ver notas inline). `placa` virou membro canônico do enum
>   `UnidadeMedida` em 2026-06-29 (sem fator fixo — placa→dm² mora em
>   `conversion_rate`, ver §3.2).
> - Banco normalizado em massa pela migration `20260702120000`; auditoria de
>   2026-06-19 (`AUDITORIA_UNIDADES_2026-06-19.md`) confirmou 0 unidade fora do canônico.
>
> **Propósito original:** levantar **todas** as unidades e conversões existentes no sistema
> (camada TS do frontend + funções SQL do servidor + dados reais no banco) para
> **avaliação e definição de regra canônica**. Gerado em 2026-05-30.

---

## 0. Resumo executivo — o que precisa virar regra

1. **Mesma unidade, várias grafias.** O metro aparece como `m`, `metro`, `metros`, `mt`.
   O frontend (`LINEAR_UNITS`) reconhece `cm/m/metro/mt` mas **não** `metros` (plural).
   → Definir uma grafia canônica por unidade e normalizar.
2. **Grafias órfãs (não reconhecidas por nenhum conversor):**
   - `gr` (1 produto em `production_unit`) — o conversor SQL usa `g`, não `gr` → conversão **falha** (retorna NULL).
   - `chapa` (1 produto em `purchase_unit`) — não existe em nenhum conjunto de unidades.
   - `dm²` como `production_unit` (1 produto) — área usada como unidade de produção.
3. **`dm²` é a unidade intermediária canônica** de todo consumo de material de área —
   e SEMPRE deve ser convertida para a unidade física antes de exibir/custear
   (ver `CLAUDE.md` › "Regra de cálculo de consumo de materiais").
4. **Duas implementações de conversão** (TS no frontend × SQL no servidor) que podem
   divergir — a regra deve declarar qual é a fonte da verdade.
5. **Unidades implícitas** (sem coluna de unidade): grade = pares, tira = cm/par,
   `quantity_per_unit` de material de área = dm²/par. A regra deve torná-las explícitas.

---

## 1. Unidades em uso (dados reais do banco, 2026-05-30)

| Coluna | Valores encontrados (qtd) |
|---|---|
| `products.unit` (unidade de estoque) | `m` (112) · `par` (11) · `un` (8) · `kg` (7) · `L` (1) |
| `products.purchase_unit` | `metro` (73) · `un` (48) · `m` (14) · `kg` (3) · **`chapa`** (1) |
| `products.production_unit` | `metros` (85) · `un` (48) · `m` (2) · `kg` (2) · **`gr`** (1) · **`dm²`** (1) |
| `products.consumption_unit` | `m` (112) · `par` (11) · `un` (8) · `kg` (7) · `L` (1) |
| `component_sheets.dimensions_unit` | `mm` (69) — 100% mm |
| `products.conversion_rate` | `=1` (127) · `≠1` (12) — usado por 12 produtos |

**Unidades canônicas de fato em uso:** `m` · `par` · `un` · `kg` · `L` (+ `mm` nas dimensões).

---

## 2. TABELA A — Unidades reconhecidas pelo sistema

| Unidade | Categoria | Significado | Rótulo (UI) | Onde é reconhecida | DECISÃO |
|---|---|---|---|---|---|
| `m` | Linear | metro | m | TS `LINEAR_UNITS`, SQL | ☐ |
| `metro` | Linear | metro (sinônimo) | m | TS `LINEAR_UNITS` | ☐ |
| `mt` | Linear | metro (sinônimo) | m | TS `LINEAR_UNITS` | ☐ |
| `metros` | Linear | metro (plural) | m | ⚠️ **só** em dados; TS não reconhece | ☐ |
| `cm` | Linear | centímetro | m (após ÷100) | TS `LINEAR_UNITS`, SQL | ☐ |
| `mm` | Linear | milímetro | mm | SQL + dimensões | ☐ |
| `dm²`/`dm2` | Área | decímetro² (intermediária do consumo) | dm² | TS `PLATE_UNITS`, SQL | ☐ |
| `m²`/`m2` | Área | metro² | m² | TS `PLATE_UNITS`, SQL | ☐ |
| `cm²` | Área | centímetro² | cm² | SQL | ☐ |
| `mm²` | Área | milímetro² | mm² | SQL | ☐ |
| `placa`/`placas` | Área→contagem | chapa/placa (cortada de área) | placa(s) | TS `PLATE_UNITS` | ☐ |
| `un` | Contagem | unidade/peça | un | TS, SQL | ☐ |
| `par` | Contagem | par (calçado) | par | SQL `convert_to_product_unit` | ☐ |
| `dz` | Contagem | dúzia (×12) | dz | SQL | ☐ |
| `cento` | Contagem | centena (×100) | cento | SQL | ☐ |
| `mil` | Contagem | milhar (×1000) | mil | SQL | ☐ |
| `kg` | Massa | quilograma | kg | TS label, SQL | ☐ |
| `g` | Massa | grama | kg | SQL (⚠️ dado usa `gr`) | ☐ |
| `mg` | Massa | miligrama | — | SQL | ☐ |
| `L`/`l`/`litro` | Volume | litro | L | TS label, SQL | ☐ |
| `ml` | Volume | mililitro | ml | SQL | ☐ |
| **`chapa`** | Área→contagem | sinônimo de `placa` | placa | ✅ `toCanonical`+`normalize_product_unit` → `placa` | ✅ NORMALIZADO |
| **`gr`** | Massa | grama (grafia legada de `g`) | g | ✅ `toCanonical` → `g` | ✅ NORMALIZADO |

> Conjuntos TS (`src/lib/materialConsumption.ts:30-31`):
> `LINEAR_UNITS = {cm, m, metro, mt}` · `PLATE_UNITS = {dm2, dm², m², placa, placas, un}`.

---

## 3. TABELA B — Conversões existentes

### 3.1 Camada TypeScript (`src/lib/materialConsumption.ts`, `strapConsumption.ts`)

| De → Para | Fórmula | Função (arquivo:linha) |
|---|---|---|
| cm → mm | × 10 | `convertDimensionToMm` (materialConsumption.ts:82) |
| m/metro/mt → mm | × 1000 | `convertDimensionToMm` (:83) |
| (largura×comprimento mm) → dm² | ÷ 10000 | `getPlateAreaDm2` (:105) |
| **dm² → metro linear** | `dm² ÷ (largura_mm/10) × (1+perda%)` | `convertDm2ToLinearMeters` (:229) |
| **dm² → placa** | `dm² ÷ área_placa_dm² × (1+perda%)` | `convertDm2ToPlates` (:254) |
| dm² → metro (fallback) | `dm² ÷ (largura_mm/10)` | `convertFallbackToLinear` (:275) |
| cm → metro | ÷ 100 | `calculateConsumptionWithUnit` (:304) |
| tira: cm/par → cm total | `Σ(pares × cm_por_par)` | `calculateStrapConsumptionCm` (strapConsumption.ts:62) |

### 3.2 Camada SQL (`convert_to_product_unit`, migration `20260627125000`)

| Categoria | Conversões (fator) |
|---|---|
| **Massa** | g↔kg (÷/×1000) · mg↔kg (÷/×1e6) · mg↔g (÷/×1000) |
| **Volume** | ml↔L (÷/×1000) |
| **Linear** | cm↔m (÷/×100) · mm↔m (÷/×1000) · mm↔cm (÷/×10) |
| **Área** | dm²↔m² (÷/×100) · cm²↔dm² (÷/×100) · cm²↔m² (÷/×10000) · mm²↔cm² (÷/×100) · mm²↔dm² (÷1e4) · mm²↔m² (÷1e6) |
| **Contagem** | mil↔un (×/÷1000) · cento↔un (×/÷100) · dz↔un (×/÷12) · cento↔mil (÷/×10) |
| **Incompatível** | retorna **NULL** (ex.: kg→un) → caller marca `unit_mismatch` |

> ⚠️ `convert_to_product_unit` **não** trata a conversão dm²→linear/placa (que depende
> da **largura**, não é fator fixo). Essa só existe na camada TS. Isso é uma das
> divergências TS×SQL a resolver na regra.

---

## 4. TABELA C — Colunas que armazenam unidade

| Tabela.coluna | Significado | Default |
|---|---|---|
| `products.unit` | unidade de estoque/venda (base) | `un` |
| `products.purchase_unit` / `purchase_order_unit` | unidade de compra | `un` |
| `products.production_unit` | unidade de produção/receita | `un` |
| `products.consumption_unit` | unidade de consumo no BOM | NULL |
| `products.conversion_rate` | fator entre unidades (1 compra = N estoque) | 1 |
| `products.yield_per_meter` / `yield_unit` | rendimento por metro / unidade do rendimento | 1 / `dm²` |
| `component_sheets.dimensions_unit` | unidade de largura/comprimento/espessura | `mm` |
| `product_groups.dimensions_unit` / `consumption_unit` | dimensões / consumo do grupo | — |
| `sheet_materials.quantity_per_unit` | consumo por par (unidade **implícita**) | 0 |

---

## 5. TABELA D — Unidades IMPLÍCITAS (sem coluna de unidade — candidatas a explicitar)

| Contexto | Campo | Unidade assumida | Onde |
|---|---|---|---|
| Grade do pedido | `sale_order_items.grade[nº]` | **pares** | convenção calçadista |
| Consumo BOM de material de área | `sheet_materials.quantity_per_unit` | **dm²/par** | corrigido 2026-05-30 (convertia errado) |
| Cabedal/Forro/Palmilha | `technical_sheets.*_consumption(_per_size)` | **dm²/par** | implícito |
| Solado | `technical_sheets.sole_consumption` | **par** | implícito |
| Tira/elástico | `product_strap_definitions.consumption(_per_size)` | **cm/par** | implícito |
| Cola/adesivo | consumo na ficha | **g/par** (produto em `kg`) | convertido em `calculate_order_cost` (fix 20260524150000) |

---

## 6. Pontos de atenção para a regra (proposta de decisão)

| # | Tema | Proposta | DECISÃO |
|---|---|---|---|
| 1 | Grafia do metro (`m`/`metro`/`metros`/`mt`) | Canônico **`m`**; normalizar os demais | ☐ |
| 2 | `gr` órfão | Normalizar p/ **`g`** (ou `kg`) | ☐ |
| 3 | `chapa` órfão | Normalizar p/ **`placa`** | ☐ |
| 4 | `dm²` como `production_unit` | Revisar — área não é unidade de produção | ☐ |
| 5 | Fonte da verdade da conversão | Declarar (TS × SQL) e alinhar dm²→físico no SQL | ☐ |
| 6 | Unidades implícitas | Tornar explícitas (coluna ou regra documentada) | ☐ |
| 7 | `convert_to_product_unit` não faz dm²→linear/placa | Estender no SQL ou centralizar no TS | ☐ |

---

## 7. Fontes (arquivos)

- TS: `src/lib/materialConsumption.ts`, `src/lib/strapConsumption.ts`, `src/lib/bomConsumption.ts`, `src/components/sale-orders/MaterialConsumptionDialog.tsx` (`formatUnit`).
- SQL: `supabase/migrations/20260627125000_convert-to-product-unit-null-on-mismatch.sql` (`convert_to_product_unit`), `20260524150000_audit-round-2-fixes.sql` (fix cola g↔kg), `function_def.sql` (`calculate_order_consumption_by_grade`).
- Regra de consumo já documentada: `CLAUDE.md` › "Regra de cálculo de consumo de materiais (CANÔNICA)".
