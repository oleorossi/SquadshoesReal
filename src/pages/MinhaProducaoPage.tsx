/**
 * /minha-producao — self-service do montador/solador (regime por par).
 *
 * Só a própria produção: lançar o dia e consultar semana/mês.
 * Pagamento e grade da equipe ficam na Ficha administrativa.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CaretLeft, CaretRight, CircleNotch as Loader2, FloppyDisk, Warning,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { useCan } from '@/hooks/useAccessControl';
import { useMeuEmployee } from '@/hooks/useMeuEmployee';
import { useEmployeeSectors, useProductionSectors } from '@/hooks/useSectorRoster';
import { semanaDePagamento } from '@/hooks/useFichaProducaoPagamento';
import {
  ratesOfRow, sumProducaoRows, type FichaMontadorRow,
} from '@/lib/montadorProduction';
import {
  adjustParesByFicha, fichasFromPares, isFichaLocked, parseParesEntry,
} from '@/lib/fichaMontadoresEntry';
import { formatCurrency } from '@/lib/utils';
import {
  buildProducaoExportRows, downloadTextFile, producaoExportToCsv,
} from '@/lib/fichaMontadoresExport';

const TAMANHOS = [12, 15, 18] as const;
type DiffKey = 'medio' | 'dificil';
type DiffMap = { medio: Record<number, number>; dificil: Record<number, number> };

const emptyMap = (): DiffMap => ({
  medio: { 12: 0, 15: 0, 18: 0 },
  dificil: { 12: 0, 15: 0, 18: 0 },
});

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDia(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function paresOf(dm: DiffMap) {
  let t = 0;
  for (const k of TAMANHOS) t += (dm.medio[k] || 0) + (dm.dificil[k] || 0);
  return t;
}

function mapFromDetalhe(detalhe: FichaMontadorRow['detalhe'], total: number | null | undefined): DiffMap {
  const dm = emptyMap();
  if (Array.isArray(detalhe) && detalhe.length) {
    for (const d of detalhe) {
      const t = Number(d?.tamanho);
      if (!TAMANHOS.includes(t as 12 | 15 | 18)) continue;
      if (d.medio != null || d.dificil != null) {
        dm.medio[t] = Number(d.medio) || 0;
        dm.dificil[t] = Number(d.dificil) || 0;
      } else {
        dm.medio[t] = Number(d.pares) || 0;
      }
    }
    return dm;
  }
  if ((Number(total) || 0) > 0) dm.medio[12] = Number(total) || 0;
  return dm;
}

function detalheFromMap(dm: DiffMap) {
  return TAMANHOS
    .map((tamanho) => ({
      tamanho,
      medio: dm.medio[tamanho] || 0,
      dificil: dm.dificil[tamanho] || 0,
    }))
    .filter((d) => d.medio > 0 || d.dificil > 0);
}

type Tab = 'lancar' | 'relatorio';

export default function MinhaProducaoPage() {
  const { data: me, isLoading: loadingMe, isError: errorMe } = useMeuEmployee();
  const { data: sectors = [] } = useProductionSectors();
  const { data: allocations = [] } = useEmployeeSectors();
  const podeVerFichaRh = useCan('/fichas-montadores').canView;

  const [tab, setTab] = useState<Tab>('lancar');
  const [dia, setDia] = useState(todayISO());
  const [setor, setSetor] = useState<string>('');
  const [draft, setDraft] = useState<DiffMap>(emptyMap());
  const [existing, setExisting] = useState<(FichaMontadorRow & {
    id?: string;
    atualizado_em?: string;
    payroll_run_id?: string | null;
    pago_em?: string | null;
    setor?: string | null;
  }) | null>(null);
  const [loadingRow, setLoadingRow] = useState(false);
  const [saving, setSaving] = useState(false);

  const [periodMode, setPeriodMode] = useState<'semana' | 'mes'>('semana');
  const [reportRows, setReportRows] = useState<Array<FichaMontadorRow & {
    dia?: string; setor?: string; payroll_run_id?: string | null; pago_em?: string | null; montador?: string | null;
  }>>([]);
  const [loadingReport, setLoadingReport] = useState(false);

  const setoresPorPar = useMemo(() => {
    const marked = sectors
      .filter((s) => s.paysByPair)
      .map((s) => ({ key: s.key, label: s.label || s.key }));
    if (marked.length) return marked;
    return [
      { key: 'montagem', label: 'Montagem' },
      { key: 'solagem', label: 'Solagem' },
    ];
  }, [sectors]);

  const meusSetores = useMemo(() => {
    if (!me) return setoresPorPar;
    const mine = new Set(
      allocations
        .filter((a) => a.employee_id === me.id)
        .map((a) => a.sector_key),
    );
    const filtered = setoresPorPar.filter((s) => mine.has(s.key));
    return filtered.length ? filtered : setoresPorPar;
  }, [me, allocations, setoresPorPar]);

  useEffect(() => {
    if (!setor && meusSetores[0]) setSetor(meusSetores[0].key);
  }, [setor, meusSetores]);

  const locked = isFichaLocked(existing);
  const dirty = useMemo(() => {
    const orig = existing ? mapFromDetalhe(existing.detalhe, existing.total) : emptyMap();
    return JSON.stringify(draft) !== JSON.stringify(orig);
  }, [draft, existing]);

  const loadDay = useCallback(async () => {
    if (!me?.id || !setor || !dia) return;
    setLoadingRow(true);
    try {
      const { data, error } = await supabase
        .from('ficha_montadores')
        .select('id, dia, montador_id, montador, setor, detalhe, total, valor_par, valor_par_medio, valor_par_dificil, origem, numeracoes, payroll_run_id, pago_em, atualizado_em')
        .eq('montador_id', me.id)
        .eq('dia', dia)
        .eq('setor', setor)
        .eq('origem', 'chamada')
        .maybeSingle();
      if (error) throw error;
      const row = data as typeof existing;
      setExisting(row);
      setDraft(row ? mapFromDetalhe(row.detalhe, row.total) : emptyMap());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o dia');
      setExisting(null);
      setDraft(emptyMap());
    } finally {
      setLoadingRow(false);
    }
  }, [me?.id, setor, dia]);

  useEffect(() => { void loadDay(); }, [loadDay]);

  const reportRange = useMemo(() => {
    if (periodMode === 'semana') return semanaDePagamento(dia);
    const [y, m] = dia.split('-');
    const last = new Date(Number(y), Number(m), 0).getDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, '0')}` };
  }, [periodMode, dia]);

  const loadReport = useCallback(async () => {
    if (!me?.id) return;
    setLoadingReport(true);
    try {
      const { data, error } = await supabase
        .from('ficha_montadores')
        .select('id, dia, montador_id, montador, setor, detalhe, total, valor_par, valor_par_medio, valor_par_dificil, origem, numeracoes, payroll_run_id, pago_em')
        .eq('montador_id', me.id)
        .eq('origem', 'chamada')
        .gte('dia', reportRange.from)
        .lte('dia', reportRange.to)
        .order('dia', { ascending: true });
      if (error) throw error;
      setReportRows((data || []) as typeof reportRows);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar relatório');
      setReportRows([]);
    } finally {
      setLoadingReport(false);
    }
  }, [me?.id, reportRange.from, reportRange.to]);

  useEffect(() => {
    if (tab === 'relatorio') void loadReport();
  }, [tab, loadReport]);

  const agg = useMemo(() => sumProducaoRows(reportRows), [reportRows]);

  function setCell(diff: DiffKey, tamanho: number, raw: string) {
    const parsed = parseParesEntry(raw, tamanho);
    if (parsed == null) return;
    setDraft((prev) => ({
      ...prev,
      [diff]: { ...prev[diff], [tamanho]: parsed },
    }));
  }

  function bump(diff: DiffKey, tamanho: number, deltaFichas: number) {
    setDraft((prev) => ({
      ...prev,
      [diff]: {
        ...prev[diff],
        [tamanho]: adjustParesByFicha(prev[diff][tamanho] || 0, tamanho, deltaFichas),
      },
    }));
  }

  async function salvar() {
    if (!me || locked || !setor) return;
    if (me.payment_type !== 'producao') {
      toast.error('Seu cadastro não está no regime por par. Fale com o RH.');
      return;
    }
    setSaving(true);
    try {
      const detalhe = detalheFromMap(draft);
      const total = paresOf(draft);
      const payload = [{
        dia,
        montador_id: me.id,
        expected_id: existing?.id ?? null,
        expected_atualizado_em: existing?.atualizado_em ?? null,
        detalhe,
      }];
      const { data, error } = await supabase.rpc(
        'save_ficha_montadores_batch' as never,
        { p_setor: setor, p_items: payload } as never,
      );
      if (error) throw error;
      const result = data as { gravados?: number; message?: string } | null;
      toast.success(
        total > 0
          ? `Salvo: ${total} pares`
          : (Number(result?.gravados) ? 'Dia zerado' : 'Nada para salvar'),
      );
      await loadDay();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const rows = buildProducaoExportRows(reportRows, new Map([[me!.id, me!.name]]));
    downloadTextFile(
      `minha-producao_${reportRange.from}_${reportRange.to}.csv`,
      producaoExportToCsv(rows),
    );
  }

  if (loadingMe) {
    return (
      <div className="space-y-4">
        <EditorialPageHeader sectionLabel="Produção" title="Minha produção" />
        <Panel className="p-8 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
        </Panel>
      </div>
    );
  }

  if (errorMe) {
    return (
      <div className="space-y-4">
        <EditorialPageHeader sectionLabel="Produção" title="Minha produção" />
        <EmptyState
          icon={Warning}
          title="Não foi possível carregar seu vínculo"
          description="Tente de novo. Se continuar, avise o RH."
        />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="space-y-4">
        <EditorialPageHeader sectionLabel="Produção" title="Minha produção" />
        <EmptyState
          icon={Warning}
          title="Conta sem vínculo com funcionário"
          description="Peça ao RH para vincular seu login em Funcionários → Conta de acesso. Sem isso você não consegue lançar pares."
        />
      </div>
    );
  }

  if (!me.active) {
    return (
      <div className="space-y-4">
        <EditorialPageHeader sectionLabel="Produção" title="Minha produção" />
        <EmptyState
          icon={Warning}
          title="Cadastro inativo"
          description="Seu cadastro de funcionário está inativo. Fale com o RH."
        />
      </div>
    );
  }

  const vm = Number(existing ? ratesOfRow(existing).vm : me.valor_par_medio) || 0;
  const vd = Number(existing ? ratesOfRow(existing).vd : me.valor_par_dificil) || 0;
  const totalPares = paresOf(draft);
  const estimado = (() => {
    let medio = 0; let dificil = 0;
    for (const t of TAMANHOS) {
      medio += draft.medio[t] || 0;
      dificil += draft.dificil[t] || 0;
    }
    return medio * vm + dificil * vd;
  })();

  return (
    <div className="space-y-4 pb-24">
      <EditorialPageHeader
        sectionLabel="Produção"
        title="Minha produção"
        description={`${me.name} · R$ ${vm.toFixed(2)} médio · R$ ${vd.toFixed(2)} difícil`}
      />

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={tab === 'lancar' ? 'default' : 'outline'}
          onClick={() => setTab('lancar')}
        >
          Lançar dia
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === 'relatorio' ? 'default' : 'outline'}
          onClick={() => setTab('relatorio')}
        >
          Meus pares
        </Button>
        {podeVerFichaRh && (
          <Button type="button" size="sm" variant="ghost" asChild className="ml-auto">
            <Link to="/fichas-montadores">Versão RH</Link>
          </Button>
        )}
      </div>

      {tab === 'lancar' && (
        <Panel className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="h-9 px-2"
              onClick={() => {
                const d = new Date(`${dia}T00:00:00`);
                d.setDate(d.getDate() - 1);
                setDia(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
              }}>
              <CaretLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className="h-9 w-[11rem]"
            />
            <Button type="button" size="sm" variant="outline" className="h-9 px-2"
              onClick={() => {
                const d = new Date(`${dia}T00:00:00`);
                d.setDate(d.getDate() + 1);
                setDia(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
              }}>
              <CaretRight className="h-4 w-4" />
            </Button>
            <div className="flex gap-1 flex-wrap">
              {meusSetores.map((s) => (
                <Button
                  key={s.key}
                  type="button"
                  size="sm"
                  variant={setor === s.key ? 'default' : 'outline'}
                  className="h-9"
                  onClick={() => setSetor(s.key)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </div>

          {locked && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              Este dia já entrou na folha ou foi pago — não dá para editar.
            </div>
          )}

          {loadingRow ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" /> Carregando dia…
            </div>
          ) : (
            <div className="space-y-4">
              {(['medio', 'dificil'] as DiffKey[]).map((diff) => (
                <div key={diff} className="space-y-2">
                  <p className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
                    {diff === 'medio' ? 'Médio' : 'Difícil'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {TAMANHOS.map((tam) => {
                      const pares = draft[diff][tam] || 0;
                      const fichas = fichasFromPares(pares, tam);
                      return (
                        <div key={`${diff}-${tam}`} className="rounded-lg border border-border p-3 space-y-2">
                          <div className="flex items-baseline justify-between">
                            <span className="font-display text-lg uppercase">Ficha {tam}</span>
                            <span className="font-mono text-xs text-muted-foreground">{fichas} f</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-10 w-10"
                              disabled={locked || pares < tam}
                              onClick={() => bump(diff, tam, -1)}
                            >
                              −
                            </Button>
                            <Input
                              inputMode="numeric"
                              disabled={locked}
                              className="h-10 text-center font-mono text-lg"
                              value={pares || ''}
                              placeholder="0"
                              onChange={(e) => setCell(diff, tam, e.target.value)}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-10 w-10"
                              disabled={locked}
                              onClick={() => bump(diff, tam, 1)}
                            >
                              +
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground text-center">
                            pares (ou digite 7f)
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <div>
                  <p className="font-mono text-2xl tabular-nums">{totalPares} pares</p>
                  <p className="text-sm text-muted-foreground">
                    Estimado {formatCurrency(estimado)}
                    {dirty ? ' · não salvo' : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  className="h-11 gap-2"
                  disabled={saving || locked || !dirty}
                  onClick={() => void salvar()}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FloppyDisk className="h-4 w-4" />}
                  Salvar
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {tab === 'relatorio' && (
        <Panel className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              type="button" size="sm"
              variant={periodMode === 'semana' ? 'default' : 'outline'}
              onClick={() => setPeriodMode('semana')}
            >
              Esta semana
            </Button>
            <Button
              type="button" size="sm"
              variant={periodMode === 'mes' ? 'default' : 'outline'}
              onClick={() => setPeriodMode('mes')}
            >
              Este mês
            </Button>
            <span className="text-xs font-mono text-muted-foreground">
              {fmtDia(reportRange.from)} – {fmtDia(reportRange.to)}
            </span>
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={exportCsv} disabled={!reportRows.length}>
              Exportar CSV
            </Button>
          </div>

          {loadingReport ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
            </div>
          ) : reportRows.length === 0 ? (
            <EmptyState
              title="Nenhum lançamento no período"
              description="Lance o dia na aba Lançar dia."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Pares</p>
                  <p className="font-mono text-2xl tabular-nums">{agg.pares}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Dias</p>
                  <p className="font-mono text-2xl tabular-nums">{agg.dias}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Bruto</p>
                  <p className="font-mono text-2xl tabular-nums">{formatCurrency(agg.bruto)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Méd / Dif</p>
                  <p className="font-mono text-lg tabular-nums">{agg.paresMedio} / {agg.paresDificil}</p>
                </div>
              </div>
              <ul className="divide-y divide-border">
                {reportRows.map((r) => {
                  const a = sumProducaoRows([r]);
                  return (
                    <li key={`${r.dia}-${r.setor}`} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{fmtDia(String(r.dia))} · {r.setor}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.paresMedio} méd · {a.paresDificil} dif
                          {r.pago_em ? ' · pago' : r.payroll_run_id ? ' · na folha' : ' · aberto'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono tabular-nums">{a.pares} pares</p>
                        <p className="font-mono text-sm text-muted-foreground">{formatCurrency(a.bruto)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
