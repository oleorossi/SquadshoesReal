import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { printHtmlAsPdf, openPrintTab, MAX_DOCUMENT_BYTES } from '../printPdf';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn() } }));
import { toast } from 'sonner';

/**
 * O envio do documento é POST de FORMULÁRIO, não `fetch`.
 *
 * Motivo (11/08/2026): no iPhone a aba ficava parada em "Gerando o PDF…" e o
 * arquivo nunca chegava. O Safari SUSPENDE a aba de origem quando a nova abre —
 * e era ela quem esperava o `fetch`, então nem o sucesso nem o `catch` rodavam.
 * Somava-se a restrição do iOS a navegar para `blob:`. Com o formulário, quem
 * baixa e exibe é o navegador, numa navegação comum.
 *
 * Estes testes travam justamente o que não pode voltar: mira na aba nomeada
 * (senão o celular bloqueia como pop-up) e nenhuma dependência de `fetch`.
 */
describe('printHtmlAsPdf — POST de formulário', () => {
  let submit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    submit = vi.fn();
    // jsdom não implementa submit(); espionamos sem navegar de verdade.
    HTMLFormElement.prototype.submit = submit as unknown as () => void;
    vi.clearAllMocks();
  });
  afterEach(() => { document.body.innerHTML = ''; });

  const campos = () => {
    const form = submit.mock.instances[0] as unknown as HTMLFormElement;
    return form;
  };

  it('envia por POST para a função, mirando a aba já aberta', () => {
    const ok = printHtmlAsPdf('<html><body>oi</body></html>', { filename: 'etiquetas-PV-1' });
    expect(ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    const form = campos();
    expect(form.method.toLowerCase()).toBe('post');
    expect(form.action).toContain('/api/render-pdf');
    // Mira NOMEADA: o submit acontece depois do preparo, quando o gesto do
    // usuário já passou — mirar em janela existente é o que escapa do pop-up.
    expect(form.target).toBe('squad-pdf');
  });

  it('leva o HTML, o nome do arquivo e a orientação', () => {
    printHtmlAsPdf('<html><body>conteudo</body></html>', {
      filename: 'cartoes-lote', landscape: true,
    });
    const form = campos();
    const valores = Object.fromEntries(
      Array.from(form.querySelectorAll('input')).map(i => [i.name, i.value]),
    );
    expect(valores.html).toContain('conteudo');
    expect(valores.filename).toBe('cartoes-lote');
    expect(valores.landscape).toBe('1');
  });

  it('não manda "landscape" quando é retrato (o servidor decide pelo padrão)', () => {
    printHtmlAsPdf('<html><body>x</body></html>', { filename: 'fichas' });
    const nomes = Array.from(campos().querySelectorAll('input')).map(i => i.name);
    expect(nomes).not.toContain('landscape');
  });

  it('não deixa o formulário sujando a página depois de enviar', () => {
    printHtmlAsPdf('<html><body>x</body></html>', { filename: 'fichas' });
    expect(document.querySelectorAll('form').length).toBe(0);
  });

  it('recusa documento acima do limite ANTES de enviar, com instrução do que fazer', () => {
    const gigante = `<html><body>${'x'.repeat(MAX_DOCUMENT_BYTES + 1)}</body></html>`;
    const ok = printHtmlAsPdf(gigante, { filename: 'fichas' });
    expect(ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    // A mensagem tem que dizer o que fazer, não só que falhou.
    const msg = String((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg).toMatch(/partes/i);
  });

  it('avisa na aba quando recusa — senão ela fica parada na mensagem de espera', () => {
    const aba = { closed: false, document: { body: { innerHTML: '' } } } as unknown as Window;
    printHtmlAsPdf(`<html><body>${'x'.repeat(MAX_DOCUMENT_BYTES + 1)}</body></html>`,
      { filename: 'fichas', target: aba });
    expect(aba.document.body.innerHTML).toMatch(/grande demais/i);
  });

  it('o limite tem folga sobre os ~4,5MB do corpo da requisição', () => {
    expect(MAX_DOCUMENT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('openPrintTab', () => {
  it('abre a aba COM NOME, que é o alvo do formulário', () => {
    const open = vi.fn().mockReturnValue({
      document: { write: vi.fn(), close: vi.fn() },
    });
    vi.stubGlobal('open', open);
    openPrintTab();
    expect(open).toHaveBeenCalledWith('', 'squad-pdf');
    vi.unstubAllGlobals();
  });
});
