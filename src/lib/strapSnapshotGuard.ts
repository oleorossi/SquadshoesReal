import {
  strapColorMode,
  technicalStrapLineId,
} from '@/lib/technicalStrapLines';
import { reconcileEditableStrapSnapshots } from '@/lib/reconcileStrapSnapshots';
import {
  getStrapSourcingOverride,
  setStrapSourcing,
  type StrapSourcingMap,
} from '@/lib/strapSourcing';

export interface StrapSnapshotItemLike {
  reference_id?: string | null;
  reference_label?: string | null;
  color?: string | null;
  strap_colors?: unknown[] | null;
  strap_sourcing?: StrapSourcingMap | null;
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
 * Pedido já Aprovado/Em Produção preserva o snapshot — exceto quando ele está
 * VAZIO e a ficha ainda exige tiras. Preservar `[]` trava o save com
 * "Demanda de tira não resolvida" e o efeito de reconcile nunca recupera
 * (PV-00168 / DS20 SP124).
 */
export function shouldSkipCommittedStrapReconcile(input: {
  preserveCommitted: boolean;
  snapshotLength: number;
  technicalDefinitionsLength: number;
  hasStraps?: boolean | null;
}): boolean {
  if (!input.preserveCommitted) return false;
  const fichaRequires = input.hasStraps === true || input.technicalDefinitionsLength > 0;
  if (input.snapshotLength === 0 && fichaRequires) return false;
  return true;
}

type RecoverableStrapLine = {
  id?: string | null;
  technical_strap_line_id?: string | null;
  color?: string | null;
  color_mode?: 'follow_main' | 'select_on_order' | null;
  pv_origem?: string | null;
  [key: string]: unknown;
};

/**
 * Recupera snapshot vazio a partir da ficha no momento do save — não depende
 * do SaleOrderItemForm ter montado o item (PV-00168: DS20 fora da viewport).
 * Também preenche pv_origem ausente a partir do strap_sourcing operacional.
 */
export function recoverEmptyStrapSnapshotsForSubmit<T extends StrapSnapshotItemLike>(
  items: T[],
  references: StrapSnapshotReferenceLike[],
): { items: T[]; recoveredEmpty: number; hydratedOrigem: number } {
  let recoveredEmpty = 0;
  let hydratedOrigem = 0;
  const next = items.map((item) => {
    const reference = references.find((entry) => entry.id === item.reference_id);
    if (!reference) return item;
    const definitions = Array.isArray(reference.strap_colors) ? reference.strap_colors : [];
    const requiresStraps = reference.has_straps === true || definitions.length > 0;
    const snapshot = Array.isArray(item.strap_colors) ? [...item.strap_colors] : [];
    let lines = snapshot as RecoverableStrapLine[];
    let sourcing: StrapSourcingMap = { ...(item.strap_sourcing || {}) };
    let changed = false;

    if (requiresStraps && lines.length === 0 && definitions.length > 0) {
      const reconciled = reconcileEditableStrapSnapshots({
        snapshotLines: [] as any,
        technicalLines: definitions as any,
        sourcing,
      });
      lines = reconciled.lines as RecoverableStrapLine[];
      sourcing = reconciled.sourcing;
      for (const line of lines) {
        const lineId = technicalStrapLineId(line as any);
        if (!lineId || getStrapSourcingOverride(sourcing, lineId)) continue;
        sourcing = setStrapSourcing(sourcing, lineId, 'internal');
      }
      if (item.color?.trim()) {
        lines = lines.map((line) => (
          strapColorMode(line as any) === 'follow_main'
            ? { ...line, color: item.color }
            : line
        ));
      }
      recoveredEmpty += 1;
      changed = true;
    }

    const withOrigem = lines.map((line) => {
      if (line.pv_origem === 'fabrica' || line.pv_origem === 'prestador' || line.pv_origem === 'sku_acabado') {
        return line;
      }
      const lineId = technicalStrapLineId(line as any);
      const mode = lineId ? getStrapSourcingOverride(sourcing, lineId) : null;
      if (mode === 'buy_ready') {
        hydratedOrigem += 1;
        changed = true;
        return { ...line, pv_origem: 'sku_acabado' };
      }
      if (mode === 'internal') {
        hydratedOrigem += 1;
        changed = true;
        return { ...line, pv_origem: 'fabrica' };
      }
      return line;
    });

    if (!changed) return item;
    return {
      ...item,
      strap_colors: withOrigem as T['strap_colors'],
      strap_sourcing: sourcing,
    };
  });
  return { items: next, recoveredEmpty, hydratedOrigem };
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
    fetch('http://127.0.0.1:7492/ingest/95b24859-9dac-4898-80f4-140cf86ddf60',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'78dba0'},body:JSON.stringify({sessionId:'78dba0',runId:'post-fix',hypothesisId:'G',location:'strapSnapshotGuard.ts:listMissing',message:'strap snapshot guard eval',data:{index,referenceId:item.reference_id,has_straps:reference.has_straps,defLen:definitions.length,snapLen:snapshot.length,code:reference.code,name:reference.name,willBlock:requiresStraps&&snapshot.length===0},timestamp:Date.now()})}).catch(()=>{});
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
