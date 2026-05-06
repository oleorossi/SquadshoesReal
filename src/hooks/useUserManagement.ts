import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  approved: boolean;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
};

export type UserRole = {
  id: string;
  user_id: string;
  role: string;
};

export type UserPermission = {
  id: string;
  user_id: string;
  module: string;
  can_view: boolean;
  can_edit: boolean;
};

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', group: 'Geral' },
  { key: 'estoque', label: 'Estoque', group: 'Produção' },
  { key: 'componentes', label: 'Componentes', group: 'Produção' },
  { key: 'produtos', label: 'Produtos (Fichas + Referências)', group: 'Produção' },
  { key: 'ordens', label: 'Ordens de Produção', group: 'Produção' },
  { key: 'vendas', label: 'Vendas', group: 'Comercial' },
  { key: 'clientes', label: 'Clientes', group: 'Comercial' },
  { key: 'relatorios', label: 'Relatórios de Vendas', group: 'Comercial' },
  { key: 'financeiro', label: 'Financeiro', group: 'Financeiro' },
  { key: 'fornecedores', label: 'Fornecedores', group: 'Cadastros' },
  { key: 'terceirizados', label: 'Terceirizados', group: 'Cadastros' },
  { key: 'historico', label: 'Histórico de Estoque', group: 'Cadastros' },
  { key: 'configuracoes', label: 'Configurações', group: 'Sistema' },
] as const;

export const ROLES = [
  { key: 'admin', label: 'Administrador', description: 'Acesso total ao sistema' },
  { key: 'gerente', label: 'Gerente', description: 'Gestão geral com restrições' },
  { key: 'producao', label: 'Produção', description: 'Ordens, estoque e componentes' },
  { key: 'almoxarifado', label: 'Almoxarifado', description: 'Estoque e movimentações' },
  { key: 'comercial', label: 'Comercial', description: 'Vendas, clientes e relatórios' },
  { key: 'consulta', label: 'Consulta', description: 'Apenas visualização' },
] as const;

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export function useCurrentProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes (user info rarely changes)
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

export function useUserRoles(userId?: string) {
  return useQuery({
    queryKey: ['user_roles', userId],
    enabled: !!userId,
    // Cache mais longo: roles mudam raramente, evita refetch agressivo
    // que pode acionar o banner de "Sessão Instável" em flutuações de rede.
    staleTime: 5 * 60 * 1000, // 5 min
    gcTime: 30 * 60 * 1000,   // 30 min
    retry: (failureCount, error: any) => {
      // Não retentar quando o erro é definitivo (auth/permissão/JSON malformado)
      const status = error?.status ?? error?.code;
      if (status === 401 || status === 403 || status === 406) return false;
      if (typeof error?.message === 'string' && error.message.includes('JSON')) return false;
      return failureCount < 3;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', userId!);
        if (error) throw error;
        return data as UserRole[];
      } catch (err) {
        console.error("[useUserRoles] Fetch error:", err);
        throw err;
      }
    },
  });
}

export function useAllUserRoles() {
  return useQuery({
    queryKey: ['all_user_roles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*');
      if (error) throw error;
      return data as UserRole[];
    },
  });
}

export function useUserPermissions(userId?: string) {
  return useQuery({
    queryKey: ['user_permissions', userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', userId!);
      if (error) throw error;
      return data as UserPermission[];
    },
  });
}

export function useCurrentUserRoles() {
  const { user } = useAuth();
  return useUserRoles(user?.id);
}

export function useCurrentUserPermissions() {
  const { user } = useAuth();
  return useUserPermissions(user?.id);
}

export function useIsAdmin() {
  const { data: roles = [] } = useCurrentUserRoles();
  return roles.some(r => r.role === 'admin');
}

export function useApproveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, approved }: { userId: string; approved: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ approved })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: (_, { approved }) => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(approved ? 'Usuário aprovado!' : 'Usuário bloqueado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role, add }: { userId: string; role: string; add: boolean }) => {
      if (add) {
        const { error } = await supabase
          .from('user_roles')
          .insert({ user_id: userId, role: role as "admin" | "gerente" | "producao" | "almoxarifado" | "comercial" | "consulta" });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
          .eq('role', role as "admin" | "gerente" | "producao" | "almoxarifado" | "comercial" | "consulta");
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all_user_roles'] });
      qc.invalidateQueries({ queryKey: ['user_roles'] });
      toast.success('Perfil atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useSetUserPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, module, can_view, can_edit }: { userId: string; module: string; can_view: boolean; can_edit: boolean }) => {
      const { error } = await supabase
        .from('user_permissions')
        .upsert({ user_id: userId, module, can_view, can_edit }, { onConflict: 'user_id,module' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user_permissions'] });
      toast.success('Permissão atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
