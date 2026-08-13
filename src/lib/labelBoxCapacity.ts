export interface SolePackagingCapacity {
  pairs_per_box_individual: number | null;
  pairs_per_box_master: number | null;
  pairs_per_box_colmeia: number | null;
  box_type_id: string | null;
  box_type_master_id: string | null;
  box_type_colmeia_id: string | null;
}

export function resolveLabelBoxCapacity(
  packagingMode: string,
  sole: SolePackagingCapacity | undefined,
  boxTypeCapacity: Map<string, number>,
): number {
  if (packagingMode === 'individual_fitilho' || packagingMode === 'individual_amarrado') return 1;
  if (!sole) return 0;
  const isMaster = packagingMode === 'individual_master';
  const isColmeia = packagingMode === 'colmeia';
  const own = isMaster
    ? sole.pairs_per_box_master
    : isColmeia ? sole.pairs_per_box_colmeia : sole.pairs_per_box_individual;
  if (Number(own) > 0) return Number(own);
  const boxId = isMaster
    ? sole.box_type_master_id
    : isColmeia ? sole.box_type_colmeia_id : sole.box_type_id;
  return boxId ? (boxTypeCapacity.get(boxId) || 0) : 0;
}
