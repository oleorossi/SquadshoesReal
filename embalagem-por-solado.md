---
name: Embalagem por Solado
description: Embalagens trimodal+fitilho ficam em product_groups (solado), nao mais em packaging_configs por ficha
type: feature
---
A configuração de embalagem migrou de `packaging_configs (sheet_id)` para `product_groups` (linha do solado):
- Colunas: `box_type_id` (individual), `box_type_master_id`, `box_type_colmeia_id`, `box_type_fitilho_id`
- Pares/caixa: `pairs_per_box_individual|master|colmeia|fitilho`
- RPC `debit_packaging_for_order` resolve `technical_sheets.sole_group_id` → `product_groups`, lê box_type por modo, debita `box_types.quantity` e grava em `stock_movements`
- UI: `PackagingTab` edita o solado (não mais a ficha); `PackagingDecision` lê pelo mesmo caminho
- Modos: colmeia | individual_master | individual_fitilho | individual_amarrado (default = individual)
- Falta de caixa configurada para o modo escolhido → status `no_box_for_sole` (não bloqueia o pedido)
