import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Panel } from '@/components/ui/panel';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ClipboardText as ClipboardCheck, Plus, ArrowLeft, Scan as ScanLine, CircleNotch as Loader2, CheckCircle as CheckCircle2, Trash as Trash2, Warning as AlertTriangle, Play, X, CaretRight as ChevronRight } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

type PickingStatus = 'aberta' | 'em_separacao' | 'conferida' | 'divergencia' | 'concluida' | 'cancelada';

const STATUS_COLOR: Record<string, string> = {
  aberta: 'bg-blue-100 text-blue-700 border-blue-300',
  em_separacao: 'bg-amber-100 text-amber-700 border-amber-300',
  conferida: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  divergencia: 'bg-destructive/10 text-destructive border-destructive/30',
  concluida: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  cancelada: 'bg-muted text-muted-foreground border-border',
};

export default function Picking() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (selectedId) {
    return <PickingSession id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-4">
      <PickingList onOpen={setSelectedId} onCreate={() => setCreating(true)} />
      <NewSessionDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); setSelectedId(id); }}
      />
    </div>
  );
}

function PickingList({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['picking_sessions'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('picking_sessions')
        .select('*, sale_orders(order_number, client_name)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <>
      <EditorialPageHeader
        sectionLabel="LOGÍSTICA · SEPARAÇÃO"
        title="Picking · Separação"
        description="Sessões de separação com bipagem EAN. Selecione um pedido pra começar."
        actions={
          <Button onClick={onCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nova Sessão
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={ClipboardCheck}
            title="Nenhuma sessão de picking"
            description="Crie a primeira sessão de separação para começar a bipagem."
            action={<Button variant="outline" size="sm" onClick={onCreate}>Criar primeira sessão</Button>}
          />
        </Panel>
      ) : (
        <div className="space-y-2">
          {items.map((r: any) => {
            const progress = r.total_pairs > 0 ? Math.round((r.total_volumes / r.total_pairs) * 100) : 0;
            return (
              <Card key={r.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onOpen(r.id)}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs">{r.session_number}</span>
                      <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLOR[r.status]}`}>
                        {r.status.replace('_', ' ')}
                      </Badge>
                      <Badge variant="outline" className="text-xs capitalize">{r.picking_type}</Badge>
                      {r.sale_orders?.order_number && (
                        <span className="text-xs text-muted-foreground">
                          {r.sale_orders.order_number} · {r.sale_orders.client_name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.total_pairs} pares · {r.total_volumes} volumes · {r.total_weight_kg} kg
                      {r.started_at && ` · iniciada ${format(new Date(r.started_at), 'dd/MM HH:mm')}`}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function PickingSession({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();

  const { data: session } = useQuery({
    queryKey: ['picking_session', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('picking_sessions')
        .select('*, sale_orders(order_number, client_name)')
        .eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ['picking_items', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('picking_items')
        .select('*, products(name, code, ean), technical_sheets:reference_id(name, code)')
        .eq('picking_session_id', id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (newStatus: PickingStatus) => {
      const patch: any = { status: newStatus };
      if (newStatus === 'em_separacao' && !session?.started_at) {
        patch.started_at = new Date().toISOString();
      }
      if (newStatus === 'concluida') {
        patch.completed_at = new Date().toISOString();
      }
      const { error } = await (supabase as any).from('picking_sessions').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picking_session', id] });
      qc.invalidateQueries({ queryKey: ['picking_sessions'] });
      toast.success('Status atualizado.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!session) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const totalExpected = items.reduce((acc: number, it: any) => acc + Number(it.expected_qty), 0);
  const totalPicked = items.reduce((acc: number, it: any) => acc + Number(it.picked_qty), 0);
  const totalConferred = items.reduce((acc: number, it: any) => acc + Number(it.conferred_qty), 0);
  const pickProgress = totalExpected > 0 ? (totalPicked / totalExpected) * 100 : 0;
  const confProgress = totalPicked > 0 ? (totalConferred / totalPicked) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" /> {session.session_number}
              <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLOR[session.status]}`}>
                {session.status.replace('_', ' ')}
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground">
              {session.sale_orders?.order_number ? `${session.sale_orders.order_number} · ${session.sale_orders.client_name}` : 'Sem PV vinculado'}
              {session.started_at && ` · iniciada ${format(new Date(session.started_at), 'dd/MM HH:mm')}`}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {session.status === 'aberta' && (
            <Button size="sm" className="gap-1.5" onClick={() => updateStatus.mutate('em_separacao')}>
              <Play className="h-3.5 w-3.5" /> Iniciar separação
            </Button>
          )}
          {session.status === 'em_separacao' && (
            <Button size="sm" className="gap-1.5" onClick={() => updateStatus.mutate('conferida')}
              disabled={totalPicked < totalExpected}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Marcar conferida
            </Button>
          )}
          {session.status === 'conferida' && (
            <Button size="sm" className="gap-1.5" onClick={() => updateStatus.mutate('concluida')}
              disabled={totalConferred < totalPicked}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Finalizar
            </Button>
          )}
          {!['concluida','cancelada'].includes(session.status) && (
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => {
              if (!confirm('Cancelar essa sessão? Não pode reverter.')) return;
              updateStatus.mutate('cancelada');
            }}>
              <X className="h-3.5 w-3.5" /> Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-bold text-muted-foreground uppercase">Esperado</p>
            <p className="text-2xl font-bold">{totalExpected}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground uppercase">Separados</p>
              <span className="text-xs font-mono">{totalPicked}/{totalExpected}</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">{totalPicked}</p>
            <Progress value={pickProgress} className="h-1.5" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground uppercase">Conferidos</p>
              <span className="text-xs font-mono">{totalConferred}/{totalPicked}</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600">{totalConferred}</p>
            <Progress value={confProgress} className="h-1.5" />
          </CardContent>
        </Card>
      </div>

      {session.status === 'em_separacao' && (
        <ScannerBar sessionId={id} items={items} />
      )}

      <PickingItemsTable
        sessionId={id}
        items={items}
        sessionStatus={session.status}
      />
    </div>
  );
}

function ScannerBar({ sessionId, items }: { sessionId: string; items: any[] }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [lastMatch, setLastMatch] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const pickItem = useMutation({
    mutationFn: async (item: any) => {
      const newQty = Number(item.picked_qty) + 1;
      const { error } = await (supabase as any)
        .from('picking_items')
        .update({
          picked_qty: newQty,
          ean_scanned: code,
          picked_at: new Date().toISOString(),
          status: newQty >= Number(item.expected_qty) ? 'separado' : 'em_andamento',
        })
        .eq('id', item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picking_items', sessionId] });
    },
    onError: (e: Error) => {
      setLastMatch({ ok: false, msg: e.message });
      toast.error(e.message);
    },
  });

  const handleScan = async () => {
    const c = code.trim();
    if (!c) return;
    // Tenta achar item por EAN do produto OU por código de produto
    const matching = items.find((it: any) => {
      const ean = it.products?.ean;
      const codeStr = it.products?.code;
      return (ean && String(ean) === c) || (codeStr && String(codeStr) === c) || it.ean_scanned === c;
    });
    if (!matching) {
      setLastMatch({ ok: false, msg: `Código "${c}" não bate com nenhum item desta sessão.` });
      setCode('');
      inputRef.current?.focus();
      return;
    }
    if (Number(matching.picked_qty) >= Number(matching.expected_qty)) {
      setLastMatch({ ok: false, msg: `${matching.products?.name}: já tem ${matching.expected_qty} bipados (esperado).` });
      setCode('');
      inputRef.current?.focus();
      return;
    }
    await pickItem.mutateAsync(matching);
    setLastMatch({ ok: true, msg: `${matching.products?.name}: ${Number(matching.picked_qty) + 1}/${matching.expected_qty}` });
    setCode('');
    inputRef.current?.focus();
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-primary" />
          <Label className="text-sm font-medium flex-1">Bipar EAN / código</Label>
        </div>
        <Input
          ref={inputRef}
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleScan()}
          placeholder="Aproxime o leitor e bipe..."
          className="text-base font-mono h-11"
          autoFocus
        />
        {lastMatch && (
          <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
            lastMatch.ok
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-destructive/10 text-destructive'
          }`}>
            {lastMatch.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {lastMatch.msg}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PickingItemsTable({
  sessionId, items, sessionStatus,
}: {
  sessionId: string;
  items: any[];
  sessionStatus: string;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const editable = !['concluida', 'cancelada'].includes(sessionStatus);

  const updateField = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const { error } = await (supabase as any).from('picking_items').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picking_items', sessionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('picking_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picking_items', sessionId] });
      toast.success('Item removido.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <Panel
        eyebrow="LOGÍSTICA · SEPARAÇÃO"
        title={`Itens da separação (${items.length})`}
        actions={editable && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Adicionar item
          </Button>
        )}
        flush
      >
      {items.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nenhum item"
          description="Adicione o que precisa ser separado."
          size="sm"
        />
      ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <th className="text-left p-2">Produto</th>
                  <th className="text-left p-2">Cor / Tam</th>
                  <th className="text-left p-2">Bin</th>
                  <th className="text-right p-2">Esperado</th>
                  <th className="text-right p-2">Picked</th>
                  <th className="text-right p-2">Conferido</th>
                  <th className="text-left p-2">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it: any) => {
                  const ok = Number(it.picked_qty) >= Number(it.expected_qty);
                  return (
                    <tr key={it.id} className="border-b border-border/40">
                      <td className="p-2">
                        <p className="font-medium">{it.products?.name || it.technical_sheets?.name || '—'}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {it.products?.code || it.technical_sheets?.code || it.product_id?.slice(0, 8)}
                          {it.products?.ean && ` · EAN ${it.products.ean}`}
                        </p>
                      </td>
                      <td className="p-2">
                        {it.color && <span>{it.color}</span>}
                        {it.size && <span className="text-muted-foreground"> · {it.size}</span>}
                      </td>
                      <td className="p-2">
                        {editable ? (
                          <Input
                            defaultValue={it.bin_location ?? ''}
                            className="h-7 text-xs w-20"
                            onBlur={e => {
                              if (e.target.value !== (it.bin_location ?? '')) {
                                updateField.mutate({ id: it.id, patch: { bin_location: e.target.value } });
                              }
                            }}
                          />
                        ) : (it.bin_location || '—')}
                      </td>
                      <td className="p-2 text-right font-mono">{it.expected_qty}</td>
                      <td className="p-2 text-right">
                        {editable ? (
                          <Input
                            type="number" min={0} max={it.expected_qty * 2}
                            defaultValue={it.picked_qty}
                            className="h-7 text-xs w-16 text-right font-mono"
                            onBlur={e => {
                              const v = +e.target.value;
                              if (v !== Number(it.picked_qty)) {
                                updateField.mutate({
                                  id: it.id,
                                  patch: {
                                    picked_qty: v,
                                    picked_at: v > 0 ? new Date().toISOString() : null,
                                    status: v >= Number(it.expected_qty) ? 'separado' : (v > 0 ? 'em_andamento' : 'pendente'),
                                  },
                                });
                              }
                            }}
                          />
                        ) : (
                          <span className={`font-mono ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>{it.picked_qty}</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {editable ? (
                          <Input
                            type="number" min={0} max={it.picked_qty}
                            defaultValue={it.conferred_qty}
                            className="h-7 text-xs w-16 text-right font-mono"
                            onBlur={e => {
                              const v = +e.target.value;
                              if (v !== Number(it.conferred_qty)) {
                                updateField.mutate({
                                  id: it.id,
                                  patch: {
                                    conferred_qty: v,
                                    conferred_at: v > 0 ? new Date().toISOString() : null,
                                    status: v >= Number(it.picked_qty) && v > 0 ? 'conferido' : 'separado',
                                  },
                                });
                              }
                            }}
                          />
                        ) : (
                          <span className="font-mono">{it.conferred_qty}</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs capitalize">{it.status?.replace('_', ' ')}</Badge>
                      </td>
                      <td className="p-2 text-right">
                        {editable && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                            onClick={() => delItem.mutate(it.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      )}
      </Panel>

      <AddItemDialog
        sessionId={sessionId}
        open={adding}
        onClose={() => setAdding(false)}
      />
    </div>
  );
}

function AddItemDialog({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState('');
  const [expectedQty, setExpectedQty] = useState<number>(1);
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');

  const { data: products = [] } = useQuery({
    queryKey: ['products_for_picking'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('products').select('id, name, code, ean, unit').eq('active', true).order('name').limit(2000);
      return data || [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from('picking_items').insert({
        picking_session_id: sessionId,
        product_id: productId,
        expected_qty: expectedQty,
        color,
        size,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picking_items', sessionId] });
      setProductId(''); setExpectedQty(1); setColor(''); setSize('');
      toast.success('Item adicionado.');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Adicionar item à sessão</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Produto</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                {products.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} {p.code && `(${p.code})`} {p.ean && ` · EAN ${p.ean}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Cor</Label>
              <Input value={color} onChange={e => setColor(e.target.value)} />
            </div>
            <div>
              <Label>Tamanho</Label>
              <Input value={size} onChange={e => setSize(e.target.value)} />
            </div>
            <div>
              <Label>Qtd esperada</Label>
              <Input type="number" min={1} value={expectedQty} onChange={e => setExpectedQty(+e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => add.mutate()} disabled={!productId || expectedQty < 1 || add.isPending}>
            {add.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewSessionDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [pickingType, setPickingType] = useState('pedido');
  const [saleOrderId, setSaleOrderId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_picking'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('sale_orders')
        .select('id, order_number, client_name, status')
        // sale_orders canonical statuses (saleOrderStateMachine): só 'Em Produção'
        // é elegível pra picking. 'em_producao'/'Pronto'/'pronto' eram lixo legacy
        // que nunca casavam — removidos.
        .in('status', ['Em Produção', 'Aprovado'])
        .order('created_at', { ascending: false })
        .limit(200);
      return data || [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from('picking_sessions')
        .insert({
          picking_type: pickingType,
          sale_order_id: pickingType === 'pedido' ? saleOrderId : null,
          divergence_notes: notes,
          status: 'aberta',
        })
        .select('id').single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success('Sessão criada.');
      setPickingType('pedido'); setSaleOrderId(''); setNotes('');
      onCreated(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Nova Sessão de Picking</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Tipo de separação</Label>
            <Select value={pickingType} onValueChange={setPickingType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pedido">Por Pedido (PV)</SelectItem>
                <SelectItem value="onda">Por Onda</SelectItem>
                <SelectItem value="livre">Livre</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {pickingType === 'pedido' && (
            <div>
              <Label>Pedido de venda</Label>
              <Select value={saleOrderId} onValueChange={setSaleOrderId}>
                <SelectTrigger><SelectValue placeholder="Selecionar PV pronto..." /></SelectTrigger>
                <SelectContent>
                  {saleOrders.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.order_number} — {s.client_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()}
            disabled={create.isPending || (pickingType === 'pedido' && !saleOrderId)}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
