import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Lightning as Zap, Plus, Play, Trash as Trash2, PencilSimple as Pencil, Copy, ShoppingCart, Package, CurrencyDollar as DollarSign, Truck, Factory, CheckCircle as CheckCircle2, XCircle, ArrowRight, Funnel as Filter, Bell, Envelope as Mail, FileText, ArrowsClockwise as RefreshCw, Gear as Settings2, Pulse as Activity, Stack as Layers, Eye, Warning as AlertTriangle, Clock, Webhook, BookOpen, TrendDown as TrendingDown, ArrowCounterClockwise as RotateCcw } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useAutomationWorkflows,
  useAddWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useToggleWorkflow,
  useRunWorkflow,
  useAutomationExecutions,
  type AutomationWorkflow,
  type WorkflowCondition,
  type WorkflowAction,
  type WorkflowInsert,
} from '@/hooks/useAutomations';

// ─── Static config ────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { group: 'Estoque',     value: 'stock_below_minimum',        label: 'Estoque abaixo do mínimo' },
  { group: 'Estoque',     value: 'stock_zeroed',               label: 'Estoque zerado' },
  { group: 'Estoque',     value: 'stock_restocked',            label: 'Estoque reposto' },
  { group: 'Pedidos',     value: 'sale_order_created',         label: 'Pedido de venda criado' },
  { group: 'Pedidos',     value: 'sale_order_approved',        label: 'Pedido de venda aprovado' },
  { group: 'Pedidos',     value: 'sale_order_completed',       label: 'Pedido de venda concluído' },
  { group: 'Produção',    value: 'production_order_created',   label: 'OP criada' },
  { group: 'Produção',    value: 'production_order_completed', label: 'OP concluída' },
  { group: 'Produção',    value: 'production_wave_completed',  label: 'Onda de produção concluída' },
  { group: 'Financeiro',  value: 'payment_received',           label: 'Pagamento confirmado' },
  { group: 'Financeiro',  value: 'payment_overdue',            label: 'Pagamento em atraso' },
  { group: 'Financeiro',  value: 'purchase_order_approved',    label: 'OC aprovada' },
  { group: 'Serviços',    value: 'service_order_completed',    label: 'OS de terceirizado concluída' },
  { group: 'Serviços',    value: 'delivery_overdue',           label: 'Prazo de entrega vencido' },
  { group: 'Agendado',    value: 'scheduled_daily',            label: 'Todo dia (agendado)' },
  { group: 'Manual',      value: 'manual',                     label: 'Execução manual' },
];

const ACTION_OPTIONS: { value: string; label: string; icon: React.ElementType }[] = [
  { value: 'notification',           label: 'Notificação in-app',  icon: Bell },
  { value: 'email',                  label: 'Enviar email',        icon: Mail },
  { value: 'update_status',          label: 'Atualizar status',    icon: RefreshCw },
  { value: 'create_purchase_order',  label: 'Gerar OC',            icon: ShoppingCart },
  { value: 'create_production_order',label: 'Criar OP',            icon: Factory },
  { value: 'create_accounts_payable',label: 'Conta a pagar',       icon: DollarSign },
  { value: 'create_accounts_receivable', label: 'Conta a receber', icon: TrendingDown },
  { value: 'reserve_materials',      label: 'Reservar materiais',  icon: Package },
  { value: 'webhook',                label: 'Webhook externo',     icon: Zap },
  { value: 'log_event',              label: 'Registrar no log',    icon: BookOpen },
];

type ConfigFieldDef = { key: string; label: string; type: 'text' | 'select'; options?: { value: string; label: string }[] };

const ACTION_CONFIG_FIELDS: Record<string, ConfigFieldDef[]> = {
  notification: [
    { key: 'title',    label: 'Título',     type: 'text' },
    { key: 'message',  label: 'Mensagem',   type: 'text' },
    { key: 'severity', label: 'Tipo',       type: 'select', options: [
      { value: 'info',    label: 'Informação' },
      { value: 'success', label: 'Sucesso' },
      { value: 'warning', label: 'Alerta' },
      { value: 'error',   label: 'Crítico' },
    ]},
  ],
  email: [
    { key: 'to',       label: 'Destinatário (email)', type: 'text' },
    { key: 'subject',  label: 'Assunto',              type: 'text' },
    { key: 'template', label: 'Modelo',               type: 'select', options: [
      { value: 'generic',            label: 'Genérico' },
      { value: 'payment_overdue',    label: 'Cobrança' },
      { value: 'delivery_delay',     label: 'Atraso de entrega' },
      { value: 'order_confirmation', label: 'Confirmação de pedido' },
    ]},
  ],
  update_status: [
    { key: 'new_status', label: 'Novo status', type: 'text' },
  ],
  create_purchase_order: [
    { key: 'notes',    label: 'Observações', type: 'text' },
    { key: 'priority', label: 'Prioridade',  type: 'select', options: [
      { value: 'normal',  label: 'Normal' },
      { value: 'urgent',  label: 'Urgente' },
    ]},
  ],
  create_production_order: [
    { key: 'department', label: 'Setor',       type: 'text' },
    { key: 'notes',      label: 'Observações', type: 'text' },
  ],
  create_accounts_payable: [
    { key: 'description', label: 'Descrição',       type: 'text' },
    { key: 'due_days',    label: 'Prazo (dias)',     type: 'text' },
  ],
  create_accounts_receivable: [
    { key: 'description', label: 'Descrição',   type: 'text' },
    { key: 'due_days',    label: 'Prazo (dias)', type: 'text' },
  ],
  reserve_materials: [
    { key: 'notes', label: 'Observações', type: 'text' },
  ],
  webhook: [
    { key: 'url',    label: 'URL de destino',          type: 'text' },
    { key: 'method', label: 'Método HTTP',             type: 'select', options: [
      { value: 'POST', label: 'POST' },
      { value: 'GET',  label: 'GET' },
      { value: 'PUT',  label: 'PUT' },
    ]},
    { key: 'secret', label: 'Token/Segredo (opcional)', type: 'text' },
  ],
  log_event: [
    { key: 'message', label: 'Mensagem do log', type: 'text' },
    { key: 'level',   label: 'Nível',           type: 'select', options: [
      { value: 'info',    label: 'Info' },
      { value: 'warning', label: 'Aviso' },
      { value: 'error',   label: 'Erro' },
    ]},
  ],
};

const CONDITION_FIELDS_BY_TRIGGER: Record<string, { value: string; label: string }[]> = {
  stock_below_minimum:        [{ value: 'quantity', label: 'Quantidade' }, { value: 'category', label: 'Categoria' }, { value: 'supplier_name', label: 'Fornecedor' }],
  stock_zeroed:               [{ value: 'category', label: 'Categoria' }, { value: 'supplier_name', label: 'Fornecedor' }],
  stock_restocked:            [{ value: 'quantity', label: 'Quantidade' }, { value: 'category', label: 'Categoria' }],
  sale_order_created:         [{ value: 'status', label: 'Status' }, { value: 'total_value', label: 'Valor Total' }, { value: 'customer_name', label: 'Cliente' }, { value: 'payment_method', label: 'Forma de Pagamento' }],
  sale_order_approved:        [{ value: 'total_value', label: 'Valor Total' }, { value: 'customer_name', label: 'Cliente' }],
  sale_order_completed:       [{ value: 'total_value', label: 'Valor Total' }, { value: 'status', label: 'Status' }],
  production_order_created:   [{ value: 'quantity', label: 'Quantidade' }, { value: 'product_name', label: 'Produto' }, { value: 'department', label: 'Setor' }],
  production_order_completed: [{ value: 'quantity', label: 'Quantidade' }, { value: 'product_name', label: 'Produto' }, { value: 'department', label: 'Setor' }, { value: 'quality_status', label: 'Status de Qualidade' }],
  production_wave_completed:  [{ value: 'wave_number', label: 'Número da Onda' }, { value: 'total_pairs', label: 'Total de Pares' }],
  payment_received:           [{ value: 'amount', label: 'Valor' }, { value: 'customer_name', label: 'Cliente' }, { value: 'payment_method', label: 'Forma de Pagamento' }],
  payment_overdue:            [{ value: 'days_overdue', label: 'Dias em Atraso' }, { value: 'amount', label: 'Valor' }, { value: 'customer_name', label: 'Cliente' }],
  purchase_order_approved:    [{ value: 'total_value', label: 'Valor Total' }, { value: 'supplier_name', label: 'Fornecedor' }],
  service_order_completed:    [{ value: 'type', label: 'Tipo (terceirizado/interno)' }, { value: 'value', label: 'Valor' }, { value: 'supplier_name', label: 'Fornecedor' }],
  delivery_overdue:           [{ value: 'days_overdue', label: 'Dias em Atraso' }, { value: 'customer_name', label: 'Cliente' }, { value: 'status', label: 'Status' }],
  scheduled_daily:            [],
  manual:                     [],
};

const OPERATOR_LABELS: Record<string, string> = {
  equals:        'igual a',
  not_equals:    'diferente de',
  greater_than:  'maior que',
  less_than:     'menor que',
  contains:      'contém',
  is_empty:      'está vazio',
  is_not_empty:  'não está vazio',
};

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  orders:     { label: 'Pedidos',      icon: ShoppingCart, color: 'text-primary' },
  stock:      { label: 'Estoque',      icon: Package,      color: 'text-amber-600' },
  finance:    { label: 'Financeiro',   icon: DollarSign,   color: 'text-success' },
  shipping:   { label: 'Logística',    icon: Truck,        color: 'text-primary' },
  production: { label: 'Produção',     icon: Factory,      color: 'text-primary' },
  quality:    { label: 'Qualidade',    icon: CheckCircle2, color: 'text-success' },
};

// ─── Empty form ────────────────────────────────────────────────────────────────

const EMPTY_FORM: WorkflowInsert = {
  name: '', description: '', trigger: '', trigger_label: '',
  conditions: [], actions: [], enabled: false, category: 'orders',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Automations() {
  const { data: workflows = [], isLoading, error } = useAutomationWorkflows();
  const { data: executions = [] } = useAutomationExecutions();

  const addWorkflow    = useAddWorkflow();
  const updateWorkflow = useUpdateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const toggleWorkflow = useToggleWorkflow();
  const runWorkflow    = useRunWorkflow();

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dialogOpen,     setDialogOpen]     = useState(false);
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [detailWf,       setDetailWf]       = useState<AutomationWorkflow | null>(null);
  const [runningId,      setRunningId]      = useState<string | null>(null);
  const [deleteWfId,     setDeleteWfId]     = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState<WorkflowInsert>(EMPTY_FORM);

  const filtered = categoryFilter === 'all' ? workflows : workflows.filter(w => w.category === categoryFilter);
  const activeCount     = workflows.filter(w => w.enabled).length;
  const totalExecutions = workflows.reduce((s, w) => s + w.execution_count, 0);
  const avgSuccess      = workflows.length > 0
    ? Math.round(workflows.reduce((s, w) => s + (w.execution_count > 0 ? (w.success_count / w.execution_count) * 100 : 0), 0) / workflows.length)
    : 0;

  // ── Form helpers ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (wf: AutomationWorkflow) => {
    setEditingId(wf.id);
    setForm({
      name: wf.name, description: wf.description,
      trigger: wf.trigger, trigger_label: wf.trigger_label,
      conditions: wf.conditions.map(c => ({ ...c })),
      actions: wf.actions.map(a => ({ ...a, config: { ...a.config } })),
      enabled: wf.enabled, category: wf.category,
    });
    setDialogOpen(true);
  };

  const setTrigger = (value: string) => {
    const opt = TRIGGER_OPTIONS.find(t => t.value === value);
    setForm(f => ({ ...f, trigger: value, trigger_label: opt?.label ?? value, conditions: [] }));
  };

  // conditions
  const addCondition = () =>
    setForm(f => ({ ...f, conditions: [...f.conditions, { id: `c-${Date.now()}`, field: '', operator: 'equals', value: '' }] }));
  const removeCondition = (id: string) =>
    setForm(f => ({ ...f, conditions: f.conditions.filter(c => c.id !== id) }));
  const updateCondition = (id: string, patch: Partial<WorkflowCondition>) =>
    setForm(f => ({ ...f, conditions: f.conditions.map(c => c.id === id ? { ...c, ...patch } : c) }));

  // actions
  const addAction = (type: string) => {
    const opt = ACTION_OPTIONS.find(a => a.value === type);
    setForm(f => ({ ...f, actions: [...f.actions, { id: `a-${Date.now()}`, type, label: opt?.label ?? type, config: {} }] }));
  };
  const removeAction = (id: string) =>
    setForm(f => ({ ...f, actions: f.actions.filter(a => a.id !== id) }));
  const updateActionConfig = (id: string, key: string, value: string) =>
    setForm(f => ({ ...f, actions: f.actions.map(a => a.id === id ? { ...a, config: { ...a.config, [key]: value } } : a) }));

  // save
  const handleSave = () => {
    if (!form.name.trim())       { toast.error('Nome da automação é obrigatório'); return; }
    if (!form.trigger)           { toast.error('Selecione um gatilho'); return; }
    if (form.actions.length < 1) { toast.error('Adicione pelo menos uma ação'); return; }
    const incomplete = form.conditions.find(c => !c.field.trim() || (!c.value.trim() && !['is_empty', 'is_not_empty'].includes(c.operator)));
    if (incomplete) { toast.error('Preencha todos os campos das condições'); return; }

    if (editingId) {
      updateWorkflow.mutate({ id: editingId, data: form }, { onSuccess: () => setDialogOpen(false) });
    } else {
      addWorkflow.mutate(form, { onSuccess: () => setDialogOpen(false) });
    }
  };

  const handleDuplicate = (wf: AutomationWorkflow) => {
    addWorkflow.mutate({
      name: `${wf.name} (cópia)`, description: wf.description,
      trigger: wf.trigger, trigger_label: wf.trigger_label,
      conditions: wf.conditions.map(c => ({ ...c, id: `c-${Date.now()}-${Math.random()}` })),
      actions: wf.actions.map(a => ({ ...a, id: `a-${Date.now()}-${Math.random()}`, config: { ...a.config } })),
      enabled: false, category: wf.category,
    });
  };

  const handleRun = async (wf: AutomationWorkflow) => {
    setRunningId(wf.id);
    runWorkflow.mutate(wf, { onSettled: () => setRunningId(null) });
  };

  // ── Condition fields for current trigger ─────────────────────────────────

  const conditionFields = form.trigger
    ? (CONDITION_FIELDS_BY_TRIGGER[form.trigger] ?? [{ value: 'value', label: 'Valor' }])
    : [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-5 page-enter">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="display text-xl tracking-tight flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />Automações
          </h1>
          <p className="text-sm text-muted-foreground">Workflows inteligentes com gatilhos e ações configuráveis</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />Nova Automação
        </Button>
      </div>

      {/* Error banner when DB table not yet created */}
      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Tabela não encontrada</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aplique a migração <code>20260427170000_automation-tables.sql</code> no Supabase Dashboard para ativar a persistência.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total</p>
            <p className="display text-2xl tabular-nums font-mono mt-1">{workflows.length}</p>
            <p className="text-[11px] text-muted-foreground">automações</p>
          </CardContent>
        </Card>
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Ativas</p>
            <p className="display text-2xl tabular-nums font-mono mt-1 text-success">{activeCount}</p>
            <p className="text-[11px] text-muted-foreground">habilitadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Execuções</p>
            <p className="display text-2xl tabular-nums font-mono mt-1">{totalExecutions}</p>
            <p className="text-[11px] text-muted-foreground">total acumulado</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Taxa de Sucesso</p>
            <p className="display text-2xl tabular-nums font-mono mt-1">{avgSuccess}%</p>
            <p className="text-[11px] text-muted-foreground">média geral</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="workflows" className="space-y-4">
        <TabsList>
          <TabsTrigger value="workflows" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />Workflows
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Histórico
            {executions.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono">{executions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Workflows tab ──────────────────────────────────────────────────── */}
        <TabsContent value="workflows" className="space-y-4">
          <div className="flex items-center gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[170px] h-9 text-xs">
                <Filter className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading && (
            <div className="text-center py-10 text-muted-foreground text-sm">Carregando automações…</div>
          )}

          <div className="grid gap-3">
            {filtered.map(wf => {
              const cat     = CATEGORY_CONFIG[wf.category] ?? CATEGORY_CONFIG.orders;
              const CatIcon = cat.icon;
              const isRunning = runningId === wf.id;
              return (
                <Card key={wf.id} className={cn('transition-all', !wf.enabled && 'opacity-60')}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={cn('rounded-xl p-2.5 shrink-0', wf.enabled ? 'bg-primary/10' : 'bg-muted')}>
                        <CatIcon className={cn('h-5 w-5', wf.enabled ? cat.color : 'text-muted-foreground')} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm">{wf.name}</h3>
                          <Badge variant="outline" className="text-[10px]">{cat.label}</Badge>
                          {wf.enabled
                            ? <Badge variant="default" className="text-[10px] bg-success/15 text-success border-success/30">Ativo</Badge>
                            : <Badge variant="secondary" className="text-[10px]">Inativo</Badge>
                          }
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{wf.description}</p>

                        {/* Flow visualization */}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Zap className="h-2.5 w-2.5" />{wf.trigger_label}
                          </Badge>
                          {wf.conditions.length > 0 && (
                            <>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <Badge variant="outline" className="text-[10px] gap-1">
                                <Filter className="h-2.5 w-2.5" />{wf.conditions.length} condição(ões)
                              </Badge>
                            </>
                          )}
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Play className="h-2.5 w-2.5" />{wf.actions.length} ação(ões)
                          </Badge>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
                          <span>{wf.execution_count} execuções</span>
                          {wf.execution_count > 0 && (
                            <span>{Math.round((wf.success_count / wf.execution_count) * 100)}% sucesso</span>
                          )}
                          {wf.last_run_at && (
                            <span>Última: {new Date(wf.last_run_at).toLocaleDateString('pt-BR')}</span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        <Switch
                          checked={wf.enabled}
                          onCheckedChange={checked => toggleWorkflow.mutate({ id: wf.id, enabled: checked })}
                        />
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs gap-1 ml-1"
                          disabled={isRunning}
                          onClick={() => handleRun(wf)}
                        >
                          {isRunning
                            ? <RotateCcw className="h-3 w-3 animate-spin" />
                            : <Play className="h-3 w-3" />}
                          {isRunning ? 'Executando…' : 'Executar'}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDetailWf(wf)} aria-label={`Ver detalhes do workflow ${wf.name}`}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(wf)} aria-label={`Editar workflow ${wf.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDuplicate(wf)} aria-label={`Duplicar workflow ${wf.name}`}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                          onClick={() => setDeleteWfId(wf.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {!isLoading && filtered.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Zap className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nenhuma automação encontrada</p>
                  <Button variant="outline" className="mt-3 gap-2 text-xs" onClick={openNew}>
                    <Plus className="h-3.5 w-3.5" />Criar primeira automação
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── History tab ────────────────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Histórico de Execuções
                <Badge variant="secondary" className="text-xs font-mono ml-auto">{executions.length} registros</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {executions.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  Nenhuma execução registrada ainda.<br />
                  <span className="text-xs">Use o botão "Executar" em qualquer automação para criar o primeiro registro.</span>
                </div>
              ) : (
                <ScrollArea className="h-[420px]">
                  <div className="divide-y">
                    {executions.map(ex => {
                      const isOk = ex.status === 'success';
                      return (
                        <div key={ex.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                          {isOk
                            ? <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                            : <XCircle      className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{ex.workflow_name}</p>
                            <p className="text-xs text-muted-foreground">{TRIGGER_OPTIONS.find(t => t.value === ex.trigger)?.label ?? ex.trigger}</p>
                            {ex.error_message && (
                              <p className="text-xs text-destructive mt-0.5">{ex.error_message}</p>
                            )}
                            {ex.status === 'success' && (ex.result as any)?.actions_queued?.length > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                Ações: {((ex.result as any).actions_queued as { label: string }[]).map(a => a.label).join(', ')}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <Badge
                              variant="outline"
                              className={cn('text-[10px]', isOk ? 'text-success border-success/40' : 'text-destructive border-destructive/40')}
                            >
                              {isOk ? 'sucesso' : 'erro'}
                            </Badge>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {new Date(ex.executed_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Create / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Automação' : 'Nova Automação'}</DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-1">
            <div className="space-y-5 pb-2">

              {/* Basic fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Nome *</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Nome da automação"
                    className="h-9 mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Descrição</Label>
                  <Textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Descreva o objetivo desta automação…"
                    rows={2}
                    className="text-xs mt-1 resize-none"
                  />
                </div>
                <div>
                  <Label className="text-xs">Categoria</Label>
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger className="h-9 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Gatilho *</Label>
                  <Select value={form.trigger} onValueChange={setTrigger}>
                    <SelectTrigger className="h-9 text-xs mt-1"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(
                        TRIGGER_OPTIONS.reduce<Record<string, typeof TRIGGER_OPTIONS>>((acc, t) => {
                          (acc[t.group] = acc[t.group] ?? []).push(t);
                          return acc;
                        }, {})
                      ).map(([group, triggers]) => (
                        <div key={group}>
                          <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{group}</p>
                          {triggers.map(t => (
                            <SelectItem key={t.value} value={t.value} className="text-xs pl-4">{t.label}</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Conditions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Condições</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addCondition} disabled={!form.trigger}>
                    <Plus className="h-3 w-3" />Adicionar
                  </Button>
                </div>
                {!form.trigger && (
                  <p className="text-xs text-muted-foreground">Selecione um gatilho para configurar condições.</p>
                )}
                {form.trigger && form.conditions.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">Nenhuma condição — executa sempre que o gatilho disparar.</p>
                )}
                <div className="space-y-2">
                  {form.conditions.map(cond => (
                    <div key={cond.id} className="flex items-center gap-2 p-2 border rounded-lg bg-muted/20">
                      {/* Field */}
                      {conditionFields.length > 0 ? (
                        <Select value={cond.field} onValueChange={v => updateCondition(cond.id, { field: v })}>
                          <SelectTrigger className="h-7 text-xs flex-1 min-w-0"><SelectValue placeholder="Campo…" /></SelectTrigger>
                          <SelectContent>
                            {conditionFields.map(f => (
                              <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={cond.field}
                          onChange={e => updateCondition(cond.id, { field: e.target.value })}
                          placeholder="Campo"
                          className="h-7 text-xs flex-1"
                        />
                      )}
                      {/* Operator */}
                      <Select value={cond.operator} onValueChange={v => updateCondition(cond.id, { operator: v as WorkflowCondition['operator'] })}>
                        <SelectTrigger className="h-7 text-xs w-32 shrink-0"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(OPERATOR_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Value */}
                      {!['is_empty', 'is_not_empty'].includes(cond.operator) && (
                        <Input
                          value={cond.value}
                          onChange={e => updateCondition(cond.id, { value: e.target.value })}
                          placeholder="Valor"
                          className="h-7 text-xs flex-1"
                        />
                      )}
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeCondition(cond.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Actions */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Ações *</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {ACTION_OPTIONS.map(a => {
                    const Icon = a.icon;
                    return (
                      <Button key={a.value} size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => addAction(a.value)}>
                        <Icon className="h-3 w-3" />{a.label}
                      </Button>
                    );
                  })}
                </div>
                {form.actions.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">Nenhuma ação adicionada.</p>
                )}
                <div className="space-y-2">
                  {form.actions.map((action, i) => {
                    const opt    = ACTION_OPTIONS.find(a => a.value === action.type);
                    const Icon   = opt?.icon ?? Zap;
                    const fields = ACTION_CONFIG_FIELDS[action.type] ?? [];
                    return (
                      <div key={action.id} className="border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
                          <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">{i + 1}</Badge>
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs font-medium flex-1">{action.label}</span>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeAction(action.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        {fields.length > 0 && (
                          <div className="px-3 pb-3 pt-2 grid grid-cols-2 gap-2 bg-muted/10">
                            {fields.map(field => (
                              <div key={field.key} className={cn(field.key === 'message' || field.key === 'notes' || field.key === 'url' ? 'col-span-2' : '')}>
                                <Label className="text-[10px] text-muted-foreground">{field.label}</Label>
                                {field.type === 'select' ? (
                                  <Select
                                    value={action.config[field.key] ?? ''}
                                    onValueChange={v => updateActionConfig(action.id, field.key, v)}
                                  >
                                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                                    <SelectContent>
                                      {field.options?.map(o => (
                                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Input
                                    value={action.config[field.key] ?? ''}
                                    onChange={e => updateActionConfig(action.id, field.key, e.target.value)}
                                    placeholder={field.label}
                                    className="h-7 text-xs mt-0.5"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="pt-3 border-t">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={addWorkflow.isPending || updateWorkflow.isPending}>
              {addWorkflow.isPending || updateWorkflow.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Detail Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={!!detailWf} onOpenChange={() => setDetailWf(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailWf && (() => {
                const cat  = CATEGORY_CONFIG[detailWf.category] ?? CATEGORY_CONFIG.orders;
                const Icon = cat.icon;
                return <Icon className={cn('h-5 w-5', cat.color)} />;
              })()}
              {detailWf?.name}
            </DialogTitle>
          </DialogHeader>
          {detailWf && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{detailWf.description || 'Sem descrição'}</p>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Fluxo</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="text-xs font-medium">{detailWf.trigger_label}</span>
                  </div>
                  {detailWf.conditions.map(c => (
                    <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20 ml-4">
                      <Filter className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      <span className="text-xs">
                        <span className="font-medium">{conditionFields.find(f => f.value === c.field)?.label ?? c.field}</span>
                        {' '}{OPERATOR_LABELS[c.operator] ?? c.operator}
                        {!['is_empty', 'is_not_empty'].includes(c.operator) && <> <span className="font-medium">{c.value}</span></>}
                      </span>
                    </div>
                  ))}
                  {detailWf.actions.map((a, i) => {
                    const opt  = ACTION_OPTIONS.find(o => o.value === a.type);
                    const Icon = opt?.icon ?? Zap;
                    return (
                      <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg bg-success/5 border border-success/20 ml-8">
                        <Icon className="h-3.5 w-3.5 text-success shrink-0" />
                        <span className="text-xs flex-1">{a.label}</span>
                        <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-lg font-bold font-mono">{detailWf.execution_count}</p>
                  <p className="text-[10px] text-muted-foreground">Execuções</p>
                </div>
                <div>
                  <p className="text-lg font-bold font-mono">
                    {detailWf.execution_count > 0
                      ? `${Math.round((detailWf.success_count / detailWf.execution_count) * 100)}%`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Sucesso</p>
                </div>
                <div>
                  <p className="text-lg font-bold font-mono">
                    {detailWf.last_run_at
                      ? new Date(detailWf.last_run_at).toLocaleDateString('pt-BR')
                      : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Última exec.</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-2"
                  disabled={runningId === detailWf.id}
                  onClick={() => { handleRun(detailWf); setDetailWf(null); }}
                >
                  <Play className="h-4 w-4" />Executar agora
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => { openEdit(detailWf); setDetailWf(null); }}>
                  <Pencil className="h-4 w-4" />Editar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteWfId} onOpenChange={(open) => { if (!open) setDeleteWfId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir automação?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A automação será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteWfId) { deleteWorkflow.mutate(deleteWfId); setDeleteWfId(null); } }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const Component = Automations;
