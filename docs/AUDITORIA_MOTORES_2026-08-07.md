# Auditoria dos motores de consumo, baixa, compra e OS — 2026-08-07

**Pergunta:** todos os motores de cálculo conversam entre si?
**Resposta:** **não** — mas o motor de consumo não é o culpado, e o desencontro é menor do que
a primeira versão deste documento afirmava.

**Três desencontros confirmados** (1, 3 e 4), um **retratado** (2, ver a seção marcada), todos
com evidência no banco de produção.

**Critério de aprovação acordado:** paridade numérica **e** fonte única de verdade.
**Escopo:** baixa de estoque · OP (`orders`) · OS (`service_orders`) · ordem de compra.

> Método: diagnósticos vivos do próprio banco (`run_consumption_parity_tests`,
> `consumption_consistency_report`, `list_stock_debit_holes`, `audit_stock_drift_report`)
> + introspecção de `pg_proc`/`pg_views` + leitura dos motores TS dos eixos 1 e 2.
> O lado SQL foi lido do **banco**, não das migrations — vale a Regra de ouro do `CLAUDE.md`.

---

## O que está SÃO

`run_consumption_parity_tests()` — **22/22 verdes**. O escalar delega ao `by_grade`, não há
resquício de `insole_mode`, a conversão dm²→unidade passa por `get_material_conversion_info`,
Fachete entra, o gate de cor é accent-insensitive e `try_reserve` deriva a demanda do motor
unificado sem explosão própria de BOM.

⚠ **Ressalva sobre o alcance desse verde:** esses 22 casos são, em maioria, **assertivas
textuais sobre o fonte das funções SQL** ("delega", "não usa campo legado", "aplica conversão")
mais 3 smokes de runtime. Eles provam coerência **interna do lado SQL**. **Nada hoje compara o
número que o TS produz contra o número que o SQL produz** — as duas suítes checam cada lado por
dentro. Pelo critério de paridade numérica, esse eixo não é verificado por ninguém.

---

## Desencontro 1 — Duas telas leem o escalar e nunca o per-size

| Arquivo | Linha | O que faz |
|---|---|---|
| `src/components/production/MaterialConsumptionTab.tsx` | 204, 217, 230 | `Number(sheet.upper_consumption) * qty` — multiplicação crua |
| `src/components/financial/SaldoFinalTab.tsx` | 174–176 | `addMaterial(..., sheet.upper_consumption)` — escalar cru |

Nenhuma das duas lê `*_consumption_per_size`. As duas pulam, portanto:

1. os valores **por numeração** (a fonte que o motor canônico usa);
2. a conversão **dm²→metro** pela largura da ficha de componente;
3. `sole_drives_consumption` (forro/palmilha vêm do solado);
4. a supressão anti-duplicidade do forro de cabedal.

**Impacto medido:** na referência `CF 09 ` o escalar é `0,68` e o per-size é `20` em todas as
6 numerações — **fator 29,4×**. Para material de área com largura cadastrada, é a mesma classe
do bug corrigido em 2026-05-30 no `sheet_materials`, que inflava ~100×.

⚠ **`SaldoFinalTab` está montado no Planejamento de Compras** (`src/pages/PurchasePlanning.tsx:235`).
Não é tela morta: o caminho ingênuo alimenta decisão de compra.

---

## ~~Desencontro 2 — O MRP mostra um número e compra outro~~ · RETRATADO

> **Esta seção estava errada e foi retratada em 2026-08-07, antes de qualquer correção ser
> aplicada.** Ela apareceu porque uma varredura por nome de tabela casou `sheet_materials`
> dentro de `generate_purchase_orders_from_mrp`, e eu li a ocorrência como se fosse a conta.

A cadeia real, verificada fonte a fonte:

```
calculate_order_consumption_by_grade   (motor canônico)
  └─ fn_projected_demand               total_required
       └─ v_mrp_needs.projected_demand
            └─ v_mrp_needs.suggested_qty = GREATEST(total_required + min_stock − quantity − qty_in_po, 0)
                 └─ generate_purchase_orders_from_mrp  ←  v_row.suggested_qty
```

**A OC gerada usa a quantidade canônica.** `sheet_materials` aparece uma única vez na função,
na subquery que monta `linked_sale_order_ids` — metadado de vínculo, não quantidade.

`fn_projected_demand` é, aliás, cuidadoso: inclui tiras via `order_strap_needs`, aplica
`get_material_conversion_info`, e **exclui da quantidade comprável** as linhas com
`conversion_warning` (largura faltando = valor ~100× inflado em dm²).

### O que sobra de real, em severidade menor

`linked_sale_order_ids` vincula PVs à OC **apenas** por `sheet_materials`. Um material que
chega ao PV por `direct_components` — ou pelos campos próprios da ficha (upper/lining/insole) —
não é vinculado. A OC fica com a quantidade certa e a lista de PVs incompleta. Dado que há 24
`direct_components` órfãos, isso é observável hoje. **Metadado, não dinheiro.**

---

## Desencontro 3 — A projeção de compra se apoia no livro furado

`get_purchase_projection` deriva o consumo histórico de `stock_movements` — o que, para uma
métrica **histórica**, é a fonte certa. Não é erro de motor: seria errado usar o motor de
consumo (que é prospectivo) para medir o que já saiu. **O defeito está no livro, não na
função.** E esse livro tem:

| Diagnóstico | Resultado |
|---|---|
| `list_stock_debit_holes()` — `consumo_sem_debito` | **1.172 linhas** · 205.291 un · **R$ 225.736,46** · 37 PVs · 34 produtos |
| `audit_stock_drift_report()` — `products.quantity` × soma dos movimentos | **99 produtos** (50 sem movimento algum, 43 drift baixo, 6 drift alto) |
| `list_ops_with_stale_reservations()` | 33 OPs |

Exemplos de buraco (OP finalizada, consumo padrão calculado, débito zero):

- `OP-2026-00863` / `PV-00122` / `CF 09 ` / Elástico 30mm — padrão 32.000 un, real 0 → R$ 80.000
- `OP-2026-00864` / `PV-00122` / `CF 09 ` / Elástico 30mm — padrão 24.000 un, real 0 → R$ 60.000
- `OP-2026-01167` / `PV-00146` / `DS21` / solado `01` — padrão 1.248 par, real 0 → R$ 2.371

Consumo subnotificado → dias de cobertura inflados → sugestão de reposição sistematicamente
baixa. O erro do eixo 3 entra no eixo 2 por essa porta.

---

## Desencontro 4 — 26 escritores diretos no mesmo livro-razão

`stock_movements` recebe `INSERT` de **26 funções**, e **20 delas também fazem `UPDATE products SET`** —
ou seja, cada uma mantém o saldo por conta própria. Existe `move_stock_delta`, que seria a fonte
única, e mais 25 caminhos que escrevem direto ao lado dela.

Tabelas de movimento, estado real:

| Tabela | Linhas | Escritores |
|---|---|---|
| `stock_movements` | 424 | **26 funções** |
| `material_reservations` | 1.495 | 9 funções |
| `material_audit_log` | 1.303 | 1 (`log_product_audit`) |
| `inventory_transactions` | **0** | **nenhum** |

Duas correções à suspeita inicial, para o registro:

- **`material_audit_log` não é um contador rival.** Seu único escritor audita mudança de
  *cadastro* de produto, não movimento de estoque. A diferença 1.303 × 424 é escopo, não buraco.
- **`inventory_transactions` é tabela morta** — zero linhas e zero escritores.

---

## Causa raiz dos órfãos de componente

`merge_product_into` mexe em `technical_sheets` mas **não toca `direct_components`**. Como esse
campo é JSONB, nenhuma FK o protege: merge ou deleção de produto deixa o ponteiro apontando para
UUID inexistente.

Estado: **24 de 28** linhas de `direct_components` têm `product_id` que não resolve. O estrago
vem de **5 UUIDs** (confirmado por `list_orphan_direct_components()` = 5):

| UUID | Nome(s) na ficha | Fichas |
|---|---|---|
| `73e1826c…` | BINÓCULO 6MM: DOURADO (+ BINÓCULO 6MM na I132) | 11 |
| `645bf78e…` | **BINÓCULO 6MM** *e* **Fivela Dourada 10.7mm** | 9 |
| `293dfd6d…` | Coração | 2 |
| `3fc6938f…` | Elástico 7mm dedinho | 1 |
| `592ec666…` | Dedinho GOLD | 1 |

⚠ O segundo UUID carrega **dois nomes contraditórios**. Binóculo e fivela não são o mesmo
produto — o dado **não é auto-reparável por inferência**.

As outras 4 linhas têm ID válido e só o nome em cache defasado (`Ilhós 51 - Ouro` → `Ilhós 51`,
`Rebite - DOURADO` → `Rebite`).

Já existem no banco, prontos e não usados neste caso: `list_orphan_direct_components`,
`relink_direct_component`, `tg_strip_invalid_direct_components`. **Não verifiquei** se o trigger
está inerte, cobre o evento errado, ou é posterior ao estrago — fica como item aberto.

---

## Código morto encontrado

| Item | Evidência |
|---|---|
| `src/lib/purchaseRequisition.ts` | consulta `technical_sheets.reference_id`, **coluna que não existe**; `generatePurchaseRequisition` não é chamada em lugar nenhum. Morta por construção — o `error` é descartado, então retornaria requisição vazia em silêncio. |
| `bill_of_materials` (tabela) | **0 linhas**. O BOM vivo é `sheet_materials` (118 linhas). |
| `inventory_transactions` (tabela) | 0 linhas, 0 escritores. |

---

## Furos de cadastro (`consumption_consistency_report`)

| Check | Sev | n |
|---|---|---|
| `persize_diverge_do_escalar` | alto | 1 (`CF 09 `) |
| `direct_components_produto_inexistente` | alto | 24 |
| `material_base_artesanal_sem_cor` | médio | 149 |
| `produto_artesanal_flag_inconsistente` | médio | 4 |
| `direct_components_nome_desatualizado` | médio | 4 |
| `solado_fachetado_sem_specs_fachete` | médio | 2 |
| `forro_cabedal_duplicado_com_palmilha` | baixo | 27 |

---

## Plano de correção

Ordem acordada: **teste vermelho primeiro, correção depois** — é a única sequência que prova
que a correção resolveu.

### Fase 1 — Instrumentar (o teste nasce vermelho)

1. Teste de **paridade numérica TS×SQL**: roda o mesmo PV pelos dois motores e compara a saída.
   Hoje não existe. Deve reprovar em `CF 09` e nos 24 órfãos.
2. Guard que trava a regressão do Desencontro 1: nenhum componente pode ler `*_consumption`
   sem também considerar `*_consumption_per_size`.

### Fase 2 — Corrigir código

3. `MaterialConsumptionTab.tsx` e `SaldoFinalTab.tsx` passam a chamar o motor canônico em vez
   de multiplicar o escalar.
4. ~~`generate_purchase_orders_from_mrp` passa a derivar de `fn_projected_demand`.~~
   **REMOVIDO** — ele já deriva. Ver o Desencontro 2 retratado. Mexer aqui alteraria geração
   de OC que funciona.
5. `merge_product_into` e o caminho de deleção passam a varrer `direct_components`.
6. Remover `purchaseRequisition.ts` e avaliar `bill_of_materials` / `inventory_transactions`.
7. *(opcional, severidade baixa)* `linked_sale_order_ids` passa a considerar também
   `direct_components` e os campos próprios da ficha, não só `sheet_materials`.

### Fase 3 — Corrigir dado (migration a partir de `20261217120400`, com snapshot antes)

8. `CF 09`: escalar passa a `20` (decisão do dono — per-size vence).
9. Criar os produtos sumidos (`un` / Componente / `COMPONENTES DIVERSOS`, espelhando
   `Binóculo 10mm` e `Fivela 12mm`; `Elástico 7mm dedinho` como **linear**) e religar via
   `relink_direct_component`.
10. Sincronizar os 4 nomes em cache defasados.
11. Os 1.172 buracos de débito e os 99 drifts: **decisão separada** — reconciliar histórico de
    estoque é outra classe de operação, e `reconcile_stock_debit_hole` já existe para isso.

### Limitação desta auditoria

`debit_consistency_report()` **não pôde ser executada**: exige usuário aprovado (RLS), e a
conexão MCP não é um. O que ela cobre além do `list_stock_debit_holes` fica desconhecido.

---

## Resultado da execução — 2026-08-07

Aplicado. Migrations `20261217120400`, `20261217120500` e `20261217120600` no banco, com os
carimbos alinhados aos nomes dos arquivos (o `apply_migration` grava a data real, abaixo da
sequência sintética — realinhado à mão).

| Métrica | Antes | Depois |
|---|---|---|
| `run_consumption_parity_tests` | 22/22 | **22/22, 0 vermelhos** |
| Órfãos em `direct_components` | 5 UUIDs · 24 entradas | **0** |
| `CF 09 ` escalar | 0,68 | **20** |
| Produtos sumidos | inexistentes | **6 criados** (`sku LIKE 'AUD20260807-%'`) |
| Nomes em cache defasados | 4 | **0** |

**Rollback:** `public.backup_auditoria_20260807` (53 linhas — `technical_sheets` inteira, com
`upper_consumption` e `direct_components` antes de qualquer UPDATE) e
`public.backup_direct_components_20260807` (só as fichas com órfão). Ambas com `REVOKE ALL`
de `anon`/`authenticated`.

**Gates, todos verdes:** typecheck canônico · `bun run test` 1.801 · `bun run test:units` 76 ·
`check:tokens` sem violação nova · guard anti-escalar passando · os 4 módulos de UI transformam
no Vite sem import não resolvido.

### O que NÃO foi feito, e por quê

1. **O teste de paridade nunca chegou a rodar de verdade.** `technical_sheets` está sob
   `technical_sheets_select_approved` (`is_approved_user()`), a chave publishable não é aprovada,
   e não há service-role key no `.env`. O teste como o Codex escreveu falhava na checagem de
   fixture — vermelho ambiental que continuaria vermelho depois da correção. Foi ajustado para
   **fazer skip dizendo o motivo** e aceitar `SUPABASE_SERVICE_ROLE_KEY`. Com essa chave
   exportada, ele roda a comparação real. **A sequência "vermelho → correção → verde" não pôde
   ser demonstrada.**
2. **As duas telas reescritas não foram verificadas visualmente** — exigem login, e não insiro
   credenciais. O que se verificou foi que os módulos transformam sem erro de import.
3. **Quatro checks de cadastro seguem abertos**, e nenhum é auto-corrigível sem decisão de
   fábrica: `material_base_artesanal_sem_cor` (149), `forro_cabedal_duplicado_com_palmilha` (27),
   `produto_artesanal_flag_inconsistente` (4), `solado_fachetado_sem_specs_fachete` (2).
4. **Os 1.172 buracos de débito (R$ 225.736,46) e os 99 drifts continuam intactos** — era item
   explicitamente fora do plano.
5. **Os 26 escritores diretos em `stock_movements` continuam 26.** O Desencontro 4 foi
   diagnosticado, não corrigido: unificar em `move_stock_delta` é refactor de outra ordem.
