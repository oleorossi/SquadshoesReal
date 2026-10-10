import { isDeleteConfirmWord } from '@/lib/deleteConfirmWord';
import { getTypedDeleteConfirmState, requestTypedDeleteConfirm, settleTypedDeleteConfirm } from '@/lib/typedDeleteConfirmStore';

describe('palavra de confirmação de exclusão', () => {
  it('aceita "excluir" em qualquer caixa e com espaço sobrando', () => {
    for (const t of ['excluir', 'Excluir', 'EXCLUIR', '  excluir  ']) expect(isDeleteConfirmWord(t)).toBe(true);
  });
  it('recusa o resto, inclusive o formato antigo', () => {
    for (const t of ['', 'exclui', 'EXCLUIR 3', 'PV-00229', null, undefined]) expect(isDeleteConfirmWord(t)).toBe(false);
  });
});

describe('janela global de confirmação', () => {
  it('resolve true ao confirmar e fecha', async () => {
    const p = requestTypedDeleteConfirm({ title: 'Excluir 2 clientes?' });
    expect(getTypedDeleteConfirmState().request?.title).toBe('Excluir 2 clientes?');
    settleTypedDeleteConfirm(true);
    await expect(p).resolves.toBe(true);
    expect(getTypedDeleteConfirmState().request).toBeNull();
  });
  it('novo pedido cancela o anterior', async () => {
    const first = requestTypedDeleteConfirm({ title: 'A' });
    const second = requestTypedDeleteConfirm({ title: 'B' });
    await expect(first).resolves.toBe(false);
    settleTypedDeleteConfirm(false);
    await expect(second).resolves.toBe(false);
  });
});
