import { describe, expect, it } from 'vitest';
import {
  contractorServicePriority,
  getContractorServiceFocus,
  matchesContractorServiceFocus,
} from '@/lib/contractorServiceFocus';

describe('contractorServiceFocus', () => {
  it('trata as chaves legadas costura e mesa como os dois serviços principais', () => {
    expect(getContractorServiceFocus('costura')).toBe('costura_cabedal');
    expect(getContractorServiceFocus('mesa')).toBe('aviamento');
  });

  it('reconhece os rótulos atuais sem confundir costura de palmilha', () => {
    expect(getContractorServiceFocus('costura', 'Costura Cabedal')).toBe('costura_cabedal');
    expect(getContractorServiceFocus('costura_palmilha', 'Costura Palmilha')).toBe('other');
    expect(getContractorServiceFocus('mesa', 'Aviamento')).toBe('aviamento');
  });

  it('ordena costura de cabedal e aviamento antes dos serviços eventuais', () => {
    expect(contractorServicePriority('costura')).toBeLessThan(contractorServicePriority('mesa'));
    expect(contractorServicePriority('mesa')).toBeLessThan(contractorServicePriority('montagem'));
  });

  it('aplica o mesmo recorte aos relatórios', () => {
    expect(matchesContractorServiceFocus('costura_cabedal', 'costura')).toBe(true);
    expect(matchesContractorServiceFocus('aviamento', 'mesa')).toBe(true);
    expect(matchesContractorServiceFocus('aviamento', 'solagem')).toBe(false);
    expect(matchesContractorServiceFocus('all', 'solagem')).toBe(true);
  });
});
