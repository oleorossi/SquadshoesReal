import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Lock, Eye, Key as KeyRound, ArrowsClockwise as RefreshCcw } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

export default function Security() {
  const qc = useQueryClient();

  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ['security_settings'],
    queryFn: async () => {
      // maybeSingle pra não jogar quando ainda não há row (primeira vez).
      const { data: existing } = await (supabase as any)
        .from('security_settings').select('*').limit(1).maybeSingle();
      if (existing) return existing;

      // Seed defaults na primeira vez. Se falhar (RLS, FK, etc.), volta
      // null pra a UI mostrar empty-state em vez de travar em "Carregando".
      const { data: seeded } = await (supabase as any)
        .from('security_settings').insert({}).select('*').maybeSingle();
      return seeded ?? null;
    },
  });

  const { data: sensitive = [] } = useQuery({
    queryKey: ['sensitive_field_registry'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('sensitive_field_registry').select('*').order('sensitivity_level');
      return data || [];
    },
  });

  const update = useMutation({
    mutationFn: async (patch: any) => {
      const { error } = await (supabase as any).from('security_settings').update(patch).eq('id', settings.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security_settings'] }); toast.success('Configurações atualizadas'); },
  });

  if (loadingSettings) return <p className="p-6 text-muted-foreground">Carregando configurações...</p>;
  if (!settings) return (
    <div className="p-6">
      <Panel flush>
        <EmptyState
          icon={ShieldCheck}
          title="Configuração indisponível"
          description="Não foi possível criar a row inicial de security_settings. Verifique as permissões/RLS da tabela."
        />
      </Panel>
    </div>
  );

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="SISTEMA · SEGURANÇA"
        title="Segurança"
        description="Política de senhas · MFA · mascaramento"
      />

      <Panel title={<span className="flex items-center gap-2"><Lock className="h-4 w-4 text-primary" /> Política de senhas</span>}>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase font-bold">Tamanho mínimo</Label>
              <Input type="number" value={settings.password_min_length}
                onChange={e => update.mutate({ password_min_length: +e.target.value })} className="h-8" />
            </div>
            <div>
              <Label className="text-xs uppercase font-bold">Histórico de senhas</Label>
              <Input type="number" value={settings.password_history_count}
                onChange={e => update.mutate({ password_history_count: +e.target.value })} className="h-8" />
            </div>
            <div>
              <Label className="text-xs uppercase font-bold">Expiração (dias)</Label>
              <Input type="number" value={settings.password_expiry_days || ''}
                onChange={e => update.mutate({ password_expiry_days: e.target.value ? +e.target.value : null })} className="h-8" />
            </div>
            <div>
              <Label className="text-xs uppercase font-bold">Tentativas máx.</Label>
              <Input type="number" value={settings.max_failed_attempts}
                onChange={e => update.mutate({ max_failed_attempts: +e.target.value })} className="h-8" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex items-center justify-between p-2 rounded border">
              <span>Maiúsculas</span>
              <Switch checked={settings.password_require_uppercase}
                onCheckedChange={v => update.mutate({ password_require_uppercase: v })} />
            </label>
            <label className="flex items-center justify-between p-2 rounded border">
              <span>Minúsculas</span>
              <Switch checked={settings.password_require_lowercase}
                onCheckedChange={v => update.mutate({ password_require_lowercase: v })} />
            </label>
            <label className="flex items-center justify-between p-2 rounded border">
              <span>Números</span>
              <Switch checked={settings.password_require_number}
                onCheckedChange={v => update.mutate({ password_require_number: v })} />
            </label>
            <label className="flex items-center justify-between p-2 rounded border">
              <span>Especiais (!@#$)</span>
              <Switch checked={settings.password_require_special}
                onCheckedChange={v => update.mutate({ password_require_special: v })} />
            </label>
          </div>
        </div>
      </Panel>

      <MfaCard />

      <Panel title={<span className="flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /> Campos sensíveis (mascaramento)</span>} flush>
          <div className="divide-y">
            {sensitive.length === 0 && (
              <EmptyState icon={Eye} title="Nenhum campo sensível registrado" size="sm" />
            )}
            {sensitive.map((s: any) => (
              <div key={s.id} className="p-3 flex items-center gap-3 text-sm">
                <Badge variant="outline" className={`text-xs capitalize ${
                  s.sensitivity_level === 'alta' ? 'bg-destructive/10 text-destructive border-destructive/30' :
                  s.sensitivity_level === 'media' ? 'bg-amber-100 text-amber-700' :
                  'bg-muted text-muted-foreground'
                }`}>{s.sensitivity_level}</Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-semibold">{s.table_name}.{s.column_name}</p>
                  <p className="text-xs text-muted-foreground">{s.reason}</p>
                </div>
                <Badge variant="outline" className="text-xs capitalize">{s.masking_rule}</Badge>
              </div>
            ))}
          </div>
      </Panel>
    </div>
  );
}

function MfaCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;

  const { data: mfa, isLoading } = useQuery({
    queryKey: ['user_mfa', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await (supabase as any)
        .from('user_mfa_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      return data;
    },
  });

  const upsert = useMutation({
    mutationFn: async (patch: any) => {
      if (!userId) throw new Error('Sessão sem usuário.');
      const payload = { user_id: userId, ...patch };
      const { error } = await (supabase as any)
        .from('user_mfa_settings')
        .upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user_mfa', userId] });
      toast.success('MFA atualizado.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenBackupCodes = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Sessão sem usuário.');
      const codes = Array.from({ length: 8 }, () =>
        Math.random().toString(36).slice(2, 6).toUpperCase() + '-' +
        Math.random().toString(36).slice(2, 6).toUpperCase()
      );
      const { error } = await (supabase as any)
        .from('user_mfa_settings')
        .upsert({ user_id: userId, backup_codes: codes }, { onConflict: 'user_id' });
      if (error) throw error;
      return codes;
    },
    onSuccess: (codes) => {
      qc.invalidateQueries({ queryKey: ['user_mfa', userId] });
      // Cópia para clipboard pra usuário guardar
      navigator.clipboard?.writeText(codes.join('\n'));
      toast.success(`8 códigos gerados e copiados pra área de transferência.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enabled = !!mfa?.mfa_enabled;
  const codes: string[] = mfa?.backup_codes ?? [];

  return (
    <Panel title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Autenticação em duas etapas (MFA)</span>}>
      <div className="space-y-3 text-sm">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex-1">
                <p className="text-sm font-medium">MFA ativo</p>
                <p className="text-xs text-muted-foreground">
                  Quando ativado, login pedirá um código TOTP (Google Authenticator/Authy) além da senha.
                  {mfa?.enrolled_at && ` · Configurado em ${new Date(mfa.enrolled_at).toLocaleDateString('pt-BR')}`}
                  {mfa?.last_used_at && ` · Último uso ${new Date(mfa.last_used_at).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => upsert.mutate({
                  mfa_enabled: v,
                  enrolled_at: v && !mfa?.enrolled_at ? new Date().toISOString() : mfa?.enrolled_at,
                })}
              />
            </div>

            {enabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs uppercase font-bold">Método</Label>
                    <select
                      value={mfa?.mfa_method ?? 'totp'}
                      onChange={(e) => upsert.mutate({ mfa_method: e.target.value })}
                      className="w-full mt-1 h-8 px-2 rounded-md border border-input bg-background text-sm"
                    >
                      <option value="totp">TOTP (app autenticador)</option>
                      <option value="sms">SMS</option>
                      <option value="email">E-mail</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs uppercase font-bold">Telefone recuperação</Label>
                    <Input
                      value={mfa?.recovery_phone ?? ''}
                      onChange={(e) => upsert.mutate({ recovery_phone: e.target.value })}
                      placeholder="+55 ..."
                      className="h-8"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs uppercase font-bold">E-mail de recuperação</Label>
                    <Input
                      type="email"
                      value={mfa?.recovery_email ?? ''}
                      onChange={(e) => upsert.mutate({ recovery_email: e.target.value })}
                      className="h-8"
                    />
                  </div>
                </div>

                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Códigos de backup</p>
                      <p className="text-xs text-muted-foreground">
                        {codes.length > 0 ? `${codes.length} códigos disponíveis` : 'Nenhum código gerado'}
                      </p>
                    </div>
                    <button
                      onClick={() => regenBackupCodes.mutate()}
                      className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                      disabled={regenBackupCodes.isPending}
                    >
                      <RefreshCcw className="h-3 w-3" />
                      {codes.length > 0 ? 'Regenerar' : 'Gerar 8 códigos'}
                    </button>
                  </div>
                  {codes.length > 0 && (
                    <div className="grid grid-cols-4 gap-1.5 mt-2">
                      {codes.map((c, i) => (
                        <code key={i} className="text-xs font-mono bg-muted px-2 py-1 rounded text-center">
                          {c}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
