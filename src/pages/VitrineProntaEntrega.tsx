import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicReadyStock, submitPublicReadyStockInquiry } from '@/hooks/useReadyStockPublic';
import { groupItemsByLot, parseGradeLabelFromNotes } from '@/lib/readyStockLots';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { toast } from 'sonner';

type PublicItem = {
  id: string;
  reference_id: string;
  color: string;
  size: string;
  quantity: number;
  notes?: string | null;
  ref_name?: string;
  ref_code?: string;
  sale_price?: number;
  image_url?: string | null;
  color_images?: Array<{ color: string; url: string }> | null;
  shoe_category?: string | null;
  brand?: string | null;
};

type CartLine = {
  id: string;
  reference_id: string;
  ref_code: string;
  ref_name: string;
  color: string;
  size: string;
  gradeLabel: string;
  quantity: number;
  available: number;
};

function imageFor(item: PublicItem) {
  const colored = Array.isArray(item.color_images)
    ? item.color_images.find((row) => row.color === item.color)?.url
    : '';
  return colored || item.image_url || '';
}

export default function VitrineProntaEntregaPage() {
  const { token = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState<PublicItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchPublicReadyStock(token);
        if (cancelled) return;
        if (!result.ok) {
          setError('Link inválido ou desativado.');
          return;
        }
        setItems((result.items || []) as PublicItem[]);
      } catch {
        if (!cancelled) setError('Não foi possível carregar o estoque.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const lots = useMemo(() => groupItemsByLot(items), [items]);
  const cartPairs = cart.reduce((sum, line) => sum + line.quantity, 0);

  const addLotToCart = (lotItems: PublicItem[]) => {
    const next = [...cart];
    for (const item of lotItems) {
      const want = Number(qtyDraft[item.id] || 0);
      if (want <= 0) continue;
      const capped = Math.min(want, item.quantity);
      const existing = next.find((line) => line.id === item.id);
      if (existing) existing.quantity = Math.min(item.quantity, existing.quantity + capped);
      else next.push({
        id: item.id,
        reference_id: item.reference_id,
        ref_code: item.ref_code || '',
        ref_name: item.ref_name || '',
        color: item.color,
        size: item.size,
        gradeLabel: parseGradeLabelFromNotes(item.notes) || item.size,
        quantity: capped,
        available: item.quantity,
      });
    }
    setCart(next.filter((line) => line.quantity > 0));
    toast.success('Adicionado ao pedido. Pode continuar comprando.');
  };

  const submit = async () => {
    if (!name.trim() || cart.length === 0) {
      toast.error('Informe seu nome e escolha ao menos um par.');
      return;
    }
    setSending(true);
    try {
      const result = await submitPublicReadyStockInquiry({
        token,
        customer_name: name.trim(),
        customer_phone: phone,
        customer_email: email,
        notes,
        items: cart.map((line) => ({
          ready_stock_id: line.id,
          reference_id: line.reference_id,
          ref_code: line.ref_code,
          ref_name: line.ref_name,
          color: line.color,
          size: line.size,
          grade: line.gradeLabel,
          quantity: line.quantity,
        })),
      });
      if (!result.ok) {
        toast.error('Não foi possível enviar o pedido.');
        return;
      }
      setSentId(result.id || 'ok');
      setCart([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Carregando estoque…</div>;
  }
  if (error) {
    return <div className="min-h-screen grid place-items-center text-sm">{error}</div>;
  }
  if (sentId) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center space-y-3">
        <h1 className="text-xl font-semibold">Pedido enviado</h1>
        <p className="text-sm text-muted-foreground">A fábrica recebeu seu pedido de pronta entrega. Em breve entram em contato.</p>
        <Button onClick={() => setSentId('')}>Fazer outro pedido</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pronta entrega</p>
          <h1 className="text-2xl font-semibold">Escolha os pares disponíveis</h1>
          <p className="text-sm text-muted-foreground">O estoque é o saldo ao vivo. Isso não cria pedido de venda automático.</p>
        </header>

        <div className="space-y-4">
          {lots.map((lot) => {
            const first = lot.items[0];
            const photo = imageFor(first);
            return (
              <section key={lot.key} className="border rounded-xl p-3 space-y-3">
                <div className="flex gap-3">
                  {photo ? (
                    <img src={photo} alt="" className="h-20 w-20 rounded-lg object-cover" />
                  ) : (
                    <div className="h-20 w-20 rounded-lg bg-muted" />
                  )}
                  <div>
                    <p className="text-sm font-semibold">{first.ref_code} · {first.ref_name}</p>
                    <p className="text-xs text-muted-foreground">{first.color} · grade {lot.gradeLabel}</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {lot.items.map((item) => (
                    <label key={item.id} className="text-center space-y-1">
                      <span className="block text-xs font-semibold">Nº {item.size}</span>
                      <NumberInput
                        min={0}
                        decimals={0}
                        value={qtyDraft[item.id] || 0}
                        onChange={(n) => setQtyDraft((prev) => ({ ...prev, [item.id]: Math.min(n, item.quantity) }))}
                        className="h-9 text-center"
                      />
                      <span className="block text-[10px] text-muted-foreground">{item.quantity} disp.</span>
                    </label>
                  ))}
                </div>
                <Button size="sm" variant="outline" onClick={() => addLotToCart(lot.items)}>
                  Adicionar e continuar
                </Button>
              </section>
            );
          })}
        </div>

        <section className="border rounded-xl p-3 space-y-3">
          <h2 className="text-sm font-semibold">Seu pedido · {cartPairs} pares</h2>
          {cart.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum item no carrinho.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {cart.map((line) => (
                <li key={line.id} className="flex justify-between gap-2">
                  <span>{line.ref_code} {line.color} {line.size}</span>
                  <span className="font-mono">{line.quantity}</span>
                </li>
              ))}
            </ul>
          )}
          <Input placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input placeholder="E-mail (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input placeholder="Observação" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button className="w-full" disabled={sending || cart.length === 0} onClick={submit}>
            {sending ? 'Enviando…' : 'Enviar pedido de pronta entrega'}
          </Button>
        </section>
      </div>
    </div>
  );
}
