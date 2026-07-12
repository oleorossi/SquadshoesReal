/**
 * Calculadora de custo de MÃO DE OBRA por par, detalhada por SETOR e baseada
 * em PRODUTIVIDADE (pares por hora). É a aba "Mão de Obra" do Markup
 * (/pricing-calculator). Cálculo ISOLADO — não toca no preço do Markup.
 *
 * Unificação 2026-06-20: antes havia DUAS abas que faziam a MESMA conta — esta
 * (pares/hora) e a antiga "Mão de Obra" (horas/par, labor_cost_results). Como
 * `custo/par = custo-hora × horas = custo-hora ÷ (pares/hora)` (horas = 1/pares-hora),
 * eram redundantes. Mantivemos o modelo pares/hora (mais completo: override por
 * linha, capacidade→pares/hora, projeção de diária) e EMBUTIMOS aqui o cadastro
 * de salário por setor (sector_labor_rates) que antes vivia na outra aba.
 *
 * Fórmula (src/lib/sectorPricing.ts é a fonte da verdade):
 *   custo/par do setor = custo-hora / pares_por_hora
 *   MOD/par da referência = Σ (custo/par dos setores pelos quais ela passa)
 *
 * Pares/hora (em vez de min/par) porque a amostragem é maior → mais previsível.
 *
 * • O custo-hora DEFAULT de cada setor vem de sector_labor_rates (salário ÷ 220,
 *   sem encargos — configurado na aba "Mão de Obra"). Cada linha pode
 *   sobrescrever o custo-hora pra esta referência.
 * • Os pares/hora podem ser digitados OU derivados da CAPACIDADE do setor
 *   (pares/dia ÷ jornada de 8h).
 * • Pré-preenche a sequência canônica de setores do PCP numa referência nova.
 * • Colunas DERIVADAS (só visuais): Pares/dia = pares/hora × jornada; Diária =
 *   custo-hora × jornada (+ "Diária total" no rodapé). Servem pra avaliar
 *   rendimento de prestador diarista — NÃO entram na fórmula do custo/par.
 * • Salva por referência em reference_sector_pricing (snapshot do custo-hora);
 *   linhas antigas em min/par são convertidas na leitura (60 / min).
 *
 * Diferente da aba "Mão de Obra" (labor_cost_results), que trabalha em HORAS —
 * as duas convivem (retrocompat).
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Trash, Calculator, Clock, FloppyDisk, MagnifyingGlass, FolderOpen,
  ArrowClockwise, Gauge, Warning, Info, CaretDown,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from 'sonner';
import { DISPLAY_SECTORS, SECTOR_LABELS, type SectorKey } from '@/lib/sectors';
import { normalizeForSearch, searchMatchesAllTerms } from '@/lib/searchUtils';
import { useSectorLaborRates, useUpsertSectorLaborRate, hourlyFromSalary } from '@/hooks/useSectorLaborRates';
import { SALARY_HOUR_DIVISOR } from '@/lib/salaryPayroll';
import { parseBrlNumberNonNeg } from '@/lib/parseBrlNumber';
import {
  sectorCostPerPair, pairsPerHourFromCapacity, totalModPerPair, countActiveSectors,
  pairsPerDay, dailyRate, totalDailyRate, adjustForEfficiency,
  DEFAULT_HOURS_PER_DAY, DEFAULT_EFFICIENCY_PCT, type SectorPricingRow,
} from '@/lib/sectorPricing';
import {
  useReferenceSectorPricing, useSaveReferenceSectorPricing, useDeleteReferenceSectorPricing,
  type ReferenceSectorPricing, type ReferenceSectorPricingLine,
} from '@/hooks/useReferenceSectorPricing';

// Setor EXCLUSIVO do cálculo de Mão de Obra (não é setor canônico de produção:
// NÃO entra em sectors.ts/DISPLAY_SECTORS, então não mexe em PCP/fichas/ondas).
// Pedido do dono 2026-06-20: custear a "Costura de Palmilha" à parte da "Costura".
const COSTURA_PALMILHA = { key: 'costura_palmilha', label: 'Costura de Palmilha' };
// Setor REAL das fichas de operador (GroupedSector) que NÃO é canônico em
// sectors.ts/DISPLAY_SECTORS — entra só aqui no custeio de MO, sem mexer em
// PCP/ondas/fichas. Pedido do dono 2026-06-23: custear "Corte Cabedal" à parte.
const CORTE_CABEDAL = { key: 'corte_cabedal', label: 'Corte Cabedal' };

// Lista canônica do PCP (DISPLAY_SECTORS) + "Corte Cabedal" (logo após Corte
// Forração, agrupando os três cortes) + "Costura de Palmilha" (logo após a
// Costura) + Expedição. Chave string-livre — sector_labor_rates é por texto.
const RATE_SECTORS: { key: string; label: string }[] = [
  ...DISPLAY_SECTORS.flatMap((s) => {
    if (s.key === 'corte_forracao') return [s, CORTE_CABEDAL];
    if (s.key === 'costura') return [s, COSTURA_PALMILHA];
    return [s];
  }),
  { key: 'expedicao', label: SECTOR_LABELS.expedicao },
];

// Setores FIXOS do Markup (custo por capacidade/dia) — sempre pré-carregados,
// nesta ordem (pedido do dono 2026-06-30). Os demais setores continuam
// disponíveis via "Adicionar setor". O dropdown segue oferecendo RATE_SECTORS
// inteiro; só o conjunto PADRÃO (estado inicial + "Restaurar setores padrão")
// passa a ser esses 6.
const MARKUP_FIXED_SECTORS: { key: string; label: string }[] = [
  { key: 'corte_palmilha', label: SECTOR_LABELS.corte_palmilha },
  { key: 'corte_forracao', label: SECTOR_LABELS.corte_forracao },
  { key: COSTURA_PALMILHA.key, label: COSTURA_PALMILHA.label },
  { key: 'silk', label: SECTOR_LABELS.silk },
  { key: 'solagem', label: SECTOR_LABELS.solagem },
  { key: 'acabamento', label: SECTOR_LABELS.acabamento },
];

// Jornada-padrão da fábrica (horas/dia). Ajuste aqui se mudar — usada pra
// derivar pares/hora da capacidade, pares/dia e a diária equivalente.
const JORNADA_HORAS = DEFAULT_HOURS_PER_DAY; // 8h

const parseNum = parseBrlNumberNonNeg;

function fmtBRL(v: number): string {
  return `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(v: number, max = 2): string {
  return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: max });
}

function sectorLabel(key: string): string {
  if (key === COSTURA_PALMILHA.key) return COSTURA_PALMILHA.label;
  if (key === CORTE_CABEDAL.key) return CORTE_CABEDAL.label;
  return SECTOR_LABELS[key as SectorKey] ?? key;
}

function resultSummary(r: ReferenceSectorPricing): string {
  return r.lines.map((l) => sectorLabel(l.sector_key)).join(', ');
}

interface Row {
  id: number;
  sectorKey: string;
  /** Pares por hora (digitado ou derivado da capacidade). */
  pairsPerHour: string;
  /** Override do custo-hora; vazio = usa o default do setor (salário ÷ 220). */
  costPerHour: string;
  /** Helper opcional: pares/dia → deriva pares/hora. Não é salvo. */
  capacityPerDay: string;
}

function canonicalRows(startId: number): Row[] {
  return MARKUP_FIXED_SECTORS.map((s, i) => ({
    id: startId + i,
    sectorKey: s.key,
    pairsPerHour: '',
    costPerHour: '',
    capacityPerDay: '',
  }));
}

export default function SectorPricingCalculator() {
  const { data: rateMap = {} } = useSectorLaborRates();
  const upsert = useUpsertSectorLaborRate();
  const { data: results = [] } = useReferenceSectorPricing();
  const save = useSaveReferenceSectorPricing();
  const del = useDeleteReferenceSectorPricing();

  // ── Cadastro de SALÁRIO por setor (sector_labor_rates) — embutido aqui depois
  // que as abas "Mão de Obra" (horas/par) e "MOD por Setor" foram unificadas:
  // faziam a MESMA conta, só mudando a unidade de entrada. Custo-hora = salário ÷ 220.
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Semeia os salários salvos (sector_labor_rates) nos campos.
  // ⚠ NÃO guardar por `=== undefined`: no 1º render o rateMap ainda está vazio
  // (query carregando), o efeito setava '' em TODOS os campos, e aí a condição
  // `undefined` nunca mais disparava → os valores salvos NUNCA apareciam (form
  // ficava 0,00 mesmo com salário no banco). Semeia sempre que o campo está
  // vazio e o banco tem valor; não sobrescreve o que o usuário está digitando.
  useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const { key } of RATE_SECTORS) {
        const dbVal = rateMap[key]?.monthly_salary;
        if ((next[key] === undefined || next[key] === '') && dbVal) next[key] = String(dbVal);
      }
      return next;
    });
  }, [rateMap]);
  const saveRate = (key: string) => {
    const v = parseNum(draft[key]);
    if (v === (rateMap[key]?.monthly_salary ?? 0)) return; // nada mudou
    upsert.mutate(
      { sectorKey: key, monthlySalary: v },
      {
        onSuccess: () => toast.success(`Salário de ${sectorLabel(key)} salvo`),
        onError: (e) => toast.error(`Não consegui salvar ${sectorLabel(key)}: ${(e as Error).message}`),
      },
    );
  };

  const rowId = useRef(1000);
  const [reference, setReference] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() => canonicalRows(0));
  // Eficiência produtiva (%): horas pagas / capacidade teórica não viram 100% de
  // pares (absenteísmo, setup, paradas, refugo). É o ÚNICO carregamento sobre a MO
  // (operadores MEI ⇒ sem encargos). Default 100% = neutro; o dono baixa por referência.
  const [efficiency, setEfficiency] = useState(String(DEFAULT_EFFICIENCY_PCT));
  const efficiencyPct = parseNum(efficiency);

  // UI: a explicação detalhada do cálculo fica recolhida por padrão (alivia a
  // parede de texto na 1ª dobra; o essencial continua sempre visível).
  const [showHow, setShowHow] = useState(false);

  // ── Custo-hora efetivo (override da linha OU default do setor) ──
  const defaultHourly = (sectorKey: string) => rateMap[sectorKey]?.hourly_rate ?? 0;
  const effectiveHourly = (row: Row): number =>
    row.costPerHour.trim() !== '' ? parseNum(row.costPerHour) : defaultHourly(row.sectorKey);

  const toModel = (row: Row): SectorPricingRow => ({
    sectorKey: row.sectorKey,
    pairsPerHour: parseNum(row.pairsPerHour),
    costPerHour: effectiveHourly(row),
  });

  const rowCostBrl = (row: Row) => sectorCostPerPair(parseNum(row.pairsPerHour), effectiveHourly(row));

  // Valores derivados de UMA linha — usado nas DUAS renderizações (tabela densa
  // no desktop + card rotulado no mobile), pra não duplicar a conta.
  const computeRow = (row: Row) => {
    const hourly = effectiveHourly(row);
    const pph = parseNum(row.pairsPerHour);
    return {
      hourly,
      pph,
      // custo/par já ajustado pela eficiência (a soma das linhas dá o total ajustado).
      cost: adjustForEfficiency(rowCostBrl(row), efficiencyPct),
      ppd: pairsPerDay(pph, JORNADA_HORAS),       // derivado: pares/dia
      dailyBrl: dailyRate(hourly, JORNADA_HORAS), // derivado: diária equivalente
      isOverride: row.costPerHour.trim() !== '',
      capacityMissing: !!row.sectorKey && pph <= 0,
      rateMissing: !!row.sectorKey && pph > 0 && hourly === 0,
    };
  };

  // Select de setor — idêntico nas duas renderizações.
  const renderSectorSelect = (row: Row) => (
    <Select value={row.sectorKey} onValueChange={(v) => updateRow(row.id, { sectorKey: v })}>
      <SelectTrigger className="h-9 text-sm" aria-label="Setor">
        <SelectValue placeholder="Selecionar setor…" />
      </SelectTrigger>
      <SelectContent>
        {RATE_SECTORS.map(({ key, label }) => (
          <SelectItem key={key} value={key}>{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const total = useMemo(() => totalModPerPair(rows.filter((r) => r.sectorKey).map(toModel)), [rows, rateMap]);
  // Total AJUSTADO pela eficiência = o custo de MO real por par (bruto ÷ η).
  const totalAdjusted = useMemo(() => adjustForEfficiency(total, efficiencyPct), [total, efficiencyPct]);
  const activeCount = useMemo(
    () => countActiveSectors(rows.filter((r) => r.sectorKey).map(toModel)),
    [rows, rateMap],
  );
  // Diária total/dia (soma das diárias dos setores com capacidade > 0) — projeção
  // pra comparar com prestador diarista. hasCapacity decide se a linha aparece.
  const totalDaily = useMemo(
    () => totalDailyRate(rows.filter((r) => r.sectorKey).map(toModel), JORNADA_HORAS),
    [rows, rateMap],
  );
  const hasCapacity = useMemo(
    () => rows.some((r) => r.sectorKey && parseNum(r.pairsPerHour) > 0),
    [rows],
  );

  // ── Manipulação de linhas ──
  const addRow = () =>
    setRows((r) => [...r, { id: rowId.current++, sectorKey: '', pairsPerHour: '', costPerHour: '', capacityPerDay: '' }]);
  const removeRow = (id: number) => setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r));
  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // Editar capacidade deriva os pares/hora (pares/dia ÷ jornada).
  const onCapacityChange = (id: number, raw: string) => {
    const cap = parseNum(raw);
    const derived = cap > 0 ? pairsPerHourFromCapacity(cap, JORNADA_HORAS) : 0;
    updateRow(id, {
      capacityPerDay: raw,
      pairsPerHour: cap > 0 ? fmtNum(derived, 3).replace('.', ',') : '',
    });
  };

  const restoreDefaults = () => {
    setRows(canonicalRows(rowId.current));
    rowId.current += MARKUP_FIXED_SECTORS.length;
  };

  // ── Salvar / carregar / excluir ──
  const buildLines = (): ReferenceSectorPricingLine[] =>
    rows
      .filter((r) => r.sectorKey && parseNum(r.pairsPerHour) > 0)
      .map((r) => {
        const pph = parseNum(r.pairsPerHour);
        const hour = effectiveHourly(r);
        return {
          sector_key: r.sectorKey,
          pairs_per_hour: pph,
          cost_per_hour: hour,
          cost: sectorCostPerPair(pph, hour),
        };
      });

  const onSave = () => {
    const ref = reference.trim();
    if (!ref) { toast.error('Preencha a referência antes de salvar'); return; }
    const lines = buildLines();
    if (lines.length === 0) { toast.error('Preencha os pares por hora de ao menos um setor'); return; }
    // line.cost é o BRUTO por setor (custo-hora ÷ pares/hora); o total salvo já é
    // AJUSTADO pela eficiência, e guardamos o % pra reconstruir na leitura.
    const grossSnapshot = lines.reduce((a, l) => a + l.cost, 0);
    const effToSave = efficiencyPct > 0 && efficiencyPct <= 100 ? efficiencyPct : 100;
    const totalSnapshot = adjustForEfficiency(grossSnapshot, effToSave);

    let targetId = loadedId;
    if (!targetId) {
      const existing = results.find((r) => normalizeForSearch(r.reference) === normalizeForSearch(ref));
      if (existing) targetId = existing.id;
    }

    save.mutate(
      { id: targetId, reference: ref, lines, total: totalSnapshot, efficiencyPct: effToSave },
      {
        onSuccess: (id) => { setLoadedId(id); toast.success(targetId ? 'MOD atualizada' : 'MOD salva'); },
        onError: () => toast.error('Erro ao salvar'),
      },
    );
  };

  const onLoad = (r: ReferenceSectorPricing) => {
    setReference(r.reference);
    setLoadedId(r.id);
    setEfficiency(String(r.efficiency_pct ?? 100));
    setRows(
      r.lines.length
        ? r.lines.map((l) => ({
            id: rowId.current++,
            sectorKey: l.sector_key,
            pairsPerHour: fmtNum(l.pairs_per_hour, 3).replace('.', ','),
            // Mostra como override só se diferir do default atual do setor.
            costPerHour:
              Math.abs((l.cost_per_hour ?? 0) - (rateMap[l.sector_key]?.hourly_rate ?? 0)) < 0.005
                ? ''
                : fmtNum(l.cost_per_hour, 4).replace('.', ','),
            capacityPerDay: '',
          }))
        : canonicalRows(rowId.current),
    );
    toast.success(`"${r.reference}" carregada`);
  };

  const onNew = () => {
    setReference('');
    setLoadedId(null);
    setEfficiency(String(DEFAULT_EFFICIENCY_PCT));
    setRows(canonicalRows(rowId.current));
    rowId.current += MARKUP_FIXED_SECTORS.length;
  };

  const onDelete = (r: ReferenceSectorPricing) => {
    del.mutate(r.id, {
      onSuccess: () => { if (loadedId === r.id) setLoadedId(null); toast.success('MOD excluída'); },
      onError: () => toast.error('Erro ao excluir'),
    });
  };

  // ── Busca nos salvos ──
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () => results.filter((r) => searchMatchesAllTerms(search, r.reference, ...r.lines.map((l) => sectorLabel(l.sector_key)))),
    [results, search],
  );

  const noSalaries = useMemo(() => RATE_SECTORS.every(({ key }) => defaultHourly(key) === 0), [rateMap]);
  // Quantos setores já têm salário (lê o draft → reflete edição ao vivo). Usado no
  // contador "X/13 cadastrados" do cabeçalho, pra escanear o que falta de relance.
  const configuredRates = useMemo(
    () => RATE_SECTORS.filter(({ key }) => hourlyFromSalary(parseNum(draft[key])) > 0).length,
    [draft],
  );

  return (
    <div className="space-y-4">
      {/* ── Config: salário por setor (custo-hora default) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Salário por setor
            <span
              className={cn(
                'ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
                configuredRates === RATE_SECTORS.length
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {configuredRates}/{RATE_SECTORS.length} cadastrados
            </span>
          </CardTitle>
          <CardDescription>
            Cadastre o <strong>salário mensal</strong> de cada setor. O custo da hora é derivado
            automaticamente = salário ÷ {SALARY_HOUR_DIVISOR} (mesma base da folha), <strong>sem encargos</strong>.
            É o custo-hora default usado no cálculo abaixo (dá pra sobrescrever por linha).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {noSalaries && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
              <Warning className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                Nenhum setor tem salário cadastrado ainda — preencha abaixo, ou informe o custo-hora
                linha a linha no cálculo.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {RATE_SECTORS.map(({ key, label }) => {
              const hourly = hourlyFromSalary(parseNum(draft[key]));
              const configured = hourly > 0;
              return (
                <div
                  key={key}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl border px-3 py-2.5 transition-colors',
                    configured ? 'border-border/60 bg-muted/20' : 'border-dashed border-border bg-transparent',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`rate-${key}`} className="text-xs font-semibold truncate">{label}</Label>
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full shrink-0',
                        configured ? 'bg-primary' : 'bg-muted-foreground/30',
                      )}
                      aria-hidden
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">R$</span>
                    <Input
                      id={`rate-${key}`}
                      inputMode="decimal"
                      className="h-8 flex-1 text-right text-sm tabular-nums"
                      value={draft[key] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      onBlur={() => saveRate(key)}
                      placeholder="0,00"
                    />
                    <span className="text-xs text-muted-foreground">/mês</span>
                  </div>
                  <p className="flex items-center justify-between text-[11px] tabular-nums">
                    <span className="text-muted-foreground">custo-hora</span>
                    {configured ? (
                      <span className="font-semibold text-foreground">{fmtBRL(hourly)}/h</span>
                    ) : (
                      <span className="text-muted-foreground/60">não cadastrado</span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Cálculo por referência ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4 text-muted-foreground" />
                Custo de mão de obra por setor
              </CardTitle>
              <CardDescription>
                Custo-hora ÷ pares por hora = custo de MO por par, somado pelos setores da referência.
              </CardDescription>
              <button
                type="button"
                onClick={() => setShowHow((v) => !v)}
                aria-expanded={showHow}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                <Info className="h-3.5 w-3.5" />
                Como funciona o cálculo
                <CaretDown className={cn('h-3 w-3 transition-transform', showHow && 'rotate-180')} />
              </button>
              {showHow && (
                <div className="mt-2 space-y-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  <p>
                    O <strong>custo-hora default</strong> vem do salário do setor (÷ {SALARY_HOUR_DIVISOR});
                    edite por linha pra sobrescrever. Os <strong>pares/hora</strong> podem ser derivados da
                    capacidade (pares/dia ÷ {JORNADA_HORAS}h).
                  </p>
                  <p>
                    O custo bruto é dividido pela <strong>eficiência produtiva</strong> — horas pagas /
                    capacidade teórica não viram 100% de pares (absenteísmo, setup, paradas, refugo).
                  </p>
                  <p>
                    <strong>Pares/dia</strong> e <strong>Diária (R$)</strong> são projeções pra jornada de{' '}
                    {JORNADA_HORAS}h — pra avaliar rendimento de prestador diarista. Não entram na fórmula
                    do custo/par.
                  </p>
                </div>
              )}
            </div>
            {loadedId && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                Editando salvo
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="max-w-sm space-y-1.5 flex-1 min-w-[200px]">
              <Label htmlFor="sp-ref" className="text-xs font-medium">Referência</Label>
              <Input
                id="sp-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ex.: STX / Sandália Tâmara"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-eff" className="text-xs font-medium flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5 text-muted-foreground" /> Eficiência produtiva
              </Label>
              <div className="flex items-center gap-1">
                <Input
                  id="sp-eff"
                  inputMode="decimal"
                  value={efficiency}
                  onChange={(e) => setEfficiency(e.target.value)}
                  placeholder={String(DEFAULT_EFFICIENCY_PCT)}
                  title="Horas pagas / capacidade teórica que viram pares. 100% = sem ajuste (ex.: pares/hora já medidos no chão de fábrica)."
                  className="h-9 w-20 text-right text-sm tabular-nums"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={restoreDefaults} className="h-9 gap-1.5">
              <ArrowClockwise className="h-3.5 w-3.5" /> Restaurar setores padrão
            </Button>
          </div>

          {/* ── Tabela densa (desktop ≥ md) ── */}
          <div className="hidden md:block space-y-2">
            <div className="grid grid-cols-[1fr_92px_100px_84px_120px_96px_96px_36px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Setor</span>
              <span className="text-right">Pares por hora</span>
              <span className="text-right">Capacidade/dia</span>
              <span className="text-right">Pares/dia</span>
              <span className="text-right">Custo-hora (R$)</span>
              <span className="text-right">Diária (R$)</span>
              <span className="text-right">Custo/par</span>
              <span />
            </div>
            {rows.map((row) => {
              const { pph, cost, ppd, dailyBrl, isOverride, capacityMissing, rateMissing } = computeRow(row);
              const sLabel = sectorLabel(row.sectorKey) || 'setor';
              return (
                <div
                  key={row.id}
                  className="grid grid-cols-[1fr_92px_100px_84px_120px_96px_96px_36px] gap-2 items-center"
                >
                  {renderSectorSelect(row)}

                  {/* Pares por hora */}
                  <div className="flex items-center justify-end gap-1">
                    <Input
                      aria-label={`Pares por hora — ${sLabel}`}
                      inputMode="decimal"
                      value={row.pairsPerHour}
                      onChange={(e) => updateRow(row.id, { pairsPerHour: e.target.value, capacityPerDay: '' })}
                      placeholder="0"
                      className="h-9 w-full text-right text-sm tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">p/h</span>
                  </div>

                  {/* Capacidade/dia (helper → deriva pares/hora) */}
                  <div className="flex items-center justify-end gap-1">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Input
                      aria-label={`Capacidade por dia — ${sLabel}`}
                      inputMode="decimal"
                      value={row.capacityPerDay}
                      onChange={(e) => onCapacityChange(row.id, e.target.value)}
                      placeholder="—"
                      title={`Pares/dia → deriva os pares/hora (÷ ${JORNADA_HORAS}h)`}
                      className="h-9 w-full text-right text-sm tabular-nums"
                    />
                  </div>

                  {/* Pares/dia (derivado = pares/hora × jornada) */}
                  <div className="text-right text-sm tabular-nums text-muted-foreground" title={`pares/hora × ${JORNADA_HORAS}h`}>
                    {pph > 0 ? fmtNum(ppd, 1) : '—'}
                  </div>

                  {/* Custo-hora (override) */}
                  <div className="flex flex-col items-end">
                    <div className="flex items-center justify-end gap-1 w-full">
                      <span className="text-xs text-muted-foreground shrink-0">R$</span>
                      <Input
                        aria-label={`Custo-hora — ${sLabel}`}
                        inputMode="decimal"
                        value={row.costPerHour}
                        onChange={(e) => updateRow(row.id, { costPerHour: e.target.value })}
                        placeholder={row.sectorKey ? fmtNum(defaultHourly(row.sectorKey), 2) : '0,00'}
                        className="h-9 w-full text-right text-sm tabular-nums"
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {isOverride ? 'override' : 'salário ÷ ' + SALARY_HOUR_DIVISOR}
                    </span>
                  </div>

                  {/* Diária equivalente (derivado = custo-hora × jornada) */}
                  <div className="text-right text-sm tabular-nums text-muted-foreground" title={`custo-hora × ${JORNADA_HORAS}h`}>
                    {fmtBRL(dailyBrl)}
                  </div>

                  {/* Custo/par */}
                  <div className="text-right text-sm font-semibold tabular-nums">
                    {fmtBRL(cost)}
                    {capacityMissing && <span className="block text-[10px] text-amber-600">sem capacidade</span>}
                    {rateMissing && <span className="block text-[10px] text-amber-600">sem custo-hora</span>}
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.id)}
                    aria-label={`Remover ${sLabel}`}
                    disabled={rows.length <= 1}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          {/* ── Cards rotulados (mobile < md) — toda linha vira um card com rótulos
              próprios, pra caber em 360px sem espremer 7 campos sem legenda. ── */}
          <div className="space-y-3 md:hidden">
            {rows.map((row) => {
              const { pph, cost, ppd, dailyBrl, isOverride, capacityMissing, rateMissing } = computeRow(row);
              return (
                <div key={row.id} className="space-y-3 rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">{renderSectorSelect(row)}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(row.id)}
                      aria-label="Remover linha"
                      disabled={rows.length <= 1}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground">Pares por hora</span>
                      <div className="flex items-center gap-1">
                        <Input
                          aria-label="Pares por hora"
                          inputMode="decimal"
                          value={row.pairsPerHour}
                          onChange={(e) => updateRow(row.id, { pairsPerHour: e.target.value, capacityPerDay: '' })}
                          placeholder="0"
                          className="h-9 text-right text-sm tabular-nums"
                        />
                        <span className="text-xs text-muted-foreground">p/h</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground">Capacidade/dia</span>
                      <Input
                        aria-label="Capacidade por dia"
                        inputMode="decimal"
                        value={row.capacityPerDay}
                        onChange={(e) => onCapacityChange(row.id, e.target.value)}
                        placeholder="—"
                        className="h-9 w-full text-right text-sm tabular-nums"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Custo-hora {isOverride ? '(override)' : `(salário ÷ ${SALARY_HOUR_DIVISOR})`}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">R$</span>
                        <Input
                          aria-label="Custo-hora"
                          inputMode="decimal"
                          value={row.costPerHour}
                          onChange={(e) => updateRow(row.id, { costPerHour: e.target.value })}
                          placeholder={row.sectorKey ? fmtNum(defaultHourly(row.sectorKey), 2) : '0,00'}
                          className="h-9 flex-1 text-right text-sm tabular-nums"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Derivados + custo/par */}
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">
                      Pares/dia <strong className="text-foreground tabular-nums">{pph > 0 ? fmtNum(ppd, 1) : '—'}</strong>
                    </span>
                    <span className="text-muted-foreground">
                      Diária <strong className="text-foreground tabular-nums">{fmtBRL(dailyBrl)}</strong>
                    </span>
                    <span className="font-semibold tabular-nums">Custo/par {fmtBRL(cost)}</span>
                  </div>

                  {capacityMissing && (
                    <p className="text-[11px] text-amber-600">Informe os pares por hora (ou a capacidade/dia).</p>
                  )}
                  {rateMissing && (
                    <p className="text-[11px] text-amber-600">Setor sem custo-hora — cadastre o salário ou informe por linha.</p>
                  )}
                </div>
              );
            })}
          </div>

          <Button variant="outline" size="sm" onClick={addRow} className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar setor
          </Button>

          {/* Total + ações + resumo */}
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-primary/70">
                  MOD por par{reference ? ` · ${reference}` : ''}
                </p>
                <p className="mt-1 display text-3xl leading-none tabular-nums text-primary">{fmtBRL(totalAdjusted)}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {activeCount} {activeCount === 1 ? 'setor ativo' : 'setores ativos'} · bruto {fmtBRL(total)}
                  {efficiencyPct > 0 && efficiencyPct < 100 ? ` ÷ ${fmtNum(efficiencyPct, 1)}% eficiência` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {loadedId && (
                  <Button variant="ghost" size="sm" onClick={onNew} className="h-9">Novo</Button>
                )}
                <Button size="sm" onClick={onSave} disabled={save.isPending} className="h-9 gap-1.5">
                  <FloppyDisk className="h-4 w-4" /> {loadedId ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </div>

            {/* Diária total — projeção pra comparar com prestador diarista */}
            {hasCapacity && (
              <div className="flex items-center justify-between gap-3 border-t border-primary/15 pt-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary/70">Diária total</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    soma das diárias dos setores ativos · jornada {JORNADA_HORAS}h/dia
                  </p>
                </div>
                <p className="display text-xl tabular-nums text-primary">
                  {fmtBRL(totalDaily)}<span className="text-xs font-normal text-muted-foreground"> /dia</span>
                </p>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Cálculo isolado de mão de obra — <strong>não altera o preço do Markup</strong> nem soma com material/overhead.
            Serve só pra estimar o custo de MO por par; o que você cadastra aqui fica nesta calculadora.
          </p>
        </CardContent>
      </Card>

      {/* ── Resultados salvos ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            Referências salvas
            {results.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{results.length}</span>
            )}
          </CardTitle>
          <CardDescription>Busque por referência ou setor e carregue de volta pra editar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por referência ou setor…"
            resultCount={filtered.length}
            totalCount={results.length}
            className="max-w-sm"
            inputClassName="h-9"
          />

          {results.length === 0 ? (
            <EmptyState
              size="sm"
              icon={FolderOpen}
              title="Nenhuma referência salva"
              description="Calcule a MOD de uma referência acima e clique em Salvar pra reutilizar depois."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              size="sm"
              icon={MagnifyingGlass}
              title={`Nenhum resultado para "${search}"`}
              action={
                <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.reference}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {resultSummary(r) || 'sem setores'}
                      {r.efficiency_pct > 0 && r.efficiency_pct < 100 ? ` · ${fmtNum(r.efficiency_pct, 1)}% efic.` : ''}
                      {' · '}{new Date(r.updated_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold tabular-nums">{fmtBRL(r.total_cost)}</span>
                    <Button variant="outline" size="sm" className="h-8" onClick={() => onLoad(r)}>Carregar</Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(r)}
                      aria-label={`Excluir ${r.reference}`}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
