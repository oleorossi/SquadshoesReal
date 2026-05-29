import { useState, useEffect } from 'react';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Slider } from '@/components/ui/slider';
import { Factory, FloppyDisk as Save } from '@phosphor-icons/react';
import { useProductionSettings, useUpdateProductionSettings } from '@/hooks/useProductionSettings';
import { toast } from 'sonner';

export default function ProductionSettingsTab() {
  const { data: settings, isLoading } = useProductionSettings();
  const updateSettings = useUpdateProductionSettings();

  const [pairsPerDay, setPairsPerDay] = useState<number>(1500);
  const [tolerancePct, setTolerancePct] = useState<number>(10);
  const [horizonDays, setHorizonDays] = useState<number>(30);

  useEffect(() => {
    if (settings) {
      setPairsPerDay(settings.costura_pairs_per_day_total);
      setTolerancePct(Math.round(settings.costura_overflow_tolerance_pct * 100));
      setHorizonDays(settings.costura_dispatch_horizon_days);
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        costura_pairs_per_day_total: pairsPerDay,
        costura_overflow_tolerance_pct: tolerancePct / 100,
        costura_dispatch_horizon_days: horizonDays,
      });
      toast.success('Configurações de produção atualizadas');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao atualizar configurações');
    }
  };

  const isDirty = settings && (
    pairsPerDay !== settings.costura_pairs_per_day_total ||
    Math.abs(tolerancePct / 100 - settings.costura_overflow_tolerance_pct) > 0.001 ||
    horizonDays !== settings.costura_dispatch_horizon_days
  );

  return (
    <Panel
      eyebrow="SISTEMA · PRODUÇÃO"
      title="Capacidade da Fábrica"
      subtitle="Define a capacidade global de Costura. Usado pelo motor para detectar overflow e sugerir terceirização."
      icon={Factory}
    >
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
      ) : (
        <div className="space-y-6 max-w-2xl">
          <div>
            <Label className="text-xs uppercase font-bold text-muted-foreground mb-2 block">
              Costura — capacidade total da fábrica
            </Label>
            <div className="flex items-center gap-3">
              <NumberInput
                value={pairsPerDay}
                onChange={(v) => setPairsPerDay(Math.max(0, Math.round(v)))}
                step="50"
                className="h-10 max-w-[200px]"
              />
              <span className="text-sm text-muted-foreground">pares por dia</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Soma da capacidade de todas as costureiras internas. Quando a demanda diária excede esse valor,
              o sistema marca o dia como <strong>overflow</strong> e sugere envio pra terceirização.
            </p>
          </div>

          <div>
            <Label className="text-xs uppercase font-bold text-muted-foreground mb-2 block">
              Tolerância de alerta — {tolerancePct}%
            </Label>
            <div className="flex items-center gap-4 max-w-md">
              <Slider
                value={[tolerancePct]}
                onValueChange={(v) => setTolerancePct(v[0])}
                min={0}
                max={25}
                step={1}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground font-mono tabular-nums w-12">
                {tolerancePct}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Margem antes do overflow ser tratado como alerta amarelo. Com {tolerancePct}%, dias com
              ocupação acima de <strong>{100 - tolerancePct}%</strong> aparecem como warning antes
              de virarem overflow.
            </p>
          </div>

          <div>
            <Label className="text-xs uppercase font-bold text-muted-foreground mb-2 block">
              Horizonte de planejamento
            </Label>
            <div className="flex items-center gap-3">
              <NumberInput
                value={horizonDays}
                onChange={(v) => setHorizonDays(Math.max(7, Math.round(v)))}
                step="5"
                className="h-10 max-w-[120px]"
              />
              <span className="text-sm text-muted-foreground">dias</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Quantos dias adiante o planner analisa pra detectar overflow. Padrão 30 dias rolling.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border/40">
            {settings?.updated_at && (
              <span className="text-xs text-muted-foreground mr-auto">
                Última atualização: {new Date(settings.updated_at).toLocaleString('pt-BR')}
              </span>
            )}
            <Button
              onClick={handleSave}
              disabled={!isDirty || updateSettings.isPending}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {updateSettings.isPending ? 'Salvando...' : 'Salvar configurações'}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
