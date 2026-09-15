# Auditoria do motor: OP → débito → setores → faturamento

**Data:** 2026-09-14  
**Escopo:** criação da OP, reserva/débito de estoque, transição dos 12 setores, faturamento informal e formal.  
**Método:** diagnósticos live (somente leitura) + E2E com rollback (`sql-scripts/e2e-ficha-pv-pcp-v5-faturamento.sql`).

## Fluxo canônico (resumo)

```
PV Rascunho
  → create_sale_order_atomic / execute_sale_order_command(confirm|promote)
  → promote_sale_order_to_production
      • INSERT orders + order_stages (12, Expedição obrigatória)
      • hybrid_debit_stock_for_order(..., force_soft) → material_reservations
  → apontar_producao_setor (Kanban / apontamento)
  → OP Finalizado (último setor ou romaneio)
      • trg_aa_settle → settle_open_reservations_for_order (débito real)
  → Faturamento:
      • Informal (nfe_required=false): Em Produção → register_order_shipment → Finalizado s/ NF
      • Formal (nfe_required=true): NF autorizada → Faturado → register_order_shipment → Expedido
```

Emitir NF-e **não** seta `Faturado` sozinho — transição manual via `execute_sale_order_command('transition')`.

## Diagnósticos live (produção)

| Checagem | Resultado |
|---|---|
| `run_consumption_parity_tests()` | 1 falha: `cola_forte_14g_versionada` (valor vivo 10 g/par; canônico 14 g/par) |
| `run_debit_guard_tests()` | 23/23 OK |
| `run_sole_live_parity_guards()` | 10/10 OK; `list_sole_spec_gaps` = 0 |
| `list_stock_debit_holes(90)` | **1665** linhas — 1416 `consumo_sem_debito` (R$ 305.819) + 249 `reserva_parcial_pendente` (R$ 60.933) |
| `list_ops_with_stale_reservations()` | 66 OPs |
| Furos (30d) | 472; (7d) 386 — inclui PV-00150 / PV-00167 (Tira Strass, solado 01) |

### Interpretação dos furos

A maior parte é **histórico deliberadamente não backfillado** (OPs finalizadas antes do settle tolerante — decisão do dono). Os top por valor recente concentram-se em tiras strass e solado `01` sem baixa correspondente. **Não reconciliar em massa** sem decisão explícita (inventários já conferidos).

### Correção aplicada nesta auditoria

- Migration `20270101025000_restaurar_cola_forte_14g_solado_01.sql` — restaura COLA FORTE do SOLADO 01 para **14 g/par** e revalida o guard de paridade.

## E2E v5 (com rollback)

Arquivo: `sql-scripts/e2e-ficha-pv-pcp-v5-faturamento.sql`

1. Ficha SP120 com 12 setores canônicos  
2. PV informal → promote → reservas (solado + napa) → apontar 12 setores  
3. Assert OP `Finalizado`, settle (`reserved=0`), romaneio Path B → `Finalizado s/ NF`  
4. PV formal (`nfe_required=true`) → NF sintética `autorizada` → `Faturado` → romaneio Path A → `Expedido` + estágios fechados + settle  

Execução: Management API / `supabase-db-exec.yml` com `strict=false` (o `RAISE` final é o rollback proposital).

## Lacunas que permanecem abertas (produto)

1. Furos históricos de débito — não mexer sem decisão do dono.  
2. 66 OPs com reserva desatualizada vs ficha — candidatos a `resync` seguro ou revisão manual.  
3. `InvoiceTrigger.tsx` parece código morto; caminho vivo é `/nfe` + transição manual para `Faturado`.  
4. Path informal exige OPs já `Finalizado` na UI de conferência; path formal permite romaneio com OP aberta (romaneio fecha). Assimetria intencional — documentada, não “corrigir” por coerência.
