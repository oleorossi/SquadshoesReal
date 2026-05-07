---
name: Per-Size Consumption Engine
description: Motor de cálculo de consumo itera por numeração da grade do pedido, somando consumos exatos por size (sole_technical_specs + sole_standard_items_consumption)
type: feature
---

O cálculo de consumo de materiais para pedidos é feito **estritamente por numeração**, via RPC `calculate_order_consumption_by_grade(reference_id, grade jsonb, color)`.

**Fluxo:**
1. Recebe `grade` no formato `{size: pairs}` (ex: `{"34":35,"37":105}`).
2. Para cada numeração:
   - Resolve `sole_technical_specs[size]` → atualiza upper/lining/insole se solado dirige consumo.
   - Lê **todas** as linhas de `sole_standard_items_consumption[sole_id, size]` (cola, EVA, linha, etc.).
   - Acumula `consumo[size] × pares[size]` por produto.
3. Emite linhas consolidadas: Solado, Cabedal, Forro, Palmilha, **Item padrão (solado)** (uma linha por item std), BOM legado, lining_accessories.

**Integração:**
- `freeze_technical_sheet(...)` aceita `p_grade jsonb` e prefere o cálculo por grade quando disponível.
- `hybrid_debit_stock_for_order(...)` repassa `p_order_grade` ao freeze, garantindo débito atômico exato.
- Função antiga `calculate_order_consumption(ref, qty, color, size)` mantida para retrocompatibilidade.

**Segurança:** SECURITY DEFINER + `search_path = public` fixo; tabelas RLS via `is_approved_user()`.
