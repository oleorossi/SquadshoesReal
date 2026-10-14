# Estoque de solado por numeração — matriz + pedidos em produção

> Spec fechada por entrevista (`/grill-me`) em 14/10/2026. Todas as decisões abaixo são
> do dono. Onde houver "⚠", é armadilha medida no banco vivo — não contorne sem reler.

## Problema

A aba **Estoque** de `/solados` (`src/components/soles-hub/SolesEstoqueTab.tsx`) mostra 7
cartões, um por numeração, com a quantidade em estoque em verde e a falta em vermelho
embaixo. **O número verde é bruto** — não desconta o que já está empenhado a pedidos.

Medido em 01 CARAMELO (SL01-02) em 14/10/2026:

| nº | estoque | empenhado | livre |
|---|---|---|---|
| 34 | 140 | 41 | 99 |
| 35 | 360 | 272 | 88 |
| 36 | 170 | 170 | **0** |
| 37 | 440 | 440 | **0** |
| 38 | 290 | 290 | **0** |
| 39 | 150 | 150 | **0** |
| 40 | 130 | 41 | 89 |

O dono relatou "o 36 e o 37 eu não possuo" olhando uma tela que mostrava 170 e 440.
Ele estava certo. A tela também escondia que **38 e 39 estão igualmente esgotados**.

Conferência que valida a fonte: `Σ covered_grade` por numeração = **1.404** =
`products.reserved_stock`. O dado sempre existiu; nunca foi lido por numeração.

## Escopo

- **Dentro:** a aba Estoque de UM solado (SKU), em desktop largo.
- **Fora:** export CSV/XLSX (o dono fará o arquivo do fornecedor depois), visão de
  todos os solados, faseamento semanal (MRP time-phased), PWA `/m/*`.

## R1 — A matriz (substitui os 7 cartões)

Linhas × colunas de numeração. Colunas marcadas de ponta a ponta quando `Livre = 0`
(a coluna é a unidade de falha, não a célula).

| # | linha | fórmula / fonte |
|---|---|---|
| 1 | Estoque físico | `products.stock_grade` por bucket |
| 2 | Empenhado | `Σ material_reservations.metadata->'covered_grade'`, **só PV em produção** |
| 3 | **Livre** | `Estoque − Empenhado` — linha protagonista |
| 4 | Falta p/ pedidos | `Σ metadata->'shortage_grade'` |
| 5 | Em compra | `purchase_order_items.grade` das OCs abertas (ver R6) |
| 6 | Projetado | `Livre − Falta + Em compra` — lógica atual, só PV em produção |
| 7 | **Projetado carteira** | idem, mas contando **toda a carteira aberta** (ver R5) |

- ⚠ **Zero é o alarme, não o negativo.** `Livre = 0` é o fato; `−482` é a consequência.
- ⚠ **Sem sinal só por cor.** `--destructive` é a MESMA cor que `--primary` (`#D9264E`,
  decisão registrada no `index.css`) e vermelho sozinho não comunica negativo. Parear
  sempre com peso/estrutura e usar o sinal `−` (U+2212).
- Clicar na coluna de uma numeração **filtra o relatório de baixo** para ela, com
  "limpar" visível (filtro client-side).

## R2 — O relatório: matriz PV × numeração

Mesma grade de colunas da matriz, alinhada, logo abaixo — uma grade só, dois blocos.

- Uma linha por PV: número, cliente, semana de faturamento.
- Células = **consumo** (`metadata->'effective_grade'`), com a parte sem lastro
  (`shortage_grade`) em número menor abaixo.
- Linha **Consumo total** (soma por numeração) + **Estoque físico** + **Saldo**.
- ⚠ Os dois blocos têm que fechar: `Consumo total − Estoque = Projetado`. Medido em
  01 CARAMELO: `2.772 − 1.680 = −1.092`. ✓

### R2.1 — Quem entra na lista

**Todo PV com reserva aberta deste solado**, com o status ao lado — não um filtro
paralelo por `status`. Assim os blocos fecham por construção.

⚠ Medido: 100% das reservas vivas de solado são de PV `Em Produção` (3 PVs, 22 reservas).
Existem **0 PVs vivos em `Aprovado`** — os 9 com esse status estão `deleted_at`. Filtrar
por status daria o mesmo hoje e divergiria em silêncio amanhã.

### R2.2 — Estado sem falta

Quando não há falta, o relatório vira **"quem está consumindo este estoque"**: os PVs que
seguram o empenho, mesma ordem de prioridade. RPC já existe:
`list_material_commitments_by_product(uuid)`.

## R3 — Prioridade: semana de faturamento acima do Ateliê

`commitment_cover_priority` hoje é:

```sql
v_score := CASE WHEN v_has_atelier THEN 0 ELSE 100000000 END + <epoch da semana>
```

O balde do Ateliê vale 1e8 s ≈ **3,17 anos** — maior que qualquer dispersão real de
semanas, então **o Ateliê sempre vence**. Decisão do dono: a **semana de faturamento
manda**, e o **Ateliê vira desempate abaixo dela** ("do jeito que estava, ele teria
prioridade entre cabedais simples"). Preservar os fallbacks atuais
(`delivery_deadline` → `created_at`) na mesma ordem relativa.

⚠ **Isto não é ordenação de tela — é o motor de alocação.** A função é lida por 4
migrations, e `20270101035100` **remaneja `covered_grade` entre PVs** por ela: muda quem
recebe o solado que chega. Aplicar **só para frente** — **não** rodar remanejamento do
que já está empenhado (decisão do dono: Q13=a).

## R4 — A pedir: arredondar para cima, múltiplo de 10

`a_pedir = ceil(falta / 10) * 10`. Exemplo do dono: 84 → 90.

⚠ **Múltiplo fixo de 10, ignorando `purchase_multiple`.** Motivo do dono: *"o lado dele
não possui caixa; o fornecedor faz a quantidade que eu preciso"* — a restrição é hábito
de compra, não embalagem do fornecedor.

## R5 — `Projetado carteira`

Conta **toda a carteira aberta** (não faturada, não cancelada), não só os PVs em produção.

⚠ **Não é recorte de mês.** O dono chamou de "Projetado Mês", mas definiu como "todos os
pedidos aprovados" — são opostos: uma janela de mês é mais *estreita*. Os 3 PVs em
produção faturam em agosto, setembro e outubro; um recorte de outubro **excluiria** o
PV-00232 e faria o número cair. Nome adotado: **`Projetado carteira`**.

⚠ **Fonte única e diferente:** PV aprovado **não tem reserva de solado** (medido: zero).
O consumo dele só existe no lado da demanda (`sale_order_items.grade` + ficha → solado).
Esta linha usa o **motor de demanda para todos os PVs abertos**, inclusive os em produção
— **não** somar reserva + demanda, senão um PV aprovado que ganhe reserva é contado duas
vezes e o número só fica maior, nunca inconsistente.

PV aprovado aparece na lista do R2 em **bloco separado**, com o status visível.

## R6 — Em compra

Lê OC aberta por numeração (`purchase_order_items.grade`, que já é populado para solado).

- **Marcar OC que chega depois da semana de faturamento.** Caso vivo: OC-01174 promete
  **22/10**, o PV-00236 fatura **19/10**. É a única informação do relatório que o dono não
  calcula de olho.
- **Sem linha "Sugerido"** — com o R7 não haverá mais OC de solado sugerida.

## R7 — Compra de solado passa a ser manual

Decisão do dono: *"não precisa mexer em nada referente à ordem de compra de solado, eu
mesmo farei manualmente"*, com escopo **só solado** (Q30=b, Q33=a).

- **Filtro de solado em `compute_materials_per_pv`** — a ÚNICA função do motor que
  distingue solado (tem `component = 'Solado'`). Mesmo idioma já usado em
  `sale_order_material_demand_lines` (`IF v_comp = 'Solado' THEN CONTINUE`).
- ⚠ **Não existem gatilhos de geração de OC.** Varridas as 11 funções que fazem
  `INSERT INTO purchase_orders`: **nenhuma** está ligada a trigger. A automação é
  `pg_cron` + outbox (job 63 `sale-order-outbox`, `* * * * *`).
- ⚠ **Nenhuma job de cron é desligada e nenhuma função é removida.** A job 63 continua
  servindo napa, cola, caixa e cabedal. Reversível apagando a linha do filtro.
- ✅ **Feito em 14/10/2026:** `cron.unschedule('rop-suggestions-daily')` (job 4),
  autorizado pelo dono. Produzia zero das OCs vivas (as 23 sugeridas são `per_pv` e
  `cabedal_prep`). A função `generate_rop_purchase_suggestions()` **permanece** no banco.
  Religar: `select cron.schedule('rop-suggestions-daily','0 6 * * *', $$ select public.generate_rop_purchase_suggestions(); $$);`
- Caminho manual já existe: `create_per_pv_purchase_orders_atomic`
  (`src/hooks/usePerPvPurchasing.ts:185`).
- Sai no **mesmo pacote** da tela (Q32=c), para não existir janela sem aviso de compra.

## R8 — A baixa de estoque NÃO muda

Decisão do dono (Q25=não), depois de ver o custo medido.

Hoje: `debit_sole_stock_by_grade` é chamada na entrada em produção por
`promote_sale_order_item`, `tg_sync_orders_from_sale_order_item` e
`materialize_production_order_internal`, **todas com `p_force_soft => true`** — e nesse
ramo a função insere a reserva e dá `RETURN` **antes** de qualquer `UPDATE products`. A
baixa real só ocorre no **faturamento**, via `convert_reservation_to_out_legacy_202701`
(gatilho `trg_finalize_orders_on_sale_order_billed`).

Prova empírica: PV-00236 está `Em Produção` e o `stock_grade` do 36 segue em 170.

⚠ **Por que não mover** (medido, não estimado):
1. O débito em dobro seria **silencioso**: `greatest(0, quantity - v_debit)` pisa em zero
   sem `RAISE`, e `expose_expected_consumption_gaps_for_order` usa
   `greatest(required − net_debited − pending, 0)` — com 2× `required` devolve 0 e conclui
   "coberto". Só mede **sub**-débito.
2. A guarda de idempotência do ramo hard casa só a string `'Debito Solado por grade%'` —
   não vê `'Conversão…'` nem `'Baixa na finalização…'`.
3. `check_grade_quantity_coherence` é **incondicional**; é o gatilho que congelou toda
   escrita de saldo em 20/08.
4. Existem `products_qty_nonneg` + `trg_prevent_negative_*`.
5. `debit_sole_stock_by_grade` tem **dois `RETURN` silenciosos** (cor não resolvida,
   produto inativo) — viraria OP em produção sem débito e sem erro.

⚠ **O corpo vivo de `debit_sole_stock_by_grade` não está em nenhum `.sql` do repo** — a
migration `20270101035100` a reescreve por **cirurgia de string** sobre
`pg_get_functiondef`. Auditoria por arquivo mente aqui; ler o banco.

## R9 — Design

Decisão do dono (Q6): **inaugurar um padrão** de "relatório dentro de aba", não imitar.
A ousadia vai inteira na estrutura da matriz; tudo em volta fica mudo.

- Tokens do projeto apenas. Fontes do projeto (Anton / Fira Sans / Fira Code).
- Sem gradiente, sem card novo, sem cor fora do token.
- Desktop largo (Q7=a). Sem cap de largura (decisão de 19/05/2026).
- Visual aprovado pelo dono no preview de 14/10/2026.

## Pronto quando

1. A matriz de 7 linhas substitui os 7 cartões e os números batem com o banco.
2. `Consumo total − Estoque = Projetado` fecha na tela, nos dois SKUs de teste
   (SL01-02 e SL01-03).
3. Clicar na numeração filtra o relatório.
4. Solado sem falta mostra quem consome o estoque.
5. A prioridade nova ordena por semana de faturamento, Ateliê desempatando.
6. Nenhuma OC de solado nova é gerada automaticamente; as outras famílias seguem.
7. `bunx tsc -p tsconfig.app.json --noEmit` limpo e `bun run check:tokens` sem violação.
8. Um agente abre `https://squadshoes-real.vercel.app/solados` em produção e confere
   (regra 7 do `CLAUDE.md`).
