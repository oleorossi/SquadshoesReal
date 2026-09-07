import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const form = readFileSync('src/pages/SaleOrderForm.tsx', 'utf8');
const dialog = readFileSync('src/components/sale-orders/StrapHubIncompleteDialog.tsx', 'utf8');

describe('Hub incompleto abre diálogo no PV (spec origem-tira-pv-hub-os §15)', () => {
  it('SaleOrderForm monta StrapHubIncompleteDialog em vez de só toastar', () => {
    expect(form).toContain('<StrapHubIncompleteDialog');
    expect(form).toContain('openHubIncompleteIfNeeded');
    expect(form).not.toContain('Abra o Hub de Tiras e complete antes de salvar');
  });

  it('diálogo grava preço na medida e retoma o save', () => {
    expect(dialog).toContain("from('artisanal_strap_measures')");
    expect(dialog).toContain('preco_prestador_per_m');
    expect(dialog).toContain('Salvar e continuar o pedido');
    expect(dialog).toContain('onCompleted(patches)');
  });
});
