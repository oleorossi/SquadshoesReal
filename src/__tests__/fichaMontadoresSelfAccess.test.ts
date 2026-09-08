import { describe, it, expect } from 'vitest';
import {
  buildProducaoExportRows,
  producaoExportToCsv,
  semanaAnteriorDe,
} from '@/lib/fichaMontadoresExport';
import { resolveModuleForPath, isRouteAllowed } from '@/hooks/useAccessControl';

describe('fichaMontadoresExport', () => {
  it('monta CSV com BOM e pares por dia', () => {
    const rows = buildProducaoExportRows([
      {
        montador_id: 'a',
        montador: 'Ana',
        dia: '2026-09-01',
        setor: 'montagem',
        origem: 'chamada',
        detalhe: [{ tamanho: 12, medio: 24, dificil: 0 }],
        total: 24,
        valor_par_medio: 0.8,
        valor_par_dificil: 1,
        pago_em: null,
        payroll_run_id: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pares).toBe(24);
    expect(rows[0].bruto).toBeCloseTo(19.2);
    const csv = producaoExportToCsv(rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Ana');
    expect(csv).toContain('aberto');
  });

  it('semanaAnteriorDe recua 7 dias a partir da segunda', () => {
    // 2026-09-07 é segunda
    expect(semanaAnteriorDe('2026-09-07')).toEqual({
      from: '2026-08-31',
      to: '2026-09-06',
    });
  });
});

describe('acesso minha-producao', () => {
  it('rota mapeia para ficha_montadores_self', () => {
    expect(resolveModuleForPath('/minha-producao')).toBe('ficha_montadores_self');
  });

  it('papel montador acessa minha-producao e não a ficha RH', () => {
    const montador = { isAdmin: false, roles: ['montador'], perms: [] };
    expect(isRouteAllowed('/minha-producao', montador)).toBe(true);
    expect(isRouteAllowed('/fichas-montadores', montador)).toBe(false);
  });

  it('RH acessa as duas telas', () => {
    const rh = { isAdmin: false, roles: ['rh'], perms: [] };
    expect(isRouteAllowed('/minha-producao', rh)).toBe(true);
    expect(isRouteAllowed('/fichas-montadores', rh)).toBe(true);
  });
});
