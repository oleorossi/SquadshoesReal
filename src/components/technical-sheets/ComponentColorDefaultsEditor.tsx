import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Plus, Trash as Trash2, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
  useComponentColorDefaults,
  useAddComponentColorDefault,
  useUpdateComponentColorDefault,
  useDeleteComponentColorDefault,
} from '@/hooks/useComponentColorDefaults';

interface Props {
  groupId: string;
}

/**
 * Editor das regras GLOBAIS de componente por cor de UM grupo
 * (component_color_defaults): cor do cabedal/PV → produto padrão do grupo.
 * Modelado no SoleColorConjugationsEditor (soles-hub), com a diferença de
 * mapear cor → PRODUTO (não cor → cor). A regra vale pra QUALQUER ficha que
 * use o grupo — a ficha continua definindo a quantidade; exceções por ficha
 * continuam em "Componentes por Cor" da própria ficha (que sempre vence).
 */
export function ComponentColorDefaultsEditor({ groupId }: Props) {
  const { data: rules = [], isLoading } = useComponentColorDefaults(groupId);
  const addRule = useAddComponentColorDefault();
  const updateRule = useUpdateComponentColorDefault();
  const deleteRule = useDeleteComponentColorDefault();

  // Produtos ativos do grupo — os alvos possíveis da regra.
  const { data: groupProducts = [] } = useQuery({
    queryKey: ['component_color_default_group_products', groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, color')
        .eq('group_id', groupId)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string; color: string | null }>;
    },
  });

  const defaultRule = rules.find(r => r.is_default);
  const specificRules = rules.filter(r => !r.is_default);

  const [draftColor, setDraftColor] = useState('');
  const [draftProductId, setDraftProductId] = useState('');
  const [draftDefaultProductId, setDraftDefaultProductId] = useState('');

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const productLabel = (p: { name: string; color: string | null }) =>
    p.color?.trim() ? `${p.name} · ${p.color}` : p.name;

  const addDraft = () => {
    const c = draftColor.trim();
    if (!c || !draftProductId) {
      toast.error('Preencha a cor e o produto padrão');
      return;
    }
    if (c === '*') {
      toast.error('Use o slot "Padrão" pra a regra catch-all');
      return;
    }
    addRule.mutate({ groupId, cabedalColor: c, productId: draftProductId });
    setDraftColor('');
    setDraftProductId('');
  };

  const productSelect = (value: string, onChange: (pid: string) => void, placeholder = 'Produto…') => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 flex-1 min-w-0 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groupProducts.map(p => (
          <SelectItem key={p.id} value={p.id} className="text-xs">{productLabel(p)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Qualquer modelo que use este grupo na cor indicada consome o produto da regra —
        a ficha continua definindo a quantidade. Exceções por ficha continuam em
        "Componentes por Cor" da própria ficha (sempre vencem a regra global).
      </p>

      {/* Regra default (catch-all) */}
      <div className="rounded-md border border-dashed bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs uppercase">Padrão</Badge>
          <span className="text-xs text-muted-foreground">Cor não listada abaixo:</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-2 py-1.5 rounded-md bg-muted/40 text-xs text-muted-foreground italic">
            (qualquer outra cor)
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          {defaultRule ? (
            <>
              {productSelect(defaultRule.product_id, (pid) => {
                if (pid && pid !== defaultRule.product_id) updateRule.mutate({ id: defaultRule.id, productId: pid });
              })}
              <Button
                size="sm" variant="ghost"
                onClick={() => deleteRule.mutate({ id: defaultRule.id })}
                className="h-8 w-8 p-0 shrink-0" title="Remover regra padrão"
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </>
          ) : (
            <>
              {productSelect(draftDefaultProductId, setDraftDefaultProductId, 'Escolher…')}
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  if (!draftDefaultProductId) {
                    toast.error('Escolha o produto padrão do grupo');
                    return;
                  }
                  addRule.mutate({ groupId, cabedalColor: '*', productId: draftDefaultProductId, isDefault: true });
                  setDraftDefaultProductId('');
                }}
                className="h-8 gap-1.5 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" /> Criar padrão
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Regras específicas por cor */}
      <div className="space-y-2">
        <Label className="text-xs">Regras por cor</Label>
        {specificRules.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            Nenhuma regra por cor — só a regra padrão (se existir) se aplica.
          </p>
        )}
        {specificRules.map(rule => (
          <div key={rule.id} className="flex items-center gap-2 p-2 rounded-md border bg-card">
            <div className="flex-1 px-2 py-1.5 rounded bg-muted/30 text-xs min-w-0 truncate">
              Cor <strong className="font-semibold">{rule.cabedal_color}</strong>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            {productSelect(rule.product_id, (pid) => {
              if (pid && pid !== rule.product_id) updateRule.mutate({ id: rule.id, productId: pid });
            })}
            <Button
              size="sm" variant="ghost"
              onClick={() => deleteRule.mutate({ id: rule.id })}
              className="h-8 w-8 p-0 shrink-0" title="Remover regra"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      {/* Adicionar nova regra */}
      <div className="flex items-center gap-2 p-2 rounded-md border border-dashed">
        <Input
          placeholder="Cor do pedido (ex: Preta)"
          value={draftColor}
          onChange={e => setDraftColor(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        {productSelect(draftProductId, setDraftProductId)}
        <Button
          size="sm" variant="outline"
          onClick={addDraft}
          disabled={!draftColor.trim() || !draftProductId || addRule.isPending}
          className="h-8 gap-1.5 shrink-0"
          title="Adicionar regra"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {groupProducts.length === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Nenhum produto ativo neste grupo — cadastre as variações de cor do material
          em <em>Estoque</em> antes de criar regras.
        </p>
      )}
    </div>
  );
}
