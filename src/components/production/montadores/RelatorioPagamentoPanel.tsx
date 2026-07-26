// Painel "Pagamento por produção" — aba Relatórios da Ficha de Montadores.
//
// PRODUZIDO = ficha_montadores do período × R$/par snapshot (sumProducaoRows —
// MESMA fórmula da folha; pode divergir da aba Produtividade, que usa rates
// editáveis na tela). JÁ PAGO = payroll_payments das folhas cujo período
// sobrepõe o filtro (useMontadorPagamentos). Saldo = produzido − pago.
import { useMemo, useState } from 'react';
import { CurrencyDollar, Package, Printer, Users, Wallet } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  aggregateProducaoByMontador, isChamadaRow, paresDiffOfRow, ratesOfRow,
  type FichaMontadorRow,
} from '@/lib/montadorProduction';
import {
  buildPagamentoRows, type PagamentoMontadorRow, type StatusPagamento,
} from '@/lib/montadorPagamentos';
import { useMontadorPagamentos } from '@/hooks/useMontadorPagamentos';
import { formatPayrollPeriod } from '@/hooks/usePayrollPayments';
import type { ReferenciaProduzidaRow } from '@/lib/referenciasProduzidas';
import { imprimirRelatorioPagamento } from '@/lib/printMontadoresPagamento';
import { RegistrarPagamentoProducaoDialog } from './RegistrarPagamentoProducaoDialog';

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDia = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');

const STATUS_META: Record<StatusPagamento, { label: string; pill: string }> = {
  pago:     { label: 'Pago',     pill: 'bg-green-500/10 text-green-600' },
  parcial:  { label: 'Parcial',  pill: 'bg-amber-500/10 text-amber-600' },
  pendente: { label: 'Pendente', pill: 'bg-red-500/10 text-red-600' },
};
const STATUS_ORDER: ('all' | StatusPagamento)[] = ['all', 'pendente', 'parcial', 'pago'];

interface Props {
  setorLabel: string;
  range: { from: string; to: string };
  periodoLabel: string;
  montadores: { id: string; name: string; cpf?: string | null; role?: string | null }[];
  /** Linhas de ficha_montadores JÁ filtradas por setor + período + montador. */
  fichasPeriodo: FichaMontadorRow[];
  /** Referências produzidas no período (pra seção 2 da impressão). */
  refs: ReferenciaProduzidaRow[];
}

export function RelatorioPagamentoPanel({ setorLabel, range, periodoLabel, montadores, fichasPeriodo, refs }: Props) {
  const [statusFilter, setStatusFilter] = useState<'all' | StatusPagamento>('all');
  const [pagarTarget, setPagarTarget] = useState<PagamentoMontadorRow | null>(null);

  const producao = useMemo(() => aggregateProducaoByMontador(fichasPeriodo), [fichasPeriodo]);
  const { data: pagamentos } = useMontadorPagamentos(montadores.map((m) => m.id), range.from, range.to);

  const rows = useMemo(() => buildPagamentoRows({
    montadores,
    producao,
    pagoByEmployee: pagamentos?.byEmployee ?? new Map(),
  }), [montadores, producao, pagamentos]);

  // Produção órfã: linhas chamada sem montador_id — não entram na folha.
  const orfao = useMemo(() => {
    let bruto = 0, pares = 0;
    for (const f of fichasPeriodo) {
      if (f.montador_id || !isChamadaRow(f)) continue;
      const { medio, dificil } = paresDiffOfRow(f);
      const { vm, vd } = ratesOfRow(f);
      pares += medio + dificil;
      bruto += medio * vm + dificil * vd;
    }
    return { bruto, pares };
  }, [fichasPeriodo]);

  const counts = useMemo(() => {
    const c: Record<StatusPagamento, number> = { pendente: 0, parcial: 0, pago: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const visiveis = statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter);

  const totals = useMemo(() => visiveis.reduce(
    (s, r) => ({
      paresMedio: s.paresMedio + r.paresMedio,
      paresDificil: s.paresDificil + r.paresDificil,
      pares: s.pares + r.pares,
      produzido: s.produzido + r.produzido,
      pago: s.pago + r.pago,
      saldo: s.saldo + r.saldo,
    }),
    { paresMedio: 0, paresDificil: 0, pares: 0, produzido: 0, pago: 0, saldo: 0 },
  ), [visiveis]);

  const empregado = (id: string) => montadores.find((m) => m.id === id);
  const intervalo = `${fmtDia(range.from)} a ${fmtDia(range.to)}`;

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Montadores" value={String(rows.length)} icon={Users} />
        <StatCard label="Produzido" value={fmtBRL(totals.produzido)} icon={Package}
          hint={`${totals.paresMedio.toLocaleString('pt-BR')} méd · ${totals.paresDificil.toLocaleString('pt-BR')} dif`} />
        <StatCard label="Já pago" value={fmtBRL(totals.pago)} icon={CurrencyDollar} tone="primary" />
        <StatCard label="Saldo" value={fmtBRL(totals.saldo)} icon={Wallet}
          hint={counts.pendente + counts.parcial > 0 ? `${counts.pendente + counts.parcial} em aberto` : 'tudo quitado'} />
      </StatGrid>

      <Panel
        flush
        eyebrow={`PAGAMENTO POR PRODUÇÃO · ${periodoLabel.toUpperCase()}`}
        title={`Produzido × pago — ${setorLabel}`}
        subtitle={`${intervalo} · produzido pelo R$/par congelado no apontamento (mesma fórmula da folha) · pago pelas folhas que cobrem o período.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    statusFilter === s ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  {s === 'all' ? `Todos (${rows.length})` : `${STATUS_META[s].label} (${counts[s]})`}
                </button>
              ))}
            </div>
            <Button
              type="button" variant="outline" size="sm" className="h-8 gap-1.5"
              disabled={visiveis.length === 0}
              onClick={() => imprimirRelatorioPagamento({
                setorLabel, periodo: periodoLabel, intervalo,
                geradoEm: fmtDia(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)),
                rows: visiveis, totals, refs,
              })}
            >
              <Printer className="h-4 w-4" /> Imprimir relatório
            </Button>
          </div>
        }
      >
        {orfao.pares > 0 && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
            <strong>{orfao.pares.toLocaleString('pt-BR')} pares ({fmtBRL(orfao.bruto)})</strong> lançados sem funcionário
            vinculado no período — não entram no pagamento. Abra o dia na Chamada e relance pelo nome.
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState icon={CurrencyDollar} title="Sem produção nem pagamentos no período"
            description="Lance a produção na Chamada do dia ou ajuste o período do filtro." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" style={{ minWidth: 860 }}>
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2">#</th>
                  <th className="px-3 py-2">Montador</th>
                  <th className="border-l border-border px-3 py-2 text-right text-amber-600">Pares méd</th>
                  <th className="px-3 py-2 text-right text-red-600">Pares dif</th>
                  <th className="px-3 py-2 text-right">Pares</th>
                  <th className="border-l border-border px-3 py-2 text-right">Produzido</th>
                  <th className="px-3 py-2 text-right">Pago</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                  <th className="border-l border-border px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum montador com status "{statusFilter === 'all' ? 'Todos' : STATUS_META[statusFilter as StatusPagamento].label}" no período.
                  </td></tr>
                )}
                {visiveis.map((r, i) => {
                  const meta = STATUS_META[r.status];
                  const runsDiferentes = r.runs.filter((x) => !x.exactPeriod);
                  return (
                    <tr key={r.employeeId} className="border-t border-border">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{r.nome}</div>
                        <div className="flex flex-wrap gap-1">
                          {runsDiferentes.length > 0 && (
                            <span
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                              title={`Inclui folha de outro recorte: ${runsDiferentes.map((x) => formatPayrollPeriod(x.period)).join(', ')} — o pago dessa(s) folha(s) conta inteiro aqui.`}
                            >
                              período difere
                            </span>
                          )}
                          {r.divergencia && (
                            <span
                              className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-600"
                              title="A folha deste período foi aprovada/paga com valor diferente do produzido atual (lançamentos alterados depois)."
                            >
                              folha ≠ produzido
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="border-l border-border px-3 py-2 text-right font-semibold tabular-nums text-amber-600">{r.paresMedio.toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-600">{r.paresDificil.toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.pares.toLocaleString('pt-BR')}</td>
                      <td className="border-l border-border px-3 py-2 text-right font-semibold tabular-nums">{fmtBRL(r.produzido)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(r.pago)}</td>
                      <td className={`px-3 py-2 text-right font-bold tabular-nums ${r.saldo > 0.005 ? 'text-amber-600' : 'text-green-600'}`}
                        title={r.saldo < -0.005 ? `Pago ${fmtBRL(-r.saldo)} além do produzido deste período (folha de recorte maior ou ajuste).` : undefined}>
                        {fmtBRL(r.saldo)}
                      </td>
                      <td className="border-l border-border px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.pill}`}>{meta.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" variant="outline" size="sm" className="h-7"
                          disabled={r.produzido <= 0 && r.pago <= 0}
                          onClick={() => setPagarTarget(r)}>
                          Registrar pagamento
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {visiveis.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-semibold">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">Total ({visiveis.length})</td>
                    <td className="border-l border-border px-3 py-2 text-right tabular-nums text-amber-600">{totals.paresMedio.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600">{totals.paresDificil.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{totals.pares.toLocaleString('pt-BR')}</td>
                    <td className="border-l border-border px-3 py-2 text-right tabular-nums">{fmtBRL(totals.produzido)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(totals.pago)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(totals.saldo)}</td>
                    <td className="border-l border-border px-3 py-2" colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Panel>

      {pagarTarget && (
        <RegistrarPagamentoProducaoDialog
          open={!!pagarTarget}
          onOpenChange={(o) => { if (!o) setPagarTarget(null); }}
          employee={{
            id: pagarTarget.employeeId,
            name: pagarTarget.nome,
            cpf: empregado(pagarTarget.employeeId)?.cpf,
            role: empregado(pagarTarget.employeeId)?.role,
          }}
          range={range}
          produzido={pagarTarget.produzido}
          paresMedio={pagarTarget.paresMedio}
          paresDificil={pagarTarget.paresDificil}
        />
      )}
    </div>
  );
}
