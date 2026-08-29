import { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Copy,
  DotsThreeVertical,
  Info,
  Printer,
  Trash,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import {
  buildGradeSizes,
  calculateGrade,
  GRADE_MAX_SIZE,
  GRADE_MIN_SIZE,
  GRADE_PRESETS,
  GradeCalculation,
  GradePresetKey,
  GradeQuantityMap,
  nonNegativeInteger,
  normalizeSheetCount,
  sanitizeQuantityMap,
  validateGradeRange,
} from '@/lib/gradeCalculator';
import { escapeHtml } from '@/lib/htmlUtils';
import { cn } from '@/lib/utils';

interface CalculatorDraft {
  model: string;
  color: string;
  from: number;
  to: number;
  sheetCount: number;
  needBySize: GradeQuantityMap;
  readyBySize: GradeQuantityMap;
}

const DEFAULT_DRAFT: CalculatorDraft = {
  model: '',
  color: '',
  from: GRADE_PRESETS.infantil.from,
  to: GRADE_PRESETS.infantil.to,
  sheetCount: 1,
  needBySize: {},
  readyBySize: {},
};

const formatQuantity = (value: number) => value.toLocaleString('pt-BR');

function normalizeStoredDraft(value: unknown): CalculatorDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_DRAFT;
  const source = value as Partial<CalculatorDraft>;
  const candidateFrom = nonNegativeInteger(source.from);
  const candidateTo = nonNegativeInteger(source.to);
  const hasValidRange = !validateGradeRange(candidateFrom, candidateTo);

  return {
    model: typeof source.model === 'string' ? source.model.slice(0, 80) : '',
    color: typeof source.color === 'string' ? source.color.slice(0, 80) : '',
    from: hasValidRange ? candidateFrom : DEFAULT_DRAFT.from,
    to: hasValidRange ? candidateTo : DEFAULT_DRAFT.to,
    sheetCount: normalizeSheetCount(source.sheetCount),
    needBySize: sanitizeQuantityMap(source.needBySize),
    readyBySize: sanitizeQuantityMap(source.readyBySize),
  };
}

function buildSummaryText(draft: CalculatorDraft, calculation: GradeCalculation): string {
  const identification = [
    draft.model.trim() ? `Modelo: ${draft.model.trim()}` : null,
    draft.color.trim() ? `Cor: ${draft.color.trim()}` : null,
  ].filter(Boolean);
  const lines = calculation.rows.map((row) =>
    [
      String(row.size),
      formatQuantity(row.needPerSheet),
      formatQuantity(row.need),
      formatQuantity(row.ready),
      formatQuantity(row.final),
      formatQuantity(row.surplus),
    ].join('\t'),
  );

  return [
    'CALCULADORA GRADE · SQUAD SHOES',
    ...identification,
    `Faixa: ${draft.from}–${draft.to}`,
    `Fichas: ${calculation.sheetCount}`,
    '',
    'Nº\tPor ficha\tNecessidade\tPronta\tA produzir\tSobra',
    ...lines,
    '',
    `Total por ficha: ${formatQuantity(calculation.totals.needPerSheet)}`,
    `Necessidade total: ${formatQuantity(calculation.totals.need)}`,
    `Palmilhas aproveitadas: ${formatQuantity(calculation.totals.used)}`,
    `A produzir: ${formatQuantity(calculation.totals.final)}`,
    `Sobra por numeração: ${formatQuantity(calculation.totals.surplus)}`,
  ].join('\n');
}

function buildPrintHtml(draft: CalculatorDraft, calculation: GradeCalculation): string {
  const model = draft.model.trim() || 'Não informado';
  const color = draft.color.trim() || 'Não informada';
  const rows = calculation.rows.map((row) => `
    <tr>
      <th scope="row">${row.size}</th>
      <td>${formatQuantity(row.needPerSheet)}</td>
      <td>${formatQuantity(row.need)}</td>
      <td>${formatQuantity(row.ready)}</td>
      <td><strong>${formatQuantity(row.final)}</strong></td>
      <td>${formatQuantity(row.surplus)}</td>
    </tr>`).join('');

  return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Calculadora Grade · ${escapeHtml(model)}</title>
      <style>
        @page { size: A4 portrait; margin: 14mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: black; background: white; font: 12px Arial, sans-serif; }
        header { border-bottom: 3px solid black; padding-bottom: 10px; margin-bottom: 14px; }
        h1 { margin: 0; font-size: 28px; text-transform: uppercase; }
        .eyebrow { margin: 0 0 4px; font: bold 10px monospace; letter-spacing: .12em; }
        .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
        .meta div { border: 1px solid black; padding: 8px; }
        .meta span, .summary span { display: block; color: dimgrey; font-size: 9px; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; }
        .meta strong, .summary strong { display: block; font-size: 16px; margin-top: 3px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border-bottom: 1px solid grey; padding: 7px 8px; text-align: right; }
        thead th { border-bottom: 2px solid black; font-size: 9px; text-transform: uppercase; }
        th:first-child, td:first-child { text-align: left; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); border: 2px solid black; margin-top: 14px; }
        .summary div { padding: 10px; border-right: 1px solid black; }
        .summary div:last-child { border-right: 0; }
        footer { color: dimgrey; font-size: 9px; margin-top: 10px; text-align: right; }
      </style>
    </head>
    <body>
      <header>
        <p class="eyebrow">PRODUÇÃO · SOLADOS</p>
        <h1>Calculadora Grade</h1>
      </header>
      <section class="meta">
        <div><span>Modelo</span><strong>${escapeHtml(model)}</strong></div>
        <div><span>Cor</span><strong>${escapeHtml(color)}</strong></div>
        <div><span>Faixa</span><strong>${draft.from}–${draft.to}</strong></div>
        <div><span>Fichas</span><strong>${calculation.sheetCount}</strong></div>
      </section>
      <table>
        <thead>
          <tr><th>Nº</th><th>Por ficha</th><th>Necessidade</th><th>Pronta</th><th>A produzir</th><th>Sobra</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <section class="summary">
        <div><span>Necessidade</span><strong>${formatQuantity(calculation.totals.need)}</strong></div>
        <div><span>Aproveitado</span><strong>${formatQuantity(calculation.totals.used)}</strong></div>
        <div><span>Sobra</span><strong>${formatQuantity(calculation.totals.surplus)}</strong></div>
        <div><span>A produzir</span><strong>${formatQuantity(calculation.totals.final)}</strong></div>
      </section>
      <footer>Gerado no Squad Shoes</footer>
    </body>
  </html>`;
}

export default function CalculadoraGrade() {
  const { user } = useAuth();
  const [draft, setDraft] = useState<CalculatorDraft>(DEFAULT_DRAFT);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const storageKey = user?.id ? `squad:calculadora-grade:${user.id}:v1` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      setDraft(stored ? normalizeStoredDraft(JSON.parse(stored)) : DEFAULT_DRAFT);
    } catch {
      setDraft(DEFAULT_DRAFT);
    }
    setLoadedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || loadedStorageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // A calculadora continua funcionando mesmo quando o navegador bloqueia storage.
    }
  }, [draft, loadedStorageKey, storageKey]);

  const rangeError = validateGradeRange(draft.from, draft.to);
  const sizes = useMemo(
    () => buildGradeSizes(draft.from, draft.to),
    [draft.from, draft.to],
  );
  const calculation = useMemo(
    () => calculateGrade(sizes, draft.sheetCount, draft.needBySize, draft.readyBySize),
    [draft.needBySize, draft.readyBySize, draft.sheetCount, sizes],
  );

  const activePreset = (Object.entries(GRADE_PRESETS) as [GradePresetKey, typeof GRADE_PRESETS[GradePresetKey]][])
    .find(([, preset]) => preset.from === draft.from && preset.to === draft.to)?.[0];

  const setPreset = (key: GradePresetKey) => {
    const preset = GRADE_PRESETS[key];
    setDraft((current) => ({ ...current, from: preset.from, to: preset.to }));
  };

  const updateQuantity = (field: 'needBySize' | 'readyBySize', size: number, raw: unknown) => {
    const quantity = nonNegativeInteger(raw);
    const key = String(size);
    setDraft((current) => {
      const nextMap = { ...current[field] };
      if (quantity > 0) nextMap[key] = quantity;
      else delete nextMap[key];
      return { ...current, [field]: nextMap };
    });
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildSummaryText(draft, calculation));
      toast.success('Resumo da grade copiado.');
    } catch {
      toast.error('Não foi possível copiar o resumo.');
    }
  };

  const printSummary = () => {
    const printWindow = window.open('', '_blank', 'width=1000,height=800');
    if (!printWindow) {
      toast.error('Libere as janelas deste site para imprimir.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildPrintHtml(draft, calculation));
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 300);
  };

  const clearCalculator = () => {
    setDraft(DEFAULT_DRAFT);
    setClearOpen(false);
    toast.success('Calculadora limpa.');
  };

  const resultMessage = calculation.totals.need === 0
    ? 'Preencha a quantidade por ficha em cada numeração para iniciar o cálculo.'
    : calculation.totals.final === 0
      ? 'A quantidade pronta cobre toda a necessidade desta grade.'
      : `Produzir ${formatQuantity(calculation.totals.final)} palmilha${calculation.totals.final === 1 ? '' : 's'}, respeitando a falta de cada numeração.`;

  const actionButtons = (
    <>
      <div className="hidden sm:flex items-center gap-2">
        <Button variant="editorial-outline" onClick={copySummary}>
          <Copy aria-hidden="true" />
          Copiar
        </Button>
        <Button variant="editorial-outline" onClick={printSummary}>
          <Printer aria-hidden="true" />
          Imprimir
        </Button>
        <Button variant="editorial-red" onClick={() => setClearOpen(true)}>
          <Trash aria-hidden="true" />
          Limpar
        </Button>
      </div>
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Abrir ações da calculadora">
              <DotsThreeVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={copySummary} className="gap-2 py-2.5">
              <Copy aria-hidden="true" /> Copiar resumo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={printSummary} className="gap-2 py-2.5">
              <Printer aria-hidden="true" /> Imprimir
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setClearOpen(true)} className="gap-2 py-2.5 text-primary">
              <Trash aria-hidden="true" /> Limpar calculadora
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · SOLADOS"
        title="Calculadora Grade"
        description="Multiplique a grade pela quantidade de fichas e desconte as palmilhas prontas, sempre por numeração."
        actions={actionButtons}
      />

      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle as="h2" className="flex items-center gap-2">
            <Calculator className="h-4 w-4" aria-hidden="true" />
            Identificação e faixa
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 pt-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
            <div className="space-y-1.5">
              <Label htmlFor="grade-model">Modelo do solado</Label>
              <Input
                id="grade-model"
                value={draft.model}
                maxLength={80}
                placeholder="Ex.: I90"
                onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grade-color">Cor</Label>
              <Input
                id="grade-color"
                value={draft.color}
                maxLength={80}
                placeholder="Ex.: Preto"
                onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5 lg:row-start-1 lg:col-start-3">
            <Label htmlFor="grade-sheet-count">Quantidade de fichas</Label>
            <Input
              id="grade-sheet-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              step={1}
              value={draft.sheetCount}
              onChange={(event) => setDraft((current) => ({
                ...current,
                sheetCount: normalizeSheetCount(event.target.value),
              }))}
              className="h-11 text-center text-base lg:w-36"
            />
          </div>

          <div className="space-y-2 lg:col-span-3">
            <div className="flex flex-wrap items-center gap-2">
              {(Object.entries(GRADE_PRESETS) as [GradePresetKey, typeof GRADE_PRESETS[GradePresetKey]][]).map(([key, preset]) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={activePreset === key ? 'default' : 'outline'}
                  onClick={() => setPreset(key)}
                  aria-pressed={activePreset === key}
                >
                  {preset.label} · {preset.from}–{preset.to}
                </Button>
              ))}
              <span className="text-xs text-muted-foreground">ou personalize:</span>
              <div className="flex items-center gap-2">
                <Label htmlFor="grade-from" className="sr-only">Numeração inicial</Label>
                <Input
                  id="grade-from"
                  type="number"
                  inputMode="numeric"
                  min={GRADE_MIN_SIZE}
                  max={GRADE_MAX_SIZE}
                  step={1}
                  value={draft.from || ''}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    from: nonNegativeInteger(event.target.value),
                  }))}
                  className="h-9 w-20 text-center"
                  aria-invalid={Boolean(rangeError)}
                />
                <span className="text-muted-foreground" aria-hidden="true">até</span>
                <Label htmlFor="grade-to" className="sr-only">Numeração final</Label>
                <Input
                  id="grade-to"
                  type="number"
                  inputMode="numeric"
                  min={GRADE_MIN_SIZE}
                  max={GRADE_MAX_SIZE}
                  step={1}
                  value={draft.to || ''}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    to: nonNegativeInteger(event.target.value),
                  }))}
                  className="h-9 w-20 text-center"
                  aria-invalid={Boolean(rangeError)}
                  aria-describedby={rangeError ? 'grade-range-error' : undefined}
                />
              </div>
            </div>
            {rangeError && (
              <p id="grade-range-error" className="text-xs font-medium text-primary" role="alert">
                {rangeError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-end justify-between gap-4 space-y-0 p-4 pb-3">
          <div className="space-y-1">
            <CardTitle as="h2">Quantidade por ficha</CardTitle>
            <p className="text-xs text-muted-foreground">Digite a grade de uma ficha. O rodapé mostra a quantidade já multiplicada.</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="section-label">Necessidade total</span>
            <strong className="block font-mono text-xl tabular-nums" aria-live="polite">
              {formatQuantity(calculation.totals.need)}
            </strong>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {sizes.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 min-[375px]:grid-cols-4 sm:[grid-template-columns:repeat(auto-fit,minmax(68px,1fr))]">
              {calculation.rows.map((row) => {
                const totalId = `grade-total-${row.size}`;
                return (
                  <div key={row.size} className="overflow-hidden rounded-sm border-[1.5px] border-foreground/15 bg-background">
                    <Label
                      htmlFor={`grade-need-${row.size}`}
                      className="flex h-8 items-center justify-center font-mono text-sm font-bold"
                    >
                      {row.size}
                    </Label>
                    <Input
                      id={`grade-need-${row.size}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={row.needPerSheet || ''}
                      placeholder="0"
                      onChange={(event) => updateQuantity('needBySize', row.size, event.target.value)}
                      aria-describedby={totalId}
                      className="h-11 rounded-none border-x-0 text-center text-base"
                    />
                    <div id={totalId} className="flex items-center justify-between gap-1 bg-muted/50 px-2 py-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Total</span>
                      <strong className="font-mono text-xs tabular-nums">{formatQuantity(row.need)}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-border p-4 text-sm text-muted-foreground">
              Corrija a faixa para exibir as numerações.
            </div>
          )}
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Exemplo: nº 34 com 1 por ficha e 10 fichas resulta em necessidade 10.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle as="h2">Palmilhas já prontas</CardTitle>
          <p className="text-xs text-muted-foreground">Informe o estoque disponível daquela cor. A sobra de um número não cobre a falta de outro.</p>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {sizes.length > 0 ? (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Numeração</TableHead>
                      <TableHead className="text-right">Necessidade</TableHead>
                      <TableHead className="text-right">Já pronta</TableHead>
                      <TableHead className="text-right">A produzir</TableHead>
                      <TableHead className="text-right">Sobra</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calculation.rows.map((row) => (
                      <TableRow key={row.size}>
                        <TableCell className="font-mono font-bold">{row.size}</TableCell>
                        <TableCell numeric className="font-mono">{formatQuantity(row.need)}</TableCell>
                        <TableCell numeric>
                          <Label htmlFor={`ready-desktop-${row.size}`} className="sr-only">
                            Palmilhas prontas da numeração {row.size}
                          </Label>
                          <Input
                            id={`ready-desktop-${row.size}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            value={row.ready || ''}
                            placeholder="0"
                            onChange={(event) => updateQuantity('readyBySize', row.size, event.target.value)}
                            className="ml-auto h-9 w-24 text-center"
                          />
                        </TableCell>
                        <TableCell numeric className={cn('font-mono font-bold', row.final > 0 && 'text-primary')}>
                          {formatQuantity(row.final)}
                        </TableCell>
                        <TableCell numeric className="font-mono text-muted-foreground">
                          {formatQuantity(row.surplus)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-2 md:hidden">
                {calculation.rows.map((row) => (
                  <div
                    key={row.size}
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)] items-center gap-2 rounded-sm border border-border p-2"
                  >
                    <div>
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Nº</span>
                      <strong className="font-mono text-base">{row.size}</strong>
                    </div>
                    <div className="text-right">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Nec.</span>
                      <strong className="font-mono text-sm tabular-nums">{formatQuantity(row.need)}</strong>
                    </div>
                    <div>
                      <Label htmlFor={`ready-mobile-${row.size}`} className="block text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        Pronta
                      </Label>
                      <Input
                        id={`ready-mobile-${row.size}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={row.ready || ''}
                        placeholder="0"
                        onChange={(event) => updateQuantity('readyBySize', row.size, event.target.value)}
                        className="h-11 text-center text-base"
                      />
                    </div>
                    <div className="text-right">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Fazer</span>
                      <strong className={cn('font-mono text-base tabular-nums', row.final > 0 && 'text-primary')}>
                        {formatQuantity(row.final)}
                      </strong>
                      {row.surplus > 0 && (
                        <span className="block text-[9px] text-muted-foreground">sobra {formatQuantity(row.surplus)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-sm border border-dashed border-border p-4 text-sm text-muted-foreground">
              Corrija a faixa para preencher o estoque pronto.
            </div>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="grade-result-title" className="overflow-hidden rounded-sm border-[1.5px] border-foreground">
        <h2 id="grade-result-title" className="sr-only">Resultado da calculadora</h2>
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            { label: 'Necessidade', value: calculation.totals.need },
            { label: 'Aproveitado', value: calculation.totals.used },
            { label: 'Sobra', value: calculation.totals.surplus },
          ].map((item) => (
            <div key={item.label} className="border-b border-r border-foreground/20 p-3 md:border-b-0">
              <span className="section-label">{item.label}</span>
              <strong className="mt-1 block font-mono text-xl tabular-nums">{formatQuantity(item.value)}</strong>
            </div>
          ))}
          <div className="bg-foreground p-3 text-background">
            <span className="block font-mono text-[9px] font-bold uppercase tracking-widest text-background/70">A produzir</span>
            <strong className="mt-1 block font-mono text-2xl tabular-nums">{formatQuantity(calculation.totals.final)}</strong>
          </div>
        </div>
        <div className="border-t border-foreground bg-card px-4 py-3 text-sm font-medium" aria-live="polite">
          {resultMessage}
        </div>
      </section>

      <p className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-foreground" aria-hidden="true" />
        Rascunho salvo automaticamente neste navegador para o seu usuário.
      </p>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar toda a calculadora?</AlertDialogTitle>
            <AlertDialogDescription>
              Modelo, cor, grade, fichas e quantidades prontas voltarão ao padrão infantil. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={clearCalculator}>Limpar tudo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
