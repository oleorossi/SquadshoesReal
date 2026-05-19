import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Warning as AlertTriangle, Check } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RoleDef {
  key: string;
  label: string;
  description: string;
  modulesPreview: string[];
}

/**
 * Roles disponíveis + descrição em PT-BR + preview dos menus liberados.
 * Espelha src/hooks/useAccessControl.ts (ROLE_MODULES) — se mudar lá, mudar aqui.
 */
const ROLES: RoleDef[] = [
  { key: 'admin', label: 'Administrador', description: 'Acesso total ao sistema (TODOS os menus + configurações)', modulesPreview: ['Todos os menus + Configurações + Automações + Segurança'] },
  { key: 'gerente', label: 'Gerente', description: 'Quase tudo, exceto telas de sistema/admin', modulesPreview: ['Vendas', 'Produção', 'Estoque', 'Clientes', 'NF-e', 'Financeiro', 'RH', 'Relatórios'] },
  { key: 'comercial', label: 'Comercial', description: 'Vendas, clientes e relatórios comerciais', modulesPreview: ['Vendas', 'Clientes', 'Relatórios'] },
  { key: 'producao', label: 'Produção', description: 'Chão de fábrica — OPs, estoque, expedição', modulesPreview: ['Produção', 'Estoque', 'Ordens', 'Expedição', 'Vendas (sem valores)'] },
  { key: 'almoxarifado', label: 'Almoxarifado', description: 'Só estoque', modulesPreview: ['Estoque'] },
  { key: 'nfe_operator', label: 'Operador NF-e', description: 'Emite NF, edita clientes/empresas. Sem AR/AP/folha', modulesPreview: ['Vendas', 'Clientes', 'NF-e', 'Empresas Fiscais'] },
  { key: 'rh', label: 'RH', description: 'Funcionários, ponto, banco de horas. SEM folha', modulesPreview: ['RH', 'Terceirizados'] },
  { key: 'consulta', label: 'Consulta', description: 'Acesso amplo mas SEM permissão de escrita (read-only)', modulesPreview: ['Tudo em modo leitura'] },
];

export default function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set(['comercial']));
  const [approveNow, setApproveNow] = useState(true);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const toggleRole = (key: string) => {
    setSelectedRoles(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Preview consolidado de menus que o usuário verá com as roles selecionadas. */
  const consolidatedPreview = useMemo(() => {
    if (selectedRoles.has('admin')) return ['Todos os menus + Configurações + Automações + Segurança'];
    const all = new Set<string>();
    for (const role of selectedRoles) {
      ROLES.find(r => r.key === role)?.modulesPreview.forEach(m => all.add(m));
    }
    return Array.from(all);
  }, [selectedRoles]);

  const reset = () => {
    setEmail('');
    setPassword('');
    setFullName('');
    setSelectedRoles(new Set(['comercial']));
    setApproveNow(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoles.size === 0) {
      toast.error('Selecione pelo menos uma role.');
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

      const res = await supabase.functions.invoke('create-user', {
        body: {
          email,
          password,
          full_name: fullName,
          roles: Array.from(selectedRoles),
          approve: approveNow,
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      // Ordem importa: res.data.error tem a mensagem específica do servidor
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar Novo Usuário</DialogTitle>
          <DialogDescription>
            Preencha os dados e escolha as <strong>roles</strong> que controlam quais menus o usuário vê. Você pode marcar mais de uma — os acessos se somam.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="create-name">Nome completo</Label>
              <Input
                id="create-name"
                placeholder="Nome do usuário"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="create-email">E-mail *</Label>
              <Input
                id="create-email"
                type="email"
                placeholder="usuario@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="h-9"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="create-password">Senha *</Label>
              <Input
                id="create-password"
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                className="h-9"
              />
            </div>
          </div>

          {/* Roles — marca quais menus o usuário verá */}
          <div>
            <Label className="text-sm font-bold mb-2 block">Permissões (Roles)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Marque uma ou mais. Cada role libera um conjunto de menus na barra lateral.
            </p>
            <div className="space-y-1.5 border rounded-md p-3 bg-muted/20 max-h-72 overflow-y-auto">
              {ROLES.map(role => {
                const checked = selectedRoles.has(role.key);
                return (
                  <label
                    key={role.key}
                    className={`flex items-start gap-3 p-2 rounded cursor-pointer hover:bg-background transition-colors ${
                      checked ? 'bg-background border border-primary/30' : 'border border-transparent'
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleRole(role.key)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{role.label}</span>
                        <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{role.key}</code>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
                      {checked && role.modulesPreview.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {role.modulesPreview.map(m => (
                            <Badge key={m} variant="outline" className="text-[10px] px-1.5 py-0">{m}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Preview consolidado quando 2+ roles marcadas */}
          {selectedRoles.size > 1 && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="text-xs font-bold text-primary mb-1">📋 Menus que esse usuário verá (consolidado):</p>
              <div className="flex flex-wrap gap-1">
                {consolidatedPreview.map(m => (
                  <Badge key={m} variant="default" className="text-[10px]">{m}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Aprovação imediata */}
          <label className="flex items-start gap-3 p-3 rounded-md border bg-emerald-500/5 border-emerald-500/20 cursor-pointer hover:bg-emerald-500/10 transition-colors">
            <Checkbox
              checked={approveNow}
              onCheckedChange={(v) => setApproveNow(v === true)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-semibold">Aprovar imediatamente</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {approveNow
                  ? 'Usuário poderá acessar o sistema assim que receber as credenciais.'
                  : 'Usuário ficará pendente — não consegue acessar até um admin aprovar em /configuracoes.'}
              </p>
            </div>
          </label>

          {!approveNow && (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 dark:text-amber-300">
                Usuário será criado <strong>pendente</strong>. Ele consegue logar mas não vai conseguir fazer nenhuma operação até ser aprovado manualmente em <code>profiles.approved = true</code>.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading || selectedRoles.size === 0}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar Usuário
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
