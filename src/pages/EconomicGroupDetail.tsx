/**
 * EconomicGroupDetail — Tela 360° do grupo econômico.
 *
 * Implementa NIVEL 1 (defaults comerciais), NIVEL 2 (crédito consolidado +
 * matriz/filial) e NIVEL 3 (contatos, notas, anexos, histórico) descritos na
 * proposta. Inspirada em TOTVS Protheus SIGAFAT, Omie e Sankhya.
 */
import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Buildings as Building2, Users, ShoppingCart, CurrencyDollar as DollarSign, Phone, Note as StickyNote, Paperclip, ClockCounterClockwise as HistoryIcon, Warning as AlertTriangle, Crown, Plus, Trash as Trash2, PencilSimple as Edit3, Upload, ArrowSquareOut as ExternalLink, TrendUp as TrendingUp, Calendar, ShieldWarning as ShieldAlert, CheckCircle as CheckCircle2, FileText, ChatText as MessageSquare, FloppyDisk as Save } from '@phosphor-icons/react';

import {
  useEconomicGroupById, useEconomicGroupKpis, useEconomicGroupCredit,
  useEconomicGroupClients, useEconomicGroupOrders, useEconomicGroupAR,
  useEconomicGroupContacts, useUpsertEconomicGroupContact, useDeleteEconomicGroupContact,
  useEconomicGroupNotes, useCreateEconomicGroupNote, useDeleteEconomicGroupNote,
  useEconomicGroupAttachments, useUploadEconomicGroupAttachment, useDeleteEconomicGroupAttachment,
  useEconomicGroupAuditLog, useUpdateEconomicGroupFull, useSetClientAsMatriz,
  type ContactRole, type NoteType,
} from '@/hooks/useEconomicGroup360';

// ─── Helpers ────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string | null | undefined) => s ? format(new Date(s), 'dd/MM/yyyy', { locale: ptBR }) : '—';
const fmtDateTime = (s: string | null | undefined) => s ? format(new Date(s), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : '—';

// ═══════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════

export default function EconomicGroupDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: group, isLoading } = useEconomicGroupById(id);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando grupo…</div>;
  }
  if (!group) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">Grupo econômico não encontrado.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/clients')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 page-enter">
      <Header group={group} />

      <Tabs defaultValue="resumo" className="w-full">
        <TabsList className="grid w-full grid-cols-8 max-w-6xl">
          <TabsTrigger value="resumo" className="gap-1.5"><TrendingUp className="h-4 w-4" /> Resumo</TabsTrigger>
          <TabsTrigger value="comercial" className="gap-1.5"><DollarSign className="h-4 w-4" /> Comercial</TabsTrigger>
          <TabsTrigger value="clientes" className="gap-1.5"><Users className="h-4 w-4" /> Clientes</TabsTrigger>
          <TabsTrigger value="pedidos" className="gap-1.5"><ShoppingCart className="h-4 w-4" /> Pedidos</TabsTrigger>
          <TabsTrigger value="financeiro" className="gap-1.5"><DollarSign className="h-4 w-4" /> Financeiro</TabsTrigger>
          <TabsTrigger value="contatos" className="gap-1.5"><Phone className="h-4 w-4" /> Contatos</TabsTrigger>
          <TabsTrigger value="notas" className="gap-1.5"><StickyNote className="h-4 w-4" /> Notas</TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5"><HistoryIcon className="h-4 w-4" /> Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo"><ResumoTab groupId={id} group={group} /></TabsContent>
        <TabsContent value="comercial"><ComercialTab group={group} /></TabsContent>
        <TabsContent value="clientes"><ClientesTab groupId={id} /></TabsContent>
        <TabsContent value="pedidos"><PedidosTab groupId={id} /></TabsContent>
        <TabsContent value="financeiro"><FinanceiroTab groupId={id} /></TabsContent>
        <TabsContent value="contatos"><ContatosTab groupId={id} /></TabsContent>
        <TabsContent value="notas"><NotasAnexosTab groupId={id} /></TabsContent>
        <TabsContent value="historico"><HistoricoTab groupId={id} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

function Header({ group }: { group: any }) {
  const navigate = useNavigate();
  const { data: credit } = useEconomicGroupCredit(group.id);
  const overLimit = credit && Number(credit.ar_open_total) > Number(group.credit_limit) && Number(group.credit_limit) > 0;

  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/clients')} aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {group.logo_url ? (
          <img src={group.logo_url} alt={group.name} className="h-12 w-12 rounded-lg object-cover border border-border" />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Building2 className="h-6 w-6" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
            {group.group_number && <Badge variant="outline" className="text-xs font-mono">{group.group_number}</Badge>}
            {group.block_new_orders && (
              <Badge variant="destructive" className="gap-1">
                <ShieldAlert className="h-3 w-3" /> Bloqueado
              </Badge>
            )}
            {overLimit && (
              <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 gap-1">
                <AlertTriangle className="h-3 w-3" /> Limite estourado
              </Badge>
            )}
          </div>
          {group.description && <p className="text-sm text-muted-foreground mt-0.5">{group.description}</p>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Resumo
// ═══════════════════════════════════════════════════════════════════════

function ResumoTab({ groupId, group }: { groupId: string; group: any }) {
  const { data: kpis } = useEconomicGroupKpis(groupId);
  const { data: credit } = useEconomicGroupCredit(groupId);

  return (
    <div className="space-y-4 pt-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Receita 12m" value={fmtCurrency(kpis?.revenue_12m || 0)} icon={DollarSign} accent="emerald" />
        <KpiCard label="Pedidos 12m" value={String(kpis?.orders_12m || 0)} icon={ShoppingCart} accent="indigo" />
        <KpiCard label="Ticket médio" value={fmtCurrency(kpis?.avg_ticket || 0)} icon={TrendingUp} accent="indigo" />
        <KpiCard label="Dias médio pgto" value={`${Number(kpis?.avg_days_to_pay || 0).toFixed(0)} dias`} icon={Calendar} accent="amber" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Crédito */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" /> Crédito consolidado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Limite do grupo" value={fmtCurrency(group.credit_limit || 0)} />
            <Row label="AR em aberto" value={fmtCurrency(credit?.ar_open_total || 0)} />
            <Row label="Crédito disponível" value={fmtCurrency(credit?.credit_available || 0)} highlight={Number(credit?.credit_available || 0) > 0 ? 'green' : 'red'} />
            <Separator className="my-1" />
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">Aging</p>
            <Row label="A vencer" value={fmtCurrency(credit?.ar_a_vencer || 0)} />
            <Row label="Em atraso 0-30 dias" value={fmtCurrency(credit?.ar_atraso_0_30 || 0)} highlight={Number(credit?.ar_atraso_0_30 || 0) > 0 ? 'amber' : undefined} />
            <Row label="Em atraso 30-60 dias" value={fmtCurrency(credit?.ar_atraso_30_60 || 0)} highlight={Number(credit?.ar_atraso_30_60 || 0) > 0 ? 'amber' : undefined} />
            <Row label="Em atraso 60-90 dias" value={fmtCurrency(credit?.ar_atraso_60_90 || 0)} highlight={Number(credit?.ar_atraso_60_90 || 0) > 0 ? 'red' : undefined} />
            <Row label="Em atraso +90 dias" value={fmtCurrency(credit?.ar_atraso_90_mais || 0)} highlight={Number(credit?.ar_atraso_90_mais || 0) > 0 ? 'red' : undefined} />
          </CardContent>
        </Card>

        {/* Composição */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Composição do grupo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Clientes vinculados" value={String(credit?.total_clients || 0)} />
            <Row label="Matriz definida?" value={Number(credit?.total_matriz || 0) > 0 ? 'Sim' : 'Não'} highlight={Number(credit?.total_matriz || 0) === 0 ? 'amber' : undefined} />
            <Row label="Share of wallet" value={`${Number(kpis?.share_of_wallet_pct || 0).toFixed(1)}%`} />
            <Row label="Último pedido" value={fmtDate(kpis?.last_order_at)} />
            <Separator className="my-1" />
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">Configuração comercial</p>
            <Row label="Tabela de preço default" value={group.default_price_list_id ? 'Configurada' : 'Sem default'} />
            <Row label="Condição pgto default" value={group.default_payment_condition || '—'} />
            <Row label="Desconto default" value={`${Number(group.default_discount_pct || 0).toFixed(1)}%`} />
            <Row label="Modalidade frete" value={group.default_modalidade_frete || '—'} />
          </CardContent>
        </Card>
      </div>

      {group.important_info && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-1">Informação importante</p>
                <p className="text-sm text-amber-900 whitespace-pre-wrap">{group.important_info}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, accent }: { label: string; value: string; icon: any; accent: 'emerald' | 'indigo' | 'amber' | 'rose' }) {
  const map = {
    emerald: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20',
    amber: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-700 border-rose-500/20',
  };
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold mb-1">{label}</p>
            <p className="text-xl font-black tracking-tight">{value}</p>
          </div>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center border ${map[accent]}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' | 'amber' }) {
  const color = highlight === 'green' ? 'text-emerald-700' : highlight === 'red' ? 'text-rose-700' : highlight === 'amber' ? 'text-amber-700' : '';
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-bold ${color}`}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Comercial (edição de defaults + crédito + bloqueio)
// ═══════════════════════════════════════════════════════════════════════

function ComercialTab({ group }: { group: any }) {
  const update = useUpdateEconomicGroupFull();
  const [form, setForm] = useState({
    name: group.name || '',
    description: group.description || '',
    important_info: group.important_info || '',
    billing_email: group.billing_email || '',
    finance_contact_name: group.finance_contact_name || '',
    logo_url: group.logo_url || '',
    silk_url: group.silk_url || '',
    default_price_list_id: group.default_price_list_id || '',
    default_payment_condition: group.default_payment_condition || '',
    default_factoring_config_id: group.default_factoring_config_id || '',
    default_modalidade_frete: group.default_modalidade_frete || '',
    default_transport_company_id: group.default_transport_company_id || '',
    default_discount_pct: Number(group.default_discount_pct || 0),
    credit_limit: Number(group.credit_limit || 0),
    block_new_orders: !!group.block_new_orders,
    block_reason: group.block_reason || '',
    aging_alert_days: Number(group.aging_alert_days || 30),
  });

  // Lookups: price_lists, factoring_config, transport_companies
  const { data: priceLists = [] } = useQuery({
    queryKey: ['price_lists_active_for_group_select'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('price_lists').select('id, name').eq('active', true).order('name');
      return data || [];
    },
  });
  const { data: factoringConfigs = [] } = useQuery({
    queryKey: ['factoring_config_active_for_group_select'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('factoring_config').select('id, name').eq('active', true).order('name');
      return data || [];
    },
  });
  const { data: transportCompanies = [] } = useQuery({
    queryKey: ['transport_companies_active_for_group_select'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('transport_companies').select('id, nome').eq('active', true).order('nome');
      return data || [];
    },
  });

  const handleSave = () => update.mutate({ id: group.id, data: form });

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Identificação</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Nome do grupo *</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Logo (URL)</Label>
            <Input value={form.logo_url} onChange={e => setForm({ ...form, logo_url: e.target.value })} placeholder="https://..." />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Descrição</Label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>
          <div className="space-y-1">
            <Label>Email faturamento</Label>
            <Input type="email" value={form.billing_email} onChange={e => setForm({ ...form, billing_email: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Contato financeiro (nome)</Label>
            <Input value={form.finance_contact_name} onChange={e => setForm({ ...form, finance_contact_name: e.target.value })} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Silk (URL)</Label>
            <Input value={form.silk_url} onChange={e => setForm({ ...form, silk_url: e.target.value })} placeholder="https://..." />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Informação importante (alerta vermelho)</Label>
            <Textarea value={form.important_info} onChange={e => setForm({ ...form, important_info: e.target.value })} rows={3} placeholder="Ex.: Boleto sempre vencendo na semana do dia 15, exige nota com observação X..." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" /> Condições comerciais default
          </CardTitle>
          <p className="text-xs text-muted-foreground">Aplicadas ao criar PV pra qualquer cliente do grupo (cliente pode sobrescrever individualmente).</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Tabela de preço default</Label>
            <Select value={form.default_price_list_id || '__none__'} onValueChange={v => setForm({ ...form, default_price_list_id: v === '__none__' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Sem default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem default</SelectItem>
                {priceLists.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Condição pgto default</Label>
            <Input value={form.default_payment_condition} onChange={e => setForm({ ...form, default_payment_condition: e.target.value })} placeholder="Ex.: 28/35/42 dias" />
          </div>
          <div className="space-y-1">
            <Label>Factoring default</Label>
            <Select value={form.default_factoring_config_id || '__none__'} onValueChange={v => setForm({ ...form, default_factoring_config_id: v === '__none__' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Sem default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem default</SelectItem>
                {factoringConfigs.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Desconto comercial default (%)</Label>
            <Input type="number" min={0} max={100} step={0.5} value={form.default_discount_pct} onChange={e => setForm({ ...form, default_discount_pct: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label>Modalidade frete</Label>
            <Select value={form.default_modalidade_frete || '__none__'} onValueChange={v => setForm({ ...form, default_modalidade_frete: v === '__none__' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Sem default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem default</SelectItem>
                <SelectItem value="CIF">CIF (frete por conta do emitente)</SelectItem>
                <SelectItem value="FOB">FOB (frete por conta do destinatário)</SelectItem>
                <SelectItem value="Terceiros">Por conta de terceiros</SelectItem>
                <SelectItem value="Sem frete">Sem frete</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Transportadora preferida</Label>
            <Select value={form.default_transport_company_id || '__none__'} onValueChange={v => setForm({ ...form, default_transport_company_id: v === '__none__' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Sem default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem default</SelectItem>
                {transportCompanies.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" /> Crédito + bloqueio comercial
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Limite de crédito do grupo (R$)</Label>
            <Input type="number" min={0} step={100} value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: Number(e.target.value) })} />
            <p className="text-[10px] text-muted-foreground">Consolidado: soma de AR aberta de TODAS as filiais</p>
          </div>
          <div className="space-y-1">
            <Label>Alertar atraso a partir de (dias)</Label>
            <Input type="number" min={1} step={1} value={form.aging_alert_days} onChange={e => setForm({ ...form, aging_alert_days: Number(e.target.value) })} />
          </div>
          <div className="space-y-1 md:col-span-2 flex items-center justify-between border border-border rounded-lg px-3 py-2">
            <div>
              <Label className="cursor-pointer">Bloquear novos pedidos do grupo</Label>
              <p className="text-[10px] text-muted-foreground">Aplica em TODOS os clientes do grupo. Sobrescreve o bloqueio individual.</p>
            </div>
            <Switch checked={form.block_new_orders} onCheckedChange={v => setForm({ ...form, block_new_orders: v })} />
          </div>
          {form.block_new_orders && (
            <div className="md:col-span-2 space-y-1">
              <Label>Motivo do bloqueio</Label>
              <Textarea value={form.block_reason} onChange={e => setForm({ ...form, block_reason: e.target.value })} rows={2} placeholder="Ex.: Inadimplência > 90 dias na matriz" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={update.isPending} className="gap-2">
          <Save className="h-4 w-4" /> {update.isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Clientes (lista, marca matriz)
// ═══════════════════════════════════════════════════════════════════════

function ClientesTab({ groupId }: { groupId: string }) {
  const { data: clients = [], isLoading } = useEconomicGroupClients(groupId);
  const setMatriz = useSetClientAsMatriz();

  return (
    <div className="space-y-3 pt-4">
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : clients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm space-y-2">
              <Building2 className="h-10 w-10 mx-auto opacity-30" />
              <p>Nenhum cliente vinculado a este grupo</p>
              <p className="text-xs">Edite um cliente em /clients e selecione este grupo no campo "Grupo econômico"</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="text-left p-2 font-semibold">Cliente</th>
                    <th className="text-left p-2 font-semibold">CNPJ</th>
                    <th className="text-left p-2 font-semibold">Cidade/UF</th>
                    <th className="text-right p-2 font-semibold">Limite</th>
                    <th className="text-center p-2 font-semibold">Status</th>
                    <th className="text-right p-2 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c: any) => (
                    <tr key={c.id} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {c.is_matriz && (
                            <Badge className="gap-1 bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]">
                              <Crown className="h-3 w-3" /> Matriz
                            </Badge>
                          )}
                          <Link to={`/clients`} className="font-medium hover:underline">
                            {c.nome_fantasia || c.razao_social}
                          </Link>
                        </div>
                        {c.nome_fantasia && c.razao_social && c.nome_fantasia !== c.razao_social && (
                          <p className="text-xs text-muted-foreground">{c.razao_social}</p>
                        )}
                      </td>
                      <td className="p-2 font-mono text-xs">{c.cnpj || '—'}</td>
                      <td className="p-2 text-xs">{c.cidade ? `${c.cidade}/${c.estado}` : '—'}</td>
                      <td className="p-2 text-right font-mono text-xs">{fmtCurrency(c.credit_limit || 0)}</td>
                      <td className="p-2 text-center">
                        {!c.active ? <Badge variant="outline" className="text-[10px]">Inativo</Badge> :
                          c.commercial_block ? <Badge className="bg-red-500/15 text-red-700 border-red-500/30 text-[10px]">Bloqueado</Badge> :
                            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]">Ativo</Badge>}
                      </td>
                      <td className="p-2 text-right">
                        {!c.is_matriz && (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setMatriz.mutate({ clientId: c.id, groupId })}>
                            <Crown className="h-3 w-3" /> Marcar matriz
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Pedidos
// ═══════════════════════════════════════════════════════════════════════

function PedidosTab({ groupId }: { groupId: string }) {
  const { data: orders = [], isLoading } = useEconomicGroupOrders(groupId);

  const summary = useMemo(() => {
    const total = orders.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
    const byStatus: Record<string, number> = {};
    for (const o of orders as any[]) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    }
    return { total, byStatus, count: orders.length };
  }, [orders]);

  return (
    <div className="space-y-3 pt-4">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Total PVs (recentes)" value={String(summary.count)} icon={ShoppingCart} accent="indigo" />
        <KpiCard label="Soma valores" value={fmtCurrency(summary.total)} icon={DollarSign} accent="emerald" />
        <KpiCard label="PVs cancelados" value={String(summary.byStatus['Cancelado'] || 0)} icon={AlertTriangle} accent="rose" />
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> :
           orders.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Sem pedidos para este grupo</p> :
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="text-left p-2 font-semibold">PV</th>
                    <th className="text-left p-2 font-semibold">Cliente</th>
                    <th className="text-left p-2 font-semibold">Status</th>
                    <th className="text-left p-2 font-semibold">Entrega</th>
                    <th className="text-left p-2 font-semibold">NF</th>
                    <th className="text-right p-2 font-semibold">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o: any) => (
                    <tr key={o.id} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="p-2 font-mono text-xs">
                        <Link to={`/orders/${o.id}/edit`} className="hover:underline flex items-center gap-1">
                          {o.order_number} <ExternalLink className="h-3 w-3 opacity-50" />
                        </Link>
                      </td>
                      <td className="p-2 text-xs">{o.client_name}</td>
                      <td className="p-2"><Badge variant="outline" className="text-[10px]">{o.status}</Badge></td>
                      <td className="p-2 text-xs">{fmtDate(o.delivery_deadline)}</td>
                      <td className="p-2 text-xs font-mono">{o.nfe || '—'}</td>
                      <td className="p-2 text-right font-mono text-xs">{fmtCurrency(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Financeiro
// ═══════════════════════════════════════════════════════════════════════

function FinanceiroTab({ groupId }: { groupId: string }) {
  const { data: credit } = useEconomicGroupCredit(groupId);
  const { data: ar = [], isLoading } = useEconomicGroupAR(groupId);
  const [statusFilter, setStatusFilter] = useState<'open' | 'paid' | 'all'>('open');

  const filtered = useMemo(() => {
    if (statusFilter === 'open') return ar.filter((a: any) => !['received', 'paid', 'cancelled'].includes(a.status));
    if (statusFilter === 'paid') return ar.filter((a: any) => ['received', 'paid'].includes(a.status));
    return ar;
  }, [ar, statusFilter]);

  return (
    <div className="space-y-3 pt-4">
      {credit && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Aging Consolidado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-2">
              <AgingBox label="A vencer" value={credit.ar_a_vencer} color="emerald" />
              <AgingBox label="0-30d" value={credit.ar_atraso_0_30} color="amber" />
              <AgingBox label="30-60d" value={credit.ar_atraso_30_60} color="orange" />
              <AgingBox label="60-90d" value={credit.ar_atraso_60_90} color="rose" />
              <AgingBox label="+90d" value={credit.ar_atraso_90_mais} color="red" />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Contas a Receber</CardTitle>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Em aberto</SelectItem>
              <SelectItem value="paid">Recebidas</SelectItem>
              <SelectItem value="all">Todas</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> :
           filtered.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Nada por aqui</p> :
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="text-left p-2 font-semibold">Cliente</th>
                    <th className="text-left p-2 font-semibold">Descrição</th>
                    <th className="text-left p-2 font-semibold">Vencimento</th>
                    <th className="text-right p-2 font-semibold">Valor</th>
                    <th className="text-right p-2 font-semibold">Recebido</th>
                    <th className="text-left p-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a: any) => {
                    const overdue = new Date(a.due_date) < new Date() && !['received', 'paid', 'cancelled'].includes(a.status);
                    return (
                      <tr key={a.id} className="border-t border-border/50 hover:bg-muted/30">
                        <td className="p-2 text-xs">{a.client_name}</td>
                        <td className="p-2 text-xs truncate max-w-[200px]" title={a.description}>{a.description}</td>
                        <td className={`p-2 text-xs ${overdue ? 'text-red-600 font-bold' : ''}`}>{fmtDate(a.due_date)}</td>
                        <td className="p-2 text-right font-mono text-xs">{fmtCurrency(a.amount)}</td>
                        <td className="p-2 text-right font-mono text-xs">{fmtCurrency(a.amount_received)}</td>
                        <td className="p-2"><Badge variant="outline" className="text-[10px]">{a.status}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}

function AgingBox({ label, value, color }: { label: string; value: number; color: string }) {
  const map: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
    orange: 'bg-orange-500/10 text-orange-700 border-orange-500/30',
    rose: 'bg-rose-500/10 text-rose-700 border-rose-500/30',
    red: 'bg-red-500/10 text-red-700 border-red-500/30',
  };
  return (
    <div className={`rounded-lg border p-2 text-center ${map[color]}`}>
      <p className="text-[10px] uppercase font-bold tracking-wide">{label}</p>
      <p className="text-sm font-mono font-black mt-0.5">{fmtCurrency(value)}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Contatos
// ═══════════════════════════════════════════════════════════════════════

const ROLE_OPTIONS: ContactRole[] = ['Comprador', 'Financeiro', 'Logística', 'Diretor', 'Comercial', 'Suporte', 'Outro'];

function ContatosTab({ groupId }: { groupId: string }) {
  const { data: contacts = [] } = useEconomicGroupContacts(groupId);
  const upsert = useUpsertEconomicGroupContact();
  const del = useDeleteEconomicGroupContact();
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const handleNew = () => {
    setEditing({ economic_group_id: groupId, role: 'Comprador', name: '', email: '', phone: '', whatsapp: '', notes: '', is_primary: false });
    setOpen(true);
  };
  const handleEdit = (c: any) => { setEditing({ ...c }); setOpen(true); };
  const handleSave = () => {
    if (!editing?.name?.trim()) { toast.error('Nome é obrigatório'); return; }
    upsert.mutate(editing, { onSuccess: () => setOpen(false) });
  };

  return (
    <div className="space-y-3 pt-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={handleNew} className="gap-2"><Plus className="h-4 w-4" /> Novo contato</Button>
      </div>
      <Card>
        <CardContent className="pt-4">
          {contacts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm space-y-2">
              <Phone className="h-10 w-10 mx-auto opacity-30" />
              <p>Nenhum contato cadastrado</p>
              <p className="text-xs">Adicione contatos por papel (Comprador, Financeiro, Logística, Diretor, Comercial)</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {contacts.map(c => (
                <div key={c.id} className="border border-border/60 rounded-lg p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        {c.is_primary && <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px]">Principal</Badge>}
                        <Badge variant="outline" className="text-[10px]">{c.role}</Badge>
                      </div>
                      <p className="font-bold text-sm mt-1">{c.name}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(c)}><Edit3 className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => del.mutate({ id: c.id, groupId })}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  {c.email && <p className="text-xs flex items-center gap-1"><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></p>}
                  {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                  {c.whatsapp && (
                    <p className="text-xs">
                      <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">
                        WhatsApp: {c.whatsapp}
                      </a>
                    </p>
                  )}
                  {c.notes && <p className="text-xs text-muted-foreground italic mt-1">{c.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? 'Editar' : 'Novo'} contato</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Papel *</Label>
                  <Select value={editing.role} onValueChange={v => setEditing({ ...editing, role: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLE_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 flex flex-col">
                  <Label>Principal?</Label>
                  <div className="flex items-center gap-2 h-9">
                    <Switch checked={editing.is_primary} onCheckedChange={v => setEditing({ ...editing, is_primary: v })} />
                    <span className="text-xs text-muted-foreground">Destaca este contato</span>
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Nome *</Label>
                <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Telefone</Label>
                  <Input value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>WhatsApp</Label>
                  <Input value={editing.whatsapp || ''} onChange={e => setEditing({ ...editing, whatsapp: e.target.value })} placeholder="DDD+número" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notas</Label>
                <Textarea value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={upsert.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Notas + Anexos
// ═══════════════════════════════════════════════════════════════════════

const NOTE_TYPES: NoteType[] = ['geral', 'reunião', 'ligação', 'email', 'visita', 'whatsapp', 'incidente', 'oportunidade'];

function NotasAnexosTab({ groupId }: { groupId: string }) {
  const { data: notes = [] } = useEconomicGroupNotes(groupId);
  const { data: attachments = [] } = useEconomicGroupAttachments(groupId);
  const createNote = useCreateEconomicGroupNote();
  const delNote = useDeleteEconomicGroupNote();
  const uploadAtt = useUploadEconomicGroupAttachment();
  const delAtt = useDeleteEconomicGroupAttachment();

  const [content, setContent] = useState('');
  const [type, setType] = useState<NoteType>('geral');

  const handleAddNote = () => {
    if (!content.trim()) { toast.error('Conteúdo vazio'); return; }
    createNote.mutate({ groupId, content: content.trim(), type }, {
      onSuccess: () => { setContent(''); setType('geral'); },
    });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadAtt.mutate({ groupId, file });
    e.target.value = '';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 pt-4">
      {/* Notas (timeline) */}
      <div className="lg:col-span-2 space-y-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Nova nota</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 items-center">
              <Label className="text-xs">Tipo:</Label>
              <Select value={type} onValueChange={v => setType(v as NoteType)}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{NOTE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea value={content} onChange={e => setContent(e.target.value)} rows={3} placeholder="Registre conversas, decisões, problemas, oportunidades…" />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAddNote} disabled={createNote.isPending} className="gap-2">
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Timeline ({notes.length})</CardTitle></CardHeader>
          <CardContent>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sem notas. Use o CRM-style: registre toda interação.</p>
            ) : (
              <div className="space-y-3">
                {notes.map(n => (
                  <div key={n.id} className="border-l-2 border-primary/40 pl-3 py-1 group">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{n.note_type}</Badge>
                        <span className="text-[10px] text-muted-foreground">{fmtDateTime(n.created_at)}</span>
                      </div>
                      <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-600" onClick={() => delNote.mutate({ id: n.id, groupId })}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Anexos */}
      <div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Paperclip className="h-4 w-4" /> Anexos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className="block">
              <div className="border-2 border-dashed border-border/60 rounded-lg p-4 text-center hover:bg-muted/30 cursor-pointer transition-colors">
                <Upload className="h-5 w-5 mx-auto text-muted-foreground" />
                <p className="text-xs mt-1 text-muted-foreground">Click pra enviar arquivo</p>
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploadAtt.isPending} />
              </div>
            </label>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">Sem anexos</p>
            ) : (
              <div className="space-y-1.5">
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-2 border border-border/60 rounded p-2 group">
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <a href={a.file_url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline truncate flex-1" title={a.file_name}>{a.file_name}</a>
                    <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-600" onClick={() => delAtt.mutate({ id: a.id, groupId })}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Histórico (audit log)
// ═══════════════════════════════════════════════════════════════════════

function HistoricoTab({ groupId }: { groupId: string }) {
  const { data: log = [] } = useEconomicGroupAuditLog(groupId);

  const FIELD_LABELS: Record<string, string> = {
    name: 'Nome',
    credit_limit: 'Limite de crédito',
    block_new_orders: 'Bloqueio comercial',
    default_price_list_id: 'Tabela de preço default',
    default_payment_condition: 'Condição pgto default',
    default_factoring_config_id: 'Factoring default',
    default_discount_pct: 'Desconto default',
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><HistoryIcon className="h-4 w-4" /> Histórico de mudanças</CardTitle>
        <p className="text-xs text-muted-foreground">Últimas 100 alterações em campos críticos.</p>
      </CardHeader>
      <CardContent>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sem alterações registradas</p>
        ) : (
          <div className="space-y-2">
            {log.map(e => (
              <div key={e.id} className="flex items-start gap-2 text-xs border-l-2 border-border/60 pl-3 py-1">
                <CheckCircle2 className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p>
                    <span className="font-bold">{FIELD_LABELS[e.field_name] || e.field_name}</span>{' '}
                    alterado de <code className="bg-muted px-1 rounded">{e.old_value ?? '∅'}</code>{' '}
                    para <code className="bg-muted px-1 rounded">{e.new_value ?? '∅'}</code>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDateTime(e.changed_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
