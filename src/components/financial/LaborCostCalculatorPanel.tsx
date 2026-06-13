/**
 * Calculadora MANUAL de custo de mão de obra por referência.
 *
 * Fluxo (pedido do usuário): preenche a referência (rótulo) → escolhe o setor
 * em cada linha → a aba PUXA o valor-hora do setor (tabela sector_labor_rates,
 * editável aqui mesmo) → preenche o tempo em HORAS → custo = valor-hora × horas.
 * Soma de todas as linhas = custo de MO da referência.
 *
 * Independente do custeio por operação (labor_costs/BOM) e da folha
 * (employees.salary) — valor-hora é cadastrado nesta aba.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash, Calculator, Clock } from '@phosphor-icons/react';
import { DISPLAY_SECTORS, SECTOR_LABELS, type SectorKey } from '@/lib/sectors';
import { useSectorLaborRates, useUpsertSectorLaborRate } from '@/hooks/useSectorLaborRates';

// Setores que recebem valor-hora: o fluxo de fábrica (DISPLAY_SECTORS) + Expedição.
const RATE_SECTORS: { key: SectorKey; label: string }[] = [
  ...DISPLAY_SECTORS,
  { key: 'expedicao' as SectorKey, label: SECTOR_LABELS.expedicao },
];

function fmtBRL(v: number): string {
  return `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Aceita vírgula OU ponto como separador decimal. Vazio/inválido → 0. */
function parseNum(s: string | undefined): number {
  const n = parseFloat(String(s ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

interface Row { id: number; sectorKey: string; hours: string; }

export default function LaborCostCalculatorPanel() {
  const { data: rateMap = {} } = useSectorLaborRates();
  const upsert = useUpsertSectorLaborRate();

  // Draft editável do valor-hora por setor (sincroniza do banco sem sobrescrever
  // edição em andamento — só preenche chaves ainda não tocadas).
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraft(prev => {
      const next = { ...prev };
      for (const { key } of RATE_SECTORS) {
        if (next[key] === undefined) next[key] = rateMap[key] != null ? String(rateMap[key]) : '';
      }
      return next;
    });
  }, [rateMap]);

  const saveRate = (key: string) => {
    const v = parseNum(draft[key]);
    if (v !== (rateMap[key] ?? 0)) upsert.mutate({ sectorKey: key, hourlyRate: v });
  };

  // ── Cálculo ──
  const rowId = useRef(1);
  const [reference, setReference] = useState('');
  const [rows, setRows] = useState<Row[]>([{ id: 0, sectorKey: '', hours: '' }]);

  const addRow = () => setRows(r => [...r, { id: rowId.current++, sectorKey: '', hours: '' }]);
  const removeRow = (id: number) => setRows(r => (r.length > 1 ? r.filter(x => x.id !== id) : r));
  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows(r => r.map(x => (x.id === id ? { ...x, ...patch } : x)));

  const rowCost = (row: Row) => (rateMap[row.sectorKey] ?? 0) * parseNum(row.hours);
  const total = useMemo(() => rows.reduce((acc, r) => acc + rowCost(r), 0), [rows, rateMap]);

  return (
    <div className="space-y-4">
      {/* ── Config: valor-hora por setor ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Valor-hora por setor
          </CardTitle>
          <CardDescription>
            Cadastre o custo da hora trabalhada (R$/h) de cada setor. A calculadora abaixo puxa esse valor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {RATE_SECTORS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <Label htmlFor={`rate-${key}`} className="text-xs font-medium truncate">{label}</Label>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground">R$</span>
                  <Input
                    id={`rate-${key}`}
                    inputMode="decimal"
                    className="h-8 w-24 text-right text-xs tabular-nums"
                    value={draft[key] ?? ''}
                    onChange={(e) => setDraft(d => ({ ...d, [key]: e.target.value }))}
                    onBlur={() => saveRate(key)}
                    placeholder="0,00"
                  />
                  <span className="text-xs text-muted-foreground">/h</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Cálculo manual por referência ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            Cálculo de custo de MO
          </CardTitle>
          <CardDescription>
            Escolha o setor em cada linha e preencha o tempo (horas/par). O custo = valor-hora × horas.
          </CardDescription>
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
            <span className="text-right">Valor-hora</span>
            <span className="text-right">Tempo (h)</span>
            <span className="text-right">Custo</span>
            <span />
          </div>

          {/* Linhas */}
          <div className="space-y-2">
            {rows.map((row) => {
              const rate = rateMap[row.sectorKey] ?? 0;
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
                    {row.sectorKey ? fmtBRL(rate) : '—'}
                    {rateMissing && <span className="block text-[10px] text-amber-600">sem valor-hora</span>}
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

          {/* Total */}
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary/70">Custo de MO{reference ? ` · ${reference}` : ''}</p>
              <p className="text-[11px] text-muted-foreground">Soma dos setores · por par</p>
            </div>
            <p className="display text-2xl tabular-nums text-primary">{fmtBRL(total)}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
