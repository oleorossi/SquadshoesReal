/**
 * Gera um arquivo DXF (ASCII, mínimo) a partir de polígonos das peças.
 *
 * Coordenadas em MILÍMETROS. Cada peça vira uma LWPOLYLINE fechada. Header com
 * `$ACADVER = AC1015` (DXF 2000 — versão que introduziu LWPOLYLINE) e
 * `$INSUNITS = 4` (mm), pra abrir no AutoCAD/Shoemaster e ser relido por
 * `computeDxfAreas` (dxfArea.ts) com a mesma área.
 */

export interface DxfPolygonMm {
  /** Vértices em mm (CAD: Y pra cima). */
  points: { x: number; y: number }[];
  layer?: string;
}

export interface DxfWriteOptions {
  /** Código $INSUNITS. 4 = mm (default). */
  insunits?: number;
}

function line(out: string[], code: number | string, value: string | number): void {
  out.push(String(code));
  out.push(String(value));
}

/** Polígonos (mm) → string DXF. */
export function polygonsToDxf(polygons: DxfPolygonMm[], opts: DxfWriteOptions = {}): string {
  const insunits = opts.insunits ?? 4; // mm
  const out: string[] = [];

  // HEADER
  line(out, 0, 'SECTION');
  line(out, 2, 'HEADER');
  line(out, 9, '$ACADVER');
  line(out, 1, 'AC1015'); // DXF 2000 — versão que introduziu LWPOLYLINE (coerente com as entidades emitidas)
  line(out, 9, '$INSUNITS');
  line(out, 70, insunits);
  line(out, 0, 'ENDSEC');

  // ENTITIES
  line(out, 0, 'SECTION');
  line(out, 2, 'ENTITIES');
  for (const poly of polygons) {
    const pts = (poly.points ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length < 3) continue;
    line(out, 0, 'LWPOLYLINE');
    line(out, 8, poly.layer || 'MOLDE');
    line(out, 90, pts.length); // nº de vértices
    line(out, 70, 1); // fechado
    for (const p of pts) {
      line(out, 10, round(p.x));
      line(out, 20, round(p.y));
    }
  }
  line(out, 0, 'ENDSEC');

  // EOF
  line(out, 0, 'EOF');

  return out.join('\n') + '\n';
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000; // 3 casas (mm) bastam
}

/** Dispara o download do DXF no navegador. */
export function downloadDxf(dxfText: string, fileName: string): void {
  const blob = new Blob([dxfText], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.dxf') ? fileName : `${fileName}.dxf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
