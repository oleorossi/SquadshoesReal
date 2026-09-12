import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { printHtmlAsPdf, openPrintTab, setPrintTabStage, printWaitHtml, MAX_DOCUMENT_BYTES } from '../printPdf';

vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
  });
  return { toast };
});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'token-de-teste' } },
        error: null,
      }),
    },
  },
}));
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

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

  it('envia por POST para a função, mirando a aba já aberta', async () => {
    const ok = await printHtmlAsPdf('<html><body>oi</body></html>', { filename: 'etiquetas-PV-1' });
    expect(ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    const form = campos();
    expect(form.method.toLowerCase()).toBe('post');
    expect(form.action).toContain('/api/render-pdf');
    // Mira NOMEADA: o submit acontece depois do preparo, quando o gesto do
    // usuário já passou — mirar em janela existente é o que escapa do pop-up.
    expect(form.target).toBe('squad-pdf');
    expect(toast).toHaveBeenCalledWith('O PDF abre na outra aba.', expect.any(Object));
  });

  it('leva o HTML, o nome do arquivo, a sessão e a orientação', async () => {
    await printHtmlAsPdf('<html><body>conteudo</body></html>', {
      filename: 'cartoes-lote', landscape: true,
    });
    const form = campos();
    const valores = Object.fromEntries(
      Array.from(form.querySelectorAll('input')).map(i => [i.name, i.value]),
    );
    expect(valores.html).toContain('conteudo');
    expect(valores.filename).toBe('cartoes-lote');
    expect(valores.landscape).toBe('1');
    expect(valores.access_token).toBe('token-de-teste');
  });

  it('vincula o envio ao job previamente registrado', async () => {
    await printHtmlAsPdf('<html><body>conteudo</body></html>', {
      filename: 'lote', jobId: 'job-123',
    });
    const valores = Object.fromEntries(
      Array.from(campos().querySelectorAll('input')).map(i => [i.name, i.value]),
    );
    expect(valores.job_id).toBe('job-123');
  });

  it('espera o jobId em Promise em paralelo com a sessão', async () => {
    let resolveJob: (id: string) => void = () => {};
    const jobId = new Promise<string>((resolve) => { resolveJob = resolve; });
    const pending = printHtmlAsPdf('<html><body>conteudo</body></html>', {
      filename: 'lote', jobId,
    });
    resolveJob('job-async');
    await pending;
    const valores = Object.fromEntries(
      Array.from(campos().querySelectorAll('input')).map(i => [i.name, i.value]),
    );
    expect(valores.job_id).toBe('job-async');
  });

  it('não manda "landscape" quando é retrato (o servidor decide pelo padrão)', async () => {
    await printHtmlAsPdf('<html><body>x</body></html>', { filename: 'fichas' });
    const nomes = Array.from(campos().querySelectorAll('input')).map(i => i.name);
    expect(nomes).not.toContain('landscape');
  });

  it('não deixa o formulário sujando a página depois de enviar', async () => {
    await printHtmlAsPdf('<html><body>x</body></html>', { filename: 'fichas' });
    expect(document.querySelectorAll('form').length).toBe(0);
  });

  it('recusa documento acima do limite ANTES de enviar, com instrução do que fazer', async () => {
    const gigante = `<html><body>${'x'.repeat(MAX_DOCUMENT_BYTES + 1)}</body></html>`;
    const ok = await printHtmlAsPdf(gigante, { filename: 'fichas' });
    expect(ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    // A mensagem tem que dizer o que fazer, não só que falhou.
    const msg = String((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg).toMatch(/partes/i);
  });

  it('avisa na aba quando recusa — senão ela fica parada na mensagem de espera', async () => {
    const wrote: string[] = [];
    const aba = {
      closed: false,
      document: {
        open: vi.fn(),
        write: (html: string) => { wrote.push(html); },
        close: vi.fn(),
        getElementById: () => null,
        body: { innerHTML: '' },
      },
    } as unknown as Window;
    await printHtmlAsPdf(`<html><body>${'x'.repeat(MAX_DOCUMENT_BYTES + 1)}</body></html>`,
      { filename: 'fichas', target: aba });
    expect(wrote.join('')).toMatch(/grande demais/i);
  });

  it('marca a aba como enviando antes do POST', async () => {
    const stage = { textContent: 'Preparando o documento…' };
    const aba = {
      closed: false,
      document: {
        getElementById: () => stage,
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window;
    await printHtmlAsPdf('<html><body>ok</body></html>', { filename: 'lote', target: aba });
    expect(stage.textContent).toMatch(/Enviando para o servidor/i);
  });

  it('o limite tem folga sobre os ~4,5MB do corpo da requisição', () => {
    expect(MAX_DOCUMENT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('printWaitHtml', () => {
  it('pinta a espera com marca, estágio e aviso para não fechar a aba', () => {
    const html = printWaitHtml('preparing');
    expect(html).toMatch(/Gerando PDF/i);
    expect(html).toMatch(/Preparando o documento/i);
    expect(html).toMatch(/Não feche esta aba/i);
    expect(html).toMatch(/Squad Shoes/);
    expect(html).toMatch(/#D9264E/);
  });

  it('troca o estágio sem perder a moldura', () => {
    expect(printWaitHtml('sending')).toMatch(/Enviando para o servidor/i);
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

  it('escreve a espera branded e já dispara a sessão', () => {
    const write = vi.fn();
    vi.stubGlobal('open', vi.fn().mockReturnValue({
      document: { write, close: vi.fn() },
    }));
    openPrintTab();
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Preparando o documento'));
    expect(supabase.auth.getSession).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  /**
   * A SEGUNDA geração é o caso que quebrava. `window.open` com o mesmo nome
   * devolve a aba existente, que já está exibindo um PDF — e escrever num
   * documento PDF LANÇA. Sem proteção, o erro subia até a primeira linha do
   * handler de impressão e abortava tudo antes do primeiro await: sem toast,
   * sem erro na tela, sem arquivo.
   */
  it('aba já exibindo um PDF não derruba o fluxo — devolve a janela mesmo assim', () => {
    const abaComPdf = {
      document: {
        write: vi.fn(() => { throw new DOMException('cannot write to PDF document'); }),
        close: vi.fn(),
      },
    };
    vi.stubGlobal('open', vi.fn().mockReturnValue(abaComPdf));
    expect(() => openPrintTab()).not.toThrow();
    expect(openPrintTab()).toBe(abaComPdf);
    vi.unstubAllGlobals();
  });

  it('pop-up bloqueado (open devolve null) também não derruba', () => {
    vi.stubGlobal('open', vi.fn().mockReturnValue(null));
    expect(() => openPrintTab()).not.toThrow();
    expect(openPrintTab()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('reusa a sessão pré-buscada no clique, sem segundo getSession', async () => {
    submitReady();
    const write = vi.fn();
    vi.stubGlobal('open', vi.fn().mockReturnValue({
      document: { write, close: vi.fn(), getElementById: () => null, open: vi.fn() },
    }));
    openPrintTab();
    const callsBefore = (supabase.auth.getSession as ReturnType<typeof vi.fn>).mock.calls.length;
    HTMLFormElement.prototype.submit = vi.fn();
    await printHtmlAsPdf('<html><body>x</body></html>', { filename: 'lote' });
    expect((supabase.auth.getSession as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    vi.unstubAllGlobals();
  });
});

describe('setPrintTabStage', () => {
  it('atualiza o estágio no elemento existente sem reescrever o documento', () => {
    const stage = { textContent: 'Preparando o documento…' };
    const write = vi.fn();
    const tab = {
      closed: false,
      document: {
        getElementById: () => stage,
        write,
        open: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as Window;
    setPrintTabStage(tab, 'sending');
    expect(stage.textContent).toMatch(/Enviando para o servidor/i);
    expect(write).not.toHaveBeenCalled();
  });
});

function submitReady() {
  HTMLFormElement.prototype.submit = vi.fn();
}
