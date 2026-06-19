/**
 * Calculadora de custo de MÃO DE OBRA por par, detalhada por SETOR e baseada
 * em TEMPO (minutos/par). Aba "MOD por Setor" do Markup (/pricing-calculator).
 *
 * Fórmula (src/lib/sectorPricing.ts é a fonte da verdade):
 *   custo/par do setor = (tempo_min / 60) × custo-hora
 *   MOD/par da referência = Σ (custo/par dos setores pelos quais ela passa)
 *
 * • O custo-hora DEFAULT de cada setor vem de sector_labor_rates (salário ÷ 220,
 *   sem encargos — configurado na aba "Mão de Obra"). Cada linha pode
 *   sobrescrever o custo-hora pra esta referência.
 * • O tempo/par pode ser digitado OU derivado da CAPACIDADE do setor
 *   (pares/dia ⇒ jornada de 8h ÷ capacidade).
 * • Pré-preenche a sequência canônica de setores do PCP numa referência nova.
 * • Salva por referência em reference_sector_pricing (snapshot do custo-hora).
 *
 * Diferente da aba "Mão de Obra" (labor_cost_results), que trabalha em HORAS e
 * sem capacidade — as duas convivem (retrocompat).
 */
import { useState, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Trash, Calculator, Clock, FloppyDisk, MagnifyingGlass, FolderOpen,
  ArrowClockwise, Gauge, Warning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { DISPLAY_SECTORS, SECTOR_LABELS, type SectorKey } from '@/lib/sectors';
import { normalizeForSearch, searchMatchesAny } from '@/lib/searchUtils';
import { useSectorLaborRates } from '@/hooks/useSectorLaborRates';
import { SALARY_HOUR_DIVISOR } from '@/lib/salaryPayroll';
import { parseBrlNumberNonNeg } from '@/lib/parseBrlNumber';
import {
  sectorCostPerPair, minutesPerPairFromCapacity, totalModPerPair, countActiveSectors,
  DEFAULT_HOURS_PER_DAY, type SectorPricingRow,
} from '@/lib/sectorPricing';
import {
  useReferenceSectorPricing, useSaveReferenceSectorPricing, useDeleteReferenceSectorPricing,
  type ReferenceSectorPricing, type ReferenceSectorPricingLine,
} from '@/hooks/useReferenceSectorPricing';

// Mesma lista canônica do PCP: fluxo de fábrica (DISPLAY_SECTORS) + Expedição.
const RATE_SECTORS: { key: SectorKey; label: string }[] = [
  ...DISPLAY_SECTORS,
  { key: 'expedicao' as SectorKey, label: SECTOR_LABELS.expedicao },
];

const parseNum = parseBrlNumberNonNeg;

function fmtBRL(v: number): string {
  return `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(v: number, max = 2): string {
  return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: max });
}

function sectorLabel(key: string): string {
  return SECTOR_LABELS[key as SectorKey] ?? key;
}

function resultSummary(r: ReferenceSectorPricing): string {
  return r.lines.map((l) => sectorLabel(l.sector_key)).join(', ');
}

interface Row {
  id: number;
  sectorKey: string;
  /** Minutos por par (digitado ou derivado da capacidade). */
  minPerPair: string;
  /** Override do custo-hora; vazio = usa o default do setor (salário ÷ 220). */
  costPerHour: string;
  /** Helper opcional: pares/dia → deriva minPerPair. Não é salvo. */
  capacityPerDay: string;
}

function canonicalRows(startId: number): Row[] {
  return RATE_SECTORS.map((s, i) => ({
    id: startId + i,
    sectorKey: s.key,
    minPerPair: '',
    costPerHour: '',
    capacityPerDay: '',
  }));
}

export default function SectorPricingCalculator() {
  const { data: rateMap = {} } = useSectorLaborRates();
  const { data: results = [] } = useReferenceSectorPricing();
  const save = useSaveReferenceSectorPricing();
  const del = useDeleteReferenceSectorPricing();

  const rowId = useRef(1000);
  const [reference, setReference] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() => canonicalRows(0));

  // ── Custo-hora efetivo (override da linha OU default do setor) ──
  const defaultHourly = (sectorKey: string) => rateMap[sectorKey]?.hourly_rate ?? 0;
  const effectiveHourly = (row: Row): number =>
    row.costPerHour.trim() !== '' ? parseNum(row.costPerHour) : defaultHourly(row.sectorKey);

  const toModel = (row: Row): SectorPricingRow => ({
    sectorKey: row.sectorKey,
    timePerPairMin: parseNum(row.minPerPair),
    costPerHour: effectiveHourly(row),
  });

  const rowCostBrl = (row: Row) => sectorCostPerPair(parseNum(row.minPerPair), effectiveHourly(row));

  const total = useMemo(() => totalModPerPair(rows.filter((r) => r.sectorKey).map(toModel)), [rows, rateMap]);
  const activeCount = useMemo(
    () => countActiveSectors(rows.filter((r) => r.sectorKey).map(toModel)),
    [rows, rateMap],
  );

  // ── Manipulação de linhas ──
  const addRow = () =>
    setRows((r) => [...r, { id: rowId.current++, sectorKey: '', minPerPair: '', costPerHour: '', capacityPerDay: '' }]);
  const removeRow = (id: number) => setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r));
  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // Editar capacidade deriva o tempo/par (jornada de 8h ÷ pares/dia).
  const onCapacityChange = (id: number, raw: string) => {
    const cap = parseNum(raw);
    const derived = cap > 0 ? minutesPerPairFromCapacity(cap) : 0;
    updateRow(id, {
      capacityPerDay: raw,
      minPerPair: cap > 0 ? fmtNum(derived, 3).replace('.', ',') : '',
    });
  };

  const restoreDefaults = () => {
    setRows(canonicalRows(rowId.current));
    rowId.current += RATE_SECTORS.length;
  };

  // ── Salvar / carregar / excluir ──
  const buildLines = (): ReferenceSectorPricingLine[] =>
    rows
      .filter((r) => r.sectorKey && parseNum(r.minPerPair) > 0)
      .map((r) => {
        const min = parseNum(r.minPerPair);
        const hour = effectiveHourly(r);
        return {
          sector_key: r.sectorKey,
          time_per_pair_min: min,
          cost_per_hour: hour,
          cost: sectorCostPerPair(min, hour),
        };
      });

  const onSave = () => {
    const ref = reference.trim();
    if (!ref) { toast.error('Preencha a referência antes de salvar'); return; }
    const lines = buildLines();
    if (lines.length === 0) { toast.error('Preencha o tempo de ao menos um setor'); return; }
    const totalSnapshot = lines.reduce((a, l) => a + l.cost, 0);

    let targetId = loadedId;
    if (!targetId) {
      const existing = results.find((r) => normalizeForSearch(r.reference) === normalizeForSearch(ref));
      if (existing) targetId = existing.id;
    }

    save.mutate(
      { id: targetId, reference: ref, lines, total: totalSnapshot },
      {
        onSuccess: (id) => { setLoadedId(id); toast.success(targetId ? 'MOD atualizada' : 'MOD salva'); },
        onError: () => toast.error('Erro ao salvar'),
      },
    );
  };

  const onLoad = (r: ReferenceSectorPricing) => {
    setReference(r.reference);
    setLoadedId(r.id);
    setRows(
      r.lines.length
        ? r.lines.map((l) => ({
            id: rowId.current++,
            sectorKey: l.sector_key,
            minPerPair: fmtNum(l.time_per_pair_min, 3).replace('.', ','),
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
    setRows(canonicalRows(rowId.current));
    rowId.current += RATE_SECTORS.length;
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
    () => results.filter((r) => searchMatchesAny(search, r.reference, ...r.lines.map((l) => sectorLabel(l.sector_key)))),
    [results, search],
  );

  const noSalaries = useMemo(() => RATE_SECTORS.every(({ key }) => defaultHourly(key) === 0), [rateMap]);

  return (
    <div className="space-y-4">
      {/* ── Aviso de configuração de salários ── */}
      {noSalaries && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs">
          <Warning className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-muted-foreground">
            Nenhum setor tem salário cadastrado, então o custo-hora default é R$ 0,00. Cadastre o salário
            mensal de cada setor na aba <strong>Mão de Obra → Salário por setor</strong> (custo-hora = salário ÷
            {' '}{SALARY_HOUR_DIVISOR}) ou informe o custo-hora linha a linha aqui.
          </p>
        </div>
      )}

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
                Tempo (min/par) por setor × custo-hora = custo de MO por par. Custo-hora default vem do salário
                do setor (÷ {SALARY_HOUR_DIVISOR}); edite por linha pra sobrescrever. O tempo pode ser derivado
                da capacidade (pares/dia em {DEFAULT_HOURS_PER_DAY}h).
              </CardDescription>
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
            <Button variant="outline" size="sm" onClick={restoreDefaults} className="h-8 gap-1.5">
              <ArrowClockwise className="h-3.5 w-3.5" /> Restaurar setores padrão
            </Button>
          </div>

          {/* Cabeçalho da tabela */}
          <div className="hidden md:grid grid-cols-[1fr_110px_120px_130px_120px_40px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Setor</span>
            <span className="text-right">Tempo (min/par)</span>
            <span className="text-right">Capacidade/dia</span>
            <span className="text-right">Custo-hora (R$)</span>
            <span className="text-right">Custo/par</span>
            <span />
          </div>

          {/* Linhas */}
          <div className="space-y-2">
            {rows.map((row) => {
              const hourly = effectiveHourly(row);
              const cost = rowCostBrl(row);
              const min = parseNum(row.minPerPair);
              const isOverride = row.costPerHour.trim() !== '';
              const rateMissing = !!row.sectorKey && min > 0 && hourly === 0;
              return (
                <div
                  key={row.id}
                  className="grid grid-cols-2 md:grid-cols-[1fr_110px_120px_130px_120px_40px] gap-2 items-center"
                >
                  <Select value={row.sectorKey} onValueChange={(v) => updateRow(row.id, { sectorKey: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecionar setor…" />
                    </SelectTrigger>
                    <SelectContent>
                      {RATE_SECTORS.map(({ key, label }) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Tempo (min/par) */}
                  <div className="flex items-center justify-end gap-1">
                    <Input
                      inputMode="decimal"
                      value={row.minPerPair}
                      onChange={(e) => updateRow(row.id, { minPerPair: e.target.value, capacityPerDay: '' })}
                      placeholder="0"
                      className="h-9 w-full text-right text-sm tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">min</span>
                  </div>

                  {/* Capacidade/dia (helper → deriva tempo) */}
                  <div className="flex items-center justify-end gap-1">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0 hidden md:block" />
                    <Input
                      inputMode="decimal"
                      value={row.capacityPerDay}
                      onChange={(e) => onCapacityChange(row.id, e.target.value)}
                      placeholder="—"
                      title="Pares/dia → deriva o tempo/par (jornada de 8h)"
                      className="h-9 w-full text-right text-sm tabular-nums"
                    />
                  </div>

                  {/* Custo-hora (override) */}
                  <div className="flex flex-col items-end">
                    <div className="flex items-center justify-end gap-1 w-full">
                      <span className="text-xs text-muted-foreground shrink-0">R$</span>
                      <Input
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

                  {/* Custo/par */}
                  <div className="text-right text-sm font-semibold tabular-nums">
                    {fmtBRL(cost)}
                    {rateMissing && <span className="block text-[10px] text-amber-600">sem custo-hora</span>}
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.id)}
                    aria-label="Remover linha"
                    disabled={rows.length <= 1}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          <Button variant="outline" size="sm" onClick={addRow} className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar setor
          </Button>

          {/* Total + ações + resumo */}
          <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary/70">
                MOD por par{reference ? ` · ${reference}` : ''}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {activeCount} {activeCount === 1 ? 'setor' : 'setores'} · soma do custo de mão de obra
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="display text-2xl tabular-nums text-primary">{fmtBRL(total)}</p>
              <div className="flex items-center gap-1.5">
                {loadedId && (
                  <Button variant="ghost" size="sm" onClick={onNew} className="h-9">Novo</Button>
                )}
                <Button size="sm" onClick={onSave} disabled={save.isPending} className="h-9 gap-1.5">
                  <FloppyDisk className="h-4 w-4" /> {loadedId ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Dica: depois de salvar, este valor pode ser puxado no <strong>Simulador</strong> (aba Manual) pelo
            campo <strong>Custo MO (R$/par)</strong> — entra na fórmula do preço junto com matéria-prima e overhead.
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
          <div className="relative max-w-sm">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar referência ou setor…"
              className="h-9 pl-8"
            />
          </div>

          {results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma referência salva ainda.</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma referência para “{search}”.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.reference}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {resultSummary(r) || 'sem setores'} · {new Date(r.updated_at).toLocaleDateString('pt-BR')}
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
