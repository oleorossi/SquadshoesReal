import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cube as Box, Package, Check, Info, Stack as Layers, Hash, LinkSimple as Link2,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { safeToFixed } from '@/lib/utils';
import { toast } from 'sonner';

interface PackagingTabProps {
  sheetId?: string;
  /** @deprecated Mantido por compat — embalagem agora é vinculada por ficha (multi-select), não por solado. */
  soleGroupId?: string | null;
}

type BoxKind = 'individual' | 'master' | 'colmeia' | 'fitilho';

const KIND_LABEL: Record<BoxKind, string> = {
  individual: 'Caixa Individual',
  master: 'Caixa Master',
  colmeia: 'Caixa Colmeia',
  fitilho: 'Fitilho',
};

const KIND_BADGE: Record<BoxKind, { tone: string; helper: string }> = {
  individual: { tone: 'bg-blue-500/10 text-blue-700 border-blue-500/30', helper: '1 par por caixa (vai dentro da master ou amarrada com fitilho).' },
  master:     { tone: 'bg-purple-500/10 text-purple-700 border-purple-500/30', helper: 'Agrupa N pares (típico: 12) — 1 master = 1 volume na NF.' },
  colmeia:    { tone: 'bg-amber-500/10 text-amber-700 border-amber-500/30', helper: 'Carrega N pares direto (típico: 12) — 1 colmeia = 1 volume na NF.' },
  fitilho:    { tone: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30', helper: 'Material linear (metros) que amarra individuais. Não agrupa em master — cada par vira 1 volume na NF.' },
};

export function PackagingTab({ sheetId, soleGroupId }: PackagingTabProps) {
  const qc = useQueryClient();

  // Todas as caixas cadastradas no setor de Embalagens
  const { data: boxTypes = [], isLoading: loadingBoxes } = useQuery({
    queryKey: ['box_types_with_kind'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('box_types')
        .select('id, nome, tipo, pairs_per_box_default, metros_per_amarrado_default, comprimento_cm, largura_cm, altura_cm, peso_kg, unit_price, quantity, active')
        .eq('active', true)
        .order('nome');
      if (error) throw error;
      return (data || []) as Array<{
        id: string; nome: string; tipo: BoxKind | null; pairs_per_box_default: number | null;
        metros_per_amarrado_default: number | null;
        comprimento_cm: number; largura_cm: number; altura_cm: number;
        peso_kg: number | null; unit_price: number | null; quantity: number | null;
      }>;
    },
    staleTime: 60_000,
  });

  // Caixas já vinculadas à ficha
  const { data: linked = [], isLoading: loadingLinks } = useQuery({
    queryKey: ['ts_box_types', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_box_types')
        .select('box_type_id')
        .eq('sheet_id', sheetId);
      if (error) throw error;
      return ((data || []) as Array<{ box_type_id: string }>).map(r => r.box_type_id);
    },
  });

  const linkedSet = React.useMemo(() => new Set(linked), [linked]);

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ts_box_types', sheetId] });
  }, [qc, sheetId]);

  const toggle = async (boxId: string, checked: boolean) => {
    if (!sheetId) return;
    if (checked) {
      const { error } = await (supabase as any).from('technical_sheet_box_types')
        .insert({ sheet_id: sheetId, box_type_id: boxId });
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await (supabase as any).from('technical_sheet_box_types')
        .delete()
        .eq('sheet_id', sheetId)
        .eq('box_type_id', boxId);
      if (error) { toast.error(error.message); return; }
    }
    invalidate();
  };

  // Modelo novo é por ficha. Quando chamado com soleGroupId (legacy), mostra
  // aviso pedindo pra configurar via ficha — não tentamos derivar a primeira
  // ficha do solado porque diferentes fichas podem ter caixas diferentes.
  // (Fica DEPOIS dos hooks: early-return antes deles muda a contagem de hooks
  // entre renders quando sheetId chega async e crasha o componente.)
  if (!sheetId && soleGroupId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground space-y-2">
          <Info className="h-10 w-10 mx-auto opacity-30" />
          <p className="text-sm font-medium text-foreground">Embalagem agora é vinculada por ficha técnica</p>
          <p className="text-xs max-w-md mx-auto">
            Abra a ficha técnica do modelo (Fichas Técnicas → escolha a referência → aba Embalagem)
            pra marcar quais caixas cadastradas em <strong>Gestão de Embalagens</strong> essa ficha usa.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!sheetId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground space-y-2">
          <Info className="h-10 w-10 mx-auto opacity-30" />
          <p className="text-sm font-medium text-foreground">Salve a ficha antes de vincular embalagens.</p>
        </CardContent>
      </Card>
    );
  }

  if (loadingBoxes || loadingLinks) {
    return <p className="text-center py-6 text-muted-foreground text-sm">Carregando...</p>;
  }

  if (boxTypes.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground space-y-2">
          <Package className="h-10 w-10 mx-auto opacity-30" />
          <p className="text-sm font-medium text-foreground">Nenhuma embalagem cadastrada</p>
          <p className="text-xs">Cadastre caixas em <strong>Gestão de Embalagens → Cadastro & Estoque</strong> primeiro. Aqui você apenas vincula as medidas que essa ficha usa.</p>
        </CardContent>
      </Card>
    );
  }

  // Agrupa por tipo pra montar uma seção por kind
  const byKind: Record<BoxKind, typeof boxTypes> = { individual: [], master: [], colmeia: [], fitilho: [] };
  for (const b of boxTypes) {
    const k = (b.tipo || 'individual') as BoxKind;
    byKind[k].push(b);
  }

  const renderRow = (b: typeof boxTypes[number]) => {
    const checked = linkedSet.has(b.id);
    const k = (b.tipo || 'individual') as BoxKind;
    return (
      <label
        key={b.id}
        className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
          checked ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/30'
        }`}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => toggle(b.id, Boolean(v))}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{b.nome}</span>
            <Badge variant="outline" className={`text-xs ${KIND_BADGE[k].tone}`}>{KIND_LABEL[k]}</Badge>
            {checked && <Check className="h-3.5 w-3.5 text-primary" />}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
            <span>{b.comprimento_cm}×{b.largura_cm}×{b.altura_cm} cm</span>
            <span className="inline-flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {b.pairs_per_box_default ?? '?'} {k === 'fitilho' ? 'pares/amarrado' : 'pares/caixa'}
            </span>
            {k === 'fitilho' && b.metros_per_amarrado_default && (
              <span>{safeToFixed(b.metros_per_amarrado_default, 2)} m/amarrado</span>
            )}
            <span>Estoque: {b.quantity ?? 0} un</span>
          </div>
        </div>
      </label>
    );
  };

  const sectionFor = (kind: BoxKind, Icon: any) => {
    const list = byKind[kind];
    if (list.length === 0) return null;
    const cfg = KIND_BADGE[kind];
    const selectedCount = list.filter(b => linkedSet.has(b.id)).length;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            {KIND_LABEL[kind]}
            {selectedCount > 0 && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {selectedCount} vinculada{selectedCount > 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{cfg.helper}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {list.map(renderRow)}
        </CardContent>
      </Card>
    );
  };

  const linkedCount = linked.length;

  return (
    <div className="space-y-5">
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex gap-2">
        <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-foreground font-medium">Vincule as medidas que essa ficha usa</p>
          <p>
            Marque cada caixa que pode ser usada pra esse modelo. Tipo (individual/master/colmeia/fitilho)
            e capacidade (pares por caixa) vêm do cadastro em <strong>Gestão de Embalagens</strong>.
            No PV, ao escolher o modo (Tradicional/Colméia/Amarrado), o sistema pega automaticamente
            a caixa do tipo correspondente entre as vinculadas aqui.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Box className="h-4 w-4 text-primary" /> Embalagens vinculadas
        </h3>
        <Badge variant="secondary" className="text-xs">
          {linkedCount} de {boxTypes.length}
        </Badge>
      </div>

      {sectionFor('individual', Package)}
      {sectionFor('master', Layers)}
      {sectionFor('colmeia', Box)}
      {sectionFor('fitilho', Link2)}
    </div>
  );
}

export default PackagingTab;
