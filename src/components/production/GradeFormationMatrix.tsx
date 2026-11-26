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

function focusMatrixInput(
  current: HTMLInputElement,
  field: QuantityField,
  size: string,
  key: string,
) {
  const root = current.closest('[data-grade-matrix]');
  if (!root) return false;

  const sameField = Array.from(
    root.querySelectorAll<HTMLInputElement>(`input[data-grade-field="${field}"]`),
  );
  const index = sameField.indexOf(current);
  const otherField: QuantityField = field === 'needBySize' ? 'readyBySize' : 'needBySize';

  let next: HTMLInputElement | undefined;
  if (key === 'ArrowRight' || key === 'Enter') {
    next = sameField[index + 1];
  } else if (key === 'ArrowLeft') {
    next = sameField[index - 1];
  } else if (key === 'ArrowDown' || key === 'ArrowUp') {
    next = root.querySelector<HTMLInputElement>(
      `input[data-grade-field="${otherField}"][data-grade-size="${size}"]`,
    ) ?? undefined;
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
  onUpdateQuantity: GradeFormationMatrixProps['onUpdateQuantity'];
  className?: string;
}

function MatrixInputCell({
  field,
  size,
  value,
  label,
  onUpdateQuantity,
  className,
}: MatrixInputCellProps) {
  const inputId = `grade-${field}-${size}`;
  return (
    <td className={cn('min-w-[4.75rem] px-1.5 py-1.5 text-center', className)}>
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
        className="mx-auto h-11 w-full min-w-[3.25rem] max-w-[5.5rem] rounded-sm border-foreground/20 px-1 text-center text-base tabular-nums shadow-none"
      />
    </td>
  );
}

export function GradeFormationMatrix({ calculation, onUpdateQuantity }: GradeFormationMatrixProps) {
  const sizes = calculation.rows.map((row) => row.size);

  return (
    <div className="space-y-3">
      <div
        data-grade-matrix
        className="overflow-x-auto overscroll-x-contain rounded-sm border-[1.5px] border-foreground/20"
      >
        <table className="w-full min-w-max border-collapse">
          <caption className="sr-only">
            Formação da grade na horizontal, com uma coluna por numeração e a linha A produzir em destaque.
          </caption>
          <thead>
            <tr className="border-b-2 border-foreground">
              <th
                scope="col"
                className="sticky left-0 z-20 min-w-[7.5rem] bg-card px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-r border-border"
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
                className="sticky right-0 z-20 min-w-[5.25rem] bg-muted px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest border-l border-border"
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider border-r border-border"
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
                  onUpdateQuantity={onUpdateQuantity}
                  className={index % 2 === 1 ? 'bg-muted/40' : undefined}
                />
              ))}
              <td className="sticky right-0 z-10 bg-muted px-3 py-2 text-center font-mono text-base font-bold tabular-nums border-l border-border">
                {formatGradeQuantity(calculation.totals.needPerSheet)}
              </td>
            </tr>

            <tr className="border-b border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-r border-border"
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
              <td className="sticky right-0 z-10 bg-muted px-3 py-2 text-center font-mono text-base font-bold tabular-nums border-l border-border">
                {formatGradeQuantity(calculation.totals.need)}
              </td>
            </tr>

            <tr className="border-b border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider border-r border-border"
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
                  onUpdateQuantity={onUpdateQuantity}
                  className={index % 2 === 1 ? 'bg-muted/40' : undefined}
                />
              ))}
              <td className="sticky right-0 z-10 bg-muted px-3 py-2 text-center font-mono text-base font-bold tabular-nums border-l border-border">
                {formatGradeQuantity(calculation.totals.ready)}
              </td>
            </tr>

            <tr className="border-y-2 border-foreground bg-muted">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-muted px-3 py-3 text-left text-xs font-bold uppercase tracking-wider border-r border-border"
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
              <td className="sticky right-0 z-10 bg-foreground px-3 py-3 text-center font-mono text-xl font-bold tabular-nums text-background border-l border-foreground sm:text-2xl">
                {formatGradeQuantity(calculation.totals.final)}
              </td>
            </tr>

            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-r border-border"
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
                  'sticky right-0 z-10 px-3 py-2 text-center font-mono text-sm tabular-nums border-l border-border',
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
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        A linha A produzir é o que vai para a fábrica, por numeração. Em telas estreitas, deslize a grade para o lado. Use Tab ou as setas para avançar entre os números.
      </p>
    </div>
  );
}
