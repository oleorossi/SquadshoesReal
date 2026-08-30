import { describe, expect, it } from 'vitest';
import {
  normalizeReferenceMaterialComponents,
  normalizeReferenceReturnSector,
} from '@/hooks/useReferenceTerceirizacoes';
import {
  SERVICE_ORDER_ACTIVITY_DEFAULTS,
  SERVICE_ORDER_MATERIAL_COMPONENTS,
  SERVICE_ORDER_SECTORS,
  hasValidServiceOrderMaterialComponents,
  isServiceOrderReturnAllowed,
  serviceOrderActivityDefaults,
  serviceOrderReturnOptions,
  serviceOrderReturnSectorsFromSettings,
  isValidOutsourceCapacity,
} from '@/lib/serviceOrderSectors';

describe('configuração de terceirização da ficha', () => {
  it('expõe fachete como atividade canônica', () => {
    expect(SERVICE_ORDER_SECTORS).toContainEqual({ value: 'fachete', label: 'Fachete' });
  });

  it('mantém os defaults operacionais acordados por atividade', () => {
    expect(SERVICE_ORDER_ACTIVITY_DEFAULTS.costura).toEqual({
      return_before_sector: 'Silk',
      material_components: ['Cabedal', 'BOM', 'Componente Direto'],
    });
    expect(SERVICE_ORDER_ACTIVITY_DEFAULTS.mesa).toEqual({
      return_before_sector: 'Silk',
      material_components: ['BOM', 'Componente Direto'],
    });
    expect(SERVICE_ORDER_ACTIVITY_DEFAULTS.fachete).toEqual({
      return_before_sector: 'Montagem',
      material_components: ['Fachete'],
    });
  });

  it('expõe exatamente os rótulos canônicos do motor de consumo', () => {
    expect(SERVICE_ORDER_MATERIAL_COMPONENTS.map((option) => option.value)).toEqual([
      'Cabedal',
      'Forração',
      'Forração Palmilha',
      'Palmilha',
      'Fachete',
      'Solado',
      'BOM',
      'Componente Direto',
      'Item padrão (solado)',
    ]);
  });

  it('normaliza aliases sem gravar slug no componente ou na etapa de retorno', () => {
    expect(normalizeReferenceMaterialComponents([
      'cabedal', 'forracao', 'componente_direto', 'Cabedal', 'desconhecido',
    ])).toEqual(['Cabedal', 'Forração', 'Componente Direto']);
    expect(normalizeReferenceReturnSector('montagem')).toBe('Montagem');
    expect(normalizeReferenceReturnSector('expedicao')).toBe('Expedição');
    // Uma etapa adicionada/rebatizada em sector_settings segue para a validação
    // autoritativa do banco em vez de ser apagada pelo fallback estático.
    expect(normalizeReferenceReturnSector('Inspeção Externa')).toBe('Inspeção Externa');
  });

  it('devolve uma cópia dos materiais para o formulário editar sem mutar a constante', () => {
    const defaults = serviceOrderActivityDefaults('fachete');
    defaults.material_components.push('BOM');
    expect(SERVICE_ORDER_ACTIVITY_DEFAULTS.fachete.material_components).toEqual(['Fachete']);
  });

  it('aceita somente componentes canônicos e não vazios na prontidão', () => {
    expect(hasValidServiceOrderMaterialComponents(['Cabedal', 'BOM'])).toBe(true);
    expect(hasValidServiceOrderMaterialComponents([])).toBe(false);
    expect(hasValidServiceOrderMaterialComponents(['Cabedal', 'desconhecido'])).toBe(false);
    expect(hasValidServiceOrderMaterialComponents('Cabedal')).toBe(false);
  });

  it('limita o retorno ao primeiro ponto dependente ou a uma etapa posterior', () => {
    expect(serviceOrderReturnOptions('costura').map((option) => option.value)).toEqual([
      'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
    ]);
    expect(isServiceOrderReturnAllowed('costura', 'Silk')).toBe(true);
    expect(isServiceOrderReturnAllowed('costura', 'Montagem')).toBe(true);
    expect(isServiceOrderReturnAllowed('costura', 'Costura Cabedal')).toBe(false);
    expect(isServiceOrderReturnAllowed('atividade_inexistente', 'Expedição')).toBe(false);
  });

  it('respeita a ordem editável de sector_settings em vez do fallback estático', () => {
    const liveOptions = serviceOrderReturnSectorsFromSettings([
      { sector: 'Costura Cabedal', flow_order: 10 },
      { sector: 'Colagem', flow_order: 20 },
      { sector: 'Silk', flow_order: 30 },
      { sector: 'Montagem', flow_order: 40 },
      { sector: 'Expedição', flow_order: 50 },
    ]);

    expect(serviceOrderReturnOptions('costura', liveOptions).map((option) => option.value)).toEqual([
      'Silk', 'Montagem', 'Expedição',
    ]);
    expect(isServiceOrderReturnAllowed('costura', 'Colagem', liveOptions)).toBe(false);
    expect(isServiceOrderReturnAllowed('costura', 'Montagem', liveOptions)).toBe(true);
    expect(isServiceOrderReturnAllowed('costura', 'montagem', liveOptions)).toBe(true);
  });

  it('falha fechado sem sector_settings e valida a capacidade no mesmo domínio do banco', () => {
    expect(serviceOrderReturnSectorsFromSettings([])).toEqual([]);
    expect(isValidOutsourceCapacity(1)).toBe(true);
    expect(isValidOutsourceCapacity(1_000_000)).toBe(true);
    expect(isValidOutsourceCapacity(0)).toBe(false);
    expect(isValidOutsourceCapacity(1.5)).toBe(false);
    expect(isValidOutsourceCapacity(1_000_001)).toBe(false);
    expect(isValidOutsourceCapacity(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
