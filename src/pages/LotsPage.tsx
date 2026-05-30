import { useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, MagnifyingGlass as Search, Package, Warning, ClockCounterClockwise, ArrowsClockwise, Tag } from '@phosphor-icons/react';
import { useActiveLots, useRecordLotIntake, useOrderLotTrace, type LotIntakeInput } from '@/hooks/useLotTracking';
import { useProducts } from '@/hooks/useProducts';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useBinLocations } from '@/hooks/useBinLocations';
import { useOrders } from '@/hooks/useOrders';
import { normalizeForSearch } from '@/lib/searchUtils';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

function formatBRL(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const EMPTY_INTAKE: LotIntakeInput = {
  productId: '',
  quantity: 0,
  unitCost: null,
  supplierId: null,
  supplierLot: null,
  binLocationId: null,
  receivedDate: new Date().toISOString().slice(0, 10),
  expiryDate: null,
  notes: null,
};

export default function LotsPage() {
  const { data: lots = [], isLoading } = useActiveLots();
  const { data: products = [] } = useProducts();
  const { data: suppliers = [] } = useSuppliers();
  const { data: binLocations = [] } = useBinLocations({ activeOnly: true });
  const recordIntake = useRecordLotIntake();

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [form, setForm] = useState<LotIntakeInput>(EMPTY_INTAKE);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'expiring' | 'expired'>('all');

  const filtered = useMemo(() => {
    return lots.filter(l => {
      if (statusFilter === 'expiring' && !l.expiring_soon) return false;
      if (statusFilter === 'expired' && !l.expired) return false;
      if (statusFilter === 'active' && (l.expiring_soon || l.expired)) return false;
      if (search.trim()) {
        const q = normalizeForSearch(search.trim());
        return normalizeForSearch(l.lot_number).includes(q)
          || normalizeForSearch(l.product_name).includes(q)
          || normalizeForSearch(l.supplier_lot || '').includes(q)
          || normalizeForSearch(l.supplier_name || '').includes(q);
      }
      return true;
    });
  }, [lots, search, statusFilter]);

  const totals = useMemo(() => {
    return {
      active: lots.length,
      expiring: lots.filter(l => l.expiring_soon).length,
      expired: lots.filter(l => l.expired).length,
      totalValue: lots.reduce((s, l) => s + (l.quantity_available || 0) * (l.unit_cost || 0), 0),
    };
  }, [lots]);

  const handleSaveIntake = async () => {
    if (!form.productId || !form.quantity || form.quantity <= 0) return;
    try {
      await recordIntake.mutateAsync(form);
      setForm(EMPTY_INTAKE);
      setIntakeOpen(false);
    } catch {}
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ESTOQUE · LOTES"
          title="Rastreabilidade de lotes"
          description="Entrada de material por lote (NFe / fornecedor) com rastreabilidade reversa lote→OP. Consumido por hybrid_debit em produção mantém o vínculo via stock_movements.lot_id."
          actions={
            <Button onClick={() => setIntakeOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova entrada de lote
            </Button>
          }
        />

        <StatGrid>
          <StatCard icon={Package} label="Lotes ativos" value={totals.active} hint="com saldo disponível" />
          <StatCard icon={ClockCounterClockwise} label="A vencer (30d)" value={totals.expiring} hint="atenção próxima" tone={totals.expiring > 0 ? 'warning' : 'default'} />
          <StatCard icon={Warning} label="Vencidos" value={totals.expired} hint="bloquear consumo" tone={totals.expired > 0 ? 'destructive' : 'default'} />
          <StatCard icon={Tag} label="Valor em estoque" value={formatBRL(totals.totalValue)} hint="qty × custo unitário" />
        </StatGrid>

        <Tabs defaultValue="lots" className="space-y-5">
          <TabsList>
            <TabsTrigger value="lots" className="gap-2">
              <Package className="h-4 w-4" /> Lotes ativos
            </TabsTrigger>
            <TabsTrigger value="traceability" className="gap-2">
              <ArrowsClockwise className="h-4 w-4" /> Rastreabilidade reversa
            </TabsTrigger>
          </TabsList>

          <TabsContent value="lots" className="space-y-4">
            <Panel flush>
              <div className="flex flex-col sm:flex-row gap-3 p-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar por lote, produto, fornecedor..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Em uso (sem alerta)</SelectItem>
                    <SelectItem value="expiring">A vencer ≤ 30d</SelectItem>
                    <SelectItem value="expired">Vencidos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Carregando lotes...</div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title={lots.length === 0 ? 'Nenhum lote registrado' : 'Nenhum lote corresponde aos filtros'}
                  description={lots.length === 0 ? 'Clique em "Nova entrada de lote" pra registrar a primeira chegada de material.' : 'Ajuste os filtros pra ver lotes.'}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <TableHead>Lote</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead className="text-right">Recebido</TableHead>
                      <TableHead className="text-right">Disponível</TableHead>
                      <TableHead className="text-right">Custo un.</TableHead>
                      <TableHead>Recebido em</TableHead>
                      <TableHead>Validade</TableHead>
                      <TableHead>Localização</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(lot => (
                      <TableRow key={lot.id} className={lot.expired ? 'bg-red-500/5' : lot.expiring_soon ? 'bg-amber-500/5' : ''}>
                        <TableCell className="font-mono text-xs">
                          <div>{lot.lot_number}</div>
                          {lot.supplier_lot && <div className="text-muted-foreground">{lot.supplier_lot}</div>}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{lot.product_name}</div>
                          {lot.sku && <div className="text-xs text-muted-foreground font-mono">{lot.sku}</div>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{lot.supplier_name || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{lot.quantity_received}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{lot.quantity_available}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{lot.unit_cost != null ? formatBRL(lot.unit_cost) : '—'}</TableCell>
                        <TableCell className="text-sm">{formatDate(lot.received_date)}</TableCell>
                        <TableCell className="text-sm">
                          {lot.expiry_date ? (
                            <div className={lot.expired ? 'text-red-700 font-semibold' : lot.expiring_soon ? 'text-amber-700' : ''}>
                              {formatDate(lot.expiry_date)}
                              {lot.expired && <Badge variant="destructive" className="ml-2 text-xs">vencido</Badge>}
                              {!lot.expired && lot.expiring_soon && <Badge variant="outline" className="ml-2 text-xs border-amber-500/40 text-amber-700">≤30d</Badge>}
                            </div>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-xs">{lot.bin_code || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </TabsContent>

          <TabsContent value="traceability">
            <TraceabilityTab />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova entrada de lote</DialogTitle>
            <DialogDescription>
              Registra chegada de material por lote. Gera lot_number sequencial (LOT-YYYYMMDD-NNNN),
              atualiza products.quantity (entrada) e cria stock_movements com lot_id pra rastreabilidade.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs">Produto *</Label>
              <Select value={form.productId} onValueChange={v => setForm(f => ({ ...f, productId: v }))}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Selecione o produto..." /></SelectTrigger>
                <SelectContent>
                  {products.slice(0, 200).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} {p.sku ? `· ${p.sku}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Quantidade *</Label>
                <Input type="number" inputMode="decimal" value={form.quantity || ''} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} className="h-10" />
              </div>
              <div>
                <Label className="text-xs">Custo unitário (R$)</Label>
                <Input type="number" inputMode="decimal" step="0.01" value={form.unitCost ?? ''} onChange={e => setForm(f => ({ ...f, unitCost: e.target.value ? Number(e.target.value) : null }))} className="h-10" />
              </div>
              <div>
                <Label className="text-xs">Data de recebimento</Label>
                <Input type="date" value={form.receivedDate || ''} onChange={e => setForm(f => ({ ...f, receivedDate: e.target.value }))} className="h-10" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Fornecedor</Label>
                <Select value={form.supplierId || ''} onValueChange={v => setForm(f => ({ ...f, supplierId: v || null }))}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Sem fornecedor..." /></SelectTrigger>
                  <SelectContent>
                    {(suppliers as any[]).slice(0, 200).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Lote do fornecedor / NF</Label>
                <Input value={form.supplierLot || ''} onChange={e => setForm(f => ({ ...f, supplierLot: e.target.value || null }))} className="h-10" placeholder="NFe 12345 / Lote A" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Localização</Label>
                <Select value={form.binLocationId || ''} onValueChange={v => setForm(f => ({ ...f, binLocationId: v || null }))}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Sem localização..." /></SelectTrigger>
                  <SelectContent>
                    {binLocations.map(bl => (
                      <SelectItem key={bl.id} value={bl.id}>{bl.code} · {bl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Validade (opcional)</Label>
                <Input type="date" value={form.expiryDate || ''} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value || null }))} className="h-10" />
              </div>
            </div>

            <div>
              <Label className="text-xs">Notas</Label>
              <Input value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value || null }))} className="h-10" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIntakeOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSaveIntake}
              disabled={!form.productId || !form.quantity || form.quantity <= 0 || recordIntake.isPending}
            >
              {recordIntake.isPending ? 'Salvando...' : 'Registrar lote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function TraceabilityTab() {
  const { data: orders = [] } = useOrders();
  const [orderId, setOrderId] = useState<string>('');
  const { data: trace = [], isLoading } = useOrderLotTrace(orderId || null);

  const order = useMemo(() => orders.find((o: any) => o.id === orderId), [orders, orderId]);
  const totalCost = useMemo(() => trace.reduce((s, t) => s + Number(t.cost_impact || 0), 0), [trace]);

  return (
    <Panel
      eyebrow="RASTREABILIDADE REVERSA"
      title="Dado uma OP, quais lotes foram consumidos?"
      subtitle="Lista materiais consumidos com lot_id preenchido em stock_movements (via consume_from_lot ou hybrid_debit_stock_for_order quando o lote é selecionado)."
      flush
    >
      <div className="p-4 border-b border-border/40">
        <Label className="text-xs">Selecionar OP</Label>
        <Select value={orderId} onValueChange={setOrderId}>
          <SelectTrigger className="h-10 max-w-md"><SelectValue placeholder="Escolha uma OP..." /></SelectTrigger>
          <SelectContent>
            {(orders as any[]).slice(0, 200).map((o: any) => (
              <SelectItem key={o.id} value={o.id}>OP {o.order_number} · {o.color || '—'} · {o.quantity} pares</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {order && (
          <p className="text-xs text-muted-foreground mt-2">
            Status: <strong>{order.status}</strong> · Total consumido R$: <strong>{formatBRL(totalCost)}</strong>
          </p>
        )}
      </div>

      {!orderId ? (
        <EmptyState icon={ArrowsClockwise} title="Selecione uma OP" description="Pra ver rastreabilidade de lotes consumidos." size="sm" />
      ) : isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Carregando rastreabilidade...</div>
      ) : trace.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Sem rastreabilidade pra essa OP"
          description="Significa que os consumos não foram vinculados a lotes (stock_movements.lot_id NULL). Use consume_from_lot pra vincular manualmente ou aguarde integração com hybrid_debit."
          size="sm"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
              <TableHead>Produto</TableHead>
              <TableHead>Lote</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead className="text-right">Consumido</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead>Recebido</TableHead>
              <TableHead>Consumido em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trace.map(t => (
              <TableRow key={t.movement_id}>
                <TableCell className="text-sm">
                  <div className="font-medium">{t.product_name}</div>
                  {t.sku && <div className="text-xs text-muted-foreground font-mono">{t.sku}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <div>{t.lot_number}</div>
                  {t.supplier_lot && <div className="text-muted-foreground">{t.supplier_lot}</div>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.supplier_name || '—'}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{t.quantity_consumed}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBRL(t.cost_impact)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(t.received_date)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(t.consumed_at).toLocaleDateString('pt-BR')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
