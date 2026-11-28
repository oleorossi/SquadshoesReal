/**
 * Tela de seleção do Pacote da OP (ficha de operador → /imprimir-fichas).
 *
 * Tudo vem marcado: sai o pacote completo (Palmilha → Fardo → Caixa). Para
 * reimprimir só uma parte: desmarque por TIPO, clique nas FOLHAS ou digite
 * a lista por texto (`1,5,15`, `1:15`, `1,5,10:15`). Reimpressão sai com o
 * selo "2ª VIA · data" — só carimbo no papel; nada é gravado no banco.
 */
import { useMemo, useState } from 'react';
import { Printer, Stack, CircleNotch as Loader2 } from '@phosphor-icons/react';
import {
  PACOTE_ORDEM,
  PACOTE_TIPO_ROTULO,
  aplicarSelecaoTexto,
  alternarFolha,
  alternarTipo,
  estadoDaFolha,
  maximoDaUnidade,
  selecaoCompleta,
  totalFichas,
  totalFolhasDoTipo,
  totalItens,
  unidadesDoTipo,
  type PacoteInventario,
  type PacotePlano,
  type PacoteSelecao,
  type PacoteTipo,
  type PacoteUnidade,
} from '@/lib/pacoteOp';
import { formatarIndices, parseSelecaoTexto } from '@/lib/pacoteOpSelecao';

const UNIDADE_ROTULO: Record<PacoteUnidade, string> = {
  folhas: 'Folhas',
  cartoes: 'Cartões',
  fichas: 'Fichas',
};

const TIPO_TITULO: Record<PacoteTipo, string> = {
  palmilha: 'Fichas Palmilha A4',
  fardo: 'Cartões do fardo',
  caixa: 'Cartões da caixa',
};

function detalheDoTipo(inv: PacoteInventario, tipo: PacoteTipo): string {
  const folhas = totalFolhasDoTipo(inv, tipo);
  const folhasTxt = `${folhas} ${folhas === 1 ? 'folha' : 'folhas'}`;
  if (tipo === 'palmilha') return folhasTxt;
  const itens = totalItens(inv, tipo);
  return `${itens} ${itens === 1 ? 'cartão' : 'cartões'} · ${folhasTxt}`;
}

const chipBase = 'inline-flex items-center justify-center border px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const chipOn = 'border-primary bg-primary/10 text-foreground';
const chipOff = 'border-border bg-background text-muted-foreground hover:text-foreground';

export interface PacoteOpPrintPanelProps {
  inventario: PacoteInventario;
  selecao: PacoteSelecao;
  onSelecaoChange: (next: PacoteSelecao) => void;
  plano: PacotePlano;
  gerando: boolean;
  onImprimir: () => void;
  /** Cabeçalho opcional da prévia (ex.: "PV-00255 · OP-2026-06203"). */
  contexto?: string;
}

export function PacoteOpPrintPanel({
  inventario,
  selecao,
  onSelecaoChange,
  plano,
  gerando,
  onImprimir,
  contexto,
}: PacoteOpPrintPanelProps) {
  const [alvo, setAlvo] = useState<PacoteTipo>('fardo');
  const [unidade, setUnidade] = useState<PacoteUnidade>('fichas');
  const [texto, setTexto] = useState('');

  const tiposComItens = PACOTE_ORDEM.filter((t) => totalItens(inventario, t) > 0);
  const max = maximoDaUnidade(inventario, alvo, unidade);
  const leitura = useMemo(() => parseSelecaoTexto(texto, max), [texto, max]);
  const unidadesOk = unidadesDoTipo(alvo);

  const escolherAlvo = (tipo: PacoteTipo) => {
    setAlvo(tipo);
    if (!unidadesDoTipo(tipo).includes(unidade)) setUnidade('folhas');
  };

  const aplicar = () => {
    if (!leitura.ok || leitura.vazio) return;
    onSelecaoChange(aplicarSelecaoTexto(inventario, selecao, { alvo, unidade, indices: leitura.indices }));
  };

  const descricaoLeitura = (() => {
    if (!leitura.ok) return null;
    if (leitura.vazio) return 'Digite os números para reimprimir só uma parte.';
    const rotulo = unidade === 'folhas' ? 'folhas' : unidade === 'cartoes' ? 'cartões' : 'fichas';
    return `Será impresso: ${rotulo} ${formatarIndices(leitura.indices)} (${leitura.indices.length} de ${max}).`;
  })();

  const fichas = totalFichas(inventario);
  const resumoTopo = tiposComItens
    .map((t) => `${PACOTE_TIPO_ROTULO[t]} ${detalheDoTipo(inventario, t)}`)
    .join(' · ');
  const semItens = tiposComItens.length === 0;

  return (
    <section
      data-testid="op-package-print-panel"
      className="no-print border border-l-4 border-border border-l-primary bg-background shadow-sm"
      aria-label="Pacote da OP — seleção para impressão"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <p className="eyebrow">PACOTE DA OP{contexto ? ` · ${contexto}` : ''}</p>
          <h2 className="mt-0.5 font-display text-xl uppercase leading-none tracking-wide">
            Seleção para impressão
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Um único PDF na ordem Palmilha A4 (retrato), Fardo e Caixa (paisagem). Tudo vem marcado;
            desmarque ou filtre para reimprimir.
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{resumoTopo || 'Nada para imprimir nesta OP.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSelecaoChange(selecaoCompleta(inventario))}
            className="inline-flex h-9 items-center border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Marcar tudo
          </button>
          <button
            type="button"
            onClick={onImprimir}
            disabled={gerando || plano.totalFolhas === 0}
            data-testid="op-package-print-submit"
            className="inline-flex h-9 items-center gap-1.5 bg-foreground px-3 text-xs font-semibold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {plano.parcial ? 'Reimprimir PDF' : 'Imprimir pacote (PDF)'}
          </button>
        </div>
      </div>

      {semItens ? (
        <p className="p-4 text-xs text-muted-foreground">
          Não há fichas Palmilha, cartões do fardo nem cartões da caixa para as OPs selecionadas.
        </p>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div>
              <p className="eyebrow">Tipos</p>
              <ul className="mt-1.5 space-y-1.5">
                {tiposComItens.map((tipo) => {
                  const marcados = selecao[tipo].length;
                  const total = totalItens(inventario, tipo);
                  return (
                    <li key={tipo}>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-primary"
                          checked={marcados === total}
                          ref={(el) => { if (el) el.indeterminate = marcados > 0 && marcados < total; }}
                          onChange={() => onSelecaoChange(alternarTipo(inventario, selecao, tipo))}
                          aria-label={TIPO_TITULO[tipo]}
                        />
                        <span className="font-semibold">{TIPO_TITULO[tipo]}</span>
                        <span className="font-mono text-muted-foreground">{detalheDoTipo(inventario, tipo)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <p className="eyebrow">Folhas</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {tiposComItens.flatMap((tipo) => {
                  const folhas = totalFolhasDoTipo(inventario, tipo);
                  return Array.from({ length: folhas }, (_, i) => {
                    const folha = i + 1;
                    const estado = estadoDaFolha(inventario, selecao, tipo, folha);
                    return (
                      <button
                        key={`${tipo}-${folha}`}
                        type="button"
                        aria-pressed={estado !== 'vazia'}
                        data-estado={estado}
                        onClick={() => onSelecaoChange(alternarFolha(inventario, selecao, tipo, folha))}
                        className={`${chipBase} flex-col gap-0.5 ${estado === 'cheia' ? chipOn : estado === 'parcial' ? 'border-primary/50 bg-primary/5 text-foreground' : chipOff}`}
                      >
                        <span className="font-display text-[11px] uppercase tracking-wide">{PACOTE_TIPO_ROTULO[tipo]}</span>
                        <span className="font-mono text-[11px]">folha {folha} de {folhas}</span>
                      </button>
                    );
                  });
                })}
              </div>
            </div>

            <div>
              <p className="eyebrow">Seleção por texto</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Lista <code className="font-mono">1,5,15</code> (só esses) ou intervalo{' '}
                <code className="font-mono">1:15</code> (de 1 até 15). Dá para combinar:{' '}
                <code className="font-mono">1,5,10:15</code>. Vale para folhas, cartões e fichas.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {tiposComItens.map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    disabled={unidade === 'fichas'}
                    aria-pressed={unidade === 'fichas' ? tipo !== 'palmilha' : alvo === tipo}
                    onClick={() => escolherAlvo(tipo)}
                    className={`${chipBase} ${unidade === 'fichas' ? 'disabled:opacity-100' : ''} ${(unidade === 'fichas' ? tipo !== 'palmilha' : alvo === tipo) ? chipOn : chipOff}`}
                  >
                    {PACOTE_TIPO_ROTULO[tipo]}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['folhas', 'cartoes', 'fichas'] as PacoteUnidade[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    disabled={!unidadesOk.includes(u)}
                    aria-pressed={unidade === u}
                    onClick={() => setUnidade(u)}
                    className={`${chipBase} ${unidade === u ? chipOn : chipOff}`}
                  >
                    {UNIDADE_ROTULO[u]}
                  </button>
                ))}
              </div>
              <label className="mt-2 block text-xs font-semibold" htmlFor="op-package-text">
                {UNIDADE_ROTULO[unidade]}
                <span className="ml-1 font-mono font-normal text-muted-foreground">
                  (1 a {max || 0}{unidade === 'fichas' && fichas > 0 ? ' · Fardo e Caixa' : ''})
                </span>
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="op-package-text"
                  value={texto}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="1,5,10:15"
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aplicar(); } }}
                  aria-invalid={!leitura.ok}
                  aria-describedby="op-package-text-help"
                  className={`h-10 min-w-0 flex-1 border bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${leitura.ok ? 'border-border' : 'border-destructive'}`}
                />
                <button
                  type="button"
                  onClick={aplicar}
                  disabled={!leitura.ok || leitura.vazio}
                  className="inline-flex h-10 items-center border border-border px-4 text-xs font-semibold text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Aplicar
                </button>
              </div>
              <p
                id="op-package-text-help"
                role={leitura.ok ? undefined : 'alert'}
                className={`mt-1 text-xs ${leitura.ok ? 'text-foreground' : 'text-destructive'}`}
              >
                {leitura.ok ? descricaoLeitura : leitura.erro}
              </p>
            </div>
          </div>

          <aside className="border border-border bg-muted/20 p-3" aria-label="Prévia do que será impresso">
            <p className="eyebrow">Prévia do que será impresso</p>
            {plano.selo && (
              <p className="mt-2 inline-block border border-primary/60 bg-primary/10 px-2 py-1 font-mono text-xs font-bold uppercase text-primary">
                {plano.selo}
              </p>
            )}
            <ul className="mt-2 space-y-1.5 font-mono text-[11px] leading-snug text-foreground">
              {plano.linhas.map((linha) => (
                <li key={linha}>{linha}</li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Total: {plano.totalFolhas} {plano.totalFolhas === 1 ? 'folha' : 'folhas'} no PDF.
              {plano.parcial ? ' A 2ª via é só um carimbo no papel — nada é gravado no banco.' : ''}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Stack className="h-3.5 w-3.5" /> Ordem fixa: Palmilha → Fardo → Caixa.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}

export default PacoteOpPrintPanel;
