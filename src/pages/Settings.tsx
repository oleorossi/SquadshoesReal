import AppLayout from "@/components/layout/AppLayout";
import { useState, useMemo, useEffect } from 'react';
import { Gear as Settings, UserCheck, UserMinus as UserX, Shield, CircleNotch as Loader2, CaretDown as ChevronDown, CaretUp as ChevronUp, Users, Eye, PencilSimple as Pencil, Lock, LockOpen as Unlock, MagnifyingGlass as Search, Envelope as Mail, Calendar, ShieldCheck, ShieldWarning as ShieldAlert, Crown, Briefcase, Factory, Warehouse, Storefront as Store, BookOpen, Receipt, UserGear as UserCog, Trash as Trash2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
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
  useIsAdmin, ROLES, useUserPermissions, useReplaceUserPermissions,
} from '@/hooks/useUserManagement';
import { Checkbox } from '@/components/ui/checkbox';
import { getMenuItemsGrouped } from '@/data/navigation';
import { isActionAllowed } from '@/hooks/useAccessControl';
import { buildPermissionTemplates } from '@/data/permissionTemplates';
import type { PermissionGrant } from '@/hooks/useUserManagement';
import { Plus, Checks } from '@phosphor-icons/react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import RepresentativesPanel from '@/components/settings/RepresentativesPanel';
import EditProfileDialog from '@/components/settings/EditProfileDialog';
import CreateUserDialog from '@/components/settings/CreateUserDialog';
import FinanceConfigPanel from '@/components/settings/FinanceConfigPanel';
import { CurrencyDollar as DollarSign, Buildings } from '@phosphor-icons/react';
import CompanySettingsTab from '@/components/settings/CompanySettingsTab';
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

/* ── Permissões por ÁREA + AÇÃO (CRUD) ──────────────────────────────────────
 * Lista todas as telas da sidebar agrupadas por área; por tela o admin define
 * Ver / Criar / Editar / Excluir. Modelos de perfil pré-preenchem a matriz
 * (ponto de partida editável). Salvar grava 1 row por tela concedida em
 * user_permissions (allow-list + flags de ação). Pré-carrega pelo acesso
 * EFETIVO atual (grants existentes ou, sem grants, o RBAC da role).
 *
 * ⚠ Enforcement: 'Ver' (rota) já vale em todo o sistema. Os gates de ação
 * (criar/editar/excluir) são lidos por useAccessControl.can()/useCan() e vão
 * sendo adotados área a área (ex.: Financeiro Contas usa `useCan('/financeiro')`
 * pra esconder criar/editar/excluir) — a matriz já grava a intenção pra cada
 * área herdar quando for ligada. */
type ActionSet = { view: boolean; create: boolean; edit: boolean; delete: boolean };
type ActionKey = keyof ActionSet;
const EMPTY_ACTIONS: ActionSet = { view: false, create: false, edit: false, delete: false };
const FULL_ACTIONS: ActionSet = { view: true, create: true, edit: true, delete: true };
const VIEW_ONLY: ActionSet = { view: true, create: false, edit: false, delete: false };

const ACTION_META: ReadonlyArray<{ key: ActionKey; label: string; icon: typeof Eye; tone: 'primary' | 'destructive' }> = [
  { key: 'view', label: 'Ver', icon: Eye, tone: 'primary' },
  { key: 'create', label: 'Criar', icon: Plus, tone: 'primary' },
  { key: 'edit', label: 'Editar', icon: Pencil, tone: 'primary' },
  { key: 'delete', label: 'Excluir', icon: Trash2, tone: 'destructive' },
];

function ActionToggle({ active, tone, icon: Icon, label, onClick }: {
  active: boolean; tone: 'primary' | 'destructive'; icon: typeof Eye; label: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
        active
          ? tone === 'destructive'
            ? 'bg-destructive text-destructive-foreground border-destructive'
            : 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-muted-foreground/50 border-border hover:bg-muted/50 hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" weight={active ? 'bold' : 'regular'} />
    </button>
  );
}

function UserPermissionsPanel({ userId, userRoles }: { userId: string; userRoles: string[] }) {
  const { data: permissions = [] } = useUserPermissions(userId);
  const replacePerms = useReplaceUserPermissions();
  const grouped = useMemo(() => getMenuItemsGrouped(), []);
  const templates = useMemo(() => buildPermissionTemplates(), []);
  const isAdminTarget = userRoles.includes('admin');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Acesso efetivo atual por tela (mesma regra do login) → estado inicial da matriz.
  const initialGrants = useMemo(() => {
    const g: Record<string, ActionSet> = {};
    const input = { isAdmin: isAdminTarget, roles: userRoles, perms: permissions };
    for (const items of Object.values(grouped)) {
      for (const it of items) {
        if (!isActionAllowed(it.path, 'view', input)) continue;
        g[it.path] = {
          view: true,
          create: isActionAllowed(it.path, 'create', input),
          edit: isActionAllowed(it.path, 'edit', input),
          delete: isActionAllowed(it.path, 'delete', input),
        };
      }
    }
    return g;
  }, [grouped, isAdminTarget, userRoles, permissions]);

  const [grants, setGrants] = useState<Record<string, ActionSet>>(initialGrants);
  const [dirty, setDirty] = useState(false);
  // Re-sincroniza com o servidor enquanto o admin não mexeu.
  useEffect(() => { if (!dirty) setGrants(initialGrants); }, [initialGrants, dirty]);

  const setScreen = (path: string, next: ActionSet | null) => {
    setDirty(true);
    setGrants(prev => {
      const n = { ...prev };
      if (!next || (!next.view && !next.create && !next.edit && !next.delete)) delete n[path];
      else n[path] = next;
      return n;
    });
  };
  const toggleAction = (path: string, action: ActionKey) => {
    const cur = grants[path] ?? EMPTY_ACTIONS;
    const next: ActionSet = { ...cur, [action]: !cur[action] };
    if (action === 'view' && !next.view) { setScreen(path, null); return; } // desligar Ver limpa a tela
    if (action !== 'view' && next[action]) next.view = true;                // agir exige poder ver
    setScreen(path, next);
  };
  const setGroup = (items: { path: string }[], mode: 'full' | 'view' | 'clear') => {
    setDirty(true);
    setGrants(prev => {
      const n = { ...prev };
      for (const it of items) {
        if (mode === 'clear') delete n[it.path];
        else n[it.path] = mode === 'full' ? { ...FULL_ACTIONS } : { ...VIEW_ONLY };
      }
      return n;
    });
  };
  const applyTemplate = (t: ReturnType<typeof buildPermissionTemplates>[number]) => {
    setDirty(true);
    const next: Record<string, ActionSet> = {};
    for (const p of t.paths) next[p] = { ...t.actions };
    setGrants(next);
    toast.success(`Modelo "${t.label}" aplicado — ajuste e salve.`);
  };

  const save = async () => {
    const rows: PermissionGrant[] = Object.entries(grants)
      .filter(([, a]) => a.view)
      .map(([path, a]) => ({ path, can_create: a.create, can_edit: a.edit, can_delete: a.delete }));
    await replacePerms.mutateAsync({ userId, grants: rows });
    setDirty(false);
  };

  if (isAdminTarget) {
    return (
      <p className="text-sm text-muted-foreground rounded-lg border bg-muted/20 px-3 py-2.5">
        <ShieldCheck className="h-4 w-4 inline mr-1.5 text-primary" />
        Administrador tem acesso <strong>total</strong> — sem restrição por área ou ação.
      </p>
    );
  }

  const total = Object.values(grouped).reduce((s, items) => s + items.length, 0);
  const grantedCount = Object.values(grants).filter(a => a.view).length;
  const q = search.trim();
  const groupsToRender = Object.entries(grouped)
    .map(([group, items]) => [
      group,
      q ? items.filter(it => searchMatchesAllTerms(q, it.label, it.path)) : items,
    ] as const)
    .filter(([, items]) => items.length > 0);
  const filteredScreenCount = groupsToRender.reduce((s, [, items]) => s + items.length, 0);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
        Defina por área o que este operador pode <strong className="text-foreground">Ver</strong>, <strong className="text-foreground">Criar</strong>, <strong className="text-foreground">Editar</strong> e <strong className="text-foreground">Excluir</strong>.
        Salvar substitui as permissões atuais. O <strong>Painel</strong> fica sempre disponível.
      </div>

      {/* Modelos de perfil — pré-preenchem a matriz (ponto de partida) */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
          Modelos de perfil · clique para começar por um
        </p>
        <div className="flex flex-wrap gap-2">
          {templates.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => applyTemplate(t)}
              title={t.description}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-all hover:shadow-sm',
                ROLE_COLORS[t.key] ?? 'bg-card',
              )}
            >
              {ROLE_ICONS[t.key]}
              <span className="text-xs font-semibold">{t.label}</span>
              <span className="text-[10px] opacity-70 tabular-nums">{t.paths.length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Busca + legenda das colunas */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por tela ou rota…"
          resultCount={filteredScreenCount}
          totalCount={total}
          disableSlashFocus
          className="w-full max-w-xs"
          inputClassName="h-9 text-xs"
        />
        <div className="hidden sm:flex items-center gap-1 pr-0.5">
          <span className="inline-flex w-8 items-center justify-center text-[10px] uppercase tracking-wide text-muted-foreground/50" title="Marcar Ver+Criar+Editar+Excluir na linha">Tudo</span>
          {ACTION_META.map(a => (
            <span key={a.key} className="inline-flex w-8 items-center justify-center text-[10px] uppercase tracking-wide text-muted-foreground/70" title={a.label}>
              {a.label}
            </span>
          ))}
        </div>
      </div>

      {/* Áreas */}
      <div className="space-y-3">
        {groupsToRender.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-xs text-muted-foreground">Nenhum resultado para "{search}"</p>
            <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>
          </div>
        )}
        {groupsToRender.map(([group, items]) => {
          const grantedInGroup = items.filter(it => grants[it.path]?.view).length;
          const isCollapsed = collapsed.has(group) && !q;
          return (
            <div key={group} className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-2 bg-muted/40 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setCollapsed(prev => { const n = new Set(prev); n.has(group) ? n.delete(group) : n.add(group); return n; })}
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                  {group}
                </button>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">{grantedInGroup}/{items.length}</Badge>
                <div className="ml-auto flex items-center gap-1.5 text-[11px]">
                  <button type="button" onClick={() => setGroup(items, 'full')} className="text-primary hover:underline">Tudo</button>
                  <span className="text-muted-foreground/40">·</span>
                  <button type="button" onClick={() => setGroup(items, 'view')} className="text-muted-foreground hover:text-foreground hover:underline">Só ver</button>
                  <span className="text-muted-foreground/40">·</span>
                  <button type="button" onClick={() => setGroup(items, 'clear')} className="text-muted-foreground hover:text-foreground hover:underline">Limpar</button>
                </div>
              </div>
              {!isCollapsed && (
                <div className="divide-y">
                  {items.map(it => {
                    const a = grants[it.path] ?? EMPTY_ACTIONS;
                    const allOn = a.view && a.create && a.edit && a.delete;
                    return (
                      <div key={it.path} className={cn('flex items-center gap-3 border-l-2 px-3 py-1.5 transition-colors', a.view ? 'border-l-primary bg-primary/[0.04]' : 'border-l-transparent hover:bg-muted/20')}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate leading-tight">{it.label}</p>
                          <code className="text-[10px] text-muted-foreground">{it.path}</code>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Marcar tudo na linha: liga Ver+Criar+Editar+Excluir de uma vez
                              (atalho por linha, ao lado do olho). Se já está tudo ligado, limpa. */}
                          <button
                            type="button"
                            onClick={() => setScreen(it.path, allOn ? null : { ...FULL_ACTIONS })}
                            title={allOn ? 'Limpar esta linha' : 'Marcar Ver, Criar, Editar e Excluir'}
                            aria-label="Marcar tudo nesta linha"
                            aria-pressed={allOn}
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                              allOn
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-dashed border-border bg-card text-muted-foreground/50 hover:bg-muted/50 hover:text-foreground',
                            )}
                          >
                            <Checks className="h-4 w-4" weight={allOn ? 'bold' : 'regular'} />
                          </button>
                          {ACTION_META.map(m => (
                            <ActionToggle key={m.key} active={a[m.key]} tone={m.tone} icon={m.icon} label={m.label} onClick={() => toggleAction(it.path, m.key)} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Barra de salvar */}
      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
        <span className="text-xs text-muted-foreground">
          <strong className="text-foreground tabular-nums">{grantedCount}</strong>/{total} telas concedidas
        </span>
        <Button onClick={save} disabled={!dirty || replacePerms.isPending} className="gap-2">
          {replacePerms.isPending
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
            : <><ShieldCheck className="h-4 w-4" /> Salvar permissões</>}
        </Button>
      </div>
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
                <Badge variant="outline" className="text-xs h-4 px-1.5 bg-muted">Você</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <Mail className="h-3 w-3 shrink-0" />
              {profile.email}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {profile.approved ? (
                <Badge variant="outline" className="text-xs h-5 bg-success/10 text-success border-success/30 gap-1">
                  <ShieldCheck className="h-3 w-3" /> Aprovado
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs h-5 bg-warning/10 text-warning border-warning/30 gap-1">
                  <ShieldAlert className="h-3 w-3" /> Pendente
                </Badge>
              )}
              {roles.map(r => (
                <Badge key={r.id} variant="outline" className={cn('text-xs h-5 gap-1', ROLE_COLORS[r.role] || '')}>
                  {ROLE_ICONS[r.role]}
                  {ROLES.find(rl => rl.key === r.role)?.label || r.role}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Editar perfil" className="h-8 w-8 text-primary hover:bg-primary/10" onClick={onEdit}>
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
                      <Button variant="ghost" size="icon" aria-label="Bloquear acesso" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => onApprove(false)}>
                        <Lock className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Bloquear acesso</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Aprovar acesso" className="h-8 w-8 text-success hover:bg-success/10" onClick={() => onApprove(true)}>
                        <Unlock className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Aprovar acesso</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Excluir usuário" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={onDelete}>
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
              aria-label={expanded ? 'Recolher detalhes do usuário' : 'Expandir detalhes do usuário'}
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
                        <p className="text-xs opacity-70 leading-tight">{role.description}</p>
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
                Permissões por Menu
              </p>
              <UserPermissionsPanel userId={profile.id} userRoles={roles.map(r => r.role)} />
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
    searchMatchesAllTerms(search, p.full_name, p.email)
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
          sectionLabel="SISTEMA · CONFIGURAÇÕES"
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
                <Badge variant="destructive" className="h-4 min-w-4 px-1 text-xs ml-1">{pendingCount}</Badge>
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
            <TabsTrigger value="empresa" className="gap-1.5">
              <Buildings className="h-3.5 w-3.5" />
              Empresa
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4 mt-4">
            {/* Search + Create */}
            <div className="flex items-center gap-3">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Buscar por nome ou e-mail…"
                resultCount={filteredProfiles.length}
                totalCount={profiles.length}
                className="max-w-sm flex-1"
              />
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
                  {search.trim() ? (
                    <EmptyState
                      size="sm"
                      icon={Search}
                      title={`Nenhum resultado para "${search}"`}
                      action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
                    />
                  ) : (
                    <EmptyState icon={Users} title="Nenhum usuário encontrado" />
                  )}
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
          <TabsContent value="empresa" className="mt-4">
            <CompanySettingsTab />
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
