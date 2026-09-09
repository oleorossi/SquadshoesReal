import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CurrencyDollar, FloppyDisk } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { saveArtisanalStrapMeasureHubFields } from '@/lib/saveArtisanalStrapMeasureHubFields';

interface MeasureLaborCostControlProps {
  measureId: string;
  measureLabel: string;
  currentLaborCostPerM: number;
  canEdit: boolean;
}

function formatLaborCost(value: number) {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/**
 * Controle sob o agrupamento de Napas: a MO é da medida (tipo × largura),
 * igual para todos os materiais-base. Rendimento continua por Napa.
 */
export function MeasureLaborCostControl({
  measureId,
  measureLabel,
  currentLaborCostPerM,
  canEdit,
}: MeasureLaborCostControlProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentLaborCostPerM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(currentLaborCostPerM > 0 ? currentLaborCostPerM : 0);
  }, [open, currentLaborCostPerM]);

  if (!canEdit) {
    if (!(currentLaborCostPerM > 0)) return null;
    return (
      <p className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Mão de obra {formatLaborCost(currentLaborCostPerM)}/m · todas as Napas desta medida
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 h-9 w-full gap-2"
        onClick={() => setOpen(true)}
      >
        <CurrencyDollar className="h-4 w-4" weight="bold" />
        {currentLaborCostPerM > 0
          ? `Editar mão de obra (${formatLaborCost(currentLaborCostPerM)}/m)`
          : 'Definir mão de obra desta medida'}
      </Button>
    );
  }

  const handleSave = async () => {
    if (saving) return;
    if (value < 0) {
      toast.error('Mão de obra não pode ser negativa.');
      return;
    }
    try {
      setSaving(true);
      await saveArtisanalStrapMeasureHubFields(
        measureId,
        { precoArtesanalPerM: value > 0 ? value : null },
        `Definição de mão de obra da medida ${measureLabel} no cadastro de tipos`,
      );
      await queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      toast.success(
        value > 0
          ? `MO ${formatLaborCost(value)}/m aplicada a todas as Napas de ${measureLabel}`
          : `MO removida de ${measureLabel}`,
      );
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar a mão de obra da medida.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="space-y-1">
        <Label htmlFor={`measure-labor-${measureId}`}>
          Mão de obra da medida (R$/m)
        </Label>
        <p className="text-xs text-muted-foreground">
          Um valor para {measureLabel}. Vale para todas as Napas deste agrupamento;
          só o rendimento (m/m) muda por material.
        </p>
      </div>
      <NumberInput
        id={`measure-labor-${measureId}`}
        value={value}
        onChange={setValue}
        min={0}
        decimals={4}
        unit="R$/m"
        autoFocus
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 flex-1"
          disabled={saving}
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-9 flex-1 gap-2"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          <FloppyDisk className="h-4 w-4" weight="bold" />
          {saving ? 'Salvando…' : 'Salvar mão de obra'}
        </Button>
      </div>
    </div>
  );
}
