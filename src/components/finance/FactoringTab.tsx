import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, PencilSimple as Pencil, Trash as Trash2, Percent, FileText, CaretDown as ChevronDown, CaretUp as ChevronUp } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { calculateFactoringDiscount } from '@/lib/factoringCalc';

interface FactoringConfig {
  id: string;
  name: string;
  monthly_interest_rate: number;
  receiving_days: number;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export function useFactoringConfigs() {
  return useQuery({
    queryKey: ['factoring_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factoring_config')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as FactoringConfig[];
    },
  });
}

function FactoringReport({ config }: { config: FactoringConfig }) {
  const [open, setOpen] = useState(false);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['factoring_orders', config.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number, client_name, total, status, created_at, delivery_deadline, delivery_month, delivery_week, payment_condition')
        .eq('is_factoring', true)
        .eq('factoring_config_id', config.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const calcDiscount = (order: typeof orders[number]) =>
    calculateFactoringDiscount({
      total: Number(order.total) || 0,
      monthlyInterestRate: config.monthly_interest_rate,
      paymentCondition: order.payment_condition,
      deliveryMonth: order.delivery_month,
      deliveryWeek: order.delivery_week,
      fallbackReceivingDays: config.receiving_days,
    });

  const computed = orders.map((o) => ({ order: o, ...calcDiscount(o) }));
  const totalBruto = computed.reduce((s, c) => s + (Number(c.order.total) || 0), 0);
  const totalDesconto = computed.reduce((s, c) => s + c.discount, 0);
  const totalLiquido = computed.reduce((s, c) => s + c.pv, 0);

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{config.name}</span>
          <Badge variant="outline" className="text-xs">{config.monthly_interest_rate}% a.m.</Badge>
          <Badge variant="outline" className="text-xs">{config.receiving_days} dias</Badge>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t p-3 space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum pedido trocado com esta factoring</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Bruto</p>
                  <p className="font-mono font-semibold text-sm">R$ {totalBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-destructive/10 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Juros/Desconto</p>
                  <p className="font-mono font-semibold text-sm text-destructive">-R$ {totalDesconto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-primary/10 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Valor Recebido</p>
                  <p className="font-mono font-semibold text-sm text-primary">R$ {totalLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Valor Bruto</TableHead>
                    <TableHead className="text-right">Desconto</TableHead>
                    <TableHead className="text-right">Valor Líquido</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {computed.map(({ order: o, pv, discount }) => {
                    const total = Number(o.total) || 0;
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">{o.order_number || '—'}</TableCell>
                        <TableCell>{o.client_name || '—'}</TableCell>
                        <TableCell>{o.created_at ? format(new Date(o.created_at), 'dd/MM/yyyy') : '—'}</TableCell>
                        <TableCell className="text-right font-mono">R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">-R$ {discount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-mono text-primary">R$ {pv.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function FactoringTab() {
  const qc = useQueryClient();
  const { data: configs = [], isLoading } = useFactoringConfigs();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FactoringConfig | null>(null);
  const [form, setForm] = useState({ name: '', monthly_interest_rate: 0, receiving_days: 1, notes: '', active: true });

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', monthly_interest_rate: 0, receiving_days: 1, notes: '', active: true });
    setDialogOpen(true);
  };

  const openEdit = (c: FactoringConfig) => {
    setEditing(c);
    setForm({ name: c.name, monthly_interest_rate: c.monthly_interest_rate, receiving_days: c.receiving_days, notes: c.notes || '', active: c.active });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(form.monthly_interest_rate) || form.monthly_interest_rate < 0) throw new Error('Taxa de juros deve ser um número não-negativo.');
      if (!Number.isFinite(form.receiving_days) || form.receiving_days < 1) throw new Error('Prazo de recebimento deve ser de pelo menos 1 dia.');
      if (editing) {
        const { error } = await supabase.from('factoring_config').update({
          name: form.name, monthly_interest_rate: form.monthly_interest_rate,
          receiving_days: form.receiving_days, notes: form.notes || null, active: form.active,
          updated_at: new Date().toISOString(),
        }).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('factoring_config').insert({
          name: form.name, monthly_interest_rate: form.monthly_interest_rate,
          receiving_days: form.receiving_days, notes: form.notes || null, active: form.active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factoring_config'] });
      toast.success(editing ? 'Factoring atualizado!' : 'Factoring cadastrado!');
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // First unlink any sale orders referencing this factoring config
      const { error: unlinkErr } = await supabase
        .from('sale_orders')
        .update({ factoring_config_id: null } as any)
        .eq('factoring_config_id', id);
      if (unlinkErr) throw unlinkErr;

      const { error } = await supabase.from('factoring_config').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factoring_config'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      toast.success('Factoring excluído! Pedidos vinculados foram desassociados.');
    },
    onError: (e: Error) => toast.error(`Erro ao excluir factoring: ${e.message}`),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" /> Configurações de Factoring
          </CardTitle>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nova Factoring</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Taxa Mensal (%)</TableHead>
                <TableHead>Prazo Recebimento (dias)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Observações</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhuma configuração de factoring cadastrada
                  </TableCell>
                </TableRow>
              ) : configs.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono">{c.monthly_interest_rate}%</TableCell>
                  <TableCell className="font-mono">{c.receiving_days} dias</TableCell>
                  <TableCell>
                    <Badge variant={c.active ? 'default' : 'secondary'}>{c.active ? 'Ativo' : 'Inativo'}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">{c.notes || '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Editar factoring" onClick={() => openEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Excluir factoring"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Excluir factoring?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate(c.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Relatório por Factoring */}
      {configs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Relatório de Títulos por Factoring
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {configs.map(c => (
              <FactoringReport key={c.id} config={c} />
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar' : 'Nova'} Factoring</DialogTitle>
            <DialogDescription>Configure nome, taxa de juros mensal e prazo de recebimento.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Factoring Principal" />
            </div>
            <div>
              <Label>Taxa de Juros Mensal (%)</Label>
              <NumberInput value={form.monthly_interest_rate} onChange={n => setForm(f => ({ ...f, monthly_interest_rate: n }))} min={0} decimals={2} placeholder="0" />
            </div>
            <div>
              <Label>Prazo de Recebimento (dias)</Label>
              <NumberInput value={form.receiving_days} onChange={n => setForm(f => ({ ...f, receiving_days: n }))} min={1} decimals={0} placeholder="1" />
              <p className="text-xs text-muted-foreground mt-1">Quantos dias após a emissão o valor será recebido pela factoring</p>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
              <Label>Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
