import { useState } from 'react';
import { useAllNfeEmitidas, useEmitNfe, useCheckNfeStatus, useCancelNfe, useCompanies, useSyncNfeFromProvider, NfeEmitida } from '@/hooks/useNfe';
import { useAccessControl } from '@/hooks/useAccessControl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, FileText, RefreshCw, XCircle, Download, Search, Building2, Plus, CheckCircle, AlertCircle, Clock, Calculator, Activity, FileEdit } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import CompaniesPanel from '@/components/nfe/CompaniesPanel';
import TaxConfigPanel from '@/components/nfe/TaxConfigPanel';
import NfeDiagnosticPanel from '@/components/nfe/NfeDiagnosticPanel';
import NfeCCePanel from '@/components/nfe/NfeCCePanel';
import { NfeBillingHealthCard } from '@/components/nfe/NfeBillingHealthCard';
import { AppErrorBoundary } from '@/components/ErrorBoundary';

// ─── Status badge ─────────────────────────────────────────────────────────────

function NfeStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    processando: { label: 'Processando', className: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: <Clock className="h-3 w-3" /> },
    autorizada:  { label: 'Autorizada',  className: 'bg-green-500/10 text-green-600 border-green-500/20', icon: <CheckCircle className="h-3 w-3" /> },
    cancelada:   { label: 'Cancelada',   className: 'bg-muted text-muted-foreground border-border', icon: <XCircle className="h-3 w-3" /> },
    rejeitada:   { label: 'Rejeitada',   className: 'bg-red-500/10 text-red-600 border-red-500/20', icon: <AlertCircle className="h-3 w-3" /> },
    erro:        { label: 'Erro',        className: 'bg-red-500/10 text-red-600 border-red-500/20', icon: <AlertCircle className="h-3 w-3" /> },
  };
  const cfg = map[status] || map.processando;
  return (
    <Badge variant="outline" className={`gap-1 text-xs ${cfg.className}`}>
      {cfg.icon} {cfg.label}
    </Badge>
  );
}

// ─── Emit dialog ─────────────────────────────────────────────────────────────

function EmitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [orderNumber, setOrderNumber] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundOrder, setFoundOrder] = useState<any>(null);
  const emit = useEmitNfe();
  const { data: companies = [] } = useCompanies();
  const { isAdmin, roles } = useAccessControl();

  // Audit Phase 3 fix: bloqueia o botão Emitir quando o usuário não tem role pra NF-e.
  // O backend (emit-nfe edge) já bloqueia, mas mostrar feedback antes evita o 403 silencioso.
  const canEmitNfe = isAdmin || roles.includes('gerente') || roles.includes('nfe_operator');

  const search = async () => {
    if (!orderNumber.trim()) return;
    setSearching(true);
    // Try exact match first to prevent ilike prefix ambiguity (e.g. "PV-001" matching "PV-0010").
    const { data: exact } = await supabase
      .from('sale_orders')
      .select('id, order_number, client_name, total, status, nfe_required')
      .eq('order_number', orderNumber.trim())
      .maybeSingle();
    if (exact) {
      setFoundOrder(exact);
      setSearching(false);
      return;
    }
    const { data } = await supabase
      .from('sale_orders')
      .select('id, order_number, client_name, total, status, nfe_required')
      .ilike('order_number', `%${orderNumber.trim()}%`)
      .order('order_number', { ascending: true })
      .limit(1);
    setFoundOrder(data?.[0] || null);
    if (!data?.[0]) toast.error('Pedido não encontrado');
    setSearching(false);
  };

  // Audit Phase 3 fix: bloqueia emissão em PV informal (nfe_required=false) no client
  // pra mostrar mensagem clara em vez de erro 400 do edge function.
  const isInformalOrder = foundOrder?.nfe_required === false;

  const handleEmit = async () => {
    if (!foundOrder) return;
    if (isInformalOrder) {
      toast.error('Este PV é informal (sem NF-e). Edite o pedido e desmarque "Pedido informal" antes de emitir.');
      return;
    }
    if (!canEmitNfe) {
      toast.error('Sem permissão pra emitir NF-e. Necessário admin, gerente ou operador NF-e.');
      return;
    }
    await emit.mutateAsync({ saleOrderId: foundOrder.id, companyId: companyId || undefined });
    onClose();
    setFoundOrder(null);
    setOrderNumber('');
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> Emitir Nova NF-e
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {companies.length > 0 && (
            <div>
              <Label>Empresa Emitente</Label>
              <Select value={companyId || '__primary__'} onValueChange={v => setCompanyId(v === '__primary__' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Usar empresa principal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__primary__">Empresa principal</SelectItem>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome_fantasia || c.razao_social} — {c.cnpj}
                      {c.is_primary ? ' ★' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Número do Pedido (PV)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                placeholder="PV-2026-00001"
                onKeyDown={e => e.key === 'Enter' && search()}
              />
              <Button variant="outline" size="icon" onClick={search} disabled={searching} aria-label="Buscar NF-e">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          {foundOrder && (
            <Card className={isInformalOrder ? "border-amber-500/30 bg-amber-500/5" : "border-green-500/30 bg-green-500/5"}>
              <CardContent className="pt-4 space-y-1 text-sm">
                <p className="font-medium">{foundOrder.order_number}</p>
                <p className="text-muted-foreground">{foundOrder.client_name}</p>
                <p className="font-medium">R$ {Number(foundOrder.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                <Badge variant="outline" className="text-xs">{foundOrder.status}</Badge>
                {isInformalOrder && (
                  <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Pedido informal — NF-e bloqueada
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {!canEmitNfe && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Sem permissão pra emitir NF-e
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleEmit} disabled={!foundOrder || emit.isPending || isInformalOrder || !canEmitNfe}>
            {emit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
            Emitir NF-e
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cancel dialog ────────────────────────────────────────────────────────────

function CancelDialog({ nfe, open, onClose }: { nfe: NfeEmitida | null; open: boolean; onClose: () => void }) {
  const [justificativa, setJustificativa] = useState('');
  const cancel = useCancelNfe();

  const handleCancel = async () => {
    if (!nfe) return;
    await cancel.mutateAsync({ nfeId: nfe.id, justificativa, dataEmissao: nfe.data_emissao });
    onClose();
    setJustificativa('');
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="h-4 w-4" /> Cancelar NF-e {nfe?.numero}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            O cancelamento é irreversível. A justificativa deve ter no mínimo 15 caracteres e será enviada à SEFAZ.
          </p>
          <div>
            <Label>Justificativa</Label>
            <Textarea
              value={justificativa}
              onChange={e => setJustificativa(e.target.value)}
              placeholder="Motivo do cancelamento..."
              rows={3}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">{justificativa.length}/15 mínimo</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button variant="destructive" onClick={handleCancel} disabled={justificativa.trim().length < 15 || cancel.isPending}>
            {cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
            Confirmar Cancelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── NF-e row ─────────────────────────────────────────────────────────────────

function NfeRow({ nfe, onCancel, canCancel }: { nfe: any; onCancel: (n: NfeEmitida) => void; canCancel: boolean }) {
  const checkStatus = useCheckNfeStatus();
  const order = (nfe as any).sale_orders;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">{order?.order_number || '—'}</span>
          <NfeStatusBadge status={nfe.status} />
          {nfe.numero && <span className="text-xs text-muted-foreground">NF {nfe.numero}/{nfe.serie}</span>}
        </div>
        <div className="text-sm text-muted-foreground truncate">{order?.client_name || '—'}</div>
        {nfe.motivo_rejeicao && (
          <div className="text-xs text-red-500 mt-0.5 truncate" title={nfe.motivo_rejeicao}>
            {nfe.motivo_rejeicao}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-0.5">
          {new Date(nfe.created_at).toLocaleString('pt-BR')}
          {nfe.cnpj_emitente && ` · CNPJ ${nfe.cnpj_emitente}`}
          {nfe.status === 'cancelada' && nfe.protocolo_cancelamento && (
            <span className="ml-1">· Prot. cancel.: {nfe.protocolo_cancelamento}</span>
          )}
        </div>
      </div>
      <div className="text-sm font-medium shrink-0">
        R$ {Number(nfe.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {nfe.status === 'processando' && (
          <Button variant="ghost" size="icon" title="Verificar status" onClick={() => checkStatus.mutate(nfe.id)} disabled={checkStatus.isPending}>
            {checkStatus.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        )}
        {nfe.danfe_url && (
          <Button variant="ghost" size="icon" title="Baixar DANFE" asChild>
            <a href={nfe.danfe_url} target="_blank" rel="noopener noreferrer"><Download className="h-3.5 w-3.5" /></a>
          </Button>
        )}
        {nfe.xml_url && (
          <Button variant="ghost" size="icon" title="Baixar XML" asChild>
            <a href={nfe.xml_url} target="_blank" rel="noopener noreferrer"><FileText className="h-3.5 w-3.5" /></a>
          </Button>
        )}
        {nfe.status === 'autorizada' && canCancel && (
          <Button variant="ghost" size="icon" title="Cancelar NF-e" className="text-red-500 hover:text-red-600" onClick={() => onCancel(nfe)}>
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NfePage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [emitOpen, setEmitOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<NfeEmitida | null>(null);
  const navigate = useNavigate();
  const { data: companies = [] } = useCompanies();
  const { isAdmin, roles } = useAccessControl();
  const canEmitNfe = isAdmin || roles.includes('gerente') || roles.includes('nfe_operator');
  const syncFromProvider = useSyncNfeFromProvider();

  const { data: allNfe = [], isLoading } = useAllNfeEmitidas({
    status: statusFilter || undefined,
    company_id: companyFilter || undefined,
  });

  const filtered = allNfe.filter((n: any) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return (
      n.sale_orders?.order_number?.toLowerCase().includes(q) ||
      n.sale_orders?.client_name?.toLowerCase().includes(q) ||
      n.numero?.toLowerCase().includes(q) ||
      n.chave_acesso?.toLowerCase().includes(q) ||
      n.cnpj_emitente?.includes(q)
    );
  });

  const stats = {
    total: filtered.length,
    autorizadas: filtered.filter((n: any) => n.status === 'autorizada').length,
    processando: filtered.filter((n: any) => n.status === 'processando').length,
    rejeitadas: filtered.filter((n: any) => n.status === 'rejeitada').length,
  };

  return (
    <div className="space-y-6 page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nota Fiscal Eletrônica</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Centro fiscal — emissão, empresas, tributação e diagnóstico em um só lugar
          </p>
        </div>
        {canEmitNfe && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => syncFromProvider.mutate()}
              disabled={syncFromProvider.isPending}
              className="gap-2"
              title="Importa NF-es emitidas direto no painel da GestaoClick"
            >
              {syncFromProvider.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              Sincronizar com GestaoClick
            </Button>
            <Button onClick={() => setEmitOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Emitir NF-e
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total emitidas', value: stats.total, className: '' },
          { label: 'Autorizadas', value: stats.autorizadas, className: 'text-green-600' },
          { label: 'Processando', value: stats.processando, className: 'text-amber-600' },
          { label: 'Rejeitadas', value: stats.rejeitadas, className: 'text-red-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <p className={`text-2xl font-bold ${s.className}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* M2: PVs com inconsistência fiscal (Faturado sem NF, NF sem Faturado, etc.) */}
      <NfeBillingHealthCard />

      <Tabs defaultValue="nfes">
        <TabsList>
          <TabsTrigger value="nfes" className="gap-2">
            <FileText className="h-4 w-4" /> NF-es Emitidas
          </TabsTrigger>
          <TabsTrigger value="empresas" className="gap-2">
            <Building2 className="h-4 w-4" /> Empresas / CNPJs
          </TabsTrigger>
          <TabsTrigger value="tributacao" className="gap-2">
            <Calculator className="h-4 w-4" /> Tributação
          </TabsTrigger>
          <TabsTrigger value="cce" className="gap-2">
            <FileEdit className="h-4 w-4" /> Cartas de Correção
          </TabsTrigger>
          <TabsTrigger value="diagnostico" className="gap-2">
            <Activity className="h-4 w-4" /> Diagnóstico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nfes" className="mt-4">
          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8"
                placeholder="Buscar por pedido, cliente, número..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
              />
            </div>
            {companies.length > 1 && (
              <Select value={companyFilter || '__all__'} onValueChange={v => setCompanyFilter(v === '__all__' ? '' : v)}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Todas as empresas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas as empresas</SelectItem>
                  {companies.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.razao_social || c.nome_fantasia || c.cnpj}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter || '__all__'} onValueChange={v => setStatusFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                <SelectItem value="processando">Processando</SelectItem>
                <SelectItem value="autorizada">Autorizada</SelectItem>
                <SelectItem value="cancelada">Cancelada</SelectItem>
                <SelectItem value="rejeitada">Rejeitada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="pt-4">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nenhuma NF-e encontrada</p>
                  {canEmitNfe && (
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setEmitOpen(true)}>
                      Emitir primeira NF-e
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filtered.map((n: any) => (
                    <NfeRow key={n.id} nfe={n} onCancel={setCancelTarget} canCancel={canEmitNfe} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="empresas" className="mt-4">
          <CompaniesPanel />
        </TabsContent>

        <TabsContent value="tributacao" className="mt-4">
          <TaxConfigPanel />
        </TabsContent>

        <TabsContent value="cce" className="mt-4">
          <AppErrorBoundary fallbackTitle="Erro ao carregar Cartas de Correção">
            <NfeCCePanel />
          </AppErrorBoundary>
        </TabsContent>

        <TabsContent value="diagnostico" className="mt-4">
          <NfeDiagnosticPanel />
        </TabsContent>
      </Tabs>

      <EmitDialog open={emitOpen} onClose={() => setEmitOpen(false)} />
      <CancelDialog nfe={cancelTarget} open={!!cancelTarget} onClose={() => setCancelTarget(null)} />
    </div>
  );
}
