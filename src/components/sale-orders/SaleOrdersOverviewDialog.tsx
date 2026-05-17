import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CircleNotch as Loader2, ShoppingCart, Package, CurrencyDollar as DollarSign, Users, Calendar, Warning as AlertTriangle, CheckCircle as CheckCircle2, FloppyDisk as Save, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchMinBillingDates, isBeforeMinDate } from '@/lib/minBillingDate';
import { MinBillingDateConfirmDialog } from './MinBillingDateConfirmDialog';

type SaleOrder = any;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orders: SaleOrder[];
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_COLORS: Record<string, string> = {
  'Pendente': 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  'Aprovado': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  'Em Produção': 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  'Faturado': 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30',
  'Cancelado': 'bg-destructive/15 text-destructive border-destructive/30',
};

function buildMonthOptions() {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = -1; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return months;
}

function buildWeekOptions(deliveryMonth: string) {
  if (!deliveryMonth) return [];
  const [year, month] = deliveryMonth.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  let weekStart = new Date(firstDay);
  const dayOfWeek = weekStart.getDay();
  if (dayOfWeek !== 1) {
    weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7));
  }
  const weeks: { value: string; label: string }[] = [];
  let weekNum = 1;
  while (weekStart <= lastDay) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 4);
    const label = `Semana ${weekNum} (${weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - ${weekEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`;
    weeks.push({ value: `S${weekNum}`, label });
    weekStart.setDate(weekStart.getDate() + 7);
    weekNum++;
  }
  return weeks;
}

export default function SaleOrdersOverviewDialog({ open, onOpenChange, orders }: Props) {
  const qc = useQueryClient();
  const [bulkMonth, setBulkMonth] = useState<string>('');
  const [bulkWeek, setBulkWeek] = useState<string>('');
  const [bulkDeadline, setBulkDeadline] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingViolation, setPendingViolation] = useState<{
    minDateISO: string;
    violatingIds: string[];
    minDateMap: Map<string, string>;
  } | null>(null);

  const monthOptions = useMemo(buildMonthOptions, []);
  const weekOptions = useMemo(() => buildWeekOptions(bulkMonth), [bulkMonth]);

  // Aggregations
  const stats = useMemo(() => {
    const totalValue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const totalPairs = orders.reduce((s, o) => s + Number(o.total_quantity || 0), 0);
    const byStatus = new Map<string, number>();
    const byClient = new Map<string, { count: number; value: number; pairs: number }>();
    const byRep = new Map<string, { count: number; value: number }>();
    const byWeek = new Map<string, { count: number; value: number; label: string }>();
    let withoutWeek = 0;

    for (const o of orders) {
      byStatus.set(o.status || '—', (byStatus.get(o.status || '—') || 0) + 1);
      const c = byClient.get(o.client_name || '—') || { count: 0, value: 0, pairs: 0 };
      c.count++; c.value += Number(o.total || 0); c.pairs += Number(o.total_quantity || 0);
      byClient.set(o.client_name || '—', c);
      const r = byRep.get(o.representative || '—') || { count: 0, value: 0 };
      r.count++; r.value += Number(o.total || 0);
      byRep.set(o.representative || '—', r);

      if (o.delivery_month && o.delivery_week) {
        const key = `${o.delivery_month}-${o.delivery_week}`;
        const w = byWeek.get(key) || { count: 0, value: 0, label: `${o.delivery_month} ${o.delivery_week}` };
        w.count++; w.value += Number(o.total || 0);
        byWeek.set(key, w);
      } else {
        withoutWeek++;
      }
    }
    return { totalValue, totalPairs, byStatus, byClient, byRep, byWeek, withoutWeek };
  }, [orders]);

  const handleApplyBulkSchedule = async () => {
    if (!bulkMonth && !bulkWeek && !bulkDeadline) {
      toast.info('Defina pelo menos um campo para aplicar.');
      return;
    }
    if (bulkWeek && !bulkMonth) {
      toast.error('Selecione o mês ao definir a semana.');
      return;
    }

    // Se está mudando a data de prazo, validar contra mínimo calculado
    if (bulkDeadline) {
      const ids = orders.map(o => o.id);
      const minMap = await fetchMinBillingDates(ids);
      const violatingIds: string[] = [];
      let earliestMin = '';
      for (const id of ids) {
        const minISO = minMap.get(id);
        if (minISO && isBeforeMinDate(bulkDeadline, minISO)) {
          violatingIds.push(id);
          if (!earliestMin || minISO > earliestMin) earliestMin = minISO;
        }
      }
      if (violatingIds.length > 0) {
        setPendingViolation({ minDateISO: earliestMin, violatingIds, minDateMap: minMap });
        setConfirmOpen(true);
        return;
      }
    }

    await applyBulkUpdate(false, null);
  };

  const applyBulkUpdate = async (manualOverride: boolean, reason: string | null) => {
    const updateData: Record<string, any> = {};
    if (bulkMonth) updateData.delivery_month = bulkMonth;
    if (bulkWeek) updateData.delivery_week = bulkWeek;
    if (bulkMonth && bulkWeek) {
      updateData.billing_week = `${bulkMonth}-${bulkWeek}`;
    } else if (bulkWeek) {
      updateData.billing_week = bulkWeek;
    }
    if (bulkDeadline) updateData.delivery_deadline = bulkDeadline;

    setSaving(true);
    try {
      const ids = orders.map(o => o.id);

      if (manualOverride && pendingViolation) {
        // Atualiza os que violam com flag + original_min_billing_date
        const violatingIds = pendingViolation.violatingIds;
        const nonViolatingIds = ids.filter(id => !violatingIds.includes(id));

        // Update em lote para os não-violadores
        if (nonViolatingIds.length > 0) {
          const { error: e1 } = await supabase
            .from('sale_orders')
            .update(updateData)
            .in('id', nonViolatingIds);
          if (e1) throw e1;
        }

        // Update individual para os violadores (cada um com seu original_min)
        for (const vid of violatingIds) {
          const minISO = pendingViolation.minDateMap.get(vid);
          const { error: e2 } = await supabase
            .from('sale_orders')
            .update({
              ...updateData,
              manual_billing_override: true,
              original_min_billing_date: minISO || null,
              manual_override_reason: reason,
            })
            .eq('id', vid);
          if (e2) throw e2;
        }
      } else {
        const { error } = await supabase
          .from('sale_orders')
          .update({ ...updateData, manual_billing_override: false, manual_override_reason: null })
          .in('id', ids);
        if (error) throw error;
      }

      toast.success(`${ids.length} ${ids.length === 1 ? 'pedido atualizado' : 'pedidos atualizados'}.`);
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['kanban-orders'] });
      setBulkMonth(''); setBulkWeek(''); setBulkDeadline('');
      setPendingViolation(null);
    } catch (err: any) {
      toast.error(`Erro ao atualizar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader className="border-b pb-3">
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Visão Geral — {orders.length} {orders.length === 1 ? 'pedido selecionado' : 'pedidos selecionados'}
          </DialogTitle>
          <DialogDescription>
            Análise consolidada e ações em lote sobre os pedidos selecionados.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
          <div className="space-y-5 py-2">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={<ShoppingCart className="h-4 w-4 text-primary" />} label="Pedidos" value={orders.length.toString()} />
              <KpiCard icon={<Package className="h-4 w-4 text-emerald-600" />} label="Pares" value={stats.totalPairs.toLocaleString('pt-BR')} />
              <KpiCard icon={<DollarSign className="h-4 w-4 text-violet-600" />} label="Valor Total" value={formatCurrency(stats.totalValue)} />
              <KpiCard icon={<Users className="h-4 w-4 text-blue-600" />} label="Clientes" value={stats.byClient.size.toString()} />
            </div>

            {/* Bulk Schedule Action */}
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Calendar className="h-4 w-4 text-primary" />
                  Reagendar entrega em lote
                  {stats.withoutWeek > 0 && (
                    <Badge variant="outline" className="ml-2 text-xs gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-600" />
                      {stats.withoutWeek} sem semana
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Novo Mês</Label>
                    <Select value={bulkMonth} onValueChange={(v) => { setBulkMonth(v); setBulkWeek(''); }}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {monthOptions.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Nova Semana</Label>
                    <Select value={bulkWeek} onValueChange={setBulkWeek} disabled={!bulkMonth}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={bulkMonth ? 'Selecione...' : 'Defina o mês'} />
                      </SelectTrigger>
                      <SelectContent>
                        {weekOptions.map(w => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Prazo (data)</Label>
                    <Input type="date" value={bulkDeadline} onChange={e => setBulkDeadline(e.target.value)} className="h-9" />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button onClick={handleApplyBulkSchedule} disabled={saving} className="gap-2 flex-1">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Aplicar
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setBulkMonth(''); setBulkWeek(''); setBulkDeadline(''); }} title="Limpar">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Aplica os campos preenchidos a todos os {orders.length} pedidos selecionados. Campos vazios são ignorados.
                </p>
              </CardContent>
            </Card>

            {/* Tabs: distribution */}
            <Tabs defaultValue="status" className="space-y-3">
              <TabsList>
                <TabsTrigger value="status" className="text-xs gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Por Status
                </TabsTrigger>
                <TabsTrigger value="weeks" className="text-xs gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Por Semana
                </TabsTrigger>
                <TabsTrigger value="clients" className="text-xs gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Por Cliente
                </TabsTrigger>
                <TabsTrigger value="orders" className="text-xs gap-1.5">
                  <ShoppingCart className="h-3.5 w-3.5" /> Pedidos
                </TabsTrigger>
              </TabsList>

              <TabsContent value="status">
                <Card><CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Pedidos</TableHead>
                        <TableHead className="text-right">% do Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from(stats.byStatus.entries()).map(([status, count]) => (
                        <TableRow key={status}>
                          <TableCell><Badge variant="outline" className={STATUS_COLORS[status] || ''}>{status}</Badge></TableCell>
                          <TableCell className="text-right font-mono">{count}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {((count / orders.length) * 100).toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="weeks">
                <Card><CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mês / Semana</TableHead>
                        <TableHead className="text-right">Pedidos</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.byWeek.size === 0 && (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Nenhum pedido com semana definida.</TableCell></TableRow>
                      )}
                      {Array.from(stats.byWeek.entries())
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([key, w]) => (
                          <TableRow key={key}>
                            <TableCell className="font-mono text-xs">{w.label}</TableCell>
                            <TableCell className="text-right font-mono">{w.count}</TableCell>
                            <TableCell className="text-right font-mono">{formatCurrency(w.value)}</TableCell>
                          </TableRow>
                        ))}
                      {stats.withoutWeek > 0 && (
                        <TableRow className="bg-amber-500/5">
                          <TableCell className="text-xs flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-amber-600" /> Sem semana definida
                          </TableCell>
                          <TableCell className="text-right font-mono">{stats.withoutWeek}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">—</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="clients">
                <Card><CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="text-right">Pedidos</TableHead>
                        <TableHead className="text-right">Pares</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from(stats.byClient.entries())
                        .sort(([, a], [, b]) => b.value - a.value)
                        .map(([client, c]) => (
                          <TableRow key={client}>
                            <TableCell className="text-sm">{client}</TableCell>
                            <TableCell className="text-right font-mono">{c.count}</TableCell>
                            <TableCell className="text-right font-mono">{c.pairs}</TableCell>
                            <TableCell className="text-right font-mono">{formatCurrency(c.value)}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="orders">
                <Card><CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pedido</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Mês/Semana</TableHead>
                        <TableHead>Prazo</TableHead>
                        <TableHead className="text-right">Pares</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map(o => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">{o.client_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[o.status] || ''}`}>
                              {o.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {o.delivery_month ? `${o.delivery_month} ${o.delivery_week || ''}`.trim() : '—'}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {o.delivery_deadline ? new Date(o.delivery_deadline).toLocaleDateString('pt-BR') : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono">{o.total_quantity || 0}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(Number(o.total || 0))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent></Card>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    {pendingViolation && (
      <MinBillingDateConfirmDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          setConfirmOpen(v);
          if (!v) setPendingViolation(null);
        }}
        selectedDateISO={bulkDeadline}
        minDateISO={pendingViolation.minDateISO}
        affectedCount={pendingViolation.violatingIds.length}
        onConfirm={(reason) => {
          setConfirmOpen(false);
          applyBulkUpdate(true, reason);
        }}
      />
    )}
    </>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
          <p className="text-base font-bold truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
