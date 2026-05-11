import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Lock, Eye } from 'lucide-react';
import { toast } from 'sonner';

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
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Não foi possível criar a row inicial de <code>security_settings</code>.
            Verifique as permissões/RLS da tabela.
          </p>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-7 w-7 text-primary mt-1" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Segurança</h1>
          <p className="text-sm text-muted-foreground">Política de senhas · MFA · mascaramento</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2"><Lock className="h-4 w-4 text-primary" /> Política de senhas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase font-bold">Tamanho mínimo</Label>
              <Input type="number" value={settings.password_min_length}
                onChange={e => update.mutate({ password_min_length: +e.target.value })} className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase font-bold">Histórico de senhas</Label>
              <Input type="number" value={settings.password_history_count}
                onChange={e => update.mutate({ password_history_count: +e.target.value })} className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase font-bold">Expiração (dias)</Label>
              <Input type="number" value={settings.password_expiry_days || ''}
                onChange={e => update.mutate({ password_expiry_days: e.target.value ? +e.target.value : null })} className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase font-bold">Tentativas máx.</Label>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /> Campos sensíveis (mascaramento)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {sensitive.map((s: any) => (
              <div key={s.id} className="p-3 flex items-center gap-3 text-sm">
                <Badge variant="outline" className={`text-[10px] capitalize ${
                  s.sensitivity_level === 'alta' ? 'bg-destructive/10 text-destructive border-destructive/30' :
                  s.sensitivity_level === 'media' ? 'bg-amber-100 text-amber-700' :
                  'bg-muted text-muted-foreground'
                }`}>{s.sensitivity_level}</Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-semibold">{s.table_name}.{s.column_name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.reason}</p>
                </div>
                <Badge variant="outline" className="text-[10px] capitalize">{s.masking_rule}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
