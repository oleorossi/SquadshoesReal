import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProductGroup } from '@/hooks/useGroups';
import type { GroupStockRollup } from '@/hooks/useGroupOrganization';
import { useMoveGroupsToFamily } from '@/hooks/useGroupOrganization';
import { sectorLabel, SECTOR_OPTIONS } from '@/lib/categoryFromGroup';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ProductGroup[];
  rollups: Map<string, GroupStockRollup>;
  selectedIds: Set<string>;
  onDone: () => void;
}

const UNLINK = '__unlink__';

/**
 * Move em massa os grupos-folha selecionados para uma família (ou desvincula).
 * Alvos válidos = famílias do MESMO setor, sem itens diretos e fora da seleção.
 * Reclassificar setor é uma ação separada porque materiais de área podem exigir
 * largura antes da mudança.
 */
export default function MoveGroupsDialog({ open, onOpenChange, groups, rollups, selectedIds, onDone }: Props) {
  const move = useMoveGroupsToFamily();
  const [target, setTarget] = useState<string>('');

  const byId = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const selectedSectors = useMemo(
    () => new Set(Array.from(selectedIds).map((id) => byId.get(id)?.sector || '—')),
    [selectedIds, byId],
  );
  const commonSector = selectedSectors.size === 1 ? Array.from(selectedSectors)[0] : null;

  // Alvos: famílias do mesmo setor e sem itens diretos, fora da seleção.
  const targetsBySector = useMemo(() => {
    const roots = groups.filter(g =>
      commonSector != null &&
      !g.parent_group_id &&
      !selectedIds.has(g.id) &&
      (g.sector || '—') === commonSector &&
      (g.is_family === true || groups.some((candidate) => candidate.parent_group_id === g.id)) &&
      (rollups.get(g.id)?.item_count ?? 0) === 0,
    );
    const childCount = new Map<string, number>();
    for (const g of groups) if (g.parent_group_id) childCount.set(g.parent_group_id, (childCount.get(g.parent_group_id) ?? 0) + 1);
    const map = new Map<string, { g: ProductGroup; kids: number }[]>();
    for (const r of roots) {
      const sec = r.sector || '—';
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push({ g: r, kids: childCount.get(r.id) ?? 0 });
    }
    for (const [, list] of map) list.sort((a, b) => a.g.name.localeCompare(b.g.name, 'pt-BR'));
    const order = SECTOR_OPTIONS.map(o => o.value);
    return Array.from(map.entries()).sort((a, b) => {
      const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [groups, rollups, selectedIds, commonSector]);

  const targetFamily = target && target !== UNLINK ? byId.get(target) : null;

  const handleConfirm = async () => {
    if (!target) return;
    const groupIds = Array.from(selectedIds);
    try {
      if (target === UNLINK) {
        await move.mutateAsync({ familyId: null, groupIds });
      } else {
        await move.mutateAsync({ familyId: target, groupIds });
      }
      setTarget('');
      onDone();
      onOpenChange(false);
    } catch { /* toast pelo hook */ }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setTarget(''); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mover {selectedIds.size} grupo(s)</DialogTitle>
          <DialogDescription>Escolha a família de destino ou desvincule (tornar soltos direto no setor).</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Select value={target || undefined} onValueChange={setTarget}>
            <SelectTrigger><SelectValue placeholder="Selecione o destino" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNLINK}>Desvincular — tornar soltos</SelectItem>
              {targetsBySector.map(([sec, list]) => (
                <SelectGroup key={sec}>
                  <SelectLabel>{sectorLabel(sec)}</SelectLabel>
                  {list.map(({ g, kids }) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} {kids > 0 ? `· ${kids} subgrupo(s)` : '· vazia'}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          {!commonSector && target !== UNLINK && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              A seleção reúne setores diferentes. Selecione grupos de um único setor para vinculá-los à mesma família.
            </p>
          )}

          {commonSector && targetsBySector.length === 0 && target !== UNLINK && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Nenhuma família disponível em <strong>{sectorLabel(commonSector)}</strong>. Crie a família nesse setor antes de mover os grupos.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" disabled={!target || move.isPending} onClick={handleConfirm}>Mover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
