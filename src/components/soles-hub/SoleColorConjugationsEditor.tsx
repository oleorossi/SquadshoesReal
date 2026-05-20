import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Plus, Trash as Trash2, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { toast } from 'sonner';

interface ConjugationRule {
  id: string;
  sole_group_id: string;
  cabedal_color: string;
  palmilha_color: string;
  is_default: boolean;
  active: boolean;
}

interface Props {
  soleGroupId: string;
}

export function SoleColorConjugationsEditor({ soleGroupId }: Props) {
  const qc = useQueryClient();

  const { data: variants = [] } = useQuery({
    queryKey: ['sole_group_color_variants', soleGroupId],
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('color')
        .eq('group_id', soleGroupId)
        .eq('active', true)
        .not('color', 'is', null);
      const colors = new Set<string>();
      for (const r of (data ?? []) as Array<{ color: string | null }>) {
        const c = String(r.color ?? '').trim();
        if (c) colors.add(c);
      }
      return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    },
  });

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['sole_color_conjugations', soleGroupId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_color_conjugations')
        .select('*')
        .eq('sole_group_id', soleGroupId)
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('cabedal_color');
      if (error) throw error;
      return (data ?? []) as ConjugationRule[];
    },
  });

  const defaultRule = rules.find(r => r.is_default);
  const specificRules = rules.filter(r => !r.is_default);

  const upsert = useMutation({
    mutationFn: async (rule: {
      id?: string;
      cabedal_color: string;
      palmilha_color: string;
      is_default?: boolean;
    }) => {
      if (rule.id) {
        const { error } = await (supabase as any)
          .from('sole_color_conjugations')
          .update({
            cabedal_color: rule.cabedal_color,
            palmilha_color: rule.palmilha_color,
            updated_at: new Date().toISOString(),
          })
          .eq('id', rule.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from('sole_color_conjugations')
          .insert({
            sole_group_id: soleGroupId,
            cabedal_color: rule.cabedal_color,
            palmilha_color: rule.palmilha_color,
            is_default: rule.is_default || false,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sole_color_conjugations', soleGroupId] });
      toast.success('Regra de coligação salva');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('sole_color_conjugations')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sole_color_conjugations', soleGroupId] });
      toast.success('Regra removida');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [draftCabedal, setDraftCabedal] = useState('');
  const [draftPalmilha, setDraftPalmilha] = useState('');

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const addDraft = () => {
    const c = draftCabedal.trim();
    const p = draftPalmilha.trim();
    if (!c || !p) {
      toast.error('Preencha cor do cabedal e da palmilha');
      return;
    }
    if (c === '*') {
      toast.error('Use o slot "Default" pra a regra catch-all');
      return;
    }
    if (specificRules.some(r => r.cabedal_color.toUpperCase() === c.toUpperCase())) {
      toast.error('Já existe regra pra esse cabedal');
      return;
    }
    upsert.mutate({ cabedal_color: c, palmilha_color: p });
    setDraftCabedal('');
    setDraftPalmilha('');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Solado palmilha-pronta tem a cor da palmilha visível, então o estoque debitado
        depende da cor do cabedal. Configure aqui as regras. A regra <em>default</em> é
        usada quando o cabedal não casa com nenhuma exceção específica.
      </p>

      {/* Regra default (catch-all) */}
      <div className="rounded-md border border-dashed bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs uppercase">Default</Badge>
          <span className="text-xs text-muted-foreground">Cabedal não listado abaixo:</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-2 py-1.5 rounded-md bg-muted/40 text-xs text-muted-foreground italic">
            (qualquer outra cor)
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          {defaultRule ? (
            <Select
              value={defaultRule.palmilha_color}
              onValueChange={(v) =>
                upsert.mutate({
                  id: defaultRule.id,
                  cabedal_color: '*',
                  palmilha_color: v,
                  is_default: true,
                })
              }
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue placeholder="Palmilha…" />
              </SelectTrigger>
              <SelectContent>
                {variants.map(v => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={draftPalmilha} onValueChange={setDraftPalmilha}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue placeholder="Escolher…" />
                </SelectTrigger>
                <SelectContent>
                  {variants.map(v => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!draftPalmilha) {
                    toast.error('Escolha a cor de palmilha default');
                    return;
                  }
                  upsert.mutate({
                    cabedal_color: '*',
                    palmilha_color: draftPalmilha,
                    is_default: true,
                  });
                  setDraftPalmilha('');
                }}
                className="h-8 gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Criar default
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Regras específicas */}
      <div className="space-y-2">
        <Label className="text-xs">Exceções específicas</Label>
        {specificRules.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            Nenhuma exceção cadastrada — só a regra default se aplica.
          </p>
        )}
        {specificRules.map(rule => (
          <div key={rule.id} className="flex items-center gap-2 p-2 rounded-md border bg-card">
            <div className="flex-1 px-2 py-1.5 rounded bg-muted/30 text-xs">
              Cabedal <strong className="font-semibold">{rule.cabedal_color}</strong>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select
              value={rule.palmilha_color}
              onValueChange={(v) =>
                upsert.mutate({
                  id: rule.id,
                  cabedal_color: rule.cabedal_color,
                  palmilha_color: v,
                })
              }
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variants.map(v => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove.mutate(rule.id)}
              className="h-8 w-8 p-0"
              title="Remover regra"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      {/* Adicionar nova regra */}
      <div className="flex items-center gap-2 p-2 rounded-md border border-dashed">
        <Input
          placeholder="Cor cabedal (ex: Preto)"
          value={draftCabedal}
          onChange={e => setDraftCabedal(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        <Select value={draftPalmilha} onValueChange={setDraftPalmilha}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue placeholder="Palmilha…" />
          </SelectTrigger>
          <SelectContent>
            {variants.map(v => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          onClick={addDraft}
          disabled={!draftCabedal.trim() || !draftPalmilha.trim() || upsert.isPending}
          className="h-8 gap-1.5"
          title="Adicionar exceção"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {variants.length === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Nenhuma variante de cor encontrada pra este solado. Cadastre pelo menos
          uma variante (ex: Preto, Caramelo) em <em>Estoque</em> antes de configurar
          coligações.
        </p>
      )}
    </div>
  );
}
