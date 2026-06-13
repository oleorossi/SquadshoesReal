import { describe, it, expect } from 'vitest';
import { computeDxfAreas } from '../dxfArea';

// DXF mínimo: header com $INSUNITS=4 (mm) + ENTITIES com:
//  - LWPOLYLINE fechada (retângulo 1000×500 mm = 500000 mm² = 50 dm²)
//  - CIRCLE raio 100 mm (área π·100² = 31415,9 mm² = 3,14159 dm²)
//  - LWPOLYLINE ABERTA (2 vértices) → deve ser IGNORADA
function dxf(lines: (string | number)[]): string {
  return lines.join('\n') + '\n';
}

const SAMPLE = dxf([
  0, 'SECTION', 2, 'HEADER',
  9, '$INSUNITS', 70, 4,
  0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  // retângulo fechado
  0, 'LWPOLYLINE', 8, 'CABEDAL', 90, 4, 70, 1,
  10, 0, 20, 0,
  10, 1000, 20, 0,
  10, 1000, 20, 500,
  10, 0, 20, 500,
  // círculo
  0, 'CIRCLE', 8, 'FUROS', 10, 0, 20, 0, 40, 100,
  // linha aberta (ignorar)
  0, 'LWPOLYLINE', 8, 'AUX', 90, 2, 70, 0,
  10, 0, 20, 0,
  10, 500, 20, 0,
  0, 'ENDSEC',
  0, 'EOF',
]);

describe('computeDxfAreas', () => {
  it('mede a área das peças fechadas em dm² e ignora geometria aberta', () => {
    const res = computeDxfAreas(SAMPLE);
    // 2 peças: retângulo + círculo (linha aberta ignorada)
    expect(res.pieces).toHaveLength(2);
    const rect = res.pieces.find((p) => p.type === 'LWPOLYLINE')!;
    const circ = res.pieces.find((p) => p.type === 'CIRCLE')!;
    expect(rect.areaDm2).toBeCloseTo(50, 3);
    expect(circ.areaDm2).toBeCloseTo(Math.PI * 100 * 100 / 10000, 3);
    expect(res.totalDm2).toBeCloseTo(50 + (Math.PI), 2); // 50 + 3,14159…
  });

  it('detecta a unidade do header ($INSUNITS=4 → mm)', () => {
    const res = computeDxfAreas(SAMPLE);
    expect(res.unit).toBe('mm');
    expect(res.unitFromHeader).toBe(true);
  });

  it('override de unidade reescala a área (cm → 100× a área em mm)', () => {
    const res = computeDxfAreas(SAMPLE, { unit: 'cm' });
    // mesmo desenho lido como cm: retângulo 1000×500 cm² = 500000 cm² = 5000 dm²
    const rect = res.pieces.find((p) => p.type === 'LWPOLYLINE')!;
    expect(rect.areaDm2).toBeCloseTo(5000, 1);
    expect(res.unitFromHeader).toBe(false);
  });

  it('minAreaDm2 descarta ruído pequeno', () => {
    const res = computeDxfAreas(SAMPLE, { minAreaDm2: 10 });
    // só o retângulo (50) passa; o círculo (3,14) é descartado
    expect(res.pieces).toHaveLength(1);
    expect(res.pieces[0].type).toBe('LWPOLYLINE');
  });

  it('DXF inválido → erro', () => {
    expect(() => computeDxfAreas('não é um dxf')).toThrow();
  });
});
