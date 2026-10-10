import { Printer } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  THERMAL_PDF_PRINT_GUIDE_CONFIRM_LABEL,
  THERMAL_PDF_PRINT_GUIDE_INTRO,
  THERMAL_PDF_PRINT_GUIDE_STEPS,
  THERMAL_PDF_PRINT_GUIDE_TITLE,
} from '@/lib/thermalPdfPrintGuide';
import {
  THERMAL_LABEL_HEIGHT_MM,
  THERMAL_LABEL_WIDTH_MM,
} from '@/lib/printLabels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Gera/abre o PDF depois que o usuário confirma o checklist. */
  onConfirm: () => void;
  confirmBusy?: boolean;
}

/**
 * Modal obrigatório antes de abrir o PDF da etiqueta individual.
 * Sem “não mostrar de novo”: na fábrica o perfil da L42PRO muda entre
 * cliente (50×30 / 106×30) e Squad (100×30).
 */
export function ThermalPdfPrintGuideDialog({
  open,
  onOpenChange,
  onConfirm,
  confirmBusy = false,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary shrink-0" />
            {THERMAL_PDF_PRINT_GUIDE_TITLE}
          </DialogTitle>
          <DialogDescription>{THERMAL_PDF_PRINT_GUIDE_INTRO}</DialogDescription>
        </DialogHeader>

        <ol className="space-y-3 text-sm">
          {THERMAL_PDF_PRINT_GUIDE_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold text-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium text-foreground">{step.title}</p>
                <p className="text-muted-foreground leading-snug">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Mídia alvo:{' '}
          <strong className="text-foreground font-mono">
            {THERMAL_LABEL_WIDTH_MM} × {THERMAL_LABEL_HEIGHT_MM} mm
          </strong>
          {' '}· 1 coluna · escala 100%
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={confirmBusy}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-2"
            disabled={confirmBusy}
            onClick={onConfirm}
          >
            {THERMAL_PDF_PRINT_GUIDE_CONFIRM_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
