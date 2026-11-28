import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import '../src/styles-paper.css';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OrderStatusStepper } from '@/components/ui/order-status-stepper';
import { SaleOrderCabedalHoldPanel } from '@/components/sale-orders/SaleOrderCabedalHoldPanel';
import { SaleOrderAtelierProductionHoldBadge } from '@/components/sale-orders/SaleOrderAtelierProductionHoldBadge';
import { SaleOrderMobileCard } from '@/components/sale-orders/SaleOrderMobileCard';
import {
  FILTER_STATUS_OPTIONS,
  STATUS_BAND,
  STATUS_COLORS,
  STATUS_DOT,
} from '@/components/sale-orders/saleOrderListConstants';
import { saleOrderDisplayStatus } from '@/lib/saleOrderCabedalHold';
import type { AtelierProductionHoldLine } from '@/lib/atelierProductionHold';
import { cn } from '@/lib/utils';

// ── Dados MOCKADOS (copiados do estado de leitura do PV-00250, 28/11/2026) ──
const hold = (itemId: string, ref: string, color: string, reason: string): AtelierProductionHoldLine => ({
  saleOrderId: 'pv250', itemId, referenceCode: ref, color, pendingJobs: '', reason,
});
const holds250: AtelierProductionHoldLine[] = [
  hold('a', 'I701', 'CHAMPAGNE', 'Ateliê — costura ainda sem recebimento (0/420)'),
  hold('b', 'I90', 'OFF WHITE', 'Ateliê — aviamento ainda sem recebimento (0/588)'),
  hold('c', 'I90', 'ROSADO', 'Ateliê — aviamento ainda sem recebimento (0/360)'),
];
const holds255: AtelierProductionHoldLine[] = [
  hold('d', 'I90', 'NATURAL', 'Ateliê — aviamento ainda sem recebimento (0/960)'),
  hold('e', 'I90', 'OFF WHITE', 'Ateliê — aviamento ainda sem recebimento (0/1200)'),
];

interface MockOrder { id: string; order_number: string; client_name: string; status: string; pairs: number; total: number; delivery_deadline: string; holds?: AtelierProductionHoldLine[] }
const orders: MockOrder[] = [
  { id: 'pv250', order_number: 'PV-00250', client_name: 'Cliente Exemplo A', status: 'Aprovado', pairs: 1368, total: 0, delivery_deadline: '2026-11-23', holds: holds250 },
  { id: 'pv255', order_number: 'PV-00255', client_name: 'Cliente Exemplo B', status: 'Aprovado', pairs: 2160, total: 0, delivery_deadline: '2026-12-10', holds: holds255 },
  { id: 'pv260', order_number: 'PV-00260', client_name: 'Cliente Exemplo C', status: 'Aprovado', pairs: 480, total: 0, delivery_deadline: '2026-12-05' },
  { id: 'pv252', order_number: 'PV-00252', client_name: 'Cliente Exemplo D', status: 'Em Produção', pairs: 720, total: 0, delivery_deadline: '2026-12-02' },
  { id: 'pv261', order_number: 'PV-00261', client_name: 'Cliente Exemplo E', status: 'Rascunho', pairs: 300, total: 0, delivery_deadline: '2026-12-20' },
];
const fmt = (d: string) => d.split('-').reverse().join('/');

function Frame({ title, subtitle, children, width }: { title: string; subtitle?: string; children: React.ReactNode; width?: number }) {
  return (
    <div className="mx-auto bg-background p-5" style={{ width: width ?? 1240 }}>
      <p className="eyebrow">Prévia · dados de exemplo</p>
      <h1 className="display text-2xl m-0 leading-none">{title}</h1>
      {subtitle && <p className="mt-1 mb-4 text-sm text-muted-foreground">{subtitle}</p>}
      {children}
    </div>
  );
}

function Lista() {
  return (
    <Frame title="Pedidos de Venda" subtitle="Lista: o PV com cabedal fora do Ateliê aparece como “Aguardando Cabedal”.">
      <div className="mb-3 flex gap-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Filtro · Status</p>
          <ul className="w-[190px] rounded-md border bg-card py-1 text-sm shadow-sm">
            <li className="px-3 py-1 text-muted-foreground">Todos</li>
            {FILTER_STATUS_OPTIONS.slice(0, 6).map((s) => (
              <li key={s} className={cn('flex items-center gap-2 px-3 py-1', s === 'Aguardando Cabedal' && 'bg-orange-500/10 font-semibold')}>
                <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} />{s}
              </li>
            ))}
            <li className="px-3 py-1 text-muted-foreground">…</li>
          </ul>
        </div>
        <div className="flex flex-1 items-end gap-6 rounded-lg border bg-card p-3 text-sm">
          <div><p className="text-xs uppercase text-muted-foreground">Aprovados</p><p className="font-display text-2xl tabular-nums">1</p></div>
          <div><p className="text-xs uppercase text-orange-700">Aguardando cabedal</p><p className="font-display text-2xl tabular-nums text-orange-700">2</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Em produção</p><p className="font-display text-2xl tabular-nums">1</p></div>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">PV</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Pares</th><th className="px-3 py-2">Entrega</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Ateliê</th></tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const shown = saleOrderDisplayStatus(o.status, o.holds);
              return (
                <tr key={o.id} className={cn('border-t', STATUS_BAND[shown])}>
                  <td className="px-3 py-2 font-mono font-bold text-primary">{o.order_number}</td>
                  <td className="px-3 py-2">{o.client_name}</td>
                  <td className="px-3 py-2 tabular-nums">{o.pairs.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2">{fmt(o.delivery_deadline)}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn(STATUS_COLORS[shown], 'text-xs gap-1')}>
                      <span className={cn('h-1.5 w-1.5 rounded-full mr-1.5', STATUS_DOT[shown])} />{shown}
                    </Badge>
                  </td>
                  <td className="px-3 py-2"><SaleOrderAtelierProductionHoldBadge status={o.status} holds={o.holds} orderNumber={o.order_number} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

function Detalhe({ released }: { released: boolean }) {
  const o = orders[0];
  const shown = saleOrderDisplayStatus(o.status, o.holds);
  const withOp = released ? new Set(['a', 'b', 'c']) : new Set<string>();
  return (
    <Frame
      title={released ? 'PV-00250 — depois de “Gerar ordens e fichas”' : 'PV-00250 — como ficaria (hoje: Aprovado e sem nenhuma ordem)'}
      subtitle="Detalhe do pedido. Nada foi alterado no PV real: é só leitura + simulação."
    >
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className={cn('border-b px-4 py-2', STATUS_BAND[shown])}>
          <p className="eyebrow">Comercial · Pedido de Venda</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="display text-2xl leading-none">{o.order_number}</span>
            <Badge variant="outline" className={STATUS_COLORS[shown]}>
              <span className={cn('h-1.5 w-1.5 rounded-full mr-1.5', STATUS_DOT[shown])} />{shown}
            </Badge>
            <SaleOrderAtelierProductionHoldBadge status={o.status} holds={o.holds} orderNumber={o.order_number} />
          </div>
          <OrderStatusStepper currentStatus={shown} className="mt-2" />
        </div>
        <div className="space-y-3 px-4 pb-4 pt-3">
          <SaleOrderCabedalHoldPanel
            orderNumber={o.order_number}
            holds={holds250}
            itemIdsWithOp={withOp}
            totalItems={3}
            canGenerate
            onGenerate={released ? undefined : () => undefined}
            onPrintFichas={() => undefined}
          />
          <div className="rounded-lg border">
            <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Itens · 3 itens · 1.368 pares</div>
            {[['I701', 'CHAMPAGNE', 420], ['I90', 'OFF WHITE', 588], ['I90', 'ROSADO', 360]].map(([r, c, q]) => (
              <div key={String(c) + r} className="flex items-center justify-between border-t px-3 py-1.5 text-sm first:border-t-0">
                <span><b>{r}</b> · {c}</span>
                <span className="tabular-nums text-muted-foreground">{Number(q).toLocaleString('pt-BR')} pares {released ? '· OP gerada (Reservado)' : '· sem OP'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function Fluxo() {
  return (
    <Frame title="Fluxo do pedido" subtitle="Antes (5 passos) e com a fase nova quando o PV tem cabedal complexo.">
      <div className="space-y-6">
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">PV sem cabedal complexo (igual a hoje)</p>
          <OrderStatusStepper currentStatus="Aprovado" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-1 text-xs font-semibold uppercase text-orange-700">PV com cabedal complexo no Ateliê</p>
          <OrderStatusStepper currentStatus="Aguardando Cabedal" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Cabedal voltou → Em Produção</p>
          <OrderStatusStepper currentStatus="Em Produção" />
        </div>
      </div>
    </Frame>
  );
}

function Mobile() {
  const base = { canSeeFinancialValues: false, canEditPv: false, selected: false, onToggleSelect: () => undefined, onOpenDetails: () => undefined, onPrefetchConsumption: () => undefined, onOpenConsumption: () => undefined, onEdit: () => undefined, minBilling: null };
  return (
    <Frame width={390} title="Pedidos no celular" subtitle="Cartão da lista no viewport mobile.">
      <div className="space-y-3">
        {orders.slice(0, 4).map((o) => (
          <SaleOrderMobileCard key={o.id} {...base} order={o} pairs={o.pairs} atelierHolds={o.holds} />
        ))}
      </div>
    </Frame>
  );
}

const view = (location.hash || '#lista').slice(1);
createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    {view === 'lista' && <Lista />}
    {view === 'detalhe' && <Detalhe released={false} />}
    {view === 'detalhe-gerado' && <Detalhe released />}
    {view === 'fluxo' && <Fluxo />}
    {view === 'mobile' && <Mobile />}
  </MemoryRouter>,
);
void Button;
