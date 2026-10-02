import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThermalPdfPrintGuideDialog } from '@/components/label-system/ThermalPdfPrintGuideDialog';
import {
  THERMAL_PDF_PRINT_GUIDE_CONFIRM_LABEL,
  THERMAL_PDF_PRINT_GUIDE_STEPS,
  THERMAL_PDF_PRINT_GUIDE_TITLE,
} from '@/lib/thermalPdfPrintGuide';

describe('ThermalPdfPrintGuideDialog', () => {
  it('lista os passos e só gera o PDF no confirmar', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ThermalPdfPrintGuideDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(THERMAL_PDF_PRINT_GUIDE_TITLE)).toBeInTheDocument();
    for (const step of THERMAL_PDF_PRINT_GUIDE_STEPS) {
      expect(screen.getByText(step.title)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: THERMAL_PDF_PRINT_GUIDE_CONFIRM_LABEL }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
