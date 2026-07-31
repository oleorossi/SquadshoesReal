# Estorno de OP unificado — resync volta a funcionar com solado

## Goal

Fazer todo caminho que devolve estoque de uma OP passar pelo **mesmo motor**, que
respeita a regra canônica do solado (estoque por numeração). Hoje o resync
automático que roda ao salvar ficha técnica falha em 100% das OPs que consomem
solado — a ficha salva, mas as OPs abertas nunca recebem a mudança.

Serve o dono/engenharia, que edita ficha esperando que as OPs em produção sejam
reprocessadas junto.

## Background / Problem

Ao salvar a ficha I100 (31/07/2026) apareceu `7 erros no resync — OP 4ebbb6f6:
Inconsistência: SUM(stock_grade) = 50 difere de quantity = 58.00 no produto
bc72840a…`. Seis OPs ativas dessa ficha (`OP-2026-00781/782/783`,
`OP-00803/804/808`) falham sempre, pelo mesmo motivo.

**Causa raiz.** `resync_op_atomic` tem uma cópia própria e ingênua do estorno:

```sql
v_new_stock := v_prev_stock + v_mov.quantity;
UPDATE public.products SET quantity = v_new_stock WHERE id = v_mov.product_id;
```

Soma no `products.quantity` escalar **sem tocar em `stock_grade`**. Para o solado
— gerido por numeração — isso quebra a coerência e o trigger
`check_grade_quantity_coherence` levanta exceção. Como a RPC é transacional, dá
rollback: a OP fica intacta (bom), mas o resync nunca acontece (ruim). O trigger é
a rede de proteção, não o defeito.

**Segundo defeito, de ordem.** A mesma função chama
`restore_sole_grade_for_order(p_order_id)` **depois** de
`DELETE FROM material_reservations WHERE order_id = p_order_id` — e é justamente
na reserva (`metadata->>'kind' = 'sole_grade'`, campo `effective_grade`) que mora
a grade consumida. Sem o trigger barrando antes, o restore por numeração seria
no-op silencioso **e** o escalar teria sido creditado duas vezes.

**O motor certo já existe.** `restore_product_stocks_for_order` (usado no
cancelamento/exclusão/mudança de status de OP, [useOrders.ts:140-480](../src/hooks/useOrders.ts))
resolve isso desde o RES-9: para produto com grade não nula, estorna só o
**resíduo escalar**, descontando o que o restore por numeração ainda vai devolver
(`effective_grade` de reservas sem marcador `sole_restored_at`), e nunca escreve
em `stock_grade`. É idempotente por construção (net = `out` − `in`).

Ou seja: existem dois estornos no sistema, um correto e um ingênuo, e o resync usa
o ingênuo.

**Estado do estoque hoje:** 0 de 7 produtos com grade estão incoerentes — o
trigger barrou tudo antes de corromper. Não há reparo de dados a fazer.

## Scope

### In scope

- `resync_op_atomic` passa a usar o par canônico de estorno, na ordem correta
  (antes de apagar as reservas).
- Fallback não-atômico do [resyncOPs.ts](../src/lib/resyncOPs.ts) alinhado à mesma
  regra (hoje repete o estorno escalar **e** o double-estorno, documentado no
  próprio comentário do passo "3b").
- Regra explícita para produto graduado cujo débito não tem grade rastreável:
  não estorna, vira pendência reportada.
- Relatório perene `op_restore_consistency_report()` + seção em
  `/diagnostics` (`SystemDiagnostics.tsx`).
- Toast de aviso na hora, quando o resync deixar pendência.
- Rotina única pós-deploy que resincroniza as OPs ativas com estorno pendente,
  transacional por OP, seguindo em caso de falha e reportando no fim.
- Guarda de regressão automatizada.

### Out of scope (explicitamente não agora)

- Alterar/remover o trigger `check_grade_quantity_coherence` — ele fica como está.
  É a rede que impediu a corrupção; o conserto é fazer os escritores respeitarem a
  regra, não afrouxar a guarda.
- Estorno de **OS/terceirização** (`tg_revert_service_order_base_on_cancel`) — não
  mexe em grade, fora do escopo de OP.
- Refatorar `hybrid_debit_stock_for_order`, `debit_sole_stock_by_grade` ou
  `debit_strap_stock` (o lado do **débito**).
- Reparo/backfill de estoque (não há incoerência viva).
- Mudar a UX do save da ficha: continua salvando mesmo quando o resync falha.
- Unificar o estorno de **tiras** (`debit_strap_stock` com `p_force_soft`), que
  segue no TS por ora.

## Requirements

1. `resync_op_atomic` **não pode** conter loop próprio de estorno. Deve chamar,
   nesta ordem: `restore_sole_grade_for_order(p_order_id)` e depois
   `restore_product_stocks_for_order(p_order_id)`.
2. Essas duas chamadas devem acontecer **antes** de
   `DELETE FROM material_reservations WHERE order_id = p_order_id` — a reserva
   `kind='sole_grade'` é a fonte da grade consumida e é destruída por esse DELETE.
3. Nenhum caminho de estorno pode escrever `products.quantity` de produto com
   `stock_grade` não vazia sem escrever a grade correspondente. A soma das chaves
   de numeração (ignorando as que começam com `_`) tem que continuar igual a
   `quantity` ao fim de qualquer estorno.
4. Quando um produto graduado tiver débito sem grade rastreável (nenhuma reserva
   `kind='sole_grade'`, status `consumed`/`converted`, sem `sole_restored_at`, que
   cubra o resíduo), o motor **não estorna** esse resíduo: registra a OP como
   pendência. Nunca inventa numeração e nunca estorna só o escalar.
5. `restore_product_stocks_for_order` deve ser ajustada para atender ao item 4 —
   hoje, com `v_pending_sole = 0`, ela credita o resíduo escalar inteiro sobre um
   produto graduado, o que quebraria a coerência exatamente como o resync quebra.
6. O estorno segue idempotente: rodar duas vezes na mesma OP não pode devolver
   estoque em dobro (marcador `sole_restored_at` na reserva + net `out`−`in` nos
   movimentos).
7. Nova função SQL `op_restore_consistency_report()` retorna uma linha por
   pendência, com no mínimo: `order_id`, `order_number`, `status` da OP,
   `product_id`, `product_name`, `product_color`, `qtd_sem_grade` (o resíduo não
   estornável) e `motivo`.
8. `/diagnostics` (`SystemDiagnostics.tsx`) ganha uma seção alimentada por essa
   função, no mesmo padrão das existentes (`consumption_consistency_report`,
   `debit_consistency_report`).
9. Quando o resync de uma OP terminar deixando pendência, o toast do save da ficha
   avisa na hora, citando a OP e apontando para Diagnósticos.
10. O fallback não-atômico do `resyncOPs.ts` deve seguir as mesmas regras 1–4 —
    sem estorno escalar próprio, restore por grade antes do DELETE das reservas.
11. Rotina única pós-deploy: função SQL que varre as OPs ativas
    (`status IN ('Reservado','Em Produção')`) com estorno pendente e roda o resync
    de cada uma.
12. A rotina processa **cada OP numa transação independente**: OP que falha dá
    rollback só dela e a varredura continua. Ao fim, devolve um relatório com uma
    entrada por OP (`resincronizada` / `pendente` + mensagem de erro).
13. O save da ficha continua sendo sucesso mesmo se o resync falhar — o
    comportamento atual de `runResyncAndInvalidate` (toast âmbar) se mantém.
14. Guarda de regressão: teste que falha se `resync_op_atomic` voltar a escrever
    `products.quantity` sem escrever `stock_grade`, ou se a ordem
    restore→DELETE inverter.

## Data model / Domain

Nada de tabela nova. Objetos envolvidos:

| Objeto | Papel |
|---|---|
| `products.quantity` | total escalar |
| `products.stock_grade` (jsonb) | pares por numeração; chaves `_size_from`/`_size_to` são **metadados** e não entram na soma |
| `check_grade_quantity_coherence` (trigger em `products`) | invariante: `SUM(grade sem "_") == quantity` (tolerância 0.01). **Permanece** |
| `stock_movements` | `movement_type` `out`/`in`, ligados por `order_id`; o resync desliga (`order_id = NULL`) os `out` antigos |
| `material_reservations` | `metadata->>'kind' = 'sole_grade'`, `metadata->'effective_grade'` = grade realmente consumida; marcador `metadata->>'sole_restored_at'` trava re-estorno |
| `restore_sole_grade_for_order(uuid)` | devolve por numeração a partir de `effective_grade`; advisory lock por OP |
| `restore_product_stocks_for_order(uuid)` | devolve o escalar; para produto graduado, só o resíduo, sem tocar grade |
| `resync_op_atomic(uuid)` | orquestra estorno → limpa reserva/estágio/snapshot → re-débito → recria estágios → `reserve_missing_materials_for_order` |
| `op_restore_consistency_report()` | **novo** — pendências |
| rotina one-shot | **nova** — varredura das OPs ativas com pendência |

**Predicado de "grade rastreável"** (usar igual nos três lugares):
`material_reservations` com `order_id = OP`, `product_id = produto`,
`metadata->>'kind' = 'sole_grade'`, `status IN ('consumed','converted')` e
`NOT (metadata ? 'sole_restored_at')`.

Migration nova precisa de carimbo **maior que `20261024120000`** (topo atual).

## User flows

### Happy path

1. Usuário edita e salva uma ficha técnica com solado.
2. `useUpdateSheet.onSuccess` → `runResyncAndInvalidate` → `resyncOPsForSheet`.
3. Para cada OP ativa da ficha, `resync_op_atomic`:
   a. `restore_sole_grade_for_order` devolve o solado **por numeração** e marca a
      reserva com `sole_restored_at`;
   b. `restore_product_stocks_for_order` devolve o resto (escalar), já descontando
      o que o passo (a) devolveu;
   c. só então apaga reservas, estágios, snapshot e desliga os movimentos antigos;
   d. re-debita pela ficha atual, recria estágios, reserva o delta.
4. Toast verde: "N OPs resincronizadas automaticamente!".
5. Estoque do solado continua coerente: `SUM(stock_grade) == quantity`.

### Alternate / edge flows

- **Produto graduado sem grade rastreável** → resíduo não é estornado; a OP entra
  em `op_restore_consistency_report()`; toast âmbar cita a OP; o resync da OP
  **conclui** (não trava por isso).
- **Reserva já restaurada** (`sole_restored_at` presente) → nada é devolvido de
  novo; sem erro.
- **RPC ausente do banco** → fallback TS, agora obedecendo às mesmas regras.
- **Erro real dentro da RPC** → propaga, rollback da OP, erro listado no toast;
  as demais OPs da ficha seguem sendo processadas (comportamento atual).
- **Rotina one-shot** → percorre as OPs pendentes, uma transação por OP, relatório
  no fim.

## Edge cases & failure modes

| Caso | Comportamento esperado |
|---|---|
| OP sem movimento `out` | nada a estornar; resync segue normal |
| `stock_grade` só com `_size_from`/`_size_to` | tratado como produto **escalar** (mesmo critério do trigger: chaves `_` fora da soma) |
| Baixa parcial de solado (`LEAST(disponível, necessário)`) | a verdade é `effective_grade` da reserva, **nunca** `orders.grade` — senão devolve par que não saiu |
| Numeração conjugada (`"33/34"`) | devolve na mesma chave conjugada que saiu |
| Re-débito sem estoque | continua soft (ruptura), não trava o resync |
| Duas sessões resincronizando a mesma OP | advisory lock por OP + `FOR UPDATE` já existentes seguram |
| Rodar a rotina one-shot duas vezes | segunda execução não devolve estoque de novo (requisito 6) |
| OP cancelada/excluída durante a varredura | a RPC já retorna `skipped` para status fora de `Reservado`/`Em Produção` |

## Constraints & assumptions

- Bun (`bun run`/`bunx`); `npm` não existe nesta máquina.
- Typecheck: `bunx tsc -p tsconfig.app.json --noEmit`.
- Migration em `supabase/migrations/`, carimbo > `20261024120000`, aplicada por MCP
  e com o registro alinhado ao nome do arquivo.
- Toasts com `sonner`; seção de Diagnósticos seguindo os design tokens e o padrão
  visual das seções vizinhas (sem cor hardcoded).
- Solado é gerido por numeração (`stock_grade`) — regra canônica do projeto; forro
  e palmilha seguem o solado, e nada disso muda aqui.
- **Assunção (risco aceito pelo dono):** a rotina única roda no deploy sem dry-run
  prévio. Ela movimenta estoque real (estorna e redebita) de várias OPs de uma vez.
  Mitigação exigida: relatório por OP ao fim (requisito 12) e idempotência
  (requisito 6), para que uma segunda execução não duplique nada.
- **Assunção:** as funções checam `is_approved_user()`. Se a execução da rotina por
  MCP/psql não passar nessa checagem (sem `auth.uid()`), ela é disparada uma única
  vez a partir de `/diagnostics` logado como admin — mesma função, mesma
  idempotência.
- Escopo de dados de referência: 6 OPs ativas hoje com estorno pendente, todas com
  reserva `sole_grade` restaurável; 0 produtos com grade incoerente.

## Open questions

- Nenhuma pendente. Decisões tomadas na entrevista: (1) sem grade rastreável →
  não estorna e reporta; (2) varredura de todos os estornos de OP; (3) pendência
  aparece em toast + `/diagnostics`; (4) rotina única no deploy; (5) rotina segue
  após falha e reporta no fim.

## Definition of Done

- [ ] **R1/R2** — `pg_get_functiondef('resync_op_atomic')` não contém `UPDATE public.products SET quantity`, e a chamada a `restore_sole_grade_for_order` aparece **antes** do `DELETE FROM public.material_reservations`. Verificar lendo a definição viva no banco.
- [ ] **R3** — Após salvar a ficha I100, rodar: `select count(*) from products p where p.stock_grade <> '{}'::jsonb and abs((select coalesce(sum((value)::numeric),0) from jsonb_each_text(p.stock_grade) where left(key,1) <> '_') - p.quantity) > 0.01` → **0**.
- [ ] **R1–R3 (ponta a ponta)** — Abrir Fichas Técnicas → I100 → Salvar. Toast verde "6 OPs resincronizadas automaticamente!" e **nenhum** toast "erros no resync".
- [ ] **R4/R5** — Numa OP de teste com débito de solado e sem reserva `sole_grade` (simulando OP legada), o resync conclui, o `quantity` do solado **não** muda e a OP aparece no relatório de pendências.
- [ ] **R6** — Rodar `resync_op_atomic` duas vezes seguidas na mesma OP: o `quantity` e o `stock_grade` do solado ficam iguais após a segunda execução (comparar antes/depois).
- [ ] **R7** — `select * from op_restore_consistency_report()` roda sem erro e traz as colunas listadas em Data model.
- [ ] **R8** — Abrir `/diagnostics`, rodar as checagens e ver a nova seção listando pendências (ou vazia, com estado vazio próprio). `bun run check:tokens` limpo.
- [ ] **R9** — Com uma OP pendente, salvar a ficha e ver o toast âmbar citando a OP e apontando para Diagnósticos.
- [ ] **R10** — Ler `src/lib/resyncOPs.ts`: o bloco de fallback não tem mais `prevStock + mov.quantity` sobre produto graduado, e chama o restore por grade antes de deletar reservas.
- [ ] **R11/R12** — Executar a rotina uma vez: ela devolve uma entrada por OP com `resincronizada`/`pendente`; as 6 OPs de I100 saem como resincronizadas; nenhuma exceção aborta a varredura. Repetir a execução → nenhuma mudança de estoque.
- [ ] **R13** — Simular falha de resync (ex.: OP com produto inexistente) e confirmar que a ficha continua salva, com toast âmbar.
- [ ] **R14** — `bun run test` passa, incluindo o novo teste de guarda; remover a delegação ao par canônico dentro de `resync_op_atomic` faz o teste falhar.
- [ ] Typecheck limpo: `bunx tsc -p tsconfig.app.json --noEmit`.
