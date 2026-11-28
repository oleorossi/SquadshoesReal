import { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Copy,
  DotsThreeVertical,
  Printer,
  Trash,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { GradeFormationMatrix } from '@/components/production/GradeFormationMatrix';
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
import { useAuth } from '@/hooks/useAuth';
import {
  buildGradeSizes,
  calculateGrade,
  GRADE_MAX_SIZE,
  GRADE_MIN_SIZE,
  GRADE_PRESETS,
  GradePresetKey,
  GradeQuantityMap,
  nonNegativeInteger,
  normalizeSheetCount,
  sanitizeQuantityMap,
  validateGradeRange,
} from '@/lib/gradeCalculator';
import { deliverHtmlDocument } from '@/lib/htmlPrintDelivery';
import { isIosBrowser } from '@/lib/iosDevice';
import {
  buildGradePrintHtml,
  buildGradeSummaryText,
  formatGradeQuantity,
  gradePrintDeliveryOptions,
  isGradePrintPhoneLayout,
} from '@/lib/gradeCalculatorView';

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
      await navigator.clipboard.writeText(buildGradeSummaryText(draft, calculation));
      toast.success('Resumo da grade copiado.');
    } catch {
      toast.error('Não foi possível copiar o resumo.');
    }
  };

  const printSummary = async () => {
    const layout = isGradePrintPhoneLayout() ? 'phone' : 'sheet';
    const html = buildGradePrintHtml(draft, calculation, layout);
    const ok = await deliverHtmlDocument(html, gradePrintDeliveryOptions(draft.model, layout));
    // No iOS o printHtmlAsPdf já avisa o erro. No restante, a aba pode ter sido bloqueada.
    if (!ok && !isIosBrowser()) {
      toast.error('Libere as janelas deste site para imprimir.');
    }
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
      : `Produzir ${formatGradeQuantity(calculation.totals.final)} palmilha${calculation.totals.final === 1 ? '' : 's'}, respeitando a falta de cada numeração.`;

  const actionButtons = (
    <>
      <div className="hidden md:flex items-center gap-2">
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
      <div className="flex w-full min-w-0 items-center gap-2 md:hidden">
        <Button
          type="button"
          className="h-11 min-h-11 flex-1"
          onClick={printSummary}
        >
          <Printer aria-hidden="true" />
          Imprimir
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Abrir outras ações da calculadora">
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
    <div className="space-y-4 page-enter overflow-x-hidden">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · SOLADOS"
        title="Calculadora Grade"
        description="Monte a grade por numeração e leia com clareza o que falta produzir."
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
                  className="h-11 px-3 md:h-8"
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
                  className="h-11 w-20 text-center text-base"
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
                  className="h-11 w-20 text-center text-base"
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
            <CardTitle as="h2">Formação da grade</CardTitle>
            <p className="text-xs text-muted-foreground">
              Digite a quantidade por ficha e as palmilhas já prontas em cada numeração. A linha destacada é o que falta produzir.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <span className="section-label">Necessidade total</span>
            <strong className="block font-mono text-xl tabular-nums" aria-live="polite">
              {formatGradeQuantity(calculation.totals.need)}
            </strong>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {sizes.length > 0 ? (
            <GradeFormationMatrix calculation={calculation} onUpdateQuantity={updateQuantity} />
          ) : (
            <div className="rounded-sm border border-dashed border-border p-4 text-sm text-muted-foreground">
              Corrija a faixa para exibir as numerações.
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
              <strong className="mt-1 block font-mono text-xl tabular-nums">{formatGradeQuantity(item.value)}</strong>
            </div>
          ))}
          <div className="bg-foreground p-3 text-background">
            <span className="block font-mono text-[9px] font-bold uppercase tracking-widest text-background/70">A produzir</span>
            <strong className="mt-1 block font-mono text-2xl tabular-nums">{formatGradeQuantity(calculation.totals.final)}</strong>
          </div>
        </div>
        <div className="border-t border-foreground bg-card px-4 py-3 text-sm font-medium" aria-live="polite">
          {resultMessage}
        </div>
      </section>

      <Button
        type="button"
        className="h-12 w-full min-h-12 text-base md:hidden"
        onClick={printSummary}
      >
        <Printer aria-hidden="true" />
        Imprimir quantidade a cortar
      </Button>

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
