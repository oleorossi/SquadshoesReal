import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Info, LinkSimple, Plus, Stack as Layers, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { ProductGroup } from '@/hooks/useGroups';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface GroupLayer {
  id?: string;
  component_group_id: string | null;
  component_label: string;
  role: string;
  display_order: number;
  is_color_source: boolean;
}

interface Props {
  groupId: string;
  groupName: string;
  groups: ProductGroup[];
  colors: string[];
}

const CUSTOM_VALUE = '__custom__';

function emptyLayer(displayOrder: number): GroupLayer {
  return {
    component_group_id: null,
    component_label: '',
    role: displayOrder === 0 ? 'Material externo' : 'Base da dublagem',
    display_order: displayOrder,
    is_color_source: displayOrder === 0,
  };
}

export default function GroupCompositionTab({ groupId, groupName, groups, colors }: Props) {
  const queryClient = useQueryClient();
  const [layers, setLayers] = useState<GroupLayer[]>([]);

  const query = useQuery({
    queryKey: ['product_group_layers', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      // Tipos do Supabase são regenerados somente após a migration chegar ao banco.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('product_group_layers')
        .select('id,component_group_id,component_label,role,display_order,is_color_source')
        .eq('composite_group_id', groupId)
        .order('display_order');
      if (error) throw error;
      return (data || []) as GroupLayer[];
    },
  });

  useEffect(() => {
    if (!query.isSuccess) return;
    setLayers(query.data.map((layer, index) => ({ ...layer, display_order: index })));
  }, [query.data, query.isSuccess]);

  const leafGroups = useMemo(() => {
    const parentIds = new Set(groups.map(group => group.parent_group_id).filter(Boolean));
    return groups
      .filter(group => group.id !== groupId && !parentIds.has(group.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [groupId, groups]);

  const validationMessage = useMemo(() => {
    if (layers.length === 1) return 'Uma composição precisa de pelo menos duas camadas.';
    if (layers.some(layer => !layer.component_label.trim())) return 'Informe o material de todas as camadas.';
    if (layers.filter(layer => layer.is_color_source).length > 1) return 'Escolha somente uma camada como referência visual de cor.';
    return '';
  }, [layers]);

  const save = useMutation({
    mutationFn: async () => {
      if (validationMessage) throw new Error(validationMessage);
      const payload = layers.map((layer, index) => ({
        component_group_id: layer.component_group_id,
        component_label: layer.component_label.trim(),
        role: layer.role.trim() || 'Camada',
        display_order: index,
        is_color_source: layer.is_color_source,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('save_product_group_layers', {
        p_composite_group_id: groupId,
        p_layers: payload,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['product_group_layers'] });
      toast.success('Composição da dublagem salva!');
    },
    onError: (error: Error) => toast.error(`Não foi possível salvar: ${error.message}`),
  });

  const patchLayer = (index: number, patch: Partial<GroupLayer>) => {
    setLayers(current => current.map((layer, layerIndex) => layerIndex === index ? { ...layer, ...patch } : layer));
  };

  const selectSource = (index: number, checked: boolean) => {
    setLayers(current => current.map((layer, layerIndex) => ({
      ...layer,
      is_color_source: checked ? layerIndex === index : (layerIndex === index ? false : layer.is_color_source),
    })));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Layers className="h-4 w-4" weight="bold" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Camadas de {groupName}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Registre os materiais unidos na dublagem. Esta composição é técnica e de rastreabilidade:
              a baixa do calçado continua ocorrendo somente no SKU acabado deste grupo, evitando débito em dobro.
            </p>
          </div>
        </div>
      </div>

      {query.isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Não foi possível carregar a composição. Atualize a tela e tente novamente.
        </div>
      ) : query.isLoading ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Carregando composição…</div>
      ) : layers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-5 text-center">
          <Layers className="mx-auto h-7 w-7 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium">Nenhuma camada informada</p>
          <p className="mt-1 text-xs text-muted-foreground">Adicione ao menos dois materiais que formam este dublado.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 gap-1.5"
            onClick={() => setLayers([emptyLayer(0), emptyLayer(1)])}
          >
            <Plus className="h-3.5 w-3.5" />
            Informar composição
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {layers.map((layer, index) => (
            <div key={layer.id || `new-${index}`} className="rounded-xl border bg-card p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground font-mono text-[10px] font-bold text-background">{index + 1}</span>
                  <span className="text-xs font-semibold uppercase tracking-wide">Camada {index + 1}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Remover camada ${index + 1}`}
                  onClick={() => setLayers(current => current.filter((_, layerIndex) => layerIndex !== index))}
                >
                  <Trash className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(180px,0.65fr)]">
                <div className="space-y-1.5">
                  <Label className="text-xs">Material utilizado</Label>
                  <Select
                    value={layer.component_group_id || CUSTOM_VALUE}
                    onValueChange={value => {
                      if (value === CUSTOM_VALUE) {
                        patchLayer(index, { component_group_id: null, component_label: '' });
                        return;
                      }
                      const selected = leafGroups.find(group => group.id === value);
                      patchLayer(index, { component_group_id: value, component_label: selected?.name || '' });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione no estoque" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CUSTOM_VALUE}>Material livre / ainda sem grupo</SelectItem>
                      {leafGroups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {!layer.component_group_id && (
                    <Input
                      value={layer.component_label}
                      onChange={event => patchLayer(index, { component_label: event.target.value })}
                      placeholder="Ex.: PU 600, cacharrel ou EVA"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Função na composição</Label>
                  <Input
                    value={layer.role}
                    onChange={event => patchLayer(index, { role: event.target.value })}
                    placeholder="Ex.: Base, espuma, acabamento"
                  />
                </div>
              </div>

              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg bg-muted/45 px-3 py-2">
                <Checkbox
                  checked={layer.is_color_source}
                  onCheckedChange={checked => selectSource(index, checked === true)}
                />
                <span className="text-xs leading-relaxed">
                  <strong className="font-medium">Referência visual de cor</strong>
                  <span className="block text-muted-foreground">Identifica qual camada orienta a combinação; as cores disponíveis para venda continuam sendo os SKUs acabados.</span>
                </span>
              </label>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setLayers(current => [...current, emptyLayer(current.length)])}>
            <Plus className="h-3.5 w-3.5" />
            Adicionar camada
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
          {colors.length > 0 ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" weight="bold" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {colors.length > 0
              ? `${colors.length} ${colors.length === 1 ? 'cor acabada cadastrada' : 'cores acabadas cadastradas'}: ${colors.slice(0, 5).join(', ')}${colors.length > 5 ? ` +${colors.length - 5}` : ''}.`
              : 'Cadastre as cores acabadas na aba Cores para que o Pedido de Venda resolva o SKU correto.'}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={save.isPending || !!validationMessage || !query.isSuccess}
          onClick={() => save.mutate()}
        >
          <LinkSimple className="h-3.5 w-3.5" />
          {save.isPending ? 'Salvando…' : 'Salvar composição'}
        </Button>
      </div>

      {validationMessage && <p className="text-xs text-destructive">{validationMessage}</p>}
    </div>
  );
}
