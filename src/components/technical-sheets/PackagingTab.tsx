import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Cube as Box, Package, Info, Stack as Layers, LinkSimple as Link2,
  ArrowSquareOut, Warning as AlertTriangle,
} from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

/**
 * Embalagem na ficha técnica — SOMENTE LEITURA desde 02/08/2026.
 *
 * A fonte única passou a ser o MODELO DE SOLADO (`product_groups.box_type_*`),
 * editado em Solados → Consumos → Embalagem. Esta aba mostra o que o solado da
 * ficha define e manda editar lá.
 *
 * Por que saiu daqui: `technical_sheet_box_types` permitia vincular DUAS caixas
 * do mesmo tipo à mesma ficha (i40 e SP130 tinham Caixa 11 + Caixa 18, ambas
 * 'individual') e a RPC de débito, que iterava o resultado, debitaria as duas
 * pelos mesmos pares. Um slot por tipo no solado elimina a ambiguidade.
 */

interface PackagingTabProps {
  /** Ficha técnica — o solado é derivado dela. */
  sheetId?: string;
  /** Grupo de solado direto (aba de solados dentro da ficha). */
  soleGroupId?: string | null;
}

type BoxKind = 'individual' | 'master' | 'colmeia' | 'fitilho';

const SLOT_LABEL: Record<BoxKind, string> = {
  individual: 'Individual',
  master: 'Master',
  colmeia: 'Colmeia',
  fitilho: 'Fitilho',
};

const MODES: Array<{ label: string; rule: string; icon: typeof Layers; parts: BoxKind[] }> = [
  { label: 'Tradicional', rule: '1 master = 1 volume na nota', icon: Layers, parts: ['individual', 'master'] },
  { label: 'Amarrado', rule: 'cada par = 1 volume na nota', icon: Link2, parts: ['individual', 'fitilho'] },
  { label: 'Colméia', rule: '1 colmeia = 1 volume na nota', icon: Box, parts: ['colmeia'] },
];

export function PackagingTab({ sheetId, soleGroupId }: PackagingTabProps) {
  const navigate = useNavigate();

  // Resolve o grupo de solado: veio direto por prop, ou sai da ficha.
  const { data: resolvedGroupId, isLoading: loadingSheet } = useQuery({
    queryKey: ['sheet_sole_group', sheetId, soleGroupId],
    queryFn: async () => {
      if (soleGroupId) return soleGroupId;
      if (!sheetId) return null;
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('sole_group_id')
        .eq('id', sheetId)
        .maybeSingle();
      if (error) throw error;
      return ((data as any)?.sole_group_id as string | null) ?? null;
    },
    staleTime: 30_000,
  });

  const { data: group, isLoading: loadingGroup } = useQuery({
    queryKey: ['sole_packaging', resolvedGroupId],
    enabled: !!resolvedGroupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select(`
          id, name,
          box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id,
          pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, pairs_per_box_fitilho,
          box_individual:box_type_id(id, nome, pairs_per_box_default, quantity, unit_price),
          box_master:box_type_master_id(id, nome, pairs_per_box_default, quantity, unit_price),
          box_colmeia:box_type_colmeia_id(id, nome, pairs_per_box_default, quantity, unit_price),
          box_fitilho:box_type_fitilho_id(id, nome, pairs_per_box_default, quantity, unit_price, metros_per_amarrado_default)
        `)
        .eq('id', resolvedGroupId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  if (!sheetId && !soleGroupId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground space-y-2">
          <Info className="h-10 w-10 mx-auto opacity-30" />
          <p className="text-sm font-medium text-foreground">Salve a ficha antes de ver a embalagem.</p>
        </CardContent>
      </Card>
    );
  }

  if (loadingSheet || loadingGroup) return <Skeleton className="h-56 w-full" />;

  if (!resolvedGroupId) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="py-8 text-center space-y-3">
          <AlertTriangle className="h-10 w-10 mx-auto text-red-600 opacity-70" />
          <p className="text-sm font-medium text-foreground">Esta ficha não tem solado vinculado</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            A embalagem é definida pelo <strong>modelo de solado</strong>. Sem solado na ficha, nenhuma caixa
            é debitada e o custo de embalagem fica zerado. Vincule o solado na aba <strong>Solado</strong> desta
            ficha.
          </p>
        </CardContent>
      </Card>
    );
  }

  const slotBox = (kind: BoxKind) =>
    ({
      individual: group?.box_individual,
      master: group?.box_master,
      colmeia: group?.box_colmeia,
      fitilho: group?.box_fitilho,
    }[kind]);

  const slotPairs = (kind: BoxKind) => {
    const own = {
      individual: group?.pairs_per_box_individual,
      master: group?.pairs_per_box_master,
      colmeia: group?.pairs_per_box_colmeia,
      fitilho: group?.pairs_per_box_fitilho,
    }[kind];
    return Number(own || 0) > 0 ? Number(own) : Number(slotBox(kind)?.pairs_per_box_default || 12);
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-xs space-y-1 flex-1">
            <p className="text-foreground font-medium">
              A embalagem vem do solado <strong>{group?.name}</strong> — não da ficha.
            </p>
            <p className="text-muted-foreground">
              É por modelo de solado, então vale pra todas as referências que o usam. Corrigir lá corrige
              em todas. O modo (Tradicional / Amarrado / Colméia) é escolhido no Pedido de Venda.
            </p>
          </div>
          <Button
            type="button" variant="outline" size="sm" className="h-8 gap-1.5 shrink-0"
            onClick={() => navigate('/solados')}
          >
            <ArrowSquareOut className="h-3.5 w-3.5" />
            Editar em Solados
          </Button>
        </CardContent>
      </Card>

      {MODES.map(mode => {
        const ready = mode.parts.every(k => !!slotBox(k));
        const Icon = mode.icon;
        return (
          <Card key={mode.label} className={`border-l-4 ${ready ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Icon className="h-4 w-4 text-primary shrink-0" />
                <h4 className="text-sm font-bold uppercase tracking-tight">{mode.label}</h4>
                <span className="text-xs text-muted-foreground">{mode.rule}</span>
                <Badge
                  variant="outline"
                  className={`ml-auto text-xs ${ready
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                    : 'bg-red-500/10 text-red-600 border-red-500/30'}`}
                >
                  {ready ? 'Pronto' : 'Não debita'}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {mode.parts.map(kind => {
                  const box = slotBox(kind);
                  return (
                    <div key={kind} className="rounded-md border border-border bg-muted/20 p-2.5">
                      <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                        {SLOT_LABEL[kind]}
                      </p>
                      {box ? (
                        <>
                          <p className="text-sm font-medium">{box.nome}</p>
                          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                            {slotPairs(kind)} {kind === 'fitilho' ? 'pares/amarrado' : 'pares/caixa'} ·{' '}
                            {Number(box.quantity || 0)} em estoque
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-red-600">Sem caixa no solado</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {!group?.box_type_id && !group?.box_type_colmeia_id && (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground space-y-2">
            <Package className="h-8 w-8 mx-auto opacity-30" />
            <p className="text-xs">
              Nenhuma caixa configurada no solado <strong>{group?.name}</strong>. Enquanto isso, nenhum
              pedido debita embalagem e o custo sai zerado.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default PackagingTab;
