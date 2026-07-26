// Painel "Referências produzidas no período" — aba Relatórios da Ficha.
//
// Derivado DAS OPs (ledger production_pointings + fallback de estágio
// concluído) — mostra o que o SETOR produziu por referência + cor, sem
// digitação extra na chamada. Visão do setor: não atribui por montador.
import { Package } from '@phosphor-icons/react';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import type { ReferenciaProduzidaRow } from '@/lib/referenciasProduzidas';

const fmtDia = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');

const FONTE_META: Record<ReferenciaProduzidaRow['fonte'], { label: string; title: string }> = {
  apontamento: { label: 'apontamento', title: 'Somado dos apontamentos parciais das OPs no setor (ledger).' },
  estagio:     { label: 'estágio',     title: 'OP antiga sem ledger — contada pela conclusão do estágio no setor.' },
  misto:       { label: 'misto',       title: 'Parte pelo ledger de apontamentos, parte pela conclusão do estágio.' },
};

interface Props {
  setorLabel: string;
  range: { from: string; to: string };
  refs: ReferenciaProduzidaRow[];
  isLoading: boolean;
}

export function ReferenciasProduzidasPanel({ setorLabel, range, refs, isLoading }: Props) {
  const totalPares = refs.reduce((s, r) => s + r.pares, 0);
  const temFallback = refs.some((r) => r.fonte !== 'apontamento');

  return (
    <Panel
      flush
      eyebrow={`REFERÊNCIAS · ${setorLabel.toUpperCase()}`}
      title="Referências produzidas no período"
      subtitle={`${fmtDia(range.from)} a ${fmtDia(range.to)} · derivado dos apontamentos das OPs que passaram pelo setor — sem digitação extra na chamada.`}
    >
      {isLoading ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando produção das OPs…</div>
      ) : refs.length === 0 ? (
        <EmptyState icon={Package} title="Sem produção apontada nas OPs"
          description="Nenhuma OP teve baixa neste setor dentro do período selecionado." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" style={{ minWidth: 560 }}>
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Referência</th>
                <th className="px-3 py-2">Cor</th>
                <th className="border-l border-border px-3 py-2 text-right">OPs</th>
                <th className="px-3 py-2 text-right">Pares</th>
                <th className="border-l border-border px-3 py-2">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {refs.map((r) => {
                const fonte = FONTE_META[r.fonte];
                return (
                  <tr key={r.key} className="border-t border-border">
                    <td className="px-3 py-2">
                      <span className="font-semibold text-foreground">{r.code}</span>
                      {r.name && r.name !== '—' && r.name !== r.code && (
                        <span className="ml-1.5 text-muted-foreground">{r.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-foreground">{r.color}</td>
                    <td className="border-l border-border px-3 py-2 text-right tabular-nums text-muted-foreground"
                      title={r.ops.length ? r.ops.join(', ') : undefined}>
                      {r.opsCount.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-foreground">{r.pares.toLocaleString('pt-BR')}</td>
                    <td className="border-l border-border px-3 py-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground" title={fonte.title}>
                        {fonte.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td className="px-3 py-2">Total ({refs.length} referência{refs.length === 1 ? '' : 's'}/cor)</td>
                <td className="px-3 py-2" />
                <td className="border-l border-border px-3 py-2 text-right tabular-nums">
                  {refs.reduce((s, r) => s + r.opsCount, 0).toLocaleString('pt-BR')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{totalPares.toLocaleString('pt-BR')}</td>
                <td className="border-l border-border px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {!isLoading && temFallback && (
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Linhas com fonte "estágio"/"misto" incluem OPs antigas sem ledger de apontamento — contadas pela data de conclusão do estágio.
        </div>
      )}
    </Panel>
  );
}
