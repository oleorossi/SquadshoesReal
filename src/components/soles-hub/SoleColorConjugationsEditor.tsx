import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleNotch as Loader2, PaintBrush, Plus, ShieldCheck } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { normalizeColorKey } from '@/lib/materialConsumption';
import type { SoleColorResolutionMode } from '@/lib/soleColorResolution';

/* Tipos gerados serão atualizados após a migration adicionar resolution_mode. */
/* eslint-disable @typescript-eslint/no-explicit-any */

interface ConjugationRule {
  id: string;
  sole_group_id: string;
  cabedal_color: string;
  palmilha_color: string | null;
  resolution_mode: SoleColorResolutionMode;
  is_default: boolean;
  active: boolean;
}

interface Props {
  soleGroupId: string;
}

const MODE_LABEL: Record<SoleColorResolutionMode, string> = {
  fixed: 'Cor fixa',
  same_as_upper: 'Mesma cor do cabedal (pintável)',
};

export function SoleColorConjugationsEditor({ soleGroupId }: Props) {
  const qc = useQueryClient();
  const [draftCabedal, setDraftCabedal] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [draftMode, setDraftMode] = useState<SoleColorResolutionMode>('fixed');
  const [defaultColor, setDefaultColor] = useState('');
  const [defaultMode, setDefaultMode] = useState<SoleColorResolutionMode>('fixed');

  const { data: variants = [] } = useQuery({
    queryKey: ['sole_group_color_variants', soleGroupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, color, quantity')
        .eq('group_id', soleGroupId)
        .eq('active', true)
        .not('color', 'is', null);
      if (error) throw error;
      const colors = new Map<string, { color: string; quantity: number }>();
      for (const row of data || []) {
        const color = String(row.color || '').trim();
        const key = normalizeColorKey(color);
        if (!key) continue;
        const current = colors.get(key);
        if (!current || Number(row.quantity) > current.quantity) {
          colors.set(key, { color, quantity: Number(row.quantity) || 0 });
        }
      }
      return [...colors.values()].sort((a, b) => a.color.localeCompare(b.color, 'pt-BR'));
    },
  });

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['sole_color_conjugations', soleGroupId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_color_conjugations')
        .select('id, sole_group_id, cabedal_color, palmilha_color, resolution_mode, is_default, active')
        .eq('sole_group_id', soleGroupId)
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('cabedal_color');
      if (error) throw error;
      return (data || []) as ConjugationRule[];
    },
  });

  const invalidateResolution = () => {
    qc.invalidateQueries({ queryKey: ['sole_color_conjugations', soleGroupId] });
    qc.invalidateQueries({ queryKey: ['sole_color_conjugations_for_print'] });
    qc.invalidateQueries({ queryKey: ['sole_shortages'] });
    qc.invalidateQueries({ queryKey: ['sale_order_consumption'] });
  };

  const upsert = useMutation({
    mutationFn: async (rule: {
      id?: string;
      cabedal_color: string;
      palmilha_color: string | null;
      resolution_mode: SoleColorResolutionMode;
      is_default?: boolean;
    }) => {
      const payload = {
        cabedal_color: rule.cabedal_color,
        palmilha_color: rule.resolution_mode === 'same_as_upper' ? null : rule.palmilha_color,
        resolution_mode: rule.resolution_mode,
        is_default: rule.is_default || false,
        active: true,
        updated_at: new Date().toISOString(),
      };
      if (rule.id) {
        const { error } = await (supabase as any)
          .from('sole_color_conjugations')
          .update(payload)
          .eq('id', rule.id);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from('sole_color_conjugations')
        .insert({ ...payload, sole_group_id: soleGroupId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateResolution();
      toast.success('Regra de cor do solado salva');
    },
    onError: (error: Error) => toast.error(error.message),
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
      invalidateResolution();
      toast.success('Regra removida');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const defaultRule = rules.find(rule => rule.is_default);
  const blackRule = rules.find(rule => !rule.is_default && normalizeColorKey(rule.cabedal_color) === 'preto');
  const specificRules = rules.filter(rule => !rule.is_default && normalizeColorKey(rule.cabedal_color) !== 'preto');
  const hasBlackVariant = variants.some(variant => normalizeColorKey(variant.color) === 'preto');

  const saveRule = (rule: ConjugationRule, mode: SoleColorResolutionMode, color?: string) => {
    if (mode === 'fixed' && !color) {
      toast.error('Escolha a cor fixa do solado');
      return;
    }
    upsert.mutate({
      id: rule.id,
      cabedal_color: rule.cabedal_color,
      palmilha_color: mode === 'fixed' ? color || rule.palmilha_color : null,
      resolution_mode: mode,
      is_default: rule.is_default,
    });
  };

  const addSpecific = () => {
    const cabedal = draftCabedal.trim();
    if (!cabedal) return toast.error('Informe a cor do cabedal');
    if (normalizeColorKey(cabedal) === 'preto') return toast.error('Preto já é uma regra obrigatória do sistema');
    if (specificRules.some(rule => normalizeColorKey(rule.cabedal_color) === normalizeColorKey(cabedal))) {
      return toast.error('Já existe regra para essa cor de cabedal');
    }
    if (draftMode === 'fixed' && !draftColor) return toast.error('Escolha a cor fixa do solado');
    upsert.mutate({
      cabedal_color: cabedal,
      palmilha_color: draftMode === 'fixed' ? draftColor : null,
      resolution_mode: draftMode,
    });
    setDraftCabedal('');
    setDraftColor('');
    setDraftMode('fixed');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-300/70 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4" /> Regra obrigatória
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="rounded bg-background px-2 py-1">Cabedal <strong>Preto</strong></span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Solado <strong>Preto</strong></span>
          {blackRule && <Badge variant="outline">Protegida</Badge>}
        </div>
        {!hasBlackVariant && (
          <p className="mt-2 text-xs font-medium text-destructive">
            Este grupo ainda não possui uma variante ativa de solado Preto. Pedidos pretos ficarão bloqueados para evitar baixa incorreta.
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase">Demais cores</Badge>
          <span className="text-xs text-muted-foreground">Regra usada quando não houver exceção específica.</span>
        </div>
        {defaultRule ? (
          <RuleControls
            rule={defaultRule}
            variants={variants}
            onChange={saveRule}
            onRemove={() => remove.mutate(defaultRule.id)}
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <ModeSelect value={defaultMode} onChange={setDefaultMode} />
            {defaultMode === 'fixed' ? (
              <ColorSelect value={defaultColor} variants={variants} onChange={setDefaultColor} />
            ) : <PaintedLabel />}
            <Button
              size="sm"
              variant="outline"
              disabled={upsert.isPending || (defaultMode === 'fixed' && !defaultColor)}
              onClick={() => upsert.mutate({
                cabedal_color: '*',
                palmilha_color: defaultMode === 'fixed' ? defaultColor : null,
                resolution_mode: defaultMode,
                is_default: true,
              })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Criar regra
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Exceções por cor do cabedal</Label>
        {specificRules.map(rule => (
          <div key={rule.id} className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[minmax(140px,1fr)_auto_minmax(190px,1fr)_minmax(160px,1fr)_auto]">
            <span className="text-xs">Cabedal <strong>{rule.cabedal_color}</strong></span>
            <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
            <RuleControls rule={rule} variants={variants} onChange={saveRule} compact />
            <DeleteConfirmButton
              title="Remover regra?"
              description={`O cabedal ${rule.cabedal_color} voltará a usar a regra das demais cores.`}
              size="h-8 w-8"
              onConfirm={() => remove.mutate(rule.id)}
            />
          </div>
        ))}
        {specificRules.length === 0 && <p className="text-xs italic text-muted-foreground">Nenhuma exceção cadastrada.</p>}
      </div>

      <div className="grid items-center gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[minmax(150px,1fr)_minmax(190px,1fr)_minmax(160px,1fr)_auto]">
        <Input value={draftCabedal} onChange={event => setDraftCabedal(event.target.value)} placeholder="Cor do cabedal" className="h-8 text-xs" />
        <ModeSelect value={draftMode} onChange={setDraftMode} />
        {draftMode === 'fixed'
          ? <ColorSelect value={draftColor} variants={variants} onChange={setDraftColor} />
          : <PaintedLabel />}
        <Button size="sm" variant="outline" onClick={addSpecific} disabled={upsert.isPending} className="h-8">
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        No modo pintável, o sistema procura no mesmo grupo uma variante física com a mesma cor do cabedal. Se ela não existir, consumo, compra e baixa ficam sem resolução — nunca migram para outra cor silenciosamente.
      </p>
    </div>
  );
}

function ModeSelect({ value, onChange }: { value: SoleColorResolutionMode; onChange: (value: SoleColorResolutionMode) => void }) {
  return (
    <Select value={value} onValueChange={value => onChange(value as SoleColorResolutionMode)}>
      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="fixed">{MODE_LABEL.fixed}</SelectItem>
        <SelectItem value="same_as_upper">{MODE_LABEL.same_as_upper}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ColorSelect({ value, variants, onChange }: {
  value: string;
  variants: Array<{ color: string; quantity: number }>;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Cor do solado…" /></SelectTrigger>
      <SelectContent>
        {variants.map(variant => (
          <SelectItem key={normalizeColorKey(variant.color)} value={variant.color}>
            {variant.color} · {variant.quantity} pares
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PaintedLabel() {
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 text-xs">
      <PaintBrush className="h-3.5 w-3.5 text-primary" /> Mesma cor do cabedal
    </div>
  );
}

function RuleControls({ rule, variants, onChange, onRemove, compact = false }: {
  rule: ConjugationRule;
  variants: Array<{ color: string; quantity: number }>;
  onChange: (rule: ConjugationRule, mode: SoleColorResolutionMode, color?: string) => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const mode = rule.resolution_mode || 'fixed';
  return (
    <div className={compact ? 'contents' : 'grid gap-2 sm:grid-cols-[1fr_1fr_auto]'}>
      <ModeSelect
        value={mode}
        onChange={next => onChange(
          rule,
          next,
          rule.palmilha_color || (next === 'fixed' ? variants[0]?.color : undefined),
        )}
      />
      {mode === 'fixed'
        ? <ColorSelect value={rule.palmilha_color || ''} variants={variants} onChange={color => onChange(rule, 'fixed', color)} />
        : <PaintedLabel />}
      {onRemove && (
        <DeleteConfirmButton
          title="Remover regra das demais cores?"
          description="As cores sem exceção voltarão a usar a ficha técnica legada."
          size="h-8 w-8"
          onConfirm={onRemove}
        />
      )}
    </div>
  );
}
