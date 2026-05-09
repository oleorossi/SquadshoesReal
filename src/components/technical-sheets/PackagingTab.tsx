import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Package, Check, Info, Layers, Link2, Hash } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { safeToFixed } from '@/lib/utils';
import { toast } from 'sonner';

interface PackagingTabProps {
  sheetId?: string;
  soleGroupId?: string | null;
}

 type PackagingType = 'individual' | 'colmeia' | 'master' | 'fitilho';

 const PKG_LABELS: Record<string, string> = {
  individual: 'Caixa Individual',
  colmeia: 'Caixa Colméia',
  master: 'Caixa Master',
  fitilho: 'Fitilho',
};

const COLUMN_BY_TYPE: Record<PackagingType, { box: string; pairs: string }> = {
  individual: { box: 'box_type_id',         pairs: 'pairs_per_box_individual' },
  master:     { box: 'box_type_master_id',  pairs: 'pairs_per_box_master' },
  colmeia:    { box: 'box_type_colmeia_id', pairs: 'pairs_per_box_colmeia' },
  fitilho:    { box: 'box_type_fitilho_id', pairs: 'pairs_per_box_fitilho' },
};

export function PackagingTab({ sheetId, soleGroupId: directSoleGroupId }: PackagingTabProps) {
  const qc = useQueryClient();

  // Resolve solado da ficha
  const { data: sheet, isLoading: loadingSheet } = useQuery({
    queryKey: ['sheet_sole_group', sheetId],
    enabled: !!sheetId && !directSoleGroupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, sole_group_id, sole_material')
        .eq('id', sheetId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const soleGroupId = directSoleGroupId || sheet?.sole_group_id || null;

  // Carrega config de embalagens diretamente do solado
  const { data: soleGroup, isLoading: loadingGroup } = useQuery({
    queryKey: ['sole_group_packaging', soleGroupId],
    enabled: !!soleGroupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select('id, name, box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id, pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, pairs_per_box_fitilho, metros_fitilho_per_amarrado')
        .eq('id', soleGroupId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const handleMetersChange = async (meters: number) => {
    if (!soleGroupId || !Number.isFinite(meters) || meters <= 0) return;
    const { error } = await (supabase as any).from('product_groups')
      .update({ metros_fitilho_per_amarrado: meters }).eq('id', soleGroupId);
    if (error) { toast.error(error.message); return; }
    invalidate();
  };

  const isLoading = loadingSheet || loadingGroup;

  const { data: boxTypes = [] } = useQuery({
    queryKey: ['box_types_active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('box_types')
        .select('id, nome, comprimento_cm, largura_cm, altura_cm, peso_kg, interno, quantity, unit_price, supplier_id')
        .eq('active', true)
        .order('nome');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const invalidate = React.useCallback(() => {
    if (soleGroupId) {
      qc.invalidateQueries({ queryKey: ['sole_group_packaging', soleGroupId] });
    }
    qc.invalidateQueries({ queryKey: ['product_groups'] });
  }, [qc, soleGroupId]);

  const handleSelect = async (packagingType: PackagingType, boxId: string, pairsDefault: number) => {
    if (!soleGroupId) {
      toast.error('Defina o solado da ficha primeiro');
      return;
    }
    const cols = COLUMN_BY_TYPE[packagingType];
    const currentPairs = (soleGroup as any)?.[cols.pairs];
    const payload: Record<string, any> = {
      [cols.box]: boxId,
      [cols.pairs]: currentPairs ?? pairsDefault,
    };
    const { error } = await (supabase as any).from('product_groups')
      .update(payload).eq('id', soleGroupId);
    if (error) { toast.error(error.message); return; }
    toast.success(`${PKG_LABELS[packagingType]} vinculada ao solado!`);
    invalidate();
  };

  const handlePairsChange = async (packagingType: PackagingType, pairs: number) => {
    if (!soleGroupId || !Number.isFinite(pairs) || pairs < 1) return;
    const cols = COLUMN_BY_TYPE[packagingType];
    const { error } = await (supabase as any).from('product_groups')
      .update({ [cols.pairs]: Math.round(pairs) }).eq('id', soleGroupId);
    if (error) { toast.error(error.message); return; }
    invalidate();
  };

  const handleClear = async (packagingType: PackagingType) => {
    if (!soleGroupId) return;
    const cols = COLUMN_BY_TYPE[packagingType];
    const { error } = await (supabase as any).from('product_groups')
      .update({ [cols.box]: null, [cols.pairs]: null }).eq('id', soleGroupId);
    if (error) { toast.error(error.message); return; }
    toast.success('Embalagem removida!');
    invalidate();
  };

  const renderBoxCard = (box: typeof boxTypes[number] | undefined) => {
    if (!box) return null;
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-0.5 mt-2">
        <p className="font-medium text-foreground text-sm flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-green-500" /> {box.nome}
        </p>
        <p>Dimensões: {box.comprimento_cm}×{box.largura_cm}×{box.altura_cm} cm</p>
        {box.peso_kg ? <p>Peso: {box.peso_kg} g</p> : null}
        <p>Custo: R$ {safeToFixed(box.unit_price, 2)}</p>
        <p>Estoque: {box.quantity ?? 0} un</p>
      </div>
    );
  };

  if (isLoading) return <p className="text-center py-6 text-muted-foreground text-sm">Carregando...</p>;

  if (!soleGroupId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground space-y-2">
          <Info className="h-10 w-10 mx-auto opacity-30" />
          <p className="text-sm font-medium text-foreground">Solado não definido nesta ficha</p>
          <p className="text-xs">A embalagem agora é configurada por solado. Selecione o Grupo de Solado na aba principal da ficha técnica para liberar este painel.</p>
        </CardContent>
      </Card>
    );
  }

  const renderSlot = (
    type: PackagingType,
    defaultPairs: number,
    helper: string,
  ) => {
    const cols = COLUMN_BY_TYPE[type];
    const boxId = (soleGroup as any)?.[cols.box] || '';
    const pairs = (soleGroup as any)?.[cols.pairs] ?? defaultPairs;
    const box = boxId ? boxTypes.find(b => b.id === boxId) : undefined;
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-xs">{PKG_LABELS[type]}</Badge>
            {boxId && (
              <button onClick={() => handleClear(type)} className="text-[10px] text-destructive hover:underline">
                Remover
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">{helper}</p>
          <div>
            <Label className="text-xs">Selecionar embalagem cadastrada</Label>
            <Select value={boxId} onValueChange={v => handleSelect(type, v, defaultPairs)}>
              <SelectTrigger><SelectValue placeholder={`Selecionar ${PKG_LABELS[type].toLowerCase()}...`} /></SelectTrigger>
              <SelectContent>
                {boxTypes.map(bt => (
                  <SelectItem key={bt.id} value={bt.id} className="text-xs">
                    {bt.nome} — {bt.comprimento_cm}×{bt.largura_cm}×{bt.altura_cm} cm — Est: {bt.quantity ?? 0}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {boxId && (
            <div>
              <Label className="text-xs">Pares por caixa</Label>
              <Input
                type="number"
                min={1}
                defaultValue={pairs}
                key={`${type}-${pairs}`}
                onBlur={e => handlePairsChange(type, Number(e.target.value))}
                className="h-8 text-xs"
              />
            </div>
          )}
          {renderBoxCard(box)}
        </CardContent>
      </Card>
    );
  };

  // Calcula caixas individuais por master (rácio típico = 12).
  const pgAny = soleGroup as any;
  const pairsIndividual = pgAny?.pairs_per_box_individual ?? null;
  const pairsMaster = pgAny?.pairs_per_box_master ?? null;
  const individualPerMaster = pairsIndividual && pairsMaster && pairsIndividual > 0
    ? Math.round(pairsMaster / pairsIndividual)
    : null;

  // Indica se cada modo está completo (todos os slots necessários preenchidos).
  const tradicionalReady = !!pgAny?.box_type_id && !!pgAny?.box_type_master_id;
  const colmeiaReady = !!pgAny?.box_type_colmeia_id;
  const amarradoReady = !!pgAny?.box_type_id && !!pgAny?.box_type_fitilho_id;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Box className="h-4 w-4 text-primary" /> Embalagens do Solado
        </h3>
        <Badge variant="secondary" className="text-[10px]">
          Solado: {(soleGroup as any)?.name || sheet?.sole_material || '—'}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        A embalagem é configurada por solado. Toda ficha que usar este solado herda automaticamente estas caixas.
        Configure os slots dos modos que sua fábrica usa — cada PV escolhe um modo na hora de criar.
      </p>

      {boxTypes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhuma embalagem cadastrada.</p>
            <p className="text-xs mt-1">Cadastre caixas na Gestão de Embalagens primeiro.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Modo 1: Tradicional (individual + master) */}
          <Card className={tradicionalReady ? 'border-primary/40' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Modo 1 · Tradicional <span className="text-xs font-normal text-muted-foreground">— Individual + Master</span>
                {tradicionalReady && <Badge variant="secondary" className="ml-auto text-[10px]">Configurado</Badge>}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Cada par vai numa caixa individual, e essas individuais são acomodadas dentro de uma caixa master.
                {individualPerMaster !== null && (
                  <span className="ml-1 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary font-medium">
                    <Hash className="h-3 w-3" /> {individualPerMaster} individuais por master
                  </span>
                )}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {renderSlot('individual', 1, 'Caixa de 1 par. Vai dentro da master.')}
                {renderSlot('master', 12, 'Caixa que agrupa N caixas individuais (típico: 12 pares).')}
              </div>
            </CardContent>
          </Card>

          {/* Modo 2: Colméia */}
          <Card className={colmeiaReady ? 'border-primary/40' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Box className="h-4 w-4 text-primary" />
                Modo 2 · Caixa Colméia <span className="text-xs font-normal text-muted-foreground">— 1 caixa = N pares</span>
                {colmeiaReady && <Badge variant="secondary" className="ml-auto text-[10px]">Configurado</Badge>}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Uma única caixa acomoda vários pares (típico: 12) sem caixas individuais. Existem em vários tamanhos —
                cadastre cada formato como um <strong>box_type</strong> diferente em Gestão de Embalagens.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {renderSlot('colmeia', 12, 'Caixa colméia que carrega N pares direto.')}
              </div>
            </CardContent>
          </Card>

          {/* Modo 3: Amarrado (individual + fitilho) */}
          <Card className={amarradoReady ? 'border-primary/40' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                Modo 3 · Amarrado <span className="text-xs font-normal text-muted-foreground">— Individual + Fitilho</span>
                {amarradoReady && <Badge variant="secondary" className="ml-auto text-[10px]">Configurado</Badge>}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Caixas individuais amarradas em conjuntos (típico: 12 pares por amarrado), unidas por <strong>fitilho</strong>
                (material linear medido em metros). Não usa caixa master.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {renderSlot('individual', 1, 'Mesma caixa individual do modo Tradicional.')}
                {renderSlot('fitilho', 12, 'Cadastre o fitilho como box_type. O estoque (quantity) representa metros disponíveis.')}
              </div>

              {pgAny?.box_type_fitilho_id && (
                <div className="mt-3 rounded-md border bg-primary/5 border-primary/20 p-3">
                  <Label className="text-xs flex items-center gap-1.5 text-primary font-semibold">
                    <Hash className="h-3.5 w-3.5" /> Metros de fitilho por amarrado
                  </Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5 mb-2">
                    Quantos metros são consumidos a cada amarrado. Ex.: se gasta 1,2 m por amarrado de 12 pares,
                    informe <code>1.2</code>. Sistema deduzirá automaticamente do estoque do fitilho ao processar a OP.
                  </p>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    defaultValue={pgAny?.metros_fitilho_per_amarrado ?? ''}
                    placeholder="ex: 1.2"
                    key={`fitilho-meters-${pgAny?.metros_fitilho_per_amarrado ?? 'empty'}`}
                    onBlur={e => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) handleMetersChange(v);
                    }}
                    className="h-8 text-sm max-w-32"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default PackagingTab;
