# Routes

Router: React Router `createBrowserRouter` in `src/App.tsx`. Authenticated routes wrap `ProtectedRoute` → `AppLayout` → `RouteGuard`.

## PV flow (this task)
| URL | File | Layout |
|---|---|---|
| `/sales` | `src/pages/SaleOrders.tsx` | AppLayout + EditorialPageHeader + SalesOperationsRail + table. Query `?pv=` opens ORDER DETAILS DIALOG. |
| `/sales?view=consumo&ids=` | same page, consumption branch | SummaryConsumptionPanel + MaterialConsumptionView |
| `/sales?view=pendencias` | same page | PendenciasView |
| `/sales/new` | `src/pages/SaleOrderForm.tsx` | AppLayout + SaleOrderFormPanel |
| `/sales/edit/:id` | `src/pages/SaleOrderForm.tsx` | same, keyed remount |

## Other key routes
| URL | File |
|---|---|
| `/auth` | Auth (no AppLayout) |
| `/dashboard` | Dashboard |
| `/estoque` | Index (inventory hub) |
| `/fichas-tecnicas` | TechnicalSheets |
| `/orders` | Orders (OPs) |
| `/producao/kanban/gestao` | fullscreen Kanban, no AppLayout |
| `/m/*` | Mobile PWA layout |
| `/clients` | Clients |
| `/financeiro` | Finance hub |

Full router lives in `src/App.tsx` (createBrowserRouter). Do not dump the 1275-line file here; PV children are around lines 1017–1034.
