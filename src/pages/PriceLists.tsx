import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, CurrencyDollar as DollarSign, Calendar, Tag, PencilSimple as Pencil, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { PriceListItemsDialog } from '@/components/sale-orders/PriceListItemsDialog';
import { toast } from 'sonner';
import { useCan } from '@/hooks/useAccessControl';
import { safeFormatBR, todayISO } from '@/lib/date';
import { evaluatePriceListValidity } from '@/lib/mobile/clientContext';

type PriceList = {
  id?: string;
  name: string;
  channel: string;
  region_uf?: string | null;
  client_id?: string | null;
  valid_from: string;
  valid_to?: string | null;
  active: boolean;
  is_promotional: boolean;
};

type PriceListRow = PriceList & {
  id: string;
  client_name?: string | null;
};

const EMPTY: PriceList = {
  name: '',
  channel: 'atacado',
  region_uf: null,
  client_id: null,
  valid_from: todayISO(),
  valid_to: null,
  active: true,
  is_promotional: false,
};

export default function PriceLists() {
  const qc = useQueryClient();
  // Gate de permissões das Tabelas de Preço (criar) — esconde a ação de
  // usuários explicitamente restritos; admins/sem-grant continuam vendo tudo.
  const perm = useCan('/price-lists');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<PriceList>(EMPTY);
  const [itemsFor, setItemsFor] = useState<{ id: string; name: string } | null>(null);

  const { data: lists = [], isLoading } = useQuery<PriceListRow[]>({
    queryKey: ['price_lists'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('price_lists')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const clientIds = [...new Set((data || []).map((p: any) => p.client_id).filter(Boolean))];
      if (clientIds.length === 0) return (data || []).map((p: any) => ({ ...p, client_name: null }));

      const { data: clients } = await (supabase as any)
        .from('clients')
        .select('id, razao_social')
        .in('id', clientIds);
      const clientMap = new Map((clients || []).map((c: any) => [c.id, c.razao_social]));
      return (data || []).map((p: any) => ({ ...p, client_name: clientMap.get(p.client_id) ?? null }));
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients_for_price_list'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('clients').select('id, razao_social').eq('active', true).order('razao_social').limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const save = useMutation({
    mutationFn: async (pl: PriceList) => {
      if (!pl.valid_from) throw new Error('Informe o início da vigência.');
      if (pl.valid_to && pl.valid_to < pl.valid_from) {
        throw new Error('O fim da vigência não pode ser anterior ao início.');
      }
      const payload = {
        name: pl.name,
        channel: pl.channel,
        region_uf: pl.region_uf || null,
        client_id: pl.client_id || null,
        valid_from: pl.valid_from,
        valid_to: pl.valid_to || null,
        active: pl.active,
        is_promotional: pl.is_promotional,
      };
      if (pl.id) {
        const { error } = await (supabase as any).from('price_lists').update(payload).eq('id', pl.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('price_lists').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price_lists'] });
      setOpen(false);
      toast.success('Tabela salva');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = () => { setEdit({ ...EMPTY, valid_from: todayISO() }); setOpen(true); };
  const openEdit = (pl: PriceListRow) => {
    setEdit({
      id: pl.id,
      name: pl.name ?? '',
      channel: pl.channel ?? 'atacado',
      region_uf: pl.region_uf,
      client_id: pl.client_id,
      valid_from: pl.valid_from?.slice(0, 10) ?? todayISO(),
      valid_to: pl.valid_to?.slice(0, 10) ?? null,
      active: pl.active ?? true,
      is_promotional: pl.is_promotional ?? false,
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="COMERCIAL · PREÇOS"
        title="Tabelas de Preço"
        description="Preços por canal, região, cliente e vigência"
        actions={
          perm.canCreate ? (
          <Button size="sm" className="gap-1.5" onClick={openNew}>
            <Plus className="h-4 w-4" /> Nova Tabela
          </Button>
          ) : undefined
        }
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && lists.length === 0 && (
        <Panel flush>
          <EmptyState
            icon={DollarSign}
            title="Nenhuma tabela de preço cadastrada"
            description="Crie a primeira tabela de preços por canal, região ou cliente."
            action={perm.canCreate ? <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Nova Tabela</Button> : undefined}
          />
        </Panel>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {lists.map((pl) => {
          const validity = evaluatePriceListValidity(pl);
          const statusLabel = validity.effective ? 'Vigente'
            : validity.invalidReason === 'inactive' ? 'Inativa'
            : validity.invalidReason === 'not_started' ? 'Futura'
            : validity.invalidReason === 'expired' ? 'Vencida'
            : 'Inválida';
          return (
          <Card
            key={pl.id}
            className="hover:shadow-md transition-shadow cursor-pointer group"
            onClick={() => openEdit(pl)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" />
                  {pl.name}
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Badge variant={validity.effective ? 'default' : 'secondary'} className="text-xs">
                    {statusLabel}
                  </Badge>
                  <Pencil className="h-3 w-3 text-muted-foreground/50 group-hover:text-primary" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Canal</span>
                <span className="font-semibold capitalize">{pl.channel}</span>
              </div>
              {pl.region_uf && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Região</span>
                  <span className="font-mono font-semibold">{pl.region_uf}</span>
                </div>
              )}
              {pl.client_name && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente</span>
                  <span className="font-semibold truncate ml-2">{pl.client_name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Vigência
                </span>
                <span className="font-mono">
                  {safeFormatBR(pl.valid_from, '—', 'dd/MM/yy')}
                  {pl.valid_to ? ` → ${safeFormatBR(pl.valid_to, '—', 'dd/MM/yy')}` : ' →'}
                </span>
              </div>
              {pl.is_promotional && (
                <Badge variant="outline" className="text-xs mt-1">PROMOCIONAL</Badge>
              )}
              <Button
                size="sm" variant="outline" className="w-full mt-2 h-7 gap-1.5"
                onClick={(e) => { e.stopPropagation(); setItemsFor({ id: pl.id, name: pl.name }); }}
              >
                <DollarSign className="h-3.5 w-3.5" /> Itens / Preços
              </Button>
            </CardContent>
          </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{edit.id ? 'Editar Tabela' : 'Nova Tabela de Preço'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome *</Label>
              <Input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })}
                placeholder="Ex.: Atacado Nacional Padrão" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Canal</Label>
                <Select value={edit.channel} onValueChange={v => setEdit({ ...edit, channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="atacado">Atacado</SelectItem>
                    <SelectItem value="varejo">Varejo</SelectItem>
                    <SelectItem value="distribuidor">Distribuidor</SelectItem>
                    <SelectItem value="ecommerce">E-commerce</SelectItem>
                    <SelectItem value="promocional">Promocional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">UF (opcional)</Label>
                <Input maxLength={2} value={edit.region_uf ?? ''}
                  onChange={e => setEdit({ ...edit, region_uf: e.target.value.toUpperCase() || null })}
                  placeholder="RJ" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Cliente específico (opcional)</Label>
              <Select value={edit.client_id ?? '__none__'} onValueChange={v => setEdit({ ...edit, client_id: v === '__none__' ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Todos os clientes do canal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Todos os clientes do canal</SelectItem>
                  {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.razao_social}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Vigência início *</Label>
                <Input type="date" value={edit.valid_from}
                  onChange={e => setEdit({ ...edit, valid_from: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Vigência fim (opcional)</Label>
                <Input type="date" value={edit.valid_to ?? ''}
                  onChange={e => setEdit({ ...edit, valid_to: e.target.value || null })} />
              </div>
            </div>
            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={edit.active} onCheckedChange={v => setEdit({ ...edit, active: v })} />
                Ativa
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={edit.is_promotional} onCheckedChange={v => setEdit({ ...edit, is_promotional: v })} />
                Promocional
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate(edit)} disabled={!edit.name || save.isPending}>
              {save.isPending ? 'Salvando...' : edit.id ? 'Salvar alterações' : 'Criar tabela'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PriceListItemsDialog open={!!itemsFor} onClose={() => setItemsFor(null)} priceList={itemsFor} />
    </div>
  );
}
