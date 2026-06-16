import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, MagnifyingGlass, Trash, WhatsappLogo, Share, ChartBar, Clock } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { enqueueOrder, saveDraft, loadDraft, deleteDraft } from '@/lib/mobile/offlineQueue';
import { useOnlineStatus } from '@/lib/mobile/networkStatus';
import { triggerSync } from '@/lib/mobile/syncEngine';
import { fetchClientPriceList, fetchClientHistory, resolvePrice, type PriceLookup, type ClientHistory } from '@/lib/mobile/clientContext';
import { normalizeForSearch } from '@/lib/searchUtils';
import { SignatureCanvas } from '@/components/mobile/SignatureCanvas';
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
  // F3: contexto do cliente — tabela de preço + histórico
  const [priceLookup, setPriceLookup] = useState<PriceLookup>({ byRefColor: new Map(), byRef: new Map() });
  const [clientHistory, setClientHistory] = useState<ClientHistory | null>(null);

  // Items
  const [refs, setRefs] = useState<RefLite[]>([]);
  const [variants, setVariants] = useState<VariantLite[]>([]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [refSearch, setRefSearch] = useState('');

  // F3: assinatura do cliente
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showSignature, setShowSignature] = useState(false);
  // F3: PV criado pra share via WhatsApp pós-submit
  const [createdPvNumber, setCreatedPvNumber] = useState<string | null>(null);

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

  // ── F3: ao selecionar cliente, carrega price list + histórico ──
  useEffect(() => {
    if (!selectedClient?.id) {
      setPriceLookup({ byRefColor: new Map(), byRef: new Map() });
      setClientHistory(null);
      return;
    }
    void fetchClientPriceList(selectedClient.id).then(setPriceLookup).catch(() => {});
    void fetchClientHistory(selectedClient.id).then(setClientHistory).catch(() => {});
  }, [selectedClient?.id]);

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
        .eq('active', true)
        .limit(40);
      if (clientSearch.length >= 2) {
        // search_norm (banco) ignora acento/caixa/espaço — "tamara" casa "TÂMARA".
        q = q.ilike('search_norm', `%${normalizeForSearch(clientSearch)}%`);
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

    // Strings vazias em colunas date/numeric quebram o PostgREST com
    // "invalid input syntax" (auditoria 24/05/2026). Campos opcionais
    // vão como null quando vazios.
    const orderPayload: any = {
      client_request_id: requestId,
      client_id: selectedClient.id,
      client_name: selectedClient.razao_social,
      client_cnpj: selectedClient.cnpj || '',
      client_contact: '',
      client_order_number: '',
      representative: '',
      payment_condition: '',
      delivery_deadline: null, // date — null OK
      delivery_week: '',
      delivery_month: '',
      notes: '',
      status: 'Aprovado',
      nfe: '',
      remessa: '',
      is_factoring: false,
      factoring_config_id: null,
      // F3 (24/05/2026): assinatura digital opcional
      client_signature_data_url: signatureDataUrl,
      client_signature_at: signatureDataUrl ? new Date().toISOString() : null,
    };

    // sale_order_items NÃO tem coluna reference_name (auditoria 24/05/2026
    // mostrou HTTP 400 "column does not exist"). Nome vem via JOIN com
    // technical_sheets quando exibido.
    const itemsPayload: any[] = items.map(it => {
      const qty = Object.values(it.grade).reduce((a, b) => a + (b || 0), 0);
      return {
        reference_id: it.reference_id,
        color: it.color,
        quantity: qty,
        grade: it.grade,
        unit_price: it.unit_price,
        observation: '',
      };
    });

    // Se online, tenta enviar direto. Senão (ou se falhar), enfileira.
    // Bug fix 24/05/2026: incluir `total` calculado no payload — sem isso,
    // sale_orders gravava total=0 (campo é populated client-side, não
    // tem default no schema).
    orderPayload.total = totalValue;

    let sent = false;
    let pvNumberLocal: string | null = null;
    if (online) {
      try {
        const { data: created, error } = await supabase
          .from('sale_orders')
          .insert(orderPayload)
          .select()
          .single();
        if (!error && created?.id) {
          const itemsToInsert = itemsPayload.map(i => ({ ...i, sale_order_id: created.id }));
          const { error: itemsError } = await supabase.from('sale_order_items').insert(itemsToInsert);
          if (itemsError) {
            // C4 (auditoria): itens falharam — remove o header órfão e cai pro enqueue
            // (header+itens juntos), SEM marcar sent nem apagar o rascunho. Evita PV
            // sem itens + perda silenciosa de dados (e o trap do client_request_id UNIQUE).
            await supabase.from('sale_orders').delete().eq('id', created.id);
            throw itemsError;
          }
          sent = true;
          pvNumberLocal = created.order_number || null;
          setCreatedPvNumber(pvNumberLocal);
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
    // F3: se PV foi criado direto (online), mostra tela de sucesso com
    // share antes de voltar pra home. Offline volta direto pra home.
    // NOTA: usa `pvNumberLocal` (variável local) em vez de `createdPvNumber`
    // state — setState é async e o closure leria valor antigo (null).
    if (sent && pvNumberLocal !== null) {
      setStep('success' as any);
    } else {
      navigate('/m');
    }
  };

  // F3: gera link WhatsApp pré-preenchido com PV details
  const shareWhatsApp = () => {
    if (!selectedClient) return;
    const pv = createdPvNumber || requestId.slice(0, 8);
    const itemsLines = items.map(it => {
      const qty = Object.values(it.grade).reduce((a, b) => a + (b || 0), 0);
      return `· ${it.reference_name} ${it.color} · ${qty} pares · R$ ${(qty * it.unit_price).toFixed(2)}`;
    }).join('\n');
    const text = encodeURIComponent(
      `Pedido ${pv} — ${selectedClient.razao_social}\n\n${itemsLines}\n\nTotal: R$ ${totalValue.toFixed(2)} (${totalPairs} pares)`,
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
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
                  <p className="text-sm font-mono mt-1">
                    {itemTotal} pares · R$ {(itemTotal * it.unit_price).toFixed(2)}
                  </p>
                  {it.unit_price > 0 && (
                    <p className="text-[10px] text-emerald-700 font-mono mt-0.5">
                      R$ {it.unit_price.toFixed(2)}/par (tabela)
                    </p>
                  )}
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
                            unit_price: resolvePrice(priceLookup, r.id, null),
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
                            unit_price: resolvePrice(priceLookup, r.id, v.color),
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

  // F3: Success screen pós-submit (com share WhatsApp)
  if (step === ('success' as any)) {
    return (
      <div className="p-4 space-y-4 text-center">
        <div className="py-8">
          <div className="inline-flex h-16 w-16 rounded-full bg-emerald-500/20 items-center justify-center">
            <Check className="h-8 w-8 text-emerald-600" weight="bold" />
          </div>
        </div>
        <h2 className="text-2xl font-bold">Pedido enviado!</h2>
        {createdPvNumber && (
          <p className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            {createdPvNumber}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {totalPairs} pares · R$ {totalValue.toFixed(2)}
        </p>
        <div className="space-y-2 pt-4">
          <button
            onClick={shareWhatsApp}
            className="w-full bg-[#25D366] text-white rounded-lg py-3 font-bold uppercase tracking-wide flex items-center justify-center gap-2"
          >
            <WhatsappLogo className="h-5 w-5" weight="bold" />
            Enviar pelo WhatsApp
          </button>
          <button
            onClick={() => {
              if (navigator.share && selectedClient) {
                navigator.share({
                  title: `Pedido ${createdPvNumber || ''}`,
                  text: `${selectedClient.razao_social} · ${totalPairs} pares · R$ ${totalValue.toFixed(2)}`,
                }).catch(() => {});
              }
            }}
            className="w-full border-[1.5px] border-foreground/20 rounded-lg py-3 font-bold uppercase tracking-wide flex items-center justify-center gap-2"
          >
            <Share className="h-4 w-4" />
            Compartilhar
          </button>
          <button
            onClick={() => navigate('/m')}
            className="w-full text-muted-foreground rounded-lg py-3 text-sm uppercase tracking-wide"
          >
            Voltar ao início
          </button>
        </div>
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

      {/* F3: Histórico do cliente (últimos 12 meses) */}
      {clientHistory && clientHistory.totalOrders > 0 && (
        <div className="border-[1.5px] border-foreground/15 rounded-lg p-3 bg-card">
          <div className="flex items-center gap-1.5 mb-2">
            <ChartBar className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
              Histórico (12m)
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xl font-bold tabular-nums">{clientHistory.totalOrders}</p>
              <p className="text-[10px] text-muted-foreground uppercase">pedidos</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{clientHistory.totalPairs}</p>
              <p className="text-[10px] text-muted-foreground uppercase">pares</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">
                {clientHistory.avgTicket > 1000
                  ? `${(clientHistory.avgTicket / 1000).toFixed(1)}k`
                  : clientHistory.avgTicket.toFixed(0)}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase">ticket</p>
            </div>
          </div>
          {clientHistory.lastOrderDate && (
            <p className="text-[10px] text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" />
              Último: {new Date(clientHistory.lastOrderDate).toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>
      )}

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

      {/* F3: Assinatura digital do cliente — opcional, fica gravada como
          PNG base64 em sale_orders.client_signature_data_url. */}
      <div className="border-[1.5px] border-foreground/15 rounded-lg p-3 bg-card">
        {signatureDataUrl ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
                Assinatura confirmada
              </span>
              <button
                onClick={() => { setSignatureDataUrl(null); setShowSignature(false); }}
                className="text-xs text-destructive"
              >
                Refazer
              </button>
            </div>
            <img
              src={signatureDataUrl}
              alt="Assinatura"
              style={{ background: '#fff' }}
              className="w-full max-h-32 object-contain border border-border rounded"
            />
          </div>
        ) : showSignature ? (
          <SignatureCanvas
            onConfirm={(url) => { setSignatureDataUrl(url); setShowSignature(false); }}
            label="Cliente assina aqui"
          />
        ) : (
          <button
            onClick={() => setShowSignature(true)}
            className="w-full py-3 text-sm text-foreground border-[1.5px] border-dashed border-foreground/30 rounded-lg uppercase tracking-wide"
          >
            + Capturar assinatura (opcional)
          </button>
        )}
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
