import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dialog = readFileSync('src/components/sale-orders/OrderConsumptionDialog.tsx', 'utf8');
const primitive = readFileSync('src/components/ui/dialog.tsx', 'utf8');

describe('consumo em tela cheia — fechar visível o tempo todo', () => {
  it('esconde o X de 16px do primitive e traz um fechar no cabeçalho e no rodapé', () => {
    expect(primitive).toContain('hideCloseButton?: boolean');
    expect(dialog).toContain('hideCloseButton');
    expect(dialog).toContain('aria-label="Fechar consumo"');
    expect(dialog).toContain('Fechar');
    expect(dialog).toContain('DialogClose');
    expect(dialog).toContain('embedded');
  });
});
