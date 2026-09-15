export interface StrapSnapshotItemLike {
  reference_id?: string | null;
  reference_label?: string | null;
  strap_colors?: unknown[] | null;
}

export interface StrapSnapshotReferenceLike {
  id: string;
  code?: string | null;
  name?: string | null;
  has_straps?: boolean | null;
  strap_colors?: unknown[] | null;
  upper_material?: string | null;
}

/**
 * Detecta a lacuna que não aparece em `missingStrapSourcingLineIds`: uma ficha
 * declara tiras, mas o item perdeu todo o snapshot. Não tenta reconstruir cor,
 * medida ou variante; apenas devolve referências acionáveis para bloquear.
 */
export function listMissingTechnicalStrapSnapshots(
  items: StrapSnapshotItemLike[],
  references: StrapSnapshotReferenceLike[],
) {
  return items.flatMap((item, index) => {
    const reference = references.find((entry) => entry.id === item.reference_id);
    if (!reference) return [];
    const definitions = Array.isArray(reference.strap_colors) ? reference.strap_colors : [];
    const requiresStraps = reference.has_straps === true || definitions.length > 0;
    const snapshot = Array.isArray(item.strap_colors) ? item.strap_colors : [];
    // #region agent log
    fetch('http://127.0.0.1:7492/ingest/95b24859-9dac-4898-80f4-140cf86ddf60',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ba1e98'},body:JSON.stringify({sessionId:'ba1e98',runId:'pre-fix',hypothesisId:'A,B,C,D,E',location:'strapSnapshotGuard.ts:listMissing',message:'strap snapshot guard eval',data:{index,referenceId:item.reference_id,refFound:!!reference,has_straps:reference.has_straps,defLen:definitions.length,defType:Array.isArray(reference.strap_colors)?'array':typeof reference.strap_colors,requiresStraps,snapLen:snapshot.length,snapType:Array.isArray(item.strap_colors)?'array':typeof item.strap_colors,snapLineIds:snapshot.slice(0,8).map((s:any)=>s?.technical_strap_line_id||s?.id||null),code:reference.code,name:reference.name,itemLabel:item.reference_label||null,willBlock:requiresStraps&&snapshot.length===0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // Cabedal e tiras podem coexistir. A presença de cabedal não transforma
    // mais uma configuração real de tiras em dado órfão nem libera o PV sem o
    // snapshot técnico necessário pra reservar/produzir essas tiras.
    if (!requiresStraps || snapshot.length > 0) return [];
    return [{
      index,
      referenceId: reference.id,
      label: item.reference_label
        || [reference.code, reference.name].filter(Boolean).join(' ').trim()
        || `item ${index + 1}`,
    }];
  });
}
