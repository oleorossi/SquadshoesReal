import AppLayout from "@/components/layout/AppLayout";
import { useState } from 'react';
import { Gear as Settings, UserCheck, UserMinus as UserX, Shield, CircleNotch as Loader2, CaretDown as ChevronDown, CaretUp as ChevronUp, Users, Eye, PencilSimple as Pencil, Lock, LockOpen as Unlock, MagnifyingGlass as Search, Envelope as Mail, Calendar, ShieldCheck, ShieldWarning as ShieldAlert, Crown, Briefcase, Factory, Warehouse, Storefront as Store, BookOpen, Receipt, UserGear as UserCog, Trash as Trash2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  useProfiles, useAllUserRoles, useApproveUser, useSetUserRole, useSetUserPermission,
  useIsAdmin, MODULES, ROLES, useUserPermissions,
} from '@/hooks/useUserManagement';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import RepresentativesPanel from '@/components/settings/RepresentativesPanel';
import EditProfileDialog from '@/components/settings/EditProfileDialog';
import CreateUserDialog from '@/components/settings/CreateUserDialog';
import FinanceConfigPanel from '@/components/settings/FinanceConfigPanel';
import { CurrencyDollar as DollarSign } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: <Crown className="h-3.5 w-3.5" />,
  gerente: <Briefcase className="h-3.5 w-3.5" />,
  producao: <Factory className="h-3.5 w-3.5" />,
  almoxarifado: <Warehouse className="h-3.5 w-3.5" />,
  comercial: <Store className="h-3.5 w-3.5" />,
  nfe_operator: <Receipt className="h-3.5 w-3.5" />,
  rh: <UserCog className="h-3.5 w-3.5" />,
  consulta: <BookOpen className="h-3.5 w-3.5" />,
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-primary/15 text-primary border-primary/30',
  gerente: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  producao: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  almoxarifado: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  comercial: 'bg-violet-500/15 text-violet-600 border-violet-500/30',
  nfe_operator: 'bg-sky-500/15 text-sky-600 border-sky-500/30',
  rh: 'bg-pink-500/15 text-pink-600 border-pink-500/30',
  consulta: 'bg-muted text-muted-foreground border-border/50',
};

function UserPermissionsPanel({ userId }: { userId: string }) {
  const { data: permissions = [] } = useUserPermissions(userId);
  const setPermission = useSetUserPermission();
  const [granting, setGranting] = useState(false);

  const getPermission = (module: string) => permissions.find(p => p.module === module);

  const groups = [...new Set(MODULES.map(m => m.group))];

  const handleGrantAllPermissions = async () => {
    setGranting(true);
    const modulesToGrant = MODULES.filter(m => m.key !== 'configuracoes');
    for (const mod of modulesToGrant) {
      await setPermission.mutateAsync({
        userId,
        module: mod.key,
        can_view: true,
        can_edit: true,
      });
    }
    setGranting(false);
  };

  return (
    <div className="space-y-4">
      {groups.map(group => {
        const groupModules = MODULES.filter(m => m.group === group && m.key !== 'configuracoes');
        if (groupModules.length === 0) return null;
        return (
          <div key={group}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">{group}</p>
            <div className="space-y-1">
              {groupModules.map(mod => {
                const perm = getPermission(mod.key);
                const canView = perm?.can_view ?? false;
                const canEdit = perm?.can_edit ?? false;
                return (
                  <div key={mod.key} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors">
                    <span className="text-sm font-medium">{mod.label}</span>
                    <div className="flex items-center gap-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5">
                            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                            <Switch
                              checked={canView}
                              onCheckedChange={v => setPermission.mutate({
                                userId, module: mod.key,
                                can_view: v,
                                can_edit: v ? canEdit : false,
                              })}
                              className="scale-80"
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Pode visualizar</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5">
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            <Switch
                              checked={canEdit}
                              disabled={!canView}
                              onCheckedChange={v => setPermission.mutate({
                                userId, module: mod.key,
                                can_view: true,
                                can_edit: v,
                              })}
                              className="scale-80"
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Pode editar</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      
      <Button
        onClick={handleGrantAllPermissions}
        disabled={granting}
        className="w-full mt-4"
        variant="outline"
      >
        {granting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Concedendo...
          </>
        ) : (
          <>
            <ShieldCheck className="h-4 w-4 mr-2" />
            Conceder todas as permissões
          </>
        )}
      </Button>
    </div>
  );
}

function UserCard({
  profile,
  roles,
  isCurrentUser,
  onApprove,
  onToggleRole,
  onEdit,
  onDelete,
}: {
  profile: { id: string; email: string; full_name: string; approved: boolean; created_at: string; avatar_url?: string };
  roles: { id: string; role: string }[];
  isCurrentUser: boolean;
  onApprove: (approved: boolean) => void;
  onToggleRole: (role: string, add: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasRole = (role: string) => roles.some(r => r.role === role);
  const initials = (profile.full_name || profile.email || '?').charAt(0).toUpperCase();

  return (
    <Card className={cn(
      'transition-all duration-200',
      expanded && 'ring-1 ring-primary/20 shadow-md',
      !profile.approved && 'border-warning/40 bg-warning/5'
    )}>
      <CardContent className="p-0">
        {/* User header */}
        <div className="flex items-start gap-3 p-4">
          <Avatar className={cn(
            'h-10 w-10 shrink-0 border-2',
            profile.approved ? 'border-primary/30' : 'border-warning/30'
          )}>
            {profile.avatar_url ? (
              <AvatarImage src={profile.avatar_url} alt={profile.full_name} />
            ) : null}
            <AvatarFallback className={cn(
              'text-sm font-bold',
              profile.approved ? 'bg-primary/15 text-primary' : 'bg-warning/15 text-warning'
            )}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate">
                {profile.full_name || 'Sem nome'}
              </p>
              {isCurrentUser && (
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-muted">Você</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <Mail className="h-3 w-3 shrink-0" />
              {profile.email}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {profile.approved ? (
                <Badge variant="outline" className="text-[10px] h-5 bg-success/10 text-success border-success/30 gap-1">
                  <ShieldCheck className="h-3 w-3" /> Aprovado
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] h-5 bg-warning/10 text-warning border-warning/30 gap-1">
                  <ShieldAlert className="h-3 w-3" /> Pendente
                </Badge>
              )}
              {roles.map(r => (
                <Badge key={r.id} variant="outline" className={cn('text-[10px] h-5 gap-1', ROLE_COLORS[r.role] || '')}>
                  {ROLE_ICONS[r.role]}
                  {ROLES.find(rl => rl.key === r.role)?.label || r.role}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10" onClick={onEdit}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Editar perfil</TooltipContent>
            </Tooltip>
            {!isCurrentUser && (
              <>
                {profile.approved ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => onApprove(false)}>
                        <Lock className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Bloquear acesso</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-success hover:bg-success/10" onClick={() => onApprove(true)}>
                        <Unlock className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Aprovar acesso</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={onDelete}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Excluir usuário</TooltipContent>
                </Tooltip>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="border-t bg-muted/20 px-4 py-4 space-y-5">
            {/* Info row */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Cadastro: {new Date(profile.created_at).toLocaleDateString('pt-BR')}
              </span>
            </div>

            {/* Roles */}
            <div>
              <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-primary" />
                Perfis de Acesso
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ROLES.map(role => {
                  const active = hasRole(role.key);
                  const disabled = isCurrentUser && role.key === 'admin';
                  return (
                    <button
                      key={role.key}
                      disabled={disabled}
                      onClick={() => onToggleRole(role.key, !active)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all',
                        active
                          ? cn(ROLE_COLORS[role.key], 'shadow-sm')
                          : 'bg-card hover:bg-muted/50 text-muted-foreground',
                        disabled && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {ROLE_ICONS[role.key]}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{role.label}</p>
                        <p className="text-[10px] opacity-70 leading-tight">{role.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* Permissions */}
            <div>
              <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <Settings className="h-4 w-4 text-primary" />
                Permissões por Módulo
              </p>
              <UserPermissionsPanel userId={profile.id} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const { data: profiles = [], isLoading } = useProfiles();
  const { data: allRoles = [] } = useAllUserRoles();
  const approveUser = useApproveUser();
  const setRole = useSetUserRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('users');
  const [editingProfile, setEditingProfile] = useState<typeof profiles[0] | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<string | null>(null);

  const handleDeleteUser = async (userId: string) => {
    setPendingDeleteUserId(userId);
  };

  const confirmDeleteUser = async () => {
    if (!pendingDeleteUserId) return;
    setDeletingUserId(pendingDeleteUserId);
    setPendingDeleteUserId(null);
    try {
      // Idem CreateUserDialog: passa Bearer explícito pra evitar 401 quando
      // o invoke não auto-injeta o token (sessão recém-recarregada).
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');
      const res = await supabase.functions.invoke('delete-user', {
        body: { user_id: pendingDeleteUserId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      toast.success('Usuário excluído com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['all_user_roles'] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao excluir usuário');
    } finally {
      setDeletingUserId(null);
    }
  };

  const getUserRoles = (userId: string) => allRoles.filter(r => r.user_id === userId);

  const filteredProfiles = profiles.filter(p =>
    p.email.toLowerCase().includes(search.toLowerCase()) ||
    p.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const pendingCount = profiles.filter(p => !p.approved).length;

  if (isLoading) {
    return (
      
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      
    );
  }

  if (!isAdmin) {
    return (
      
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Shield className="h-12 w-12 mb-4 opacity-40" />
          <p className="text-lg font-medium">Acesso Restrito</p>
          <p className="text-sm">Apenas administradores podem acessar as configurações.</p>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="SISTEMA · Configurações"
          title="Configurações"
          description="Gestão de usuários, permissões e configurações do sistema"
        />

        {/* Stats cards */}
        <StatGrid>
          <StatCard label="Total Usuários" value={profiles.length} icon={Users} />
          <StatCard label="Aprovados" value={profiles.filter(p => p.approved).length} icon={ShieldCheck} tone="success" />
          <StatCard label="Pendentes" value={pendingCount} icon={ShieldAlert} tone="warning" />
          <StatCard label="Admins" value={allRoles.filter(r => r.role === 'admin').length} icon={Crown} tone="primary" />
        </StatGrid>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Usuários
              {pendingCount > 0 && (
                <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px] ml-1">{pendingCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="representatives" className="gap-1.5">
              <Briefcase className="h-3.5 w-3.5" />
              Representantes
            </TabsTrigger>
            <TabsTrigger value="finance-config" className="gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Financeiro
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4 mt-4">
            {/* Search + Create */}
            <div className="flex items-center gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou e-mail..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button onClick={() => setShowCreateUser(true)} className="gap-1.5">
                <Users className="h-4 w-4" />
                Criar Usuário
              </Button>
            </div>

            {/* User cards */}
            <div className="space-y-3">
              {filteredProfiles.map(profile => (
                <UserCard
                  key={profile.id}
                  profile={profile}
                  roles={getUserRoles(profile.id)}
                  isCurrentUser={profile.id === user?.id}
                  onApprove={approved => approveUser.mutate({ userId: profile.id, approved })}
                  onToggleRole={(role, add) => setRole.mutate({ userId: profile.id, role, add })}
                  onEdit={() => setEditingProfile(profile)}
                  onDelete={() => handleDeleteUser(profile.id)}
                />
              ))}
              {filteredProfiles.length === 0 && (
                <Panel flush>
                  <EmptyState icon={Users} title="Nenhum usuário encontrado" />
                </Panel>
              )}
            </div>
          </TabsContent>

          <TabsContent value="representatives" className="mt-4">
            <Panel
              eyebrow="SISTEMA · CONFIGURAÇÕES"
              title="Representantes Comerciais"
              subtitle="Gerencie os representantes e suas comissões"
            >
              <RepresentativesPanel />
            </Panel>
          </TabsContent>

          <TabsContent value="finance-config" className="mt-4">
            <FinanceConfigPanel />
          </TabsContent>
        </Tabs>

        {editingProfile && (
          <EditProfileDialog
            open={!!editingProfile}
            onOpenChange={open => !open && setEditingProfile(null)}
            profile={editingProfile}
          />
        )}

        <CreateUserDialog open={showCreateUser} onOpenChange={setShowCreateUser} />

        <AlertDialog open={!!pendingDeleteUserId} onOpenChange={open => !open && setPendingDeleteUserId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir este usuário? Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDeleteUser} className="bg-destructive hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    
  );
}
