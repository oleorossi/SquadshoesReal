import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const form = readFileSync('src/pages/SaleOrderForm.tsx', 'utf8');
const dialog = readFileSync('src/components/sale-orders/StrapHubIncompleteDialog.tsx', 'utf8');
const editor = readFileSync('src/components/artisanal-straps/ArtisanalStrapEditor.tsx', 'utf8');
const helper = readFileSync('src/lib/saveArtisanalStrapMeasureHubFields.ts', 'utf8');

describe('Hub incompleto abre diálogo no PV (spec origem-tira-pv-hub-os §15)', () => {
  it('SaleOrderForm monta StrapHubIncompleteDialog em vez de só toastar', () => {
    expect(form).toContain('<StrapHubIncompleteDialog');
    expect(form).toContain('openHubIncompleteIfNeeded');
    expect(form).not.toContain('Abra o Hub de Tiras e complete antes de salvar');
  });

  it('diálogo grava preço via RPC e retoma o save', () => {
    expect(dialog).toContain('saveArtisanalStrapMeasureHubFields');
    expect(dialog).toContain('describePostgrestError');
    expect(dialog).toContain('Salvar e continuar o pedido');
    expect(dialog).toContain('onCompleted(patches)');
    expect(dialog).not.toContain("from('artisanal_strap_measures')");
  });

  it('editor do Hub usa a mesma RPC, sem UPDATE direto na medida', () => {
    expect(editor).toContain('saveArtisanalStrapMeasureHubFields');
    expect(editor).not.toContain("from('artisanal_strap_measures')");
  });

  it('helper chama a RPC SECURITY DEFINER, não a tabela', () => {
    expect(helper).toContain("rpc('save_artisanal_strap_measure_hub_fields'");
    expect(helper).toContain('p_payload');
    expect(helper).not.toContain("from('artisanal_strap_measures')");
  });
});
