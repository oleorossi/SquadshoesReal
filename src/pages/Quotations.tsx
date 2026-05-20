import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileXls as FileSpreadsheet, Plus, Trash as Trash2, CircleNotch as Loader2, CaretRight as ChevronRight, Trophy, Package, Users, ArrowLeft, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { format } from 'date-fns';
import { toast } from 'sonner';

type QuotationStatus = 'aberta' | 'enviada' | 'recebida' | 'analisada' | 'aprovada' | 'cancelada' | 'expirada';

const STATUS_COLOR: Record<string, string> = {
  aberta: 'bg-blue-100 text-blue-700 border-blue-300',
  enviada: 'bg-amber-100 text-amber-700 border-amber-300',
  recebida: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  analisada: 'bg-purple-100 text-purple-700 border-purple-300',
  aprovada: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  cancelada: 'bg-muted text-muted-foreground border-border',
  expirada: 'bg-destructive/10 text-destructive border-destructive/30',
};

export default function Quotations() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (selectedId) {
    return <QuotationDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-4">
      <QuotationsList
        onOpen={setSelectedId}
        onCreate={() => setCreating(true)}
      />
      <NewQuotationDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); setSelectedId(id); }}
      />
    </div>
  );
}

function QuotationsList({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['purchase_quotations'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_quotations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <>
      <EditorialPageHeader
        sectionLabel="COMERCIAL · COTAÇÕES"
        title="Cotações (RFQ)"
        description="Cotação multifornecedor — registre itens, respostas e escolha o vencedor."
        actions={
          <Button onClick={onCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nova Cotação
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={FileSpreadsheet}
            title="Nenhuma cotação criada"
            description="Crie uma RFQ para cotar materiais com múltiplos fornecedores."
            action={<Button variant="outline" size="sm" onClick={onCreate}>Criar primeira RFQ</Button>}
          />
        </Panel>
      ) : (
        <div className="space-y-2">
          {items.map((r: any) => (
            <Card key={r.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onOpen(r.id)}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-xs">{r.quotation_number}</span>
                    <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLOR[r.status]}`}>
                      {r.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.created_at), 'dd/MM/yy HH:mm')}
                      {r.deadline && ` · prazo ${format(new Date(r.deadline), 'dd/MM')}`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{r.notes || '—'}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function QuotationDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();

  const { data: q } = useQuery({
    queryKey: ['purchase_quotation', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_quotations')
        .select('*, suppliers:selected_supplier_id(name)')
        .eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ['purchase_quotation_items', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_quotation_items')
        .select('*, products(name, unit)')
        .eq('quotation_id', id);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: responses = [] } = useQuery({
    queryKey: ['purchase_quotation_responses', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_quotation_responses')
        .select('*, suppliers(name)')
        .eq('quotation_id', id);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: prices = [] } = useQuery({
    queryKey: ['purchase_quotation_prices_all', id],
    queryFn: async () => {
      const ids = responses.map((r: any) => r.id);
      if (ids.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('purchase_quotation_prices')
        .select('*')
        .in('response_id', ids);
      if (error) throw error;
      return data || [];
    },
    enabled: responses.length > 0,
  });

  const pricesByCell = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of prices) {
      map.set(`${p.response_id}:${p.quotation_item_id}`, p);
    }
    return map;
  }, [prices]);

  const totalsByResponse = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      for (const r of responses) {
        const p = pricesByCell.get(`${r.id}:${it.id}`);
        if (!p) continue;
        const lineTotal = Number(p.unit_price) * Number(it.quantity) * (1 - Number(p.discount_pct ?? 0) / 100);
        m.set(r.id, (m.get(r.id) ?? 0) + lineTotal);
      }
    }
    for (const r of responses) {
      const base = m.get(r.id) ?? 0;
      m.set(r.id, base + Number(r.freight_value ?? 0));
    }
    return m;
  }, [items, responses, pricesByCell]);

  const setWinner = useMutation({
    mutationFn: async (response: any) => {
      // Marca apenas este response como winner
      const { error: e1 } = await (supabase as any)
        .from('purchase_quotation_responses')
        .update({ is_winner: false }).eq('quotation_id', id);
      if (e1) throw e1;
      const { error: e2 } = await (supabase as any)
        .from('purchase_quotation_responses')
        .update({ is_winner: true }).eq('id', response.id);
      if (e2) throw e2;
      const { error: e3 } = await (supabase as any)
        .from('purchase_quotations')
        .update({
          selected_supplier_id: response.supplier_id,
          status: 'aprovada',
          decision_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (e3) throw e3;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_quotation', id] });
      qc.invalidateQueries({ queryKey: ['purchase_quotation_responses', id] });
      qc.invalidateQueries({ queryKey: ['purchase_quotations'] });
      toast.success('Fornecedor vencedor definido.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!q) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" /> {q.quotation_number}
              <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLOR[q.status]}`}>{q.status}</Badge>
            </h1>
            <p className="text-xs text-muted-foreground">
              Solicitada em {format(new Date(q.created_at), 'dd/MM/yyyy HH:mm')}
              {q.deadline && ` · prazo ${format(new Date(q.deadline), 'dd/MM/yyyy')}`}
              {q.suppliers?.name && ` · 🏆 ${q.suppliers.name}`}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items" className="gap-1.5"><Package className="h-3.5 w-3.5" /> Itens ({items.length})</TabsTrigger>
          <TabsTrigger value="responses" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Respostas ({responses.length})</TabsTrigger>
          <TabsTrigger value="comparison">Comparativo</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-4">
          <ItemsTab quotationId={id} items={items} disabled={q.status === 'aprovada'} />
        </TabsContent>

        <TabsContent value="responses" className="mt-4">
          <ResponsesTab quotationId={id} responses={responses} items={items} pricesByCell={pricesByCell} disabled={q.status === 'aprovada'} />
        </TabsContent>

        <TabsContent value="comparison" className="mt-4">
          <Panel title="Comparativo de fornecedores" subtitle="Preços, frete e total por resposta" bodyClassName="overflow-x-auto">
              {responses.length === 0 || items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Cadastre itens e respostas para gerar o comparativo.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <th className="text-left p-2">Produto</th>
                      <th className="text-right p-2">Qtd</th>
                      {responses.map((r: any) => (
                        <th key={r.id} className="text-right p-2 min-w-[120px]">{r.suppliers?.name || '—'}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it: any) => (
                      <tr key={it.id} className="border-b border-border/40">
                        <td className="p-2">{it.products?.name || it.product_id}</td>
                        <td className="p-2 text-right font-mono">{it.quantity} {it.unit}</td>
                        {responses.map((r: any) => {
                          const p = pricesByCell.get(`${r.id}:${it.id}`);
                          if (!p) return <td key={r.id} className="p-2 text-right text-muted-foreground">—</td>;
                          const line = Number(p.unit_price) * Number(it.quantity) * (1 - Number(p.discount_pct ?? 0) / 100);
                          return (
                            <td key={r.id} className="p-2 text-right font-mono">
                              R$ {Number(p.unit_price).toFixed(2)} / un
                              <br/>
                              <span className="text-xs text-muted-foreground">total R$ {line.toFixed(2)}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="border-t-2 font-bold">
                      <td className="p-2">Frete</td>
                      <td />
                      {responses.map((r: any) => (
                        <td key={r.id} className="p-2 text-right font-mono">R$ {Number(r.freight_value ?? 0).toFixed(2)}</td>
                      ))}
                    </tr>
                    <tr className="bg-muted/50 font-bold">
                      <td className="p-2">TOTAL</td>
                      <td />
                      {responses.map((r: any) => {
                        const total = totalsByResponse.get(r.id) ?? 0;
                        const minTotal = Math.min(...Array.from(totalsByResponse.values()));
                        const isWinner = total === minTotal && total > 0;
                        return (
                          <td key={r.id} className={`p-2 text-right ${isWinner ? 'text-emerald-600' : ''}`}>
                            R$ {total.toFixed(2)} {isWinner && '🏆'}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td />
                      <td />
                      {responses.map((r: any) => (
                        <td key={r.id} className="p-2 text-right">
                          {q.status !== 'aprovada' && (
                            <Button
                              size="sm" variant={r.is_winner ? 'default' : 'outline'}
                              className="h-7 text-xs gap-1"
                              onClick={() => setWinner.mutate(r)}
                            >
                              <Trophy className="h-3.5 w-3.5" /> {r.is_winner ? 'Vencedor' : 'Escolher'}
                            </Button>
                          )}
                          {r.is_winner && q.status === 'aprovada' && (
                            <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Vencedor</Badge>
                          )}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ItemsTab({ quotationId, items, disabled }: { quotationId: string; items: any[]; disabled: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [unit, setUnit] = useState('un');

  const { data: products = [] } = useQuery({
    queryKey: ['products_for_quotation'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('products').select('id, name, unit').eq('active', true).order('name').limit(2000);
      return data || [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from('purchase_quotation_items').insert({
        quotation_id: quotationId,
        product_id: productId,
        quantity,
        unit,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_quotation_items', quotationId] });
      setProductId(''); setQuantity(1); setUnit('un'); setAdding(false);
      toast.success('Item adicionado.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await (supabase as any).from('purchase_quotation_items').delete().eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_quotation_items', quotationId] });
      toast.success('Removido.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhum item — adicione o que vai cotar.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it: any) => (
            <Card key={it.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-medium text-sm">{it.products?.name || it.product_id}</p>
                  <p className="text-xs text-muted-foreground font-mono">{it.quantity} {it.unit}</p>
                </div>
                {!disabled && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate(it.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!disabled && (
        adding ? (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div>
                <Label>Produto</Label>
                <Select value={productId} onValueChange={(v) => {
                  setProductId(v);
                  const p = products.find((p: any) => p.id === v);
                  if (p?.unit) setUnit(p.unit);
                }}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Quantidade</Label>
                  <Input type="number" step="0.01" min={0.01} value={quantity} onChange={e => setQuantity(+e.target.value)} />
                </div>
                <div>
                  <Label>Unidade</Label>
                  <Input value={unit} onChange={e => setUnit(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setAdding(false)} className="flex-1">Cancelar</Button>
                <Button onClick={() => add.mutate()} disabled={!productId || quantity <= 0 || add.isPending} className="flex-1">
                  Adicionar
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)} className="w-full gap-1.5">
            <Plus className="h-4 w-4" /> Adicionar item
          </Button>
        )
      )}
    </div>
  );
}

function ResponsesTab({
  quotationId, responses, items, pricesByCell, disabled,
}: {
  quotationId: string;
  responses: any[];
  items: any[];
  pricesByCell: Map<string, any>;
  disabled: boolean;
}) {
  const qc = useQueryClient();
  const [addingSupplierId, setAddingSupplierId] = useState('');
  const [editingResponseId, setEditingResponseId] = useState<string | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers_for_quotation'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('suppliers').select('id, name, active').eq('active', true).order('name').limit(500);
      return data || [];
    },
  });

  const addResponse = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from('purchase_quotation_responses').insert({
        quotation_id: quotationId,
        supplier_id: addingSupplierId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_quotation_responses', quotationId] });
      setAddingSupplierId('');
      toast.success('Fornecedor adicionado.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delResponse = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('purchase_quotation_responses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_quotation_responses', quotationId] });
      qc.invalidateQueries({ queryKey: ['purchase_quotation_prices_all', quotationId] });
      toast.success('Removido.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {responses.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhuma resposta — adicione os fornecedores que receberam a RFQ.</p>
      ) : (
        <div className="space-y-2">
          {responses.map((r: any) => (
            <Card key={r.id} className={r.is_winner ? 'border-emerald-500/40 bg-emerald-500/5' : ''}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm flex items-center gap-2">
                      {r.suppliers?.name || '—'}
                      {r.is_winner && <Trophy className="h-4 w-4 text-emerald-600" />}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Contactado {format(new Date(r.contacted_at), 'dd/MM')}
                      {r.responded_at && ` · respondeu ${format(new Date(r.responded_at), 'dd/MM')}`}
                      {r.delivery_days && ` · ${r.delivery_days}d prazo`}
                      {r.payment_terms && ` · ${r.payment_terms}`}
                      {r.freight_type && ` · ${r.freight_type.toUpperCase()}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditingResponseId(r.id)}>Preços / Termos</Button>
                    {!disabled && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => delResponse.mutate(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="flex gap-2">
          <Select value={addingSupplierId} onValueChange={setAddingSupplierId}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Selecionar fornecedor..." /></SelectTrigger>
            <SelectContent>
              {suppliers
                .filter((s: any) => !responses.some((r: any) => r.supplier_id === s.id))
                .map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
              }
            </SelectContent>
          </Select>
          <Button onClick={() => addResponse.mutate()} disabled={!addingSupplierId || addResponse.isPending} className="gap-1.5">
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
      )}

      <ResponseEditDialog
        responseId={editingResponseId}
        items={items}
        pricesByCell={pricesByCell}
        onClose={() => setEditingResponseId(null)}
      />
    </div>
  );
}

function ResponseEditDialog({
  responseId, items, pricesByCell, onClose,
}: {
  responseId: string | null;
  items: any[];
  pricesByCell: Map<string, any>;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const { data: response } = useQuery({
    queryKey: ['purchase_quotation_response', responseId],
    enabled: !!responseId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('purchase_quotation_responses')
        .select('*, suppliers(name)')
        .eq('id', responseId).single();
      return data;
    },
  });

  const [editForm, setEditForm] = useState<any>({});
  const [pricesEdit, setPricesEdit] = useState<Record<string, { unit_price: number; discount_pct: number }>>({});

  // Reset form when dialog opens
  useMemo(() => {
    if (response) {
      setEditForm({
        delivery_days: response.delivery_days ?? '',
        payment_terms: response.payment_terms ?? '',
        freight_value: response.freight_value ?? 0,
        freight_type: response.freight_type ?? 'cif',
        validity_days: response.validity_days ?? 30,
        notes: response.notes ?? '',
        responded: !!response.responded_at,
      });
      const initial: Record<string, { unit_price: number; discount_pct: number }> = {};
      for (const it of items) {
        const p = pricesByCell.get(`${response.id}:${it.id}`);
        initial[it.id] = {
          unit_price: p?.unit_price ?? 0,
          discount_pct: p?.discount_pct ?? 0,
        };
      }
      setPricesEdit(initial);
    }
  }, [response, items, pricesByCell]);

  const save = useMutation({
    mutationFn: async () => {
      if (!response) return;
      // 1) Update response
      const { error: e1 } = await (supabase as any)
        .from('purchase_quotation_responses')
        .update({
          delivery_days: editForm.delivery_days || null,
          payment_terms: editForm.payment_terms,
          freight_value: editForm.freight_value,
          freight_type: editForm.freight_type,
          validity_days: editForm.validity_days,
          notes: editForm.notes,
          responded_at: editForm.responded ? new Date().toISOString() : null,
        })
        .eq('id', response.id);
      if (e1) throw e1;

      // 2) Upsert prices per item
      for (const it of items) {
        const cellKey = `${response.id}:${it.id}`;
        const existing = pricesByCell.get(cellKey);
        const newPrice = pricesEdit[it.id];
        if (!newPrice || newPrice.unit_price <= 0) {
          if (existing) {
            await (supabase as any).from('purchase_quotation_prices').delete().eq('id', existing.id);
          }
          continue;
        }
        if (existing) {
          await (supabase as any)
            .from('purchase_quotation_prices')
            .update({ unit_price: newPrice.unit_price, discount_pct: newPrice.discount_pct })
            .eq('id', existing.id);
        } else {
          await (supabase as any).from('purchase_quotation_prices').insert({
            response_id: response.id,
            quotation_item_id: it.id,
            unit_price: newPrice.unit_price,
            discount_pct: newPrice.discount_pct,
          });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_quotation_responses'] });
      qc.invalidateQueries({ queryKey: ['purchase_quotation_prices_all'] });
      toast.success('Resposta atualizada.');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!responseId} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{response?.suppliers?.name ?? 'Editar resposta'}</DialogTitle>
        </DialogHeader>

        {!response ? (
          <p className="text-sm text-muted-foreground py-4">Carregando…</p>
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Prazo de entrega (dias)</Label>
                <Input type="number" min={0} value={editForm.delivery_days ?? ''}
                  onChange={e => setEditForm({ ...editForm, delivery_days: e.target.value })} />
              </div>
              <div>
                <Label>Validade (dias)</Label>
                <Input type="number" min={0} value={editForm.validity_days ?? ''}
                  onChange={e => setEditForm({ ...editForm, validity_days: +e.target.value })} />
              </div>
              <div>
                <Label>Condição de pagamento</Label>
                <Input value={editForm.payment_terms ?? ''}
                  onChange={e => setEditForm({ ...editForm, payment_terms: e.target.value })}
                  placeholder="30/60/90" />
              </div>
              <div>
                <Label>Frete</Label>
                <Input type="number" step="0.01" min={0} value={editForm.freight_value ?? 0}
                  onChange={e => setEditForm({ ...editForm, freight_value: +e.target.value })} />
              </div>
              <div>
                <Label>Tipo frete</Label>
                <Select value={editForm.freight_type ?? 'cif'} onValueChange={v => setEditForm({ ...editForm, freight_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cif">CIF</SelectItem>
                    <SelectItem value="fob">FOB</SelectItem>
                    <SelectItem value="terceiros">Terceiros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  variant={editForm.responded ? 'default' : 'outline'}
                  className="w-full"
                  onClick={() => setEditForm({ ...editForm, responded: !editForm.responded })}
                >
                  {editForm.responded ? '✓ Respondeu' : 'Marcar como respondida'}
                </Button>
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea value={editForm.notes ?? ''} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={2} />
            </div>

            <div>
              <Label className="mb-2 block">Preços por item</Label>
              <div className="space-y-2">
                {items.map((it: any) => (
                  <div key={it.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                    <div className="col-span-5 truncate">{it.products?.name || it.product_id}</div>
                    <div className="col-span-2 font-mono text-xs text-right">{it.quantity} {it.unit}</div>
                    <div className="col-span-3">
                      <Input
                        type="number" step="0.01" min={0}
                        placeholder="Preço unit."
                        value={pricesEdit[it.id]?.unit_price ?? ''}
                        onChange={e => setPricesEdit(prev => ({
                          ...prev,
                          [it.id]: { ...(prev[it.id] ?? { unit_price: 0, discount_pct: 0 }), unit_price: +e.target.value },
                        }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number" step="0.01" min={0} max={100}
                        placeholder="% desc"
                        value={pricesEdit[it.id]?.discount_pct ?? ''}
                        onChange={e => setPricesEdit(prev => ({
                          ...prev,
                          [it.id]: { ...(prev[it.id] ?? { unit_price: 0, discount_pct: 0 }), discount_pct: +e.target.value },
                        }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewQuotationDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [deadline, setDeadline] = useState('');
  const [notes, setNotes] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_quotations')
        .insert({
          status: 'aberta',
          deadline: deadline || null,
          notes,
        })
        .select('id').single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success('Cotação criada.');
      setDeadline(''); setNotes('');
      onCreated(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Nova Cotação
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Prazo de resposta (opcional)</Label>
            <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Contexto da cotação, política comercial, etc." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
