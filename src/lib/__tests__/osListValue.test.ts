import { describe, expect, it } from 'vitest';
import { osListValue, serviceOrderPartyName } from '@/lib/osListValue';

describe('valor da OS na lista', () => {
  it('mostra o devido das contas e o contratado como previsto', () => {
    expect(osListValue({ contracted: 60, hasPayable: true, payableAmount: 50 })).toEqual({
      primary: 50,
      forecast: 60,
    });
  });

  it('não repete o previsto quando a conta fecha o contratado', () => {
    expect(osListValue({ contracted: 60, hasPayable: true, payableAmount: 60 })).toEqual({
      primary: 60,
      forecast: null,
    });
  });

  it('a fábrica aparece como Interno', () => {
    expect(serviceOrderPartyName({ internal: true, contractorName: null })).toBe('Interno');
    expect(serviceOrderPartyName({ internal: false, contractorName: 'Casa A' })).toBe('Casa A');
  });

  it('antes de existir conta, mostra o contratado', () => {
    expect(osListValue({ contracted: 60, hasPayable: false, payableAmount: null })).toEqual({
      primary: 60,
      forecast: null,
    });
  });
});
