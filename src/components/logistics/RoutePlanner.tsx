import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Map, MapPin, Truck, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { EXPEDITION_STATUSES } from '@/lib/logistics/routeManagement';

interface Delivery {
  id: string;
  client_name: string;
  order_number: string;
  total: number;
  status: string;
  clients: { endereco: string | null; cidade: string | null; bairro: string | null; cep: string | null; estado: string | null } | null;
}

const STORED_ORIGIN_KEY = 'routeplanner_origin';

export function RoutePlanner() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [origin, setOrigin] = useState<string>(() => localStorage.getItem(STORED_ORIGIN_KEY) || '');

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['routeplanner-deliveries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, client_name, order_number, total, status, clients(endereco, cidade, bairro, cep, estado)')
        .in('status', [...EXPEDITION_STATUSES])
        .order('order_number')
        .limit(100);
      if (error) throw error;
      const typed = (data || []) as unknown as Delivery[];
      setSelected(new Set(typed.map(d => d.id)));
      return typed;
    },
  });

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSaveOrigin = () => {
    localStorage.setItem(STORED_ORIGIN_KEY, origin);
    toast.success('Origem salva');
  };

  const handleGenerateRoute = () => {
    const selectedDeliveries = deliveries.filter(d => selected.has(d.id));
    if (selectedDeliveries.length === 0) return toast.error('Selecione ao menos um pedido');

    const waypoints = selectedDeliveries
      .map(d => {
        if (d.clients?.cep) return d.clients.cep.replace(/\D/g, '');
        const parts = [d.clients?.endereco, d.clients?.bairro, d.clients?.cidade, d.clients?.estado].filter(Boolean);
        return parts.join(', ');
      })
      .filter(Boolean);

    if (waypoints.length === 0) return toast.error('Nenhum endereço disponível nos pedidos selecionados');

    const originEncoded = encodeURIComponent(origin || 'Origem');
    const wp = encodeURIComponent(waypoints.join('|'));
    window.open(
      `https://www.google.com/maps/dir/?api=1&origin=${originEncoded}&waypoints=${wp}&destination=${originEncoded}&travelmode=driving`,
      '_blank',
    );
  };

  return (
    <div className="space-y-5">
      {/* Origin config */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="origin-input">Endereço de Origem (fábrica)</Label>
              <Input
                id="origin-input"
                placeholder="Ex: Rua das Flores, 123, São Paulo, SP"
                value={origin}
                onChange={e => setOrigin(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">Usado como ponto de partida e retorno da rota</p>
            </div>
            <Button variant="outline" onClick={handleSaveOrigin} className="shrink-0">
              Salvar Origem
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Header actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            Pedidos para Entrega
            {deliveries.length > 0 && (
              <Badge variant="secondary">{deliveries.length} pedidos</Badge>
            )}
          </h2>
          <p className="text-muted-foreground text-xs mt-0.5">
            Selecione os pedidos e gere a rota otimizada no Google Maps
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (selected.size === deliveries.length) {
                setSelected(new Set());
              } else {
                setSelected(new Set(deliveries.map(d => d.id)));
              }
            }}
          >
            {selected.size === deliveries.length ? 'Desmarcar todos' : 'Selecionar todos'}
          </Button>
          <Button
            onClick={handleGenerateRoute}
            disabled={selected.size === 0}
            className="gap-2"
          >
            <Map className="h-4 w-4" />
            Abrir Rota ({selected.size})
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground text-sm">Carregando pedidos...</p>
      ) : deliveries.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Truck className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhum pedido pendente de entrega encontrado.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {deliveries.map((delivery) => (
            <Card
              key={delivery.id}
              className={`p-4 border-l-4 cursor-pointer transition-colors ${
                selected.has(delivery.id)
                  ? 'border-l-primary bg-primary/5'
                  : 'border-l-muted hover:border-l-muted-foreground/30'
              }`}
              onClick={() => toggleSelect(delivery.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-xs font-bold text-muted-foreground font-mono">
                      {delivery.order_number}
                    </span>
                    <span className="text-xs font-black text-emerald-600 shrink-0">
                      R$ {Number(delivery.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm leading-tight truncate">{delivery.client_name}</h3>
                  <Badge variant="outline" className="text-[10px] mt-1 px-1.5 py-0">
                    {delivery.status}
                  </Badge>
                  {delivery.clients?.cidade && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1 mt-1.5">
                      <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                      <span className="truncate">
                        {[delivery.clients.endereco, delivery.clients.bairro, delivery.clients.cidade, delivery.clients.estado]
                          .filter(Boolean).join(', ')}
                      </span>
                    </p>
                  )}
                </div>
                <Checkbox
                  checked={selected.has(delivery.id)}
                  onCheckedChange={() => toggleSelect(delivery.id)}
                  className="mt-0.5 shrink-0"
                  onClick={e => e.stopPropagation()}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
