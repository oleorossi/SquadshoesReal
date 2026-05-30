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
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { Plus, MagnifyingGlass as Search, Package, ClipboardText, CheckCircle, Warning, Trash } from '@phosphor-icons/react';
import { useCycleCounts, useCycleCountItems, useCreateCycleCount, useAddCycleCountItem, useFinalizeCycleCount } from '@/hooks/useCycleCounts';
import { useProducts } from '@/hooks/useProducts';
import { normalizeForSearch } from '@/lib/searchUtils';
import { toast } from 'sonner';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function CycleCountsPage() {
  const { data: cycles = [], isLoading } = useCycleCounts();
  const { data: products = [] } = useProducts();
  const createCycle = useCreateCycleCount();
  const finalize = useFinalizeCycleCount();
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newNotes, setNewNotes] = useState('');
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);

  const openCycles = useMemo(() => cycles.filter(c => c.status === 'open'), [cycles]);
  const closedCycles = useMemo(() => cycles.filter(c => c.status !== 'open').slice(0, 20), [cycles]);

  const totals = useMemo(() => {
    const closed90d = cycles.filter(c => c.status === 'closed');
    const totalItems = closed90d.reduce((s, c) => s + c.total_items, 0);
    const totalAccurate = closed90d.reduce((s, c) => s + c.accurate_items, 0);
    const avgAccuracy = totalItems > 0 ? Math.round((totalAccurate / totalItems) * 100) : 0;
    return {
      open: openCycles.length,
      closed: closed90d.length,
      avgAccuracy,
      totalAdjusted: closed90d.reduce((s, c) => s + c.items_adjusted, 0),
    };
  }, [cycles, openCycles]);

  const handleCreate = async () => {
    try {
      const newId = await createCycle.mutateAsync(newNotes || undefined);
      setNewDialogOpen(false);
      setNewNotes('');
      setActiveCycleId(newId);
    } catch {}
  };

  const handleFinalize = async (cycleId: string) => {
    if (!confirm('Fechar ciclo e aplicar ajustes de estoque pra todos os itens com variância?')) return;
    try {
      await finalize.mutateAsync({ cycleId, applyAdjustments: true });
      setActiveCycleId(null);
    } catch {}
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ESTOQUE · INVENTÁRIO ROTATIVO"
          title="Contagens de ciclo"
          description="Inventário rotativo com ajuste automático de estoque via adjust_stock (audit em stock_movements)"
          actions={
            <Button onClick={() => setNewDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Novo ciclo
            </Button>
          }
        />

        <StatGrid>
          <StatCard icon={ClipboardText} label="Ciclos abertos" value={totals.open} hint="aguardando contagem" tone={totals.open > 0 ? 'primary' : 'default'} />
          <StatCard icon={CheckCircle} label="Ciclos fechados" value={totals.closed} hint="histórico total" />
          <StatCard icon={Package} label="Acuracidade média" value={`${totals.avgAccuracy}%`} hint="itens contados sem variância" tone={totals.avgAccuracy >= 95 ? 'success' : totals.avgAccuracy >= 85 ? 'warning' : 'destructive'} />
          <StatCard icon={Warning} label="Ajustes aplicados" value={totals.totalAdjusted} hint="movimentações de correção" />
        </StatGrid>

        {isLoading ? (
          <Panel><div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div></Panel>
        ) : cycles.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={ClipboardText}
              title="Nenhum ciclo de contagem registrado"
              description="Clique em 'Novo ciclo' pra começar um inventário rotativo. Você escaneia/busca produtos, conta, e ao fechar o sistema aplica os ajustes via adjust_stock."
            />
          </Panel>
        ) : (
          <>
            {openCycles.length > 0 && (
              <Panel eyebrow="EM ABERTO" title={`${openCycles.length} ciclo(s) ativo(s)`} flush>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <TableHead>Número</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Itens</TableHead>
                      <TableHead className="text-right">Sem variância</TableHead>
                      <TableHead className="text-right">A mais / a menos</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead className="text-center">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openCycles.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-sm">{c.count_number}</TableCell>
                        <TableCell className="text-sm">{formatDate(c.count_date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.total_items}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.accurate_items}</TableCell>
                        <TableCell className="text-right text-xs">
                          <span className="text-emerald-700">+{c.items_over}</span>
                          {' / '}
                          <span className="text-red-700">−{c.items_under}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{c.notes || '—'}</TableCell>
                        <TableCell className="text-center">
                          <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={() => setActiveCycleId(c.id)}>
                            Contar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            )}

            {closedCycles.length > 0 && (
              <Panel eyebrow="HISTÓRICO" title={`Últimos ${closedCycles.length} ciclos fechados`} flush>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <TableHead>Número</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Itens</TableHead>
                      <TableHead className="text-right">Acuracidade</TableHead>
                      <TableHead className="text-right">Ajustes</TableHead>
                      <TableHead>Aprovador</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedCycles.map(c => (
                      <TableRow key={c.id} className="opacity-80">
                        <TableCell className="font-mono text-sm">{c.count_number}</TableCell>
                        <TableCell className="text-sm">{formatDate(c.count_date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.total_items}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Badge variant="outline" className={`text-xs ${c.accuracy_pct >= 95 ? 'border-emerald-500/40 text-emerald-700' : c.accuracy_pct >= 85 ? 'border-amber-500/40 text-amber-700' : 'border-red-500/40 text-red-700'}`}>
                            {c.accuracy_pct}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.items_adjusted}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.approved_by || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            )}
          </>
        )}
      </div>

      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo ciclo de contagem</DialogTitle>
            <DialogDescription>
              Cria um ciclo aberto. Você pode adicionar itens em qualquer momento e fechar quando terminar — ajustes são aplicados ao fechar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="notes" className="text-xs">Notas (opcional)</Label>
              <Textarea id="notes" value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Ex.: Inventário rotativo seção A — quinzena 1" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createCycle.isPending}>
              {createCycle.isPending ? 'Criando...' : 'Criar ciclo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {activeCycleId && (
        <CountingDialog
          cycleId={activeCycleId}
          cycle={cycles.find(c => c.id === activeCycleId)}
          products={products}
          onClose={() => setActiveCycleId(null)}
          onFinalize={() => handleFinalize(activeCycleId)}
        />
      )}
    </AppLayout>
  );
}

function CountingDialog({
  cycleId, cycle, products, onClose, onFinalize,
}: {
  cycleId: string;
  cycle: any;
  products: any[];
  onClose: () => void;
  onFinalize: () => void;
}) {
  const { data: items = [] } = useCycleCountItems(cycleId);
  const addItem = useAddCycleCountItem();
  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [countedQty, setCountedQty] = useState<string>('');
  const [binLocation, setBinLocation] = useState<string>('');
  const [lotNumber, setLotNumber] = useState<string>('');

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return [];
    const q = normalizeForSearch(search.trim());
    return products.filter((p: any) =>
      normalizeForSearch(p.name || '').includes(q) ||
      normalizeForSearch(p.sku || '').includes(q)
    ).slice(0, 10);
  }, [products, search]);

  const selectedProduct = selectedProductId ? products.find((p: any) => p.id === selectedProductId) : null;

  const handleAddCount = async () => {
    if (!selectedProductId || !countedQty.trim()) {
      toast.error('Selecione um produto e informe a quantidade contada');
      return;
    }
    const n = Number(countedQty);
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Quantidade inválida');
      return;
    }
    try {
      await addItem.mutateAsync({
        cycleId,
        productId: selectedProductId,
        countedQuantity: n,
        binLocation: binLocation.trim() || null,
        lotNumber: lotNumber.trim() || null,
      });
      setSelectedProductId(null);
      setCountedQty('');
      setSearch('');
      setBinLocation('');
      setLotNumber('');
      toast.success('Contagem registrada');
    } catch {}
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contagem · {cycle?.count_number || cycleId.slice(0, 8)}</DialogTitle>
          <DialogDescription>
            Busque produto, informe quantidade contada. Variância é calculada automaticamente. Ao fechar o ciclo, ajustes são aplicados via adjust_stock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Panel flush>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar produto por nome ou SKU..."
                  className="pl-9 h-10"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setSelectedProductId(null); }}
                />
                {filteredProducts.length > 0 && !selectedProductId && (
                  <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-md shadow-md max-h-64 overflow-y-auto">
                    {filteredProducts.map((p: any) => (
                      <button
                        key={p.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm"
                        onClick={() => { setSelectedProductId(p.id); setSearch(p.name); }}
                      >
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.sku && <span className="font-mono">{p.sku}</span>}
                          {' · estoque atual: '}
                          <strong>{p.quantity ?? 0}</strong>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedProduct && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="font-semibold">{selectedProduct.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Sistema: <strong>{selectedProduct.quantity ?? 0}</strong> · SKU: <span className="font-mono">{selectedProduct.sku || '—'}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Quantidade contada *</Label>
                  <Input type="number" inputMode="decimal" value={countedQty} onChange={e => setCountedQty(e.target.value)} className="h-10" placeholder="0" />
                </div>
                <div>
                  <Label className="text-xs">Localização (opcional)</Label>
                  <Input value={binLocation} onChange={e => setBinLocation(e.target.value)} className="h-10" placeholder="A-12-3" />
                </div>
                <div>
                  <Label className="text-xs">Lote (opcional)</Label>
                  <Input value={lotNumber} onChange={e => setLotNumber(e.target.value)} className="h-10" placeholder="L-2026-001" />
                </div>
              </div>

              <Button
                onClick={handleAddCount}
                disabled={!selectedProductId || !countedQty.trim() || addItem.isPending}
                className="w-full gap-2"
              >
                <Plus className="h-4 w-4" />
                {addItem.isPending ? 'Salvando...' : 'Registrar contagem'}
              </Button>
            </div>
          </Panel>

          <Panel eyebrow="ITENS CONTADOS" title={`${items.length} itens no ciclo`} flush>
            {items.length === 0 ? (
              <EmptyState icon={Package} title="Nenhum item contado ainda" size="sm" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Sistema</TableHead>
                    <TableHead className="text-right">Contado</TableHead>
                    <TableHead className="text-right">Variância</TableHead>
                    <TableHead>Localização / Lote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => {
                    const product = products.find((p: any) => p.id === item.product_id);
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm">{product?.name || item.product_id.slice(0, 8)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{item.system_quantity}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{item.counted_quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.variance === 0 ? (
                            <span className="text-emerald-700">0</span>
                          ) : item.variance > 0 ? (
                            <span className="text-emerald-700">+{item.variance}</span>
                          ) : (
                            <span className="text-red-700">{item.variance}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[item.bin_location, item.lot_number].filter(Boolean).join(' · ') || '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar dialog (não finaliza)</Button>
          <Button
            onClick={onFinalize}
            disabled={items.length === 0}
            className="gap-2"
          >
            <CheckCircle className="h-4 w-4" />
            Finalizar ciclo e aplicar ajustes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
