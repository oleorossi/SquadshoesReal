// Mapping of Brazilian state UF → capital city. Used by the transport
// calculator to decide between rate.valor_capital and rate.valor_interior.
// Storing the canonical capital with accents; matching normalises both sides
// (lowercase + diacritic strip) so user input like "sao paulo" or "SAO PAULO"
// still matches "São Paulo".
const STATE_CAPITALS: Record<string, string> = {
  AC: 'Rio Branco',
  AL: 'Maceió',
  AM: 'Manaus',
  AP: 'Macapá',
  BA: 'Salvador',
  CE: 'Fortaleza',
  DF: 'Brasília',
  ES: 'Vitória',
  GO: 'Goiânia',
  MA: 'São Luís',
  MG: 'Belo Horizonte',
  MS: 'Campo Grande',
  MT: 'Cuiabá',
  PA: 'Belém',
  PB: 'João Pessoa',
  PE: 'Recife',
  PI: 'Teresina',
  PR: 'Curitiba',
  RJ: 'Rio de Janeiro',
  RN: 'Natal',
  RO: 'Porto Velho',
  RR: 'Boa Vista',
  RS: 'Porto Alegre',
  SC: 'Florianópolis',
  SE: 'Aracaju',
  SP: 'São Paulo',
  TO: 'Palmas',
};

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function isStateCapital(city: string | undefined | null, state: string | undefined | null): boolean {
  if (!city || !state) return false;
  const capital = STATE_CAPITALS[state.toUpperCase().trim()];
  if (!capital) return false;
  return normalize(city) === normalize(capital);
}
