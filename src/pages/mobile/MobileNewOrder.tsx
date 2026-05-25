import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { enqueueOrder, saveDraft, loadDraft, deleteDraft } from '@/lib/mobile/offlineQueue';
import { useOnlineStatus } from '@/lib/mobile/networkStatus';
import { triggerSync } from '@/lib/mobile/syncEngine';
import type { SaleOrderItemFormData } from '@/hooks/useSaleOrders';

interface ClientLite {
  id: string;
  razao_social: string;
  nome_fantasia?: string | null;
  cnpj?: string | null;
  cidade?: string | null;
  estado?: string | null;
}

interface RefLite {
  id: string;
  name: string;
  shoe_category_id?: string | null;
}

interface VariantLite {
  reference_id: string;
  color: string;
  image_url?: string | null;
}

interface DraftItem {
  reference_id: string;
  reference_name: string;
  color: string;
  image_url?: string | null;
  grade: Record<string, number>;
  unit_price: number;
}

type Step = 'client' | 'items' | 'review';

// UUID gerado uma vez por draft, identificador único pro server dedup
const newRequestId = () => crypto.randomUUID();

const SIZE_RANGE_ADULT = ['33','34','35','36','37','38','39','40'];

export default function MobileNewOrder() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [step, setStep] = useState<Step>('client');
  const [requestId, setRequestId] = useState<string>(newRequestId());

  // Cliente
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientLite | null>(null);

  // Items
  const [refs, setRefs] = useState<RefLite[]>([]);
  const [variants, setVariants] = useState<VariantLite[]>([]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [refSearch, setRefSearch] = useState('');

  // ── Restore draft on mount ──
  useEffect(() => {
    (async () => {
      // Tenta restaurar o último rascunho não-finalizado (mais recente).
      // Simplificação: usamos uma chave fixa pra "draft em andamento".
      const draftId = localStorage.getItem('mobile-current-draft-id');
      if (draftId) {
        const data = await loadDraft(draftId);
        if (data) {
          setRequestId(draftId);
          setSelectedClient(data.client);
          setItems(data.items || []);
          if (data.client) setStep('items');
        }
      } else {
        localStorage.setItem('mobile-current-draft-id', requestId);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Autosave draft ──
  useEffect(() => {
    if (!selectedClient && items.length === 0) return;
    const t = setTimeout(() => {
      void saveDraft(requestId, { client: selectedClient, items });
    }, 500);
    return () => clearTimeout(t);
  }, [selectedClient, items, requestId]);

  // ── Carrega clientes ──
  useEffect(() => {
    if (step !== 'client') return;
    const t = setTimeout(async () => {
      let q = supabase
        .from('clients')
        .select('id, razao_social, nome_fantasia, cnpj, cidade, estado')
        .eq('ativo', true)
        .limit(40);
      if (clientSearch.length >= 2) {
        q = q.ilike('razao_social', `%${clientSearch}%`);
      }
      const { data } = await q;
      setClients(data ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [step, clientSearch]);

  // ── Carrega refs (preload no step de items) ──
  useEffect(() => {
    if (step !== 'items') return;
    (async () => {
      const { data } = await supabase
        .from('technical_sheets')
        .select('id, name, shoe_category_id')
        .order('name')
        .limit(100);
      setRefs(data ?? []);

      const refIds = (data ?? []).map(r => r.id);
      if (refIds.length > 0) {
        const { data: v } = await supabase
          .from('reference_color_variants')
          .select('reference_id, color, image_url')
          .in('reference_id', refIds);
        setVariants(v ?? []);
      }
    })();
  }, [step]);

  const filteredRefs = useMemo(() => {
    if (!refSearch) return refs;
    const s = refSearch.toLowerCase();
    return refs.filter(r => r.name?.toLowerCase().includes(s));
  }, [refs, refSearch]);

  const totalPairs = items.reduce(
    (s, it) => s + Object.values(it.grade).reduce((a, b) => a + (b || 0), 0),
    0,
  );
  const totalValue = items.reduce(
    (s, it) => s + Object.values(it.grade).reduce((a, b) => a + (b || 0), 0) * (it.unit_price || 0),
    0,
  );

  // ── Submit ──
  const handleSubmit = async () => {
    if (!selectedClient) {
      toast.error('Selecione um cliente');
      return;
    }
    if (items.length === 0 || totalPairs === 0) {
      toast.error('Adicione ao menos 1 item com quantidade');
      return;
    }

    const orderPayload: any = {
      client_request_id: requestId,
      client_id: selectedClient.id,
      client_name: selectedClient.razao_social,
      client_cnpj: selectedClient.cnpj || '',
      client_contact: '',
      client_order_number: '',
      representative: '',
      payment_condition: '',
      delivery_deadline: '',
      delivery_week: '',
      delivery_month: '',
      notes: '',
      status: 'Aprovado',
      nfe: '',
      remessa: '',
      is_factoring: false,
      factoring_config_id: null,
    };

    const itemsPayload: SaleOrderItemFormData[] = items.map(it => {
      const qty = Object.values(it.grade).reduce((a, b) => a + (b || 0), 0);
      return {
        reference_id: it.reference_id,
        reference_name: it.reference_name,
        color: it.color,
        quantity: qty,
        grade: it.grade,
        unit_price: it.unit_price,
        observation: '',
      } as SaleOrderItemFormData;
    });

    // Se online, tenta enviar direto. Senão (ou se falhar), enfileira.
    let sent = false;
    if (online) {
      try {
        const { data: created, error } = await supabase
          .from('sale_orders')
          .insert(orderPayload)
          .select()
          .single();
        if (!error && created?.id) {
          const itemsToInsert = itemsPayload.map(i => ({ ...i, sale_order_id: created.id }));
          await supabase.from('sale_order_items').insert(itemsToInsert);
          sent = true;
          toast.success(`PV ${created.order_number || ''} enviado!`);
        }
      } catch (e) {
        // Fall through to enqueue
      }
    }

    if (!sent) {
      await enqueueOrder({
        order: orderPayload,
        items: itemsPayload,
        client_id: selectedClient.id,
      });
      toast.success(`Pedido salvo (${online ? 'tentando reenviar' : 'modo offline'})`);
      if (online) void triggerSync();
    }

    // Limpa rascunho local
    await deleteDraft(requestId);
    localStorage.removeItem('mobile-current-draft-id');
    navigate('/m');
  };

  // ── Renderização por step ──
  if (step === 'client') {
    return (
      <div className="p-4 space-y-3">
        <h2 className="text-xl font-bold">1 · Cliente</h2>
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            type="search"
            value={clientSearch}
            onChange={e => setClientSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="w-full pl-10 pr-4 py-3 text-base border-[1.5px] border-foreground/15 rounded-lg bg-card focus:border-foreground focus:outline-none"
            autoFocus
          />
        </div>
        <ul className="divide-y divide-border">
          {clients.map(c => (
            <li key={c.id}>
              <button
                onClick={() => { setSelectedClient(c); setStep('items'); }}
                className="w-full text-left p-3 active:bg-muted/40 transition-colors"
              >
                <p className="font-bold text-foreground">{c.nome_fantasia || c.razao_social}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {c.cidade || '—'}{c.estado ? `/${c.estado}` : ''} · {c.cnpj || 'sem CNPJ'}
                </p>
              </button>
            </li>
          ))}
          {clients.length === 0 && (
            <li className="p-6 text-center text-muted-foreground text-sm">
              Nenhum cliente encontrado. Digite ao menos 2 letras.
            </li>
          )}
        </ul>
      </div>
    );
  }

  if (step === 'items') {
    return (
      <div className="p-4 space-y-3 pb-32">
        <div className="flex items-center justify-between">
          <button onClick={() => setStep('client')} className="flex items-center gap-1 text-muted-foreground">
            <ArrowLeft className="h-5 w-5" />
            <span className="text-sm">Cliente</span>
          </button>
          <button
            onClick={() => setStep('review')}
            disabled={items.length === 0}
            className="text-primary font-bold disabled:text-muted-foreground"
          >
            Revisar →
          </button>
        </div>

        <div className="bg-muted/40 rounded-lg p-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Cliente</p>
          <p className="font-bold text-sm">{selectedClient?.razao_social}</p>
        </div>

        <h2 className="text-xl font-bold">2 · Itens</h2>

        {/* Items atuais */}
        {items.map((it, idx) => {
          const itemTotal = Object.values(it.grade).reduce((a, b) => a + (b || 0), 0);
          return (
            <div key={idx} className="border-[1.5px] border-foreground/15 rounded-lg p-3 bg-card">
              <div className="flex items-start gap-3">
                {it.image_url ? (
                  <img src={it.image_url} alt={it.reference_name} className="h-14 w-14 object-cover rounded" />
                ) : (
                  <div className="h-14 w-14 bg-muted rounded" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{it.reference_name}</p>
                  <p className="text-xs text-muted-foreground uppercase">{it.color}</p>
                  <p className="text-sm font-mono mt-1">{itemTotal} pares · R$ {(itemTotal * it.unit_price).toFixed(2)}</p>
                </div>
                <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-destructive">
                  <Trash className="h-5 w-5" />
                </button>
              </div>
              <details className="mt-2">
                <summary className="text-xs text-primary cursor-pointer">Editar grade</summary>
                <GradeEditor
                  grade={it.grade}
                  onChange={g => setItems(items.map((x, i) => i === idx ? { ...x, grade: g } : x))}
                />
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">Preço/par:</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={it.unit_price}
                    onChange={e => setItems(items.map((x, i) => i === idx ? { ...x, unit_price: Number(e.target.value) || 0 } : x))}
                    className="w-24 px-2 py-1 text-sm border rounded font-mono"
                  />
                </div>
              </details>
            </div>
          );
        })}

        {/* Adicionar novo item */}
        <details className="border-[1.5px] border-dashed border-foreground/20 rounded-lg p-3" open={items.length === 0}>
          <summary className="font-bold text-sm cursor-pointer">+ Adicionar referência</summary>
          <input
            type="search"
            value={refSearch}
            onChange={e => setRefSearch(e.target.value)}
            placeholder="Buscar referência..."
            className="w-full mt-2 px-3 py-2 text-sm border rounded"
          />
          <div className="grid grid-cols-2 gap-2 mt-2 max-h-64 overflow-y-auto">
            {filteredRefs.slice(0, 30).map(r => {
              const refVariants = variants.filter(v => v.reference_id === r.id);
              return (
                <div key={r.id} className="border rounded p-2">
                  <p className="text-xs font-bold truncate">{r.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {refVariants.length === 0 ? (
                      <button
                        onClick={() => {
                          setItems([...items, {
                            reference_id: r.id,
                            reference_name: r.name,
                            color: '',
                            grade: {},
                            unit_price: 0,
                          }]);
                          setRefSearch('');
                        }}
                        className="text-xs px-2 py-1 bg-muted rounded"
                      >+ sem cor</button>
                    ) : refVariants.slice(0, 4).map(v => (
                      <button
                        key={v.color}
                        onClick={() => {
                          setItems([...items, {
                            reference_id: r.id,
                            reference_name: r.name,
                            color: v.color,
                            image_url: v.image_url || undefined,
                            grade: {},
                            unit_price: 0,
                          }]);
                          setRefSearch('');
                        }}
                        className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded uppercase"
                      >{v.color}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </div>
    );
  }

  // Review step
  return (
    <div className="p-4 space-y-3 pb-32">
      <div className="flex items-center justify-between">
        <button onClick={() => setStep('items')} className="flex items-center gap-1 text-muted-foreground">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm">Itens</span>
        </button>
        <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">3 · Revisão</span>
      </div>

      <h2 className="text-xl font-bold">Confirmar pedido</h2>

      <div className="bg-muted/40 rounded-lg p-3">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Cliente</p>
        <p className="font-bold">{selectedClient?.razao_social}</p>
        <p className="text-xs text-muted-foreground">{selectedClient?.cnpj}</p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Itens ({items.length})</p>
        <ul className="divide-y divide-border border rounded-lg">
          {items.map((it, idx) => {
            const qty = Object.values(it.grade).reduce((a, b) => a + (b || 0), 0);
            return (
              <li key={idx} className="p-3 flex items-center gap-3">
                {it.image_url && <img src={it.image_url} alt="" className="h-10 w-10 object-cover rounded" />}
                <div className="flex-1">
                  <p className="text-sm font-bold">{it.reference_name}</p>
                  <p className="text-xs text-muted-foreground">{it.color} · {qty} pares</p>
                </div>
                <span className="font-mono text-sm">R$ {(qty * it.unit_price).toFixed(2)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t-2 border-foreground pt-3 flex items-baseline justify-between">
        <span className="text-sm uppercase tracking-widest text-muted-foreground font-mono">Total</span>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums">R$ {totalValue.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">{totalPairs} pares</p>
        </div>
      </div>

      {!online && (
        <div className="border border-amber-500 bg-amber-50 text-amber-900 rounded-lg p-3 text-sm">
          ⚠ Você está offline. O pedido vai pra fila e será enviado quando a rede voltar.
        </div>
      )}

      <button
        onClick={handleSubmit}
        className="w-full bg-primary text-primary-foreground rounded-lg py-4 font-bold uppercase tracking-wide active:opacity-80 flex items-center justify-center gap-2"
      >
        <Check className="h-5 w-5" weight="bold" />
        {online ? 'Enviar pedido' : 'Salvar offline'}
      </button>
    </div>
  );
}

// ── Helper: editor de grade ─────────────────────────────────────────────────

function GradeEditor({ grade, onChange }: { grade: Record<string, number>; onChange: (g: Record<string, number>) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 mt-2">
      {SIZE_RANGE_ADULT.map(sz => (
        <div key={sz} className="border rounded p-1 text-center">
          <p className="text-[10px] font-mono uppercase">{sz}</p>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={grade[sz] || ''}
            onChange={e => onChange({ ...grade, [sz]: Number(e.target.value) || 0 })}
            className="w-full text-center text-sm font-mono py-1"
          />
        </div>
      ))}
    </div>
  );
}
