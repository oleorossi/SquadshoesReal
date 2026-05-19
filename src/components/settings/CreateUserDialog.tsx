import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CircleNotch as Loader2, Warning as AlertTriangle, Check, Lightning as Zap } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { MENU_OPTIONS, getMenuOptionsGrouped, type MenuOption } from '@/lib/userMenuOptions';

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RoleDef {
  key: string;
  label: string;
  description: string;
  /** Conjunto de módulos que essa role libera (deve casar com MENU_OPTIONS) */
  modules: string[];
}

const ROLES: RoleDef[] = [
  { key: 'admin', label: 'Administrador', description: 'Acesso total — TODOS os menus + sistema', modules: MENU_OPTIONS.map(m => m.module) },
  { key: 'gerente', label: 'Gerente', description: 'Quase tudo, exceto telas de sistema/admin', modules: ['dashboard', 'estoque', 'produtos', 'ordens', 'vendas', 'clientes', 'reports', 'financeiro', 'nfe', 'empresas_fiscal', 'fornecedores', 'terceirizados', 'rh', 'rh_folha', 'producao', 'expedicao'] },
  { key: 'comercial', label: 'Comercial', description: 'Vendas, clientes e relatórios', modules: ['dashboard', 'vendas', 'clientes', 'reports'] },
  { key: 'producao', label: 'Produção', description: 'Chão de fábrica — OPs, estoque, expedição', modules: ['dashboard', 'estoque', 'produtos', 'ordens', 'producao', 'vendas', 'expedicao'] },
  { key: 'almoxarifado', label: 'Almoxarifado', description: 'Só estoque', modules: ['dashboard', 'estoque'] },
  { key: 'nfe_operator', label: 'Operador NF-e', description: 'NF + cadastros básicos', modules: ['dashboard', 'vendas', 'clientes', 'nfe', 'empresas_fiscal'] },
  { key: 'rh', label: 'RH', description: 'Funcionários e ponto. SEM folha', modules: ['dashboard', 'rh', 'terceirizados'] },
  { key: 'consulta', label: 'Consulta', description: 'Acesso amplo em modo leitura', modules: ['dashboard', 'estoque', 'produtos', 'ordens', 'vendas', 'clientes', 'reports', 'financeiro', 'nfe', 'empresas_fiscal', 'fornecedores', 'terceirizados', 'rh', 'producao', 'expedicao'] },
];

export default function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  // Aba "rapida" (role) vs "granular" (checkbox por menu)
  const [mode, setMode] = useState<'role' | 'granular'>('role');
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set(['comercial']));
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set(['dashboard']));
  const [approveNow, setApproveNow] = useState(true);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const grouped = useMemo(() => getMenuOptionsGrouped(), []);

  const toggleRole = (key: string) => {
    setSelectedRoles(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleModule = (module: string) => {
    setSelectedModules(prev => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module); else next.add(module);
      // Dashboard sempre marcado (tela inicial)
      next.add('dashboard');
      return next;
    });
  };

  const markAllModulesInGroup = (groupKey: MenuOption['group']) => {
    setSelectedModules(prev => {
      const next = new Set(prev);
      next.add('dashboard');
      for (const opt of grouped[groupKey] || []) {
        if (!opt.adminOnly) next.add(opt.module);
      }
      return next;
    });
  };

  const reset = () => {
    setEmail('');
    setPassword('');
    setFullName('');
    setMode('role');
    setSelectedRoles(new Set(['comercial']));
    setSelectedModules(new Set(['dashboard']));
    setApproveNow(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'role' && selectedRoles.size === 0) {
      toast.error('Selecione pelo menos uma role.');
      return;
    }
    if (mode === 'granular' && selectedModules.size <= 1) {
      // só dashboard marcado = nada útil liberado
      toast.error('Selecione pelo menos um menu além do Painel.');
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

      // Em modo granular, ainda precisa de uma role base pra satisfazer
      // checagens que dependem só de role (admin/gerente). Usamos 'consulta'
      // como base mínima — sem permissão de escrita por padrão. A granular
      // (user_permissions) controla quais MENUS aparecem.
      const rolesToSend = mode === 'role'
        ? Array.from(selectedRoles)
        : ['consulta'];

      const allowedModules = mode === 'granular'
        ? Array.from(selectedModules)
        : undefined;

      const res = await supabase.functions.invoke('create-user', {
        body: {
          email,
          password,
          full_name: fullName,
          roles: rolesToSend,
          approve: approveNow,
          allowed_modules: allowedModules,
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.data?.error) throw new Error(res.data.error);
      if (res.error) throw new Error(res.error.message);
      if (res.data?.warning) toast.warning(res.data.warning, { duration: 10000 });

      const approved = res.data?.approved !== false;
      toast.success(
        `Usuário criado com sucesso! ${approved ? '(aprovado e pronto pra acessar)' : '(pendente de aprovação)'}`,
        { duration: 6000 },
      );
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['user_roles'] });
      qc.invalidateQueries({ queryKey: ['user_permissions'] });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar usuário', { duration: 10000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar Novo Usuário</DialogTitle>
          <DialogDescription>
            Preencha os dados do usuário e escolha quais menus ele verá. Use a aba <strong>Perfil rápido</strong> pra atribuir uma role pronta, ou <strong>Permissões específicas</strong> pra escolher menu por menu.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="create-name">Nome completo</Label>
              <Input id="create-name" placeholder="Nome do usuário" value={fullName} onChange={e => setFullName(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label htmlFor="create-email">E-mail *</Label>
              <Input id="create-email" type="email" placeholder="usuario@email.com" value={email} onChange={e => setEmail(e.target.value)} required className="h-9" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="create-password">Senha *</Label>
              <Input id="create-password" type="password" placeholder="Mínimo 8 caracteres" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} className="h-9" />
            </div>
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'role' | 'granular')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="role" className="gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Perfil rápido (Role)
              </TabsTrigger>
              <TabsTrigger value="granular" className="gap-1.5">
                <Check className="h-3.5 w-3.5" /> Permissões específicas (Menu a menu)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="role" className="space-y-2 mt-3">
              <p className="text-xs text-muted-foreground">Marque uma ou mais roles. Cada uma libera um conjunto pré-definido de menus.</p>
              <div className="space-y-1.5 border rounded-md p-3 bg-muted/20 max-h-72 overflow-y-auto">
                {ROLES.map(role => {
                  const checked = selectedRoles.has(role.key);
                  return (
                    <label key={role.key} className={`flex items-start gap-3 p-2 rounded cursor-pointer hover:bg-background transition-colors ${checked ? 'bg-background border border-primary/30' : 'border border-transparent'}`}>
                      <Checkbox checked={checked} onCheckedChange={() => toggleRole(role.key)} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{role.label}</span>
                          <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{role.key}</code>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="granular" className="space-y-2 mt-3">
              <p className="text-xs text-muted-foreground">
                Marque exatamente quais menus o usuário verá. Permite combinações que as roles prontas não cobrem (ex: <em>só Pedido de Venda + NF-e</em>). O Painel está sempre marcado por ser a tela inicial.
              </p>
              <div className="space-y-3 border rounded-md p-3 bg-muted/20 max-h-96 overflow-y-auto">
                {(Object.keys(grouped) as MenuOption['group'][]).map(group => (
                  <div key={group} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{group}</h4>
                      <button type="button" onClick={() => markAllModulesInGroup(group)} className="text-[10px] text-primary hover:underline">
                        Marcar todos
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {grouped[group].map(opt => {
                        const checked = selectedModules.has(opt.module);
                        const disabled = opt.adminOnly || opt.alwaysOn;
                        return (
                          <label
                            key={opt.module}
                            className={`flex items-start gap-2.5 p-1.5 rounded ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-background'} ${checked ? 'bg-background border border-primary/30' : 'border border-transparent'}`}
                            title={opt.adminOnly ? 'Só Administradores podem acessar' : opt.alwaysOn ? 'Sempre liberado (tela inicial)' : undefined}
                          >
                            <Checkbox
                              checked={checked || !!opt.alwaysOn}
                              onCheckedChange={() => !disabled && toggleModule(opt.module)}
                              disabled={disabled}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium">{opt.label}</span>
                                {opt.adminOnly && <Badge variant="outline" className="text-[9px] h-4 px-1">admin</Badge>}
                                {opt.alwaysOn && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">sempre</Badge>}
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-tight">{opt.description}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Esses menus são gravados em <code>user_permissions</code> e sobrepõem o RBAC tradicional. Pra ajustar depois, edite direto na tabela ou em Configurações → Usuários.
              </div>
            </TabsContent>
          </Tabs>

          <label className="flex items-start gap-3 p-3 rounded-md border bg-emerald-500/5 border-emerald-500/20 cursor-pointer hover:bg-emerald-500/10 transition-colors">
            <Checkbox checked={approveNow} onCheckedChange={(v) => setApproveNow(v === true)} className="mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-semibold">Aprovar imediatamente</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {approveNow
                  ? 'Usuário poderá acessar o sistema assim que receber as credenciais.'
                  : 'Usuário ficará pendente — não consegue fazer operações até um admin aprovar.'}
              </p>
            </div>
          </label>

          {!approveNow && (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 dark:text-amber-300">
                Usuário criado <strong>pendente</strong>. Ele logra mas não vai conseguir fazer nenhuma operação até ser aprovado.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading || (mode === 'role' ? selectedRoles.size === 0 : selectedModules.size <= 1)}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar Usuário
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
