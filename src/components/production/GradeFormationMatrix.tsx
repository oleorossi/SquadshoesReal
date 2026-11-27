import { type KeyboardEvent } from 'react';
import { Info } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type GradeCalculation } from '@/lib/gradeCalculator';
import { formatGradeQuantity } from '@/lib/gradeCalculatorView';
import { cn } from '@/lib/utils';

interface GradeFormationMatrixProps {
  calculation: GradeCalculation;
  onUpdateQuantity: (field: 'needBySize' | 'readyBySize', size: number, raw: unknown) => void;
}

type QuantityField = 'needBySize' | 'readyBySize';
type GradeLayout = 'horizontal' | 'vertical';

function focusMatrixInput(
  current: HTMLInputElement,
  field: QuantityField,
  size: string,
  key: string,
) {
  const root = current.closest('[data-grade-matrix]');
  if (!root) return false;

  const layout = (root.getAttribute('data-grade-layout') ?? 'horizontal') as GradeLayout;
  const sameField = Array.from(
    root.querySelectorAll<HTMLInputElement>(`input[data-grade-field="${field}"]`),
  );
  const index = sameField.indexOf(current);
  const otherField: QuantityField = field === 'needBySize' ? 'readyBySize' : 'needBySize';
  const otherSameSize = root.querySelector<HTMLInputElement>(
    `input[data-grade-field="${otherField}"][data-grade-size="${size}"]`,
  ) ?? undefined;

  let next: HTMLInputElement | undefined;
  if (layout === 'vertical') {
    if (key === 'ArrowRight') {
      if (field === 'needBySize') {
        next = otherSameSize;
      } else {
        const nextSize = sameField[index + 1]?.dataset.gradeSize;
        next = nextSize
          ? root.querySelector<HTMLInputElement>(
            `input[data-grade-field="needBySize"][data-grade-size="${nextSize}"]`,
          ) ?? undefined
          : undefined;
      }
    } else if (key === 'ArrowLeft') {
      if (field === 'readyBySize') {
        next = otherSameSize;
      } else {
        const prevSize = sameField[index - 1]?.dataset.gradeSize;
        next = prevSize
          ? root.querySelector<HTMLInputElement>(
            `input[data-grade-field="readyBySize"][data-grade-size="${prevSize}"]`,
          ) ?? undefined
          : undefined;
      }
    } else if (key === 'ArrowDown' || key === 'Enter') {
      next = sameField[index + 1];
    } else if (key === 'ArrowUp') {
      next = sameField[index - 1];
    }
  } else if (key === 'ArrowRight' || key === 'Enter') {
    next = sameField[index + 1];
  } else if (key === 'ArrowLeft') {
    next = sameField[index - 1];
  } else if (key === 'ArrowDown' || key === 'ArrowUp') {
    next = otherSameSize;
  }

  if (!next) return false;
  next.focus();
  next.select();
  return true;
}

function handleMatrixKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  const { key } = event;
  if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Enter'].includes(key)) return;
  const current = event.currentTarget;
  const field = current.dataset.gradeField as QuantityField | undefined;
  const size = current.dataset.gradeSize;
  if (!field || !size) return;
  if (focusMatrixInput(current, field, size, key)) {
    event.preventDefault();
  }
}

interface MatrixInputCellProps {
  field: QuantityField;
  size: number;
  value: number;
  label: string;
  idPrefix: string;
  onUpdateQuantity: GradeFormationMatrixProps['onUpdateQuantity'];
  className?: string;
  inputClassName?: string;
}

function MatrixInputCell({
  field,
  size,
  value,
  label,
  idPrefix,
  onUpdateQuantity,
  className,
  inputClassName,
}: MatrixInputCellProps) {
  const inputId = `${idPrefix}-${field}-${size}`;
  return (
    <td className={className}>
      <Label htmlFor={inputId} className="sr-only">
        {label}
      </Label>
      <Input
        id={inputId}
        data-grade-field={field}
        data-grade-size={size}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value || ''}
        placeholder="0"
        onChange={(event) => onUpdateQuantity(field, size, event.target.value)}
        onKeyDown={handleMatrixKeyDown}
        className={inputClassName}
      />
    </td>
  );
}

const DESKTOP_INPUT_CLASS =
  'mx-auto h-11 w-full min-w-[3.25rem] max-w-[5.5rem] rounded-sm border-foreground/20 px-1 text-center text-base tabular-nums shadow-none';
const MOBILE_INPUT_CLASS =
  'h-11 w-full min-w-0 rounded-sm border-foreground/20 px-0.5 text-center text-base tabular-nums shadow-none';

function HorizontalMatrix({ calculation, onUpdateQuantity }: GradeFormationMatrixProps) {
  const sizes = calculation.rows.map((row) => row.size);

  return (
    <div
      data-grade-matrix
      data-grade-layout="horizontal"
      className="hidden overflow-x-auto overscroll-x-contain rounded-sm border-[1.5px] border-foreground/20 md:block print:block"
    >
      <table className="w-full min-w-max border-collapse">
        <caption className="sr-only">
          Formação da grade na horizontal, com uma coluna por numeração e a linha A produzir em destaque.
        </caption>
        <thead>
          <tr className="border-b-2 border-foreground">
            <th
              scope="col"
              className="sticky left-0 z-20 min-w-[7.5rem] border-r border-border bg-card px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
            >
              Métrica
            </th>
            {sizes.map((size, index) => (
              <th
                key={size}
                scope="col"
                className={cn(
                  'min-w-[4.75rem] px-2 py-2.5 text-center font-mono text-lg font-bold tabular-nums sm:text-xl',
                  index % 2 === 1 && 'bg-muted/40',
                )}
              >
                {size}
              </th>
            ))}
            <th
              scope="col"
              className="sticky right-0 z-20 min-w-[5.25rem] border-l border-border bg-muted px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <th
              scope="row"
              className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider"
            >
              Por ficha
            </th>
            {calculation.rows.map((row, index) => (
              <MatrixInputCell
                key={`need-${row.size}`}
                field="needBySize"
                size={row.size}
                value={row.needPerSheet}
                label={`Quantidade por ficha da numeração ${row.size}`}
                idPrefix="grade-desktop"
                onUpdateQuantity={onUpdateQuantity}
                className={cn('min-w-[4.75rem] px-1.5 py-1.5 text-center', index % 2 === 1 && 'bg-muted/40')}
                inputClassName={DESKTOP_INPUT_CLASS}
              />
            ))}
            <td className="sticky right-0 z-10 border-l border-border bg-muted px-3 py-2 text-center font-mono text-base font-bold tabular-nums">
              {formatGradeQuantity(calculation.totals.needPerSheet)}
            </td>
          </tr>

          <tr className="border-b border-border">
            <th
              scope="row"
              className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              Necessidade
            </th>
            {calculation.rows.map((row, index) => (
              <td
                key={`need-total-${row.size}`}
                className={cn(
                  'min-w-[4.75rem] px-2 py-2 text-center font-mono text-base tabular-nums text-muted-foreground',
                  index % 2 === 1 && 'bg-muted/40',
                )}
              >
                {formatGradeQuantity(row.need)}
              </td>
            ))}
            <td className="sticky right-0 z-10 border-l border-border bg-muted px-3 py-2 text-center font-mono text-base font-bold tabular-nums">
              {formatGradeQuantity(calculation.totals.need)}
            </td>
          </tr>

          <tr className="border-b border-border">
            <th
              scope="row"
              className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider"
            >
              Já pronta
            </th>
            {calculation.rows.map((row, index) => (
              <MatrixInputCell
                key={`ready-${row.size}`}
                field="readyBySize"
                size={row.size}
                value={row.ready}
                label={`Palmilhas já prontas da numeração ${row.size}`}
                idPrefix="grade-desktop"
                onUpdateQuantity={onUpdateQuantity}
                className={cn('min-w-[4.75rem] px-1.5 py-1.5 text-center', index % 2 === 1 && 'bg-muted/40')}
                inputClassName={DESKTOP_INPUT_CLASS}
              />
            ))}
            <td className="sticky right-0 z-10 border-l border-border bg-muted px-3 py-2 text-center font-mono text-base font-bold tabular-nums">
              {formatGradeQuantity(calculation.totals.ready)}
            </td>
          </tr>

          <tr className="border-y-2 border-foreground bg-muted">
            <th
              scope="row"
              className="sticky left-0 z-10 border-r border-border bg-muted px-3 py-3 text-left text-xs font-bold uppercase tracking-wider"
            >
              A produzir
            </th>
            {calculation.rows.map((row) => (
              <td
                key={`final-${row.size}`}
                className="min-w-[4.75rem] bg-muted px-2 py-3 text-center font-mono text-xl font-bold tabular-nums sm:text-2xl"
              >
                {formatGradeQuantity(row.final)}
              </td>
            ))}
            <td className="sticky right-0 z-10 border-l border-foreground bg-foreground px-3 py-3 text-center font-mono text-xl font-bold tabular-nums text-background sm:text-2xl">
              {formatGradeQuantity(calculation.totals.final)}
            </td>
          </tr>

          <tr>
            <th
              scope="row"
              className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              Sobra
            </th>
            {calculation.rows.map((row, index) => (
              <td
                key={`surplus-${row.size}`}
                className={cn(
                  'min-w-[4.75rem] px-2 py-2 text-center font-mono text-sm tabular-nums',
                  row.surplus > 0
                    ? 'bg-muted font-bold text-foreground'
                    : 'text-muted-foreground',
                  row.surplus === 0 && index % 2 === 1 && 'bg-muted/40',
                )}
              >
                {formatGradeQuantity(row.surplus)}
              </td>
            ))}
            <td
              className={cn(
                'sticky right-0 z-10 border-l border-border px-3 py-2 text-center font-mono text-sm tabular-nums',
                calculation.totals.surplus > 0
                  ? 'bg-muted font-bold text-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {formatGradeQuantity(calculation.totals.surplus)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function VerticalMatrix({ calculation, onUpdateQuantity }: GradeFormationMatrixProps) {
  return (
    <div
      data-grade-matrix
      data-grade-layout="vertical"
      className="overflow-x-hidden rounded-sm border-[1.5px] border-foreground/20 md:hidden print:hidden"
    >
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          Formação da grade na vertical, com uma linha por numeração e a coluna A produzir em destaque.
        </caption>
        <colgroup>
          <col className="w-[12%]" />
          <col className="w-[20%]" />
          <col className="w-[14%]" />
          <col className="w-[20%]" />
          <col className="w-[20%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <tr className="border-b-2 border-foreground">
            <th scope="col" aria-label="Tamanho" className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Tam.
            </th>
            <th scope="col" aria-label="Por ficha" className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider">
              Ficha
            </th>
            <th scope="col" aria-label="Necessidade" className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Nec.
            </th>
            <th scope="col" aria-label="Já pronta" className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider">
              Pronta
            </th>
            <th scope="col" aria-label="A produzir" className="bg-muted px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider">
              Prod.
            </th>
            <th scope="col" aria-label="Sobra" className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Sobra
            </th>
          </tr>
        </thead>
        <tbody>
          {calculation.rows.map((row) => (
            <tr key={row.size} className="border-b border-border">
              <th scope="row" className="px-1 py-1.5 text-center font-mono text-base font-bold tabular-nums">
                {row.size}
              </th>
              <MatrixInputCell
                field="needBySize"
                size={row.size}
                value={row.needPerSheet}
                label={`Quantidade por ficha da numeração ${row.size}`}
                idPrefix="grade-mobile"
                onUpdateQuantity={onUpdateQuantity}
                className="px-0.5 py-1 text-center"
                inputClassName={MOBILE_INPUT_CLASS}
              />
              <td className="px-1 py-1.5 text-center font-mono text-sm tabular-nums text-muted-foreground">
                {formatGradeQuantity(row.need)}
              </td>
              <MatrixInputCell
                field="readyBySize"
                size={row.size}
                value={row.ready}
                label={`Palmilhas já prontas da numeração ${row.size}`}
                idPrefix="grade-mobile"
                onUpdateQuantity={onUpdateQuantity}
                className="px-0.5 py-1 text-center"
                inputClassName={MOBILE_INPUT_CLASS}
              />
              <td className="bg-muted px-1 py-1.5 text-center font-mono text-lg font-bold tabular-nums">
                {formatGradeQuantity(row.final)}
              </td>
              <td
                className={cn(
                  'px-1 py-1.5 text-center font-mono text-sm tabular-nums',
                  row.surplus > 0 ? 'bg-muted font-bold text-foreground' : 'text-muted-foreground',
                )}
              >
                {formatGradeQuantity(row.surplus)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-foreground bg-muted">
            <th scope="row" className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wider">
              Total
            </th>
            <td className="px-1 py-2 text-center font-mono text-sm font-bold tabular-nums">
              {formatGradeQuantity(calculation.totals.needPerSheet)}
            </td>
            <td className="px-1 py-2 text-center font-mono text-sm font-bold tabular-nums">
              {formatGradeQuantity(calculation.totals.need)}
            </td>
            <td className="px-1 py-2 text-center font-mono text-sm font-bold tabular-nums">
              {formatGradeQuantity(calculation.totals.ready)}
            </td>
            <td className="bg-foreground px-1 py-2 text-center font-mono text-lg font-bold tabular-nums text-background">
              {formatGradeQuantity(calculation.totals.final)}
            </td>
            <td
              className={cn(
                'px-1 py-2 text-center font-mono text-sm tabular-nums',
                calculation.totals.surplus > 0 ? 'font-bold text-foreground' : 'text-muted-foreground',
              )}
            >
              {formatGradeQuantity(calculation.totals.surplus)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function GradeFormationMatrix({ calculation, onUpdateQuantity }: GradeFormationMatrixProps) {
  return (
    <div className="space-y-3">
      <VerticalMatrix calculation={calculation} onUpdateQuantity={onUpdateQuantity} />
      <HorizontalMatrix calculation={calculation} onUpdateQuantity={onUpdateQuantity} />
      <p className="flex items-start gap-2 text-xs text-muted-foreground md:hidden print:hidden">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        A coluna Prod. (A produzir) é o que vai para a fábrica, por numeração. Use Tab ou as setas para avançar entre os números.
      </p>
      <p className="hidden items-start gap-2 text-xs text-muted-foreground md:flex print:hidden">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        A linha A produzir é o que vai para a fábrica, por numeração. Use Tab ou as setas para avançar entre os números.
      </p>
    </div>
  );
}
