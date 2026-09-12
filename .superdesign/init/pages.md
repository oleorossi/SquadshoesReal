# Page dependency trees (PV flow + neighbors)

## /sales — Pedidos de Venda (list + ficha dialog)
Entry: `src/pages/SaleOrders.tsx`
Dependencies:
- `src/components/layout/EditorialPageHeader.tsx`
- `src/components/sale-orders/SalesOperationsRail.tsx`
- `src/components/sale-orders/saleOrderListConstants.ts`
- `src/components/sale-orders/SaleOrderSortHead.tsx`
- `src/components/sale-orders/SaleOrderMobileCard.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/panel.tsx`
- `src/components/ui/empty-state.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/bulk-actions-bar.tsx`
- `src/hooks/useSaleOrders.ts`
- `src/lib/utils.ts`

ORDER DETAILS DIALOG render branch: `src/pages/SaleOrders.tsx` ~2374–2800 (sticky header, 01/02/03 action mesa, dados comerciais dl, grouped items + grade table).

## /sales/new and /sales/edit/:id
Entry: `src/pages/SaleOrderForm.tsx`
Dependencies:
- `src/components/layout/EditorialPageHeader.tsx`
- `src/components/sale-orders/SaleOrderFormPanel.tsx`
  - `src/components/sale-orders/SaleOrderItemForm.tsx`
    - `src/components/sale-orders/StrapPvOrigemChooser.tsx`
    - `src/components/ui/number-input.tsx`
    - `src/components/ui/signed-image.tsx`
  - `src/components/ui/card.tsx`
  - `src/components/ui/order-status-stepper.tsx`
- `src/components/sale-orders/PvServiceOrdersCard.tsx`

Desktop render: EditorialPageHeader + SaleOrderFormPanel (cliente cards + itens). Item card: header photo+ref, fields grid, 4-step strip, grade NumberInputs, straps grid.

## /sales?view=consumo
Entry: `src/pages/SaleOrders.tsx` consumption branch → `src/components/sale-orders/SummaryConsumptionPanel.tsx`
- `src/components/sale-orders/MaterialConsumptionView.tsx`
  - `src/components/sale-orders/ConsumptionDecisionRail.tsx`
  - `src/components/ui/table.tsx`

## /sales?view=pendencias
Entry: `src/components/sale-orders/PendenciasView.tsx`
- `src/components/ui/button.tsx` / `badge.tsx` / `empty-state.tsx`

## /dashboard
Entry: `src/pages/Dashboard.tsx` — EditorialPageHeader hero (NOT the compact PV density).
