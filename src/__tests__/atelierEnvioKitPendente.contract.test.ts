import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101066000_atelie_envio_kit_pendente_recebimento.sql'),
  'utf8',
);

describe('Ateliê — envio com kit pendente e recebimento visível', () => {
  it('autoriza o envio com ressalva sem debitar estoque e sem criar OS', () => {
    expect(SQL).toContain('atelier_confirm_open_kit_send');
    expect(SQL).toContain('atelier_kit_allows_send');
    expect(SQL).toContain('atelier_kit_pending_message');
    expect(SQL).toContain('open_kit_send_at');
    expect(SQL).toContain('O estoque que falta não é debitado');
    expect(SQL).toContain('sem debitar estoque e sem criar OS');
    expect(SQL).not.toContain('quantity = quantity -');
  });

  it('os envios passam a aceitar a ressalva e a mensagem cita o material que falta', () => {
    expect(SQL).toContain('atelier_kit_allows_send(v_job.lot_id)');
    expect(SQL).toContain('atelier_kit_allows_send(j.lot_id)');
    expect(SQL).toContain('atelier_kit_send_block_message');
    expect(SQL).toContain('list_atelier_order_launch');
    expect(SQL).toContain("'color', p.color, 'available_qty'");
  });

  it('a fila e o envio exigem confirmação explícita da ressalva', () => {
    const board = readFileSync(resolve(ROOT, 'src/components/atelier/AtelierOperacao.tsx'), 'utf8');
    const split = readFileSync(resolve(ROOT, 'src/components/atelier/AtelierSplitDialog.tsx'), 'utf8');
    const remessa = readFileSync(resolve(ROOT, 'src/components/atelier/AtelierRemessaPanel.tsx'), 'utf8');
    expect(board).toContain('confirmAtelierOpenKitSend');
    expect(board).toContain('Confirma o envio com ressalva?');
    expect(split).toContain('Confirmo o envio com ressalva');
    expect(remessa).toContain('Confirmo o envio com ressalva');
    expect(split).toContain('confirmAtelierOpenKitSend');
    expect(remessa).toContain('confirmAtelierOpenKitSend');
  });
});
