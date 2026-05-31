// =============================================================================
// SoleDriverPicker.tsx
// Primeiro passo da ficha técnica: escolher o SOLADO que dita o consumo.
// =============================================================================
import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Info, Lock, LockOpen as Unlock, Stack as Layers } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type SoleProduct = {
  id: string;
  name: string;
  color: string | null;
  quantity: number;
  sku: string | null;
};

interface SoleDriverPickerProps {
  primarySoleId: string | null;
  soleDrivesConsumption: boolean;
  referenceSize: number;
  onChangePrimarySole: (id: string | null) => void;
  onChangeSoleDrivesConsumption: (v: boolean) => void;
  onChangeReferenceSize: (size: number) => void;
}

export function SoleDriverPicker({
  primarySoleId,
  soleDrivesConsumption,
  referenceSize,
  onChangePrimarySole,
  onChangeSoleDrivesConsumption,
  onChangeReferenceSize,
}: SoleDriverPickerProps) {
  const { data: soles = [] } = useQuery<SoleProduct[]>({
    queryKey: ['products-soles'],
    queryFn: async () => {
      // BUG ANTIGO: usávamos .or('category.ilike.%solado%,product_groups.name.ilike.%solado%')
      // mas PostgREST falha (PGRST100) quando o filtro embedded (product_groups.name)
      // está dentro do .or() top-level. Resultado: query falhava silenciosa e solados
      // sumiam (ex: "Saltinho Bloco" tem category='Solado' mas group_name='SALTINHO BLOCO'
      // — não casa com %solado% no group).
      // FIX: dois queries paralelos + merge no client. Cobre AMBOS os cenários
      // (category preenchida OR grupo com 'solado' no nome) sem usar embedded OR.
      const [byCategory, soleGroups] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, color, quantity, sku, category, group_id')
          .eq('active', true)
          .ilike('category', '%solado%'),
        supabase
          .from('product_groups')
          .select('id')
          .ilike('name', '%solado%'),
      ]);
      if (byCategory.error) throw byCategory.error;
      if (soleGroups.error) throw soleGroups.error;

      const soleGroupIds = (soleGroups.data ?? []).map((g: any) => g.id);
      const fromGroupsRes = soleGroupIds.length > 0
        ? await supabase
            .from('products')
            .select('id, name, color, quantity, sku, category, group_id')
            .eq('active', true)
            .in('group_id', soleGroupIds)
        : { data: [], error: null };
      if (fromGroupsRes.error) throw fromGroupsRes.error;

      // Merge dedup por id
      const map = new Map<string, SoleProduct>();
      for (const p of (byCategory.data ?? [])) map.set(p.id, p as any);
      for (const p of (fromGroupsRes.data ?? [])) map.set(p.id, p as any);
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    },
  });

  const groupedSoles = useMemo(() => {
    const map = new Map<string, SoleProduct[]>();
    for (const s of soles) {
      const base = (s.name || '').replace(/\s*-\s*(preto|branco|caramelo|marrom|bege).*$/i, '').trim();
      const key = base || s.name;
      (map.get(key) ?? map.set(key, []).get(key)!).push(s);
    }
    return Array.from(map.entries());
  }, [soles]);

  const selectedSole = soles.find((s) => s.id === primarySoleId);
  const hasSelection = Boolean(primarySoleId);

  return (
    <Card className="p-4 border-2 border-primary/20 bg-primary/5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 font-bold text-foreground">
            <Layers className="w-5 h-5 text-primary" />
            Passo 1 — Solado (Fator Principal)
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            O solado é o primeiro item da ficha técnica e dita o consumo dos demais materiais.
          </p>
        </div>
        <Badge variant={hasSelection ? 'default' : 'destructive'} className="shrink-0">
          {hasSelection ? (
            <><Unlock className="w-3 h-3 mr-1" />Configurado</>
          ) : (
            <><Lock className="w-3 h-3 mr-1" />Obrigatório</>
          )}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-7">
          <Label className="text-xs font-bold text-muted-foreground uppercase">Solado principal</Label>
          <select
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={primarySoleId ?? ''}
            onChange={(e) => onChangePrimarySole(e.target.value || null)}
          >
            <option value="">— Selecione um solado —</option>
            {groupedSoles.map(([base, variants]) => (
              <optgroup key={base} label={base}>
                {variants.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.color ? `(${s.color})` : ''} — estoque: {s.quantity}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedSole && (
            <div className="mt-2 text-xs text-muted-foreground">
              SKU: <span className="font-mono">{selectedSole.sku}</span> · Estoque atual:{' '}
              <strong className="text-foreground">{selectedSole.quantity}</strong>
            </div>
          )}
        </div>

        <div className="md:col-span-2">
          <Label className="text-xs font-bold text-muted-foreground uppercase">Tamanho ref.</Label>
          <Input
            type="number" min={20} max={50}
            value={referenceSize}
            onChange={(e) => onChangeReferenceSize(Number(e.target.value || 37))}
            className="h-10"
          />
          <p className="text-xs text-muted-foreground mt-1">Usado nas specs do solado</p>
        </div>

        <div className="md:col-span-3 flex flex-col justify-start">
          <Label className="text-xs font-bold text-muted-foreground uppercase mb-2">Modo de consumo</Label>
          <div className="flex items-center gap-2 p-2 bg-card rounded-md border border-border">
            <Switch
              checked={soleDrivesConsumption}
              onCheckedChange={onChangeSoleDrivesConsumption}
              disabled={!hasSelection}
            />
            <span className="text-xs">
              {soleDrivesConsumption ? (
                <span className="font-medium text-primary">Solado dita consumo</span>
              ) : (
                <span className="text-muted-foreground">Consumo manual</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {soleDrivesConsumption && hasSelection && (
        <div className="mt-3 flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-700 dark:text-blue-300">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Modo solado-driver ativo.</strong> O consumo de cabedal, forração e palmilha será
            calculado a partir das specs técnicas do solado (tabela <code>sole_technical_specs</code>)
            para o tamanho <strong>{referenceSize}</strong>.
          </div>
        </div>
      )}

      {!hasSelection && (
        <div className="mt-3 flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-700 dark:text-amber-300">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <strong>Selecione um solado para destravar os demais campos.</strong>
        </div>
      )}
    </Card>
  );
}
