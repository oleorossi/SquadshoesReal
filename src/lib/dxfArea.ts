/**
 * Leitura de DXF (Shoemaster/AutoCAD) → área das peças em dm².
 *
 * Cada CONTORNO FECHADO (LWPOLYLINE/POLYLINE com flag closed, ou CIRCLE) é uma
 * peça do molde. A área vem da fórmula do shoelace nos vértices (arcos/bulge são
 * aproximados pela corda — "o mais básico correto"). A unidade do desenho é
 * detectada do header `$INSUNITS`; default mm (padrão de calçado), com override.
 *
 * Saída em dm²/par no TAMANHO BASE — depois é escalonada por numeração
 * (gradeScaling.ts) e gravada no consumo por número que o motor já consome.
 *
 * ⚠ Calibrar com um DXF real do Shoemaster: peças em SPLINE não têm área exata
 * aqui (só control points) e bulges são ignorados. Tratar conforme o exemplo.
 */
import DxfParser from 'dxf-parser';

export type DxfLengthUnit = 'mm' | 'cm' | 'm' | 'in';

export interface DxfPiece {
  layer: string;
  type: string;
  areaDm2: number;
  vertices: number;
}

export interface DxfAreaResult {
  unit: DxfLengthUnit;
  unitFromHeader: boolean;
  pieces: DxfPiece[];
  totalDm2: number;
}

export interface DxfAreaOptions {
  /** Força a unidade do desenho (ignora o header). */
  unit?: DxfLengthUnit;
  /** Área mínima (dm²) pra contar como peça — descarta ruído. Default 0,01 (=1 cm²). */
  minAreaDm2?: number;
}

// AutoCAD $INSUNITS → unidade linear.
const INSUNITS: Record<number, DxfLengthUnit> = { 1: 'in', 4: 'mm', 5: 'cm', 6: 'm' };
// Quantos mm vale 1 unidade (pra converter área unidade² → mm²).
const UNIT_MM: Record<DxfLengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

interface XY { x: number; y: number }

/** Shoelace: área (em unidade²) do polígono fechado pelos vértices. */
function polygonArea(pts: XY[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** área em unidade² → dm² (1 dm² = 10000 mm²). */
function areaToDm2(areaUnitSq: number, unit: DxfLengthUnit): number {
  const mm = UNIT_MM[unit];
  return (areaUnitSq * mm * mm) / 10000;
}

const isClosed = (e: any): boolean => {
  if (e.shape === true) return true; // LWPOLYLINE/POLYLINE closed flag (group 70 bit 1)
  // fallback: fechado por coincidência (1º ≈ último vértice)
  const v = e.vertices;
  if (Array.isArray(v) && v.length >= 3) {
    const a = v[0];
    const b = v[v.length - 1];
    if (a && b && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) return true;
  }
  return false;
};

/** Lê o DXF e devolve as peças (contornos fechados) com área em dm². */
export function computeDxfAreas(dxfText: string, opts: DxfAreaOptions = {}): DxfAreaResult {
  const parser = new DxfParser();
  let dxf;
  try {
    dxf = parser.parseSync(dxfText);
  } catch (err) {
    throw new Error(`DXF inválido: ${(err as Error)?.message ?? 'erro ao ler'}`);
  }
  if (!dxf) throw new Error('DXF inválido ou não reconhecido');

  let unit: DxfLengthUnit = opts.unit ?? 'mm';
  let unitFromHeader = false;
  if (!opts.unit) {
    const ins = Number((dxf.header as Record<string, unknown>)?.['$INSUNITS']);
    if (INSUNITS[ins]) {
      unit = INSUNITS[ins];
      unitFromHeader = true;
    }
  }
  const minArea = opts.minAreaDm2 ?? 0.01;

  const pieces: DxfPiece[] = [];
  for (const e of (dxf.entities ?? []) as any[]) {
    if (e.type === 'CIRCLE' && typeof e.radius === 'number') {
      const areaDm2 = areaToDm2(Math.PI * e.radius * e.radius, unit);
      if (areaDm2 >= minArea) pieces.push({ layer: e.layer || '', type: 'CIRCLE', areaDm2, vertices: 0 });
      continue;
    }
    if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && Array.isArray(e.vertices) && e.vertices.length >= 3 && isClosed(e)) {
      const pts: XY[] = e.vertices.map((v: any) => ({ x: Number(v.x) || 0, y: Number(v.y) || 0 }));
      const areaDm2 = areaToDm2(polygonArea(pts), unit);
      if (areaDm2 >= minArea) pieces.push({ layer: e.layer || '', type: e.type, areaDm2, vertices: pts.length });
    }
  }

  const totalDm2 = pieces.reduce((s, p) => s + p.areaDm2, 0);
  return { unit, unitFromHeader, pieces, totalDm2 };
}
