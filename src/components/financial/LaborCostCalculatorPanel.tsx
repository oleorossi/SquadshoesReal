/**
 * Calculadora MANUAL de custo de mão de obra por referência.
 *
 * Fórmula (padrão calçadista, base salário, SEM encargos):
 *   custo-hora do setor = SALÁRIO do setor ÷ 220   (mesma base da folha)
 *   custo de MO da ref. = Σ (custo-hora × tempo em horas)
 *
 * Fluxo: cadastra o SALÁRIO MENSAL de cada setor (tabela sector_labor_rates) →
 * a aba deriva o custo-hora (salário ÷ 220) → preenche a referência → escolhe o
 * setor por linha → preenche o tempo em HORAS → custo = custo-hora × horas. Soma
 * = custo de MO/par. Pode SALVAR, BUSCAR e CARREGAR salvos.
 *
 * O resultado salvo guarda um SNAPSHOT (salário + custo-hora + custo) de cada
 * linha (labor_cost_results) — o total salvo não muda se o salário do setor
 * mudar depois. Independente do custeio por operação (labor_costs/BOM) e da folha.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash, Calculator, Clock, FloppyDisk, MagnifyingGlass, FolderOpen } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { DISPLAY_SECTORS, SECTOR_LABELS, type SectorKey } from '@/lib/sectors';
import { normalizeForSearch, searchMatchesAny } from '@/lib/searchUtils';
import { useSectorLaborRates, useUpsertSectorLaborRate, hourlyFromSalary } from '@/hooks/useSectorLaborRates';
import { SALARY_HOUR_DIVISOR } from '@/lib/salaryPayroll';
import { parseBrlNumberNonNeg } from '@/lib/parseBrlNumber';
import {
  useLaborCostResults, useSaveLaborCostResult, useDeleteLaborCostResult,
  type LaborCostResult, type LaborCostResultLine,
} from '@/hooks/useLaborCostResults';

// Setores que recebem valor-hora: o fluxo de fábrica (DISPLAY_SECTORS) + Expedição.
const RATE_SECTORS: { key: SectorKey; label: string }[] = [
  ...DISPLAY_SECTORS,
  { key: 'expedicao' as SectorKey, label: SECTOR_LABELS.expedicao },
];

function fmtBRL(v: number): string {
  return `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Número no formato pt-BR (trata milhar "2.500,00" → 2500), nunca negativo.
 *  Bug corrigido na auditoria 2026-06-14: o replace(',','.') anterior corrompia
 *  salário com separador de milhar (2.500,00 → 2,5). Ver parseBrlNumber. */
const parseNum = parseBrlNumberNonNeg;

function sectorLabel(key: string): string {
  return SECTOR_LABELS[key as SectorKey] ?? key;
}

function resultSummary(r: LaborCostResult): string {
  return r.lines.map((l) => sectorLabel(l.sector_key)).join(', ');
}

interface Row { id: number; sectorKey: string; hours: string; }

export default function LaborCostCalculatorPanel() {
  const { data: rateMap = {} } = useSectorLaborRates();
  const upsert = useUpsertSectorLaborRate();
  const { data: results = [] } = useLaborCostResults();
  const save = useSaveLaborCostResult();
  const del = useDeleteLaborCostResult();

  // Draft editável do SALÁRIO por setor (sincroniza do banco sem sobrescrever
  // edição em andamento — só preenche chaves ainda não tocadas).
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const { key } of RATE_SECTORS) {
        if (next[key] === undefined) next[key] = rateMap[key]?.monthly_salary ? String(rateMap[key]!.monthly_salary) : '';
      }
      return next;
    });
  }, [rateMap]);

  const saveRate = (key: string) => {
    const v = parseNum(draft[key]);
    if (v !== (rateMap[key]?.monthly_salary ?? 0)) upsert.mutate({ sectorKey: key, monthlySalary: v });
  };

  // ── Cálculo ──
  const rowId = useRef(1);
  const [reference, setReference] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([{ id: 0, sectorKey: '', hours: '' }]);

  const addRow = () => setRows((r) => [...r, { id: rowId.current++, sectorKey: '', hours: '' }]);
  const removeRow = (id: number) => setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r));
  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const rowCost = (row: Row) => (rateMap[row.sectorKey]?.hourly_rate ?? 0) * parseNum(row.hours);
  const total = useMemo(() => rows.reduce((acc, r) => acc + rowCost(r), 0), [rows, rateMap]);

  // ── Salvar / carregar / excluir ──
  const buildLines = (): LaborCostResultLine[] =>
    rows
      .filter((r) => r.sectorKey)
      .map((r) => {
        const sr = rateMap[r.sectorKey];
        const rate = sr?.hourly_rate ?? 0;
        const salary = sr?.monthly_salary ?? 0;
        const hours = parseNum(r.hours);
        return { sector_key: r.sectorKey, hours, hourly_rate: rate, monthly_salary: salary, cost: rate * hours };
      });

  const onSave = () => {
    const ref = reference.trim();
    if (!ref) { toast.error('Preencha a referência antes de salvar'); return; }
    const lines = buildLines();
    if (lines.length === 0) { toast.error('Escolha ao menos um setor'); return; }
    const totalSnapshot = lines.reduce((a, l) => a + l.cost, 0);

    // Sem id carregado: se já existe um salvo com a mesma referência, sobrescreve.
    let targetId = loadedId;
    if (!targetId) {
      const existing = results.find((r) => normalizeForSearch(r.reference) === normalizeForSearch(ref));
      if (existing) targetId = existing.id;
    }

    save.mutate(
      { id: targetId, reference: ref, lines, total: totalSnapshot },
      {
        onSuccess: (id) => { setLoadedId(id); toast.success(targetId ? 'Resultado atualizado' : 'Resultado salvo'); },
        onError: () => toast.error('Erro ao salvar resultado'),
      },
    );
  };

  const onLoad = (r: LaborCostResult) => {
    setReference(r.reference);
    setLoadedId(r.id);
    setRows(
      r.lines.length
        ? r.lines.map((l) => ({ id: rowId.current++, sectorKey: l.sector_key, hours: String(l.hours) }))
        : [{ id: rowId.current++, sectorKey: '', hours: '' }],
    );
    toast.success(`"${r.reference}" carregada`);
  };

  const onNew = () => {
    setReference('');
    setLoadedId(null);
    setRows([{ id: rowId.current++, sectorKey: '', hours: '' }]);
  };

  const onDelete = (r: LaborCostResult) => {
    del.mutate(r.id, {
      onSuccess: () => { if (loadedId === r.id) setLoadedId(null); toast.success('Resultado excluído'); },
      onError: () => toast.error('Erro ao excluir'),
    });
  };

  // ── Busca nos salvos ──
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () => results.filter((r) => searchMatchesAny(search, r.reference, ...r.lines.map((l) => sectorLabel(l.sector_key)))),
    [results, search],
  );

  return (
    <div className="space-y-4">
      {/* ── Config: valor-hora por setor ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Salário por setor
          </CardTitle>
          <CardDescription>
            Cadastre o <strong>salário mensal</strong> de cada setor. O custo da hora é derivado
            automaticamente = salário ÷ {SALARY_HOUR_DIVISOR} (mesma base da folha), <strong>sem encargos</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {RATE_SECTORS.map(({ key, label }) => {
              const hourly = hourlyFromSalary(parseNum(draft[key]));
              return (
                <div key={key} className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`rate-${key}`} className="text-xs font-medium truncate">{label}</Label>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground">R$</span>
                      <Input
                        id={`rate-${key}`}
                        inputMode="decimal"
                        className="h-8 w-24 text-right text-xs tabular-nums"
                        value={draft[key] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                        onBlur={() => saveRate(key)}
                        placeholder="0,00"
                      />
                      <span className="text-xs text-muted-foreground">/mês</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-right tabular-nums">
                    custo-hora = {fmtBRL(hourly)}/h
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Cálculo manual por referência ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4 text-muted-foreground" />
                Cálculo de custo de MO
              </CardTitle>
              <CardDescription>
                Escolha o setor em cada linha e preencha o tempo (horas/par). Custo = custo-hora × horas
                (custo-hora = salário ÷ {SALARY_HOUR_DIVISOR}).
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
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="mo-ref" className="text-xs font-medium">Referência</Label>
            <Input
              id="mo-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ex.: SP10 / Sandália Executiva"
              className="h-9"
            />
          </div>

          {/* Cabeçalho */}
          <div className="hidden sm:grid grid-cols-[1fr_120px_120px_130px_40px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Setor</span>
            <span className="text-right">Custo-hora</span>
            <span className="text-right">Tempo (h)</span>
            <span className="text-right">Custo</span>
            <span />
          </div>

          {/* Linhas */}
          <div className="space-y-2">
            {rows.map((row) => {
              const rate = rateMap[row.sectorKey]?.hourly_rate ?? 0;
              const cost = rowCost(row);
              const rateMissing = !!row.sectorKey && rate === 0;
              return (
                <div key={row.id} className="grid grid-cols-2 sm:grid-cols-[1fr_120px_120px_130px_40px] gap-2 items-center">
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

                  <div className="text-right text-sm tabular-nums text-muted-foreground">
                    {row.sectorKey ? `${fmtBRL(rate)}/h` : '—'}
                    {rateMissing && <span className="block text-[10px] text-amber-600">sem salário</span>}
                  </div>

                  <div className="flex items-center justify-end gap-1">
                    <Input
                      inputMode="decimal"
                      value={row.hours}
                      onChange={(e) => updateRow(row.id, { hours: e.target.value })}
                      placeholder="0,00"
                      className="h-9 w-20 text-right text-sm tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">h</span>
                  </div>

                  <div className="text-right text-sm font-semibold tabular-nums">{fmtBRL(cost)}</div>

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

          {/* Total + ações */}
          <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary/70">Custo de MO{reference ? ` · ${reference}` : ''}</p>
              <p className="text-[11px] text-muted-foreground">Soma dos setores · por par</p>
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
        </CardContent>
      </Card>

      {/* ── Resultados salvos ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            Resultados salvos
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
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum resultado salvo ainda.</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum resultado para “{search}”.</p>
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
