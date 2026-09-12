# Extractable Superdesign components

## EditorialPageHeader
- Source: `src/components/layout/EditorialPageHeader.tsx`
- Category: layout
- Description: Page title primitive — eyebrow + Anton title + actions + optional thick rule
- Extractable props: sectionLabel (string), title (string), description (string), density (default|compact)
- Hardcoded: Anton via .hero-editorial-title, 3px rule-thick, Fira Sans eyebrow

## AppShellMain
- Source: `src/components/layout/AppLayout.tsx` render ~890–1011
- Category: layout
- Description: Sidebar 232/68 + sticky breadcrumb + fluid main padding
- Extractable props: sidebarCollapsed (boolean), printMode (boolean)
- Hardcoded: Squad logo img, graphite sidebar tokens, BottomNav

## SalesOperationsRail
- Source: `src/components/sale-orders/SalesOperationsRail.tsx`
- Category: layout
- Description: Ink KPI strip + status metrics for the visible PV set
- Extractable props: scopeLabel, orderCount, pairs, drafts, approved, inProduction, deadlineRisk, total
- Hardcoded: amber/emerald/blue segment colors, Anton count

## PvDetailHeader
- Source: `src/pages/SaleOrders.tsx` ORDER DETAILS DIALOG header
- Category: layout
- Description: Sticky PV number + status badge + pares/total/itens KPIs
- Extractable props: orderNumber, status, pairs, total, items
- Hardcoded: eyebrow "Comercial · Pedido de Venda", STATUS_BAND background

Skip primitives: Button, Input, Card, Badge, Dialog — inline in drafts.
