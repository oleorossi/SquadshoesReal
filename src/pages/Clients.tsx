import AppLayout from "@/components/layout/AppLayout";
import { useState, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Users, Plus, CircleNotch as Loader2, PencilSimple as Pencil, Trash as Trash2, MagnifyingGlass as Search, Buildings as Building2, CaretDown as ChevronDown, FileArrowUp as FileUp, Storefront as Store, Check, Star, ArrowsClockwise as RefreshCw, ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import { cn } from '@/lib/utils';
import {
  useClients, useCreateClient, useUpdateClient, useDeleteClient,
  useEconomicGroups, useCreateEconomicGroup, useUpdateEconomicGroup, useDeleteEconomicGroup,
  Client, ClientFormData, EconomicGroup,
} from '@/hooks/useClients';
import ClientFormDialog from '@/components/clients/ClientFormDialog';
import ExcelImportDialog from '@/components/clients/ExcelImportDialog';
import { ImportClientsDialog } from '@/components/clients/ImportClientsDialog';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import ClientLogoTab from '@/components/clients/ClientLogoTab';
import RepresentativeTab from '@/components/clients/RepresentativeTab';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { validateCnpj } from '@/lib/validateCnpj';
import { normalizeForSearch } from '@/lib/searchUtils';

const emptyClient: ClientFormData = {
  razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '',
  endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '', codigo_municipio: '',
  email: '', telefone: '',
  contato: '', notes: '', economic_group_id: null, active: true, logo_url: '', silk_url: null,
  is_favorite: false,
  accepts_bundled_packaging: true,
  credit_limit: 0,
  branch_code: null,
  branch_name: null,
  icms_contribuinte: null,
};

export default function Clients() {
  const navigate = useNavigate();
  const { data: clients = [], isLoading, isError, error } = useClients();
  const { data: economicGroups = [] } = useEconomicGroups();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const createGroup = useCreateEconomicGroup();
  const updateGroup = useUpdateEconomicGroup();
  const deleteGroup = useDeleteEconomicGroup();

  // Audit B4 (round 28): aceita ?q= na URL pra search global navegar contextualmente
  // (ex: /clients?q=12345678 destaca o cliente clicado no buscador top-bar).
  const initialSearch = (() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('q') || '';
  })();
  const [search, setSearch] = usePersistedState('search', initialSearch);
  const [clientDialog, setClientDialog] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientFormData>(emptyClient);

  const [groupDialog, setGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<EconomicGroup | null>(null);
  const [groupForm, setGroupForm] = useState({ 
    name: '', 
    description: '', 
    logo_url: '', 
    silk_url: '', 
    billing_email: '', 
    finance_contact_name: '',
    important_info: ''
  });

  const [excelDialog, setExcelDialog] = useState(false);
  const [importSmartOpen, setImportSmartOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [addStoreDialog, setAddStoreDialog] = useState(false);
  const [storeSearch, setStoreSearch] = useState('');
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [isSyncingCnpj, setIsSyncingCnpj] = useState(false);
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);

  const handleSyncCnpj = async () => {
    setIsSyncingCnpj(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-cnpj-addresses', { body: {} });
      if (error) throw error;
      toast.success(`Sincronização concluída: ${data?.updated ?? 0} clientes atualizados de ${data?.total ?? 0}`);
    } catch (err: any) {
      toast.error('Erro ao sincronizar endereços: ' + (err.message || 'erro desconhecido'));
    } finally {
      setIsSyncingCnpj(false);
    }
  };

  const filteredClients = useMemo(() => {
    const q = normalizeForSearch(search);
    const qDigits = q.replace(/\D/g, '');
    return clients.filter(c =>
      normalizeForSearch(c.razao_social).includes(q) ||
      normalizeForSearch(c.nome_fantasia).includes(q) ||
      (qDigits.length > 0
        ? (c.cnpj?.replace(/\D/g, '') ?? '').includes(qDigits)
        : normalizeForSearch(c.cnpj).includes(q)) ||
      normalizeForSearch(c.cidade).includes(q)
    );
  }, [clients, search]);

  const groupedClients = useMemo(() => {
    const groups: { group: EconomicGroup | null; clients: Client[] }[] = [];
    economicGroups.forEach(g => {
      const gc = filteredClients.filter(c => c.economic_group_id === g.id);
      if (gc.length > 0) groups.push({ group: g, clients: gc });
    });
    const ungrouped = filteredClients.filter(c => !c.economic_group_id);
    if (ungrouped.length > 0) groups.push({ group: null, clients: ungrouped });
    return groups;
  }, [filteredClients, economicGroups]);

  // KPI strip — design system "Novidade". Derivado dos dados reais
  // (sem campos inventados): total/ativos da carteira, grupos econômicos,
  // favoritos e crédito agregado.
  const clientStats = useMemo(() => ({
    total: clients.length,
    ativos: clients.filter(c => c.active).length,
    favoritos: clients.filter(c => c.is_favorite).length,
    grupos: economicGroups.length,
    creditoTotal: clients.reduce((s, c) => s + (Number(c.credit_limit) || 0), 0),
  }), [clients, economicGroups]);

  const openAddClient = () => { setEditingClient(null); setForm(emptyClient); setClientDialog(true); };
  const openEditClient = (c: Client) => {
    setEditingClient(c);
    const { id, created_at, updated_at, ...rest } = c;
    setForm(rest as ClientFormData);
    setClientDialog(true);
  };

  const handleClientSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cnpjDigits = form.cnpj.replace(/\D/g, '');
    if (cnpjDigits.length === 14 && !validateCnpj(cnpjDigits)) {
      toast.error('CNPJ inválido — verifique os dígitos verificadores.');
      return;
    }
    if (editingClient) {
      updateClient.mutate({ id: editingClient.id, data: form });
    } else {
      createClient.mutate(form);
    }
    setClientDialog(false);
  };

  const handleExcelImport = async (importedClients: ClientFormData[]) => {
    // Parallelize: skip duplicates without aborting siblings.
    const results = await Promise.allSettled(
      importedClients.map(c => createClient.mutateAsync(c))
    );
    const success = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - success;
    if (failed > 0) {
      toast.warning(`${success} de ${importedClients.length} importados (${failed} duplicados/erros).`);
    } else {
      toast.success(`${success} de ${importedClients.length} clientes importados!`);
    }
  };

  const openAddGroup = () => { 
    setEditingGroup(null); 
    setGroupForm({ 
      name: '', 
      description: '', 
      logo_url: '', 
      silk_url: '', 
      billing_email: '', 
      finance_contact_name: '',
      important_info: ''
    }); 
    setGroupDialog(true); 
  };
  const openEditGroup = (g: EconomicGroup) => {
    setEditingGroup(g);
    setGroupForm({ 
      name: g.name, 
      description: g.description || '', 
      logo_url: g.logo_url || '', 
      silk_url: g.silk_url || '', 
      billing_email: g.billing_email || '', 
      finance_contact_name: g.finance_contact_name || '',
      important_info: g.important_info || ''
    });
    setGroupDialog(true);
  };

  const handleGroupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingGroup) {
      updateGroup.mutate({ id: editingGroup.id, data: groupForm });
    } else {
      createGroup.mutate(groupForm);
    }
    setGroupDialog(false);
  };

  const toggleGroup = (key: string) => setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const groupClients = editingGroup ? clients.filter(c => c.economic_group_id === editingGroup.id) : [];
  const availableClients = useMemo(() => {
    if (!editingGroup) return [];
    const q = normalizeForSearch(storeSearch);
    return clients
      .filter(c => c.economic_group_id !== editingGroup.id)
      .filter(c => {
        if (!q) return true;
        const qd = q.replace(/\D/g, '');
        return normalizeForSearch(c.razao_social).includes(q) ||
          normalizeForSearch(c.nome_fantasia).includes(q) ||
          (qd.length > 0 ? (c.cnpj?.replace(/\D/g, '') ?? '').includes(qd) : normalizeForSearch(c.cnpj).includes(q));
      });
  }, [clients, editingGroup, storeSearch]);

  const toggleStoreSelection = (id: string) => {
    setSelectedStoreIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleAddStoresToGroup = async () => {
    if (!editingGroup || selectedStoreIds.length === 0) return;
    // Parallelize linking — sequential loop hung the page on dozens of stores.
    const results = await Promise.allSettled(
      selectedStoreIds.map(id =>
        updateClient.mutateAsync({ id, data: { economic_group_id: editingGroup.id } })
      )
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      toast.warning(`${selectedStoreIds.length - failed} loja(s) adicionada(s); ${failed} falhou(aram).`);
    } else {
      toast.success(`${selectedStoreIds.length} loja(s) adicionada(s) ao grupo!`);
    }
    setSelectedStoreIds([]);
    setAddStoreDialog(false);
  };

  const handleRemoveFromGroup = (clientId: string) => {
    updateClient.mutate({ id: clientId, data: { economic_group_id: null } });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (isError) {
    return <div className="flex items-center justify-center py-20 text-destructive text-sm">Erro ao carregar clientes: {(error as Error)?.message}</div>;
  }

  return (
    <AppLayout>
      <div className="space-y-5 page-enter editorial-stagger">
        <EditorialPageHeader
          sectionLabel="COMERCIAL · CLIENTES"
          title="Clientes"
          description="Cadastro de lojistas e grupos econômicos"
          actions={
            <Button variant="outline" onClick={() => setImportSmartOpen(true)} className="gap-2" title="Importar lojistas de Excel, PDF, Word ou imagem (IA)">
              <FileUp className="h-4 w-4" />
              <span className="hidden sm:inline">Importar Clientes</span>
            </Button>
          }
        />

        <Tabs defaultValue="clients">
          <TabsList>
            <TabsTrigger value="clients" className="gap-1.5"><Users className="h-4 w-4" />Clientes</TabsTrigger>
            <TabsTrigger value="groups" className="gap-1.5"><Building2 className="h-4 w-4" />Grupos Econômicos</TabsTrigger>
          </TabsList>

          <TabsContent value="clients" className="space-y-4 mt-4">
            {/* KPI strip — kit editorial (StatCard) derivado de dados reais */}
            <StatGrid>
              <StatCard
                label="Clientes"
                value={clientStats.total.toLocaleString('pt-BR')}
                hint={`${clientStats.ativos} ativos`}
              />
              <StatCard
                label="Grupos econômicos"
                value={clientStats.grupos.toLocaleString('pt-BR')}
                hint="carteira agrupada"
              />
              <StatCard
                label="Favoritos"
                value={clientStats.favoritos.toLocaleString('pt-BR')}
                hint="marcados"
                tone="warning"
              />
              <StatCard
                label="Crédito total"
                value={clientStats.creditoTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                hint="limite agregado"
                tone="primary"
              />
            </StatGrid>

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar por razão social, CNPJ, cidade..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleSyncCnpj} disabled={isSyncingCnpj} className="gap-2">
                  <RefreshCw className={cn("h-4 w-4", isSyncingCnpj && "animate-spin")} />
                  {isSyncingCnpj ? 'Sincronizando...' : 'Atualizar CNPJ'}
                </Button>
                <Button variant="outline" onClick={() => setExcelDialog(true)} className="gap-2">
                  <FileUp className="h-4 w-4" />Importar Arquivo
                </Button>
                <Button onClick={openAddClient} className="gap-2">
                  <Plus className="h-4 w-4" />Novo Cliente
                </Button>
              </div>
            </div>

            {filteredClients.length === 0 ? (
              <Panel flush>
                <EmptyState
                  icon={Users}
                  title={search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
                  description={search ? 'Ajuste a busca ou cadastre um novo cliente.' : 'Cadastre o primeiro lojista da carteira.'}
                  action={<Button onClick={openAddClient} className="gap-2"><Plus className="h-4 w-4" />Novo Cliente</Button>}
                />
              </Panel>
            ) : (
              <div className="space-y-4">
                {groupedClients.map(({ group, clients: gc }) => {
                  const key = group?.id || 'ungrouped';
                  const isCollapsed = collapsedGroups[key];
                  // Estatísticas inline do grupo: total clientes ativos +
                  // limite de crédito agregado. Ajuda visualizar "peso" de
                  // cada grupo na carteira.
                  const activeCount = gc.filter(c => c.active).length;
                  const totalCredit = gc.reduce((s, c) => s + (Number(c.credit_limit) || 0), 0);
                  const cities = new Set(gc.map(c => c.cidade).filter(Boolean));
                  return (
                    <div key={key} className={cn(
                      "rounded-lg border overflow-hidden bg-card",
                      group ? "border-border" : "border-dashed border-border"
                    )}>
                      {group ? (
                        <button onClick={() => toggleGroup(key)} className="w-full flex items-center gap-3 px-4 py-3 border-l-2 border-foreground bg-muted/30 hover:bg-muted/50 transition-colors text-left">
                          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", isCollapsed && "-rotate-90")} />
                          <div className="bg-primary/15 p-1.5 rounded-md shrink-0">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm">{group.name}</span>
                              <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                #{group.group_number}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                              <span><strong className="text-foreground">{gc.length}</strong> {gc.length === 1 ? 'loja' : 'lojas'}{activeCount < gc.length ? ` (${activeCount} ativas)` : ''}</span>
                              {cities.size > 0 && <span>· {cities.size} {cities.size === 1 ? 'cidade' : 'cidades'}</span>}
                              {totalCredit > 0 && (
                                <span>· Crédito total: <strong className="font-mono text-foreground">{totalCredit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</strong></span>
                              )}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0 bg-background">
                            {gc.length} {gc.length === 1 ? 'loja' : 'lojas'}
                          </Badge>
                        </button>
                      ) : (
                        <div className="px-4 py-2 bg-muted/20 border-b flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Clientes sem Grupo</span>
                          <Badge variant="outline" className="ml-auto text-[10px]">{gc.length}</Badge>
                        </div>
                      )}
                      {(!group || !isCollapsed) && (
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground [&_th]:h-9">
                              <TableHead className="w-24">Nº</TableHead>
                              <TableHead>Razão Social</TableHead>
                              <TableHead>CNPJ</TableHead>
                              <TableHead>Cidade/UF</TableHead>
                              <TableHead>Telefone</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead className="text-right">Limite Crédito</TableHead>
                              <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {gc.map(c => (
                              <TableRow key={c.id} className={cn("group cursor-pointer hover:bg-muted/50 transition-colors", !c.active && "opacity-50")} onClick={(e) => { if ((e.target as HTMLElement).closest('button')) return; openEditClient(c); }}>
                                <TableCell className="font-mono text-xs text-muted-foreground">{(c as any).client_number || '—'}</TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={(e) => { e.stopPropagation(); updateClient.mutate({ id: c.id, data: { is_favorite: !c.is_favorite } }); }} className="shrink-0">
                                      <Star className={cn("h-4 w-4 transition-colors", c.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30 hover:text-amber-300")} />
                                    </button>
                                    <div>
                                      <div>{c.razao_social}</div>
                                      {c.nome_fantasia && <div className="text-xs text-muted-foreground">{c.nome_fantasia}</div>}
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-sm">{c.cnpj || '—'}</TableCell>
                                <TableCell className="text-sm">{[c.cidade, c.estado].filter(Boolean).join('/') || '—'}</TableCell>
                                <TableCell className="text-sm">{c.telefone || '—'}</TableCell>
                                <TableCell className="text-sm">{c.email || '—'}</TableCell>
                                <TableCell className="text-right text-sm tabular-nums">
                                  {c.credit_limit > 0
                                    ? c.credit_limit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                    : <span className="text-muted-foreground/50">—</span>}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditClient(c)} aria-label="Editar cliente"><Pencil className="h-4 w-4" /></Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteClientId(c.id)} aria-label="Excluir cliente"><Trash2 className="h-4 w-4" /></Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="groups" className="space-y-4 mt-4">
            {economicGroups.length === 0 ? (
              <Panel flush>
                <EmptyState
                  icon={Building2}
                  title="Nenhum grupo econômico cadastrado"
                  description="Agrupe lojas da mesma rede para visão consolidada da carteira."
                  action={<Button onClick={openAddGroup} className="gap-2"><Plus className="h-4 w-4" />Novo Grupo</Button>}
                />
              </Panel>
            ) : (
              <Panel
                eyebrow="COMERCIAL · CARTEIRA"
                title="Grupos Econômicos"
                subtitle={`${economicGroups.length} ${economicGroups.length === 1 ? 'grupo' : 'grupos'}`}
                actions={<Button onClick={openAddGroup} size="sm" className="gap-2"><Plus className="h-4 w-4" />Novo Grupo</Button>}
                flush
              >
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground [&_th]:h-9">
                      <TableHead className="w-24">Nº</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-center">Lojas</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {economicGroups.map(g => {
                      const count = clients.filter(c => c.economic_group_id === g.id).length;
                      // Clique na linha abre a tela 360° (gestão completa). Pencil = edit rápido inline.
                      return (
                        <TableRow key={g.id} className="group cursor-pointer hover:bg-muted/50 transition-colors" onClick={(e) => { if ((e.target as HTMLElement).closest('button')) return; navigate(`/grupos-economicos/${g.id}`); }}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{g.group_number || '—'}</TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              <button onClick={(e) => { e.stopPropagation(); updateGroup.mutate({ id: g.id, data: { name: g.name, description: g.description || '', is_favorite: !g.is_favorite } as any }); }} className="shrink-0">
                                <Star className={cn("h-4 w-4 transition-colors", g.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30 hover:text-amber-300")} />
                              </button>
                              {g.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{g.description || '—'}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">{count}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Abrir 360°" aria-label="Abrir visão 360° do grupo econômico" onClick={() => navigate(`/grupos-economicos/${g.id}`)}><ExternalLink className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Edição rápida" aria-label="Edição rápida do grupo econômico" onClick={() => openEditGroup(g)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteGroupId(g.id)} aria-label="Excluir grupo econômico"><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Panel>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <ClientFormDialog
        open={clientDialog}
        onOpenChange={(open) => { setClientDialog(open); if (!open) { setEditingClient(null); setForm(emptyClient); } }}
        editingClient={editingClient}
        form={form}
        setForm={setForm}
        economicGroups={economicGroups}
        onSubmit={handleClientSubmit}
      />

      <ImportClientsDialog open={importSmartOpen} onOpenChange={setImportSmartOpen} />

      <ExcelImportDialog
        open={excelDialog}
        onOpenChange={setExcelDialog}
        onImport={handleExcelImport}
      />

      <Dialog open={groupDialog} onOpenChange={(open) => { setGroupDialog(open); if (!open) { setEditingGroup(null); setGroupForm({ name: '', description: '', logo_url: '', silk_url: '', billing_email: '', finance_contact_name: '', important_info: '' }); } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Editar Grupo Econômico' : 'Novo Grupo Econômico'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleGroupSubmit} className="space-y-4 mt-2">
            <Tabs defaultValue="dados">
              <TabsList className="w-full">
                <TabsTrigger value="dados" className="flex-1">Dados</TabsTrigger>
                <TabsTrigger value="logos" className="flex-1">Logos & SILK</TabsTrigger>
                {editingGroup && <TabsTrigger value="lojas" className="flex-1">Lojas</TabsTrigger>}
                {editingGroup && <TabsTrigger value="representante" className="flex-1">Representante</TabsTrigger>}
              </TabsList>
              <TabsContent value="dados" className="space-y-4 mt-3">
                <div>
                  <Label>Nome *</Label>
                  <Input value={groupForm.name} onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))} required className="mt-1" placeholder="Ex: Grupo XYZ" />
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Textarea value={groupForm.description} onChange={e => setGroupForm(f => ({ ...f, description: e.target.value }))} className="mt-1" rows={2} />
                </div>
                <div>
                  <Label>Informações Importantes (Relatórios)</Label>
                  <Textarea 
                    value={groupForm.important_info} 
                    onChange={e => setGroupForm(f => ({ ...f, important_info: e.target.value }))} 
                    className="mt-1" 
                    rows={3} 
                    placeholder="Informações que devem aparecer nas lojas do grupo e relatórios..."
                  />
                </div>
                <div className="rounded-lg border p-4 bg-muted/30 space-y-3">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    Informações Financeiras do Grupo
                  </p>
                  <div>
                    <Label>Responsável Financeiro</Label>
                    <Input value={groupForm.finance_contact_name} onChange={e => setGroupForm(f => ({ ...f, finance_contact_name: e.target.value }))} className="mt-1" placeholder="Nome do responsável" />
                  </div>
                  <div>
                    <Label>E-mail para Cobrança</Label>
                    <Input type="email" value={groupForm.billing_email} onChange={e => setGroupForm(f => ({ ...f, billing_email: e.target.value }))} className="mt-1" placeholder="financeiro@empresa.com" />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="logos" className="mt-3 space-y-6">
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold border-b pb-2">Logo do Grupo</h4>
                  <ClientLogoTab
                    clientId={editingGroup?.id || 'group'}
                    logoUrl={groupForm.logo_url}
                    onLogoChange={(url) => setGroupForm(f => ({ ...f, logo_url: url }))}
                  />
                </div>
                <div className="space-y-4 pt-2 border-t">
                  <h4 className="text-sm font-semibold border-b pb-2">SILK Padrão do Grupo</h4>
                  <p className="text-xs text-muted-foreground">Este silk será usado em todas as fichas de produção das lojas deste grupo, a menos que a loja tenha um silk próprio.</p>
                  <ClientLogoTab
                    clientId={editingGroup?.id ? `${editingGroup.id}-silk` : 'group-silk'}
                    logoUrl={groupForm.silk_url}
                    onLogoChange={(url) => setGroupForm(f => ({ ...f, silk_url: url }))}
                  />
                </div>
              </TabsContent>
              {editingGroup && (
                <TabsContent value="lojas" className="mt-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{groupClients.length} loja(s) neste grupo</p>
                    <Button type="button" size="sm" className="gap-1.5" onClick={() => { setStoreSearch(''); setSelectedStoreIds([]); setAddStoreDialog(true); }}>
                      <Store className="h-4 w-4" />Adicionar Loja
                    </Button>
                  </div>
                  {groupClients.length > 0 ? (
                    <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                      {groupClients.map(c => (
                        <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                          <div>
                            <span className="font-medium">{c.razao_social}</span>
                            {c.nome_fantasia && <span className="text-muted-foreground ml-2">({c.nome_fantasia})</span>}
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRemoveFromGroup(c.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-6">Nenhuma loja vinculada</p>
                  )}
                </TabsContent>
              )}
              {editingGroup && (
                <TabsContent value="representante" className="mt-3">
                  <RepresentativeTab entityId={editingGroup.id} type="group" />
                </TabsContent>
              )}
            </Tabs>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setGroupDialog(false)}>Cancelar</Button>
              <Button type="submit">{editingGroup ? 'Salvar' : 'Criar'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ADD STORE TO GROUP DIALOG */}
      <Dialog open={addStoreDialog} onOpenChange={setAddStoreDialog}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Adicionar Lojas ao Grupo</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar cliente..." value={storeSearch} onChange={e => setStoreSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex-1 overflow-y-auto rounded-md border divide-y min-h-0 max-h-[50vh]">
            {availableClients.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">Nenhum cliente disponível</p>
            ) : (
              availableClients.map(c => {
                const selected = selectedStoreIds.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggleStoreSelection(c.id)}
                    className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors", selected && "bg-primary/5")}>
                    <Checkbox checked={selected} className="pointer-events-none" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{c.razao_social}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[c.nome_fantasia, c.cnpj, c.cidade].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {selectedStoreIds.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-muted-foreground">{selectedStoreIds.length} selecionada(s)</span>
              <Button onClick={handleAddStoresToGroup} className="gap-1.5">
                <Check className="h-4 w-4" />Adicionar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteClientId} onOpenChange={(open) => { if (!open) setDeleteClientId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O cliente será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteClientId) { deleteClient.mutate(deleteClientId); setDeleteClientId(null); } }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteGroupId} onOpenChange={(open) => { if (!open) setDeleteGroupId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir grupo econômico?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O grupo será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteGroupId) { deleteGroup.mutate(deleteGroupId); setDeleteGroupId(null); } }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
