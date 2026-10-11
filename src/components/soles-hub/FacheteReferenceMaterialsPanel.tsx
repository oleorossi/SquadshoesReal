import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CheckCircle, WarningCircle as AlertTriangle, CircleNotch as Loader2,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUpdateSheet } from '@/hooks/useTechnicalSheets';
import { cn } from '@/lib/utils';

/**
 * Material do FACHETE por referência (mig 20270101035400).
 *
 * O consumo do fachete (dm²/par) é do MODELO de solado — linha PAPEL logo
 * acima. O MATERIAL é escolha de cada referência que usa o solado
 * (`technical_sheets.fachete_material`, nome do grupo). Precedência no débito:
 * variante (variant_drives_fachete) > ficha > grupo de fachete do solado >
 * forração da ficha. Referência sem material aparece em âmbar: o débito cai no
 * fallback, que ninguém escolheu.
 */

interface Props {
  soleGroupId: string;
  /** Grupo de fachete cadastrado no solado (fallback), se houver. */
  soleFacheteGroupId?: string | null;
}

interface SheetRow {
  id: string;
  code: string | null;
  name: string;
  fachete_material: string | null;
  lining_material: string | null;
  variant_drives_fachete: boolean | null;
}

const NONE = '__none__';

export default function FacheteReferenceMaterialsPanel({ soleGroupId, soleFacheteGroupId }: Props) {
  const qc = useQueryClient();
  const updateSheet = useUpdateSheet();

  // Fichas que usam este modelo — pelo grupo do solado OU pelo solado principal
  // (fichas antigas podem ter só um dos dois preenchidos).
  const { data: sheets = [], isLoading } = useQuery({
    queryKey: ['fachete_reference_sheets', soleGroupId],
    queryFn: async () => {
      const { data: soleIds, error: soleErr } = await supabase
        .from('products')
        .select('id')
        .eq('group_id', soleGroupId);
      if (soleErr) throw soleErr;
      const ids = (soleIds || []).map((p) => p.id);
      const filter = ids.length > 0
        ? `sole_group_id.eq.${soleGroupId},primary_sole_id.in.(${ids.join(',')})`
        : `sole_group_id.eq.${soleGroupId}`;
      const { data, error } = await (supabase as any)
        .from('technical_sheets')
        .select('id, code, name, fachete_material, lining_material, variant_drives_fachete')
        .or(filter)
        .is('retired_at', null)
        .order('code');
      if (error) throw error;
      return (data || []) as SheetRow[];
    },
    staleTime: 30_000,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['material_groups_for_fachete'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_groups')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const soleFacheteGroupName = soleFacheteGroupId
    ? groups.find((g) => g.id === soleFacheteGroupId)?.name ?? null
    : null;

  const missing = useMemo(
    () => sheets.filter((s) => !(s.fachete_material || '').trim()).length,
    [sheets],
  );

  const save = (sheet: SheetRow, value: string) => {
    const next = value === NONE ? '' : value;
    if ((sheet.fachete_material || '') === next) return;
    updateSheet.mutate(
      { id: sheet.id, data: { fachete_material: next } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: ['fachete_reference_sheets', soleGroupId] }) },
    );
  };

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide">
            Material do fachete por referência
          </div>
          <div className="text-[11px] text-muted-foreground">
            O consumo é deste solado; o material é de cada referência e entra no débito de estoque.
          </div>
        </div>
        {sheets.length > 0 && (
          missing > 0 ? (
            <Badge variant="outline" className="text-xs border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              {missing} sem material
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
              Todas preenchidas
            </Badge>
          )
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando referências…
        </div>
      ) : sheets.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          Nenhuma ficha técnica usa este solado ainda.
        </p>
      ) : (
        <div className="divide-y divide-border/60 rounded-md border border-border/60 bg-card">
          {sheets.map((sheet) => {
            const value = (sheet.fachete_material || '').trim();
            const fallback = soleFacheteGroupName || sheet.lining_material || '';
            const saving = updateSheet.isPending && updateSheet.variables?.id === sheet.id;
            return (
              <div key={sheet.id} className="flex items-center gap-3 flex-wrap px-3 py-2">
                <div className="flex-1 min-w-[160px]">
                  <Link
                    to={`/fichas-tecnicas?ref=${sheet.id}`}
                    className="text-sm font-semibold hover:underline"
                  >
                    {sheet.code ? `${sheet.code} · ` : ''}{sheet.name}
                  </Link>
                  {!value ? (
                    <div className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" weight="fill" />
                      {fallback
                        ? <>Sem material — o débito usa <strong>{fallback}</strong> (fallback)</>
                        : <>Sem material — o fachete NÃO é debitado</>}
                    </div>
                  ) : (
                    <div className="text-[11px] text-green-700 dark:text-green-400 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" weight="fill" />
                      Debita {value}
                      {sheet.variant_drives_fachete ? ' (ou o material da variante vendida)' : ''}
                    </div>
                  )}
                </div>
                <Select value={value || NONE} onValueChange={(v) => save(sheet, v)} disabled={saving}>
                  <SelectTrigger
                    className={cn(
                      'h-8 w-full sm:w-64 text-xs',
                      !value && 'border-amber-500/50',
                    )}
                  >
                    <SelectValue placeholder="Escolher material…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <SelectItem value={NONE} className="text-xs">Sem material (usa fallback)</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.name} className="text-xs">{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
