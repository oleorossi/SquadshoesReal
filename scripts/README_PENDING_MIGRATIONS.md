# Scripts de Migrations Pendentes — Guia Completo

Esse diretório contém **todos os scripts SQL consolidados** das 34 migrations pendentes (Grupos 1 a 11 do `CLAUDE.md`).

## 🎯 Aplicação Rápida (TL;DR)

1. **Diagnóstico primeiro** — abra https://supabase.com/dashboard/project/qrdvwoijghmgugejponz/sql/new e cole `00_DIAGNOSTICO_quais_grupos_faltam.sql`. Ele te diz exatamente quais Grupos faltam aplicar.
2. Pra cada Grupo faltando, rode o script consolidado correspondente (na ordem 00a → 00b → 00c → 01).
3. No final, rode `02_verify_pending_migrations.sql` para validar Grupos 9-11.
4. Opcional: `03_test_resync_scenarios.sql` em homologação para testar o fluxo de resync.

---

## 📚 Mapa Completo dos Scripts

| Script | Cobre | Linhas | Migrations incluídas |
|--------|-------|--------|----------------------|
| `00_DIAGNOSTICO_quais_grupos_faltam.sql` | — | ~150 | **Diagnóstico** (idempotente, leitura-only) |
| `00a_grupos_1_2.sql` | Grupos **1-2** | 1381 | Estoque base, work schedules, artisanal recipes, adjust_stock RPC |
| `00b_grupos_3_4.sql` | Grupos **3-4** | 1738 | Conjugações de solado, NF-e companies, mesa-sector-planning |
| `00c_grupos_5_a_8.sql` | Grupos **5-8** | 1128 | Corte a Faca, consumo por grade, RLS, modelos de construção |
| `01_apply_pending_migrations.sql` | Grupos **9-11** | 976 | Custo com embalagem, atomicidade, resync atômico, backfill |
| `02_verify_pending_migrations.sql` | Verifica 9-11 | ~200 | Roda checks idempotentes |
| `03_test_resync_scenarios.sql` | Testes 9-11 | — | 4 cenários de resync (homologação) |
| `04_rollback_pending_migrations.sql` | Rollback 9-11 | — | Apenas em emergência |

---

## 📋 Ordem de Execução

### Cenário A: Você nunca aplicou nenhuma migration manualmente

Aplicar **na ordem**, do mais antigo ao mais recente:

```
1. scripts/00_DIAGNOSTICO_quais_grupos_faltam.sql   ← confere o ponto de partida
2. scripts/00a_grupos_1_2.sql                       ← aprox. 5min
3. scripts/00b_grupos_3_4.sql                       ← aprox. 5min
4. scripts/00c_grupos_5_a_8.sql                     ← aprox. 3min
5. scripts/01_apply_pending_migrations.sql          ← aprox. 5-15min (faz backfill)
6. scripts/02_verify_pending_migrations.sql         ← verifica Grupos 9-11
7. (opcional) scripts/03_test_resync_scenarios.sql  ← em homologação
```

### Cenário B: Você já aplicou alguns

Comece pelo `00_DIAGNOSTICO`. Ele lista quais Grupos já estão e quais faltam. Aplique apenas os que faltam, **na ordem cronológica**.

---

## 🚀 Passo a Passo Detalhado

### 1. Backup Preventivo

No Supabase Dashboard:
- Database → Backups → **Create on-demand backup**
- Aguarde até ver "available" antes de prosseguir

### 2. Diagnóstico

Abra https://supabase.com/dashboard/project/qrdvwoijghmgugejponz/sql/new

Cole o conteúdo de `scripts/00_DIAGNOSTICO_quais_grupos_faltam.sql` e clique **Run**. A saída traz:
- 11 linhas dizendo `✅ APLICADO` ou `❌ FALTANDO` para cada Grupo
- Um resumo no final indicando quais scripts consolidados rodar

### 3. Aplicar Scripts Faltantes (na ordem)

Para cada script faltando:

1. Abra o arquivo no editor (`scripts/00a_grupos_1_2.sql`, etc.)
2. Selecione tudo (`Cmd+A`), copie (`Cmd+C`)
3. No SQL Editor do Supabase, cole e clique **Run**
4. Aguarde a conclusão (Grupos 9-11 fazem backfill em DO blocks — pode levar 5-15min)
5. Verifique a aba **Results** por mensagens `NOTICE` indicando progresso

### 4. Verificar Aplicação (Grupos 9-11)

Abra `scripts/02_verify_pending_migrations.sql`, copie e cole. Rode. Saída esperada:

```
check_calculate_order_cost_packaging   | OK
check_calculate_order_cost_grade       | OK
check_atomic_packaging_rpc             | OK
check_clients_address_override         | OK
check_trigger_address_manual_edit      | OK
check_mrp_status_lower                 | OK
check_sale_order_total_trigger         | OK
check_recalc_sale_order_total_rpc      | OK
pedidos_com_total_divergente           | 0   (esperado: 0)
check_resync_queue_table               | OK
check_resync_rpcs                      | OK
check_production_consumptions_superseded | OK
```

Se aparecer `FALTANDO`, abra a migration específica em `supabase/migrations/` e rode-a isoladamente.

### 5. Sanity-Check de Dados

```sql
-- Quantos pedidos ativos? Quantos têm order_costs com novo formato?
SELECT
  COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) NOT IN
    ('cancelado','cancelada','cancelled','entregue','delivered',
     'finalizado','finalizada','finished','completed',
     'faturado','faturada','invoiced')) AS pedidos_ativos,
  (SELECT COUNT(*) FROM order_costs) AS order_costs_total,
  (SELECT COUNT(*) FROM order_costs WHERE breakdown ? 'packaging_per_pair') AS com_packaging
FROM sale_orders;
```

Se `com_packaging << order_costs_total`, é porque muitos pedidos eram finalizados (foram pulados pelo backfill do Grupo 10 — comportamento intencional para preservar custo histórico).

---

## 🧪 Testar o Fluxo de Resync (Homologação — Grupos 9-11)

`03_test_resync_scenarios.sql` cobre 4 cenários:

1. **Conjugação de solado (23/24)** — espera trigger enfileirar OPs e `process_resync_queue` fazer estorno + re-débito
2. **Mapeamento cabedal × palmilha** — fichas com `insole_has_lining=false`
3. **`yield_per_meter` em receita artesanal** — só roda se módulo artesanal estiver ativo
4. **`sale_orders.total` sincroniza com itens** — testa o trigger novo

Cada cenário começa com `BEGIN` e termina com `ROLLBACK`. Para aplicar de verdade, troque o último `ROLLBACK` por `COMMIT`.

**ANTES DE RODAR**: ajuste IDs marcados como `AJUSTAR:` (`sole_group_id`, `sheet_id`, `recipe_id`) para refletir dados reais.

---

## 🔥 Rollback de Emergência (Grupos 9-11)

Apenas se algo quebrar criticamente em produção:

1. Aplicar `04_rollback_pending_migrations.sql`
2. Reverter os commits TS que dependem das novas RPCs:
   - `src/hooks/useOrders.ts` (chama `debit_packaging_for_order_atomic`)
   - `src/hooks/useSoleConjugations.ts` (chama `process_resync_queue`)
   - `src/hooks/usePalmilhaColorMappings.ts` (chama `process_resync_queue`)
   - `src/hooks/useArtisanalRecipes.ts` (chama `process_resync_queue`)
   - `src/lib/resyncOPs.ts` (chama `resync_op_atomic`)

```bash
git revert ed877c3 820a9a6 65f8643 446cc98
```

---

## 📊 Resumo de Impacto por Grupo

| Grupo | Risco | Impacto evitado |
|-------|-------|-----------------|
| 1-2 | Baixo | Bugs antigos de estoque, jornada de trabalho |
| 3 | Baixo | Conjugações 23/24 com fallback errado |
| 4 | Baixo | NF-e multi-CNPJ, cronograma reverso quebrado |
| 5 | Baixo | Seletor "Corte a Faca" não aparece |
| 6 | Médio | Consumo errado por grade (afeta MRP) |
| 7 | **Alto (segurança)** | RLS desabilitado em 5 tabelas → vazamento entre tenants |
| 8 | Médio | Modelos de construção / capacidade Mesa não funcionam |
| 9 | Baixo | Margem 2-5% inflada → ~R$10-25k/ano em decisões erradas |
| 10 | Médio | NF-e rejeitada SEFAZ, race condition em packaging, MRP excessivo |
| 11 | Médio | Estoque dessincronizado quando ficha técnica muda |

---

## ❓ Troubleshooting

### "ERROR: function calculate_order_consumption_by_grade does not exist"
- Grupo 6 não foi aplicado. Rode `00c_grupos_5_a_8.sql` primeiro.

### "ERROR: column packaging_cost_per_pair does not exist"
- Falta uma migration anterior à 9 (provavelmente Grupo 1 ou 2). Rode `00a_grupos_1_2.sql`.

### Backfill demora > 30 minutos
- Tabela `order_costs` muito grande. Pode ser cancelado e re-aplicado depois — o UPSERT é idempotente.

### Trigger `trg_resync_for_artisanal_recipe` não foi criado
- Verifique se a tabela `artisanal_orders` existe. Se não, o DO block do Grupo 11 pula a criação (esperado).

### Erro "duplicate key value violates unique constraint"
- Você está rodando o script duas vezes. Os scripts usam `IF NOT EXISTS` para tabelas/colunas e `CREATE OR REPLACE` para funções, mas alguns triggers usam `CREATE TRIGGER` sem `IF NOT EXISTS`. Se travar nisso, o resto já aplicou — pule e siga para o próximo script.

---

## 🆘 O que fazer se algo der errado no meio

1. NÃO entre em pânico — todos os scripts têm `BEGIN`/`COMMIT` por bloco
2. Verifique a primeira mensagem de erro nos Results
3. Se for "function/column already exists" → ignore, está aplicado
4. Se for "permission denied" → você precisa estar logado como owner do projeto
5. Se for "out of memory" → cole partes menores, não o arquivo todo de uma vez

Em qualquer dúvida, antes de rodar o `04_rollback`, abra um issue no GitHub.
