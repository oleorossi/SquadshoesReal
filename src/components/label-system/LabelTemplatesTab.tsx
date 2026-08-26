import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle as CheckCircle2,
  CircleNotch as Loader2,
  Copy,
  Cube as Box,
  FilePdf,
  Package,
  Plus,
  Printer,
  Ruler,
  Trash as Trash2,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/ui/panel';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { createPrintJob, setPrintJobStatus } from '@/lib/printJobs';
import {
  MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE,
  STANDARD_TEXT_LABEL_GEOMETRY,
  STANDARD_TEXT_LABEL_PRESETS,
  buildStandardTextLabelsPdf,
  countStandardTextLabels,
  normalizeStandardTextLabelSample,
  standardTextLabelsFilename,
  type StandardTextLabelPreset,
  type StandardTextLabelSample,
} from '@/lib/standardTextLabels';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface QueuedSample extends StandardTextLabelSample {
  id: string;
}

interface DraftSample {
  reference: string;
  color: string;
  material: string;
  copies: number;
}

type DraftErrors = Partial<Record<keyof DraftSample, string>>;

const EMPTY_DRAFT: DraftSample = {
  reference: '',
  color: '',
  material: '',
  copies: 1,
};

const SAMPLE_PREVIEW: StandardTextLabelSample = {
  reference: 'SP130',
  color: 'OFF WHITE',
  material: 'NAPA SOFT',
  copies: 1,
};

const PRESET_OPTIONS: Array<{
  value: StandardTextLabelPreset;
  icon: typeof Box;
  eyebrow: string;
}> = [
  { value: 'external_box', icon: Box, eyebrow: 'IDENTIFICAÇÃO EXTERNA' },
  { value: 'individual_package', icon: Package, eyebrow: 'IDENTIFICAÇÃO DO PRODUTO' },
];

const TEMPLATE_SYSTEM_KEYS: Record<StandardTextLabelPreset, string> = {
  external_box: 'external_box_l42pro',
  individual_package: 'individual_package_l42pro',
};

function newSampleId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `sample-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function validateDraftFields(draft: DraftSample): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.reference.trim()) errors.reference = 'Informe a referência.';
  if (!draft.color.trim()) errors.color = 'Informe a cor.';
  if (!draft.material.trim()) errors.material = 'Informe o material.';
  if (!Number.isInteger(draft.copies) || draft.copies < 1) {
    errors.copies = 'Informe uma quantidade inteira maior que zero.';
  } else if (draft.copies > MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE) {
    errors.copies = `O limite é ${MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE.toLocaleString('pt-BR')} etiquetas por amostra.`;
  }
  return errors;
}

function previewSamples(samples: QueuedSample[], draft: DraftSample): StandardTextLabelSample[] {
  const expanded: StandardTextLabelSample[] = [];
  for (const sample of samples) {
    const copies = Math.max(1, sample.copies || 1);
    for (let copy = 0; copy < copies && expanded.length < 2; copy++) expanded.push(sample);
    if (expanded.length === 2) return expanded;
  }
  if (expanded.length === 0) {
    expanded.push({
      reference: draft.reference.trim() || SAMPLE_PREVIEW.reference,
      color: draft.color.trim() || SAMPLE_PREVIEW.color,
      material: draft.material.trim() || SAMPLE_PREVIEW.material,
      copies: 1,
    });
  }
  return expanded;
}

async function resolveStandardTemplateId(preset: StandardTextLabelPreset): Promise<string> {
  const { data, error } = await supabase
    .from('label_templates')
    .select('*')
    .eq('is_active', true);
  if (error) throw error;

  const expectedSystemKey = TEMPLATE_SYSTEM_KEYS[preset];
  const rows = (data || []) as Array<{
    id: string;
    system_key?: string | null;
    layout_config: unknown;
  }>;
  const match = rows.find(row => {
    const config = row.layout_config && typeof row.layout_config === 'object' && !Array.isArray(row.layout_config)
      ? row.layout_config as Record<string, unknown>
      : null;
    return row.system_key === expectedSystemKey
      && config?.builder_key === preset
      && config?.locked === true;
  });
  if (!match) {
    throw new Error(`O padrão oficial ${expectedSystemKey} ainda não está disponível no servidor.`);
  }
  return match.id;
}

export function LabelTemplatesTab() {
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<StandardTextLabelPreset>('individual_package');
  const [draft, setDraft] = useState<DraftSample>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [samples, setSamples] = useState<QueuedSample[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const totalLabels = useMemo(() => {
    try {
      return countStandardTextLabels(samples);
    } catch {
      return 0;
    }
  }, [samples]);
  const preview = useMemo(() => previewSamples(samples, draft), [draft, samples]);

  const addDraft = () => {
    const errors = validateDraftFields(draft);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      setDraftErrors(errors);
      toast.error(firstError);
      return;
    }
    try {
      const normalized = normalizeStandardTextLabelSample(draft, samples.length);
      setSamples(current => [...current, { ...normalized, id: newSampleId() }]);
      setDraft(EMPTY_DRAFT);
      setDraftErrors({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Revise os dados da amostra.');
    }
  };

  const duplicateSample = (sample: QueuedSample) => {
    try {
      countStandardTextLabels([...samples, sample]);
      setSamples(current => [...current, { ...sample, id: newSampleId() }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível duplicar a amostra.');
    }
  };

  const removeSample = (id: string) => {
    setSamples(current => current.filter(sample => sample.id !== id));
  };

  const generatePdf = async () => {
    if (samples.length === 0) {
      toast.error('Adicione pelo menos uma amostra à tiragem.');
      return;
    }

    setIsGenerating(true);
    let jobId: string | null = null;
    try {
      const templateId = await resolveStandardTemplateId(preset);
      jobId = await createPrintJob({
        batchName: `Amostras · ${STANDARD_TEXT_LABEL_PRESETS[preset].label}`,
        totalLabels,
        templateId,
      });
      const doc = await buildStandardTextLabelsPdf(samples, preset);
      doc.save(standardTextLabelsFilename(preset));
      await setPrintJobStatus(jobId, 'generated');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['print_jobs_dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['print_history'] }),
      ]);
      toast.success(`${totalLabels.toLocaleString('pt-BR')} etiquetas geradas no padrão L42PRO.`);
    } catch (error) {
      if (jobId) {
        try {
          await setPrintJobStatus(jobId, 'failed');
        } catch {
          // A mensagem principal abaixo já orienta o operador sobre a falha.
        }
      }
      toast.error(error instanceof Error ? error.message : 'Não foi possível gerar o PDF.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3">
        <FormatMetric label="Etiqueta" value="50 × 30 mm" icon={Ruler} />
        <FormatMetric label="Carreira" value="2 etiquetas" icon={Package} />
        <FormatMetric label="Mídia L42PRO" value="106 × 30 mm" icon={Printer} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
        <div className="space-y-4">
          <Panel
            eyebrow="01 · PADRÃO IMUTÁVEL"
            title="Escolha onde a etiqueta será aplicada"
            subtitle="A finalidade altera somente a organização do texto; a dimensão física permanece 50 × 30 mm."
          >
            <RadioGroup
              value={preset}
              onValueChange={value => setPreset(value as StandardTextLabelPreset)}
              className="grid gap-3 sm:grid-cols-2"
              aria-label="Finalidade da etiqueta"
            >
              {PRESET_OPTIONS.map(option => {
                const active = preset === option.value;
                const Icon = option.icon;
                const info = STANDARD_TEXT_LABEL_PRESETS[option.value];
                return (
                  <div key={option.value} className="relative">
                    <RadioGroupItem
                      id={`standard-label-preset-${option.value}`}
                      value={option.value}
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={`standard-label-preset-${option.value}`}
                      className={cn(
                        'block cursor-pointer rounded-lg border p-4 text-left transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                        active ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted/40',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className={cn('rounded-md border p-2', active ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                          <Icon className="h-5 w-5" weight="duotone" />
                        </div>
                        {active && <CheckCircle2 className="h-5 w-5 text-primary" weight="fill" />}
                      </div>
                      <p className="mt-4 font-mono text-xs font-bold tracking-wider text-muted-foreground">{option.eyebrow}</p>
                      <p className="mt-1 text-sm font-bold text-foreground">{info.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{info.description}</p>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </Panel>

          <Panel
            eyebrow="02 · CONTEÚDO"
            title="Preencha a amostra"
            subtitle="Somente referência, cor e material entram na etiqueta padronizada."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="standard-label-reference">Referência <span aria-hidden="true">*</span></Label>
                <Input
                  id="standard-label-reference"
                  value={draft.reference}
                  onChange={event => {
                    setDraft(current => ({ ...current, reference: event.target.value }));
                    setDraftErrors(current => ({ ...current, reference: undefined }));
                  }}
                  placeholder="Ex.: SP130"
                  maxLength={60}
                  autoComplete="off"
                  required
                  aria-invalid={Boolean(draftErrors.reference)}
                  aria-describedby={draftErrors.reference ? 'standard-label-reference-error' : undefined}
                />
                {draftErrors.reference && <p id="standard-label-reference-error" role="alert" className="text-xs text-destructive">{draftErrors.reference}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="standard-label-color">Cor <span aria-hidden="true">*</span></Label>
                <Input
                  id="standard-label-color"
                  value={draft.color}
                  onChange={event => {
                    setDraft(current => ({ ...current, color: event.target.value }));
                    setDraftErrors(current => ({ ...current, color: undefined }));
                  }}
                  placeholder="Ex.: Off White"
                  maxLength={80}
                  autoComplete="off"
                  required
                  aria-invalid={Boolean(draftErrors.color)}
                  aria-describedby={draftErrors.color ? 'standard-label-color-error' : undefined}
                />
                {draftErrors.color && <p id="standard-label-color-error" role="alert" className="text-xs text-destructive">{draftErrors.color}</p>}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="standard-label-material">Material <span aria-hidden="true">*</span></Label>
                <Input
                  id="standard-label-material"
                  value={draft.material}
                  onChange={event => {
                    setDraft(current => ({ ...current, material: event.target.value }));
                    setDraftErrors(current => ({ ...current, material: undefined }));
                  }}
                  placeholder="Ex.: Napa Soft"
                  maxLength={120}
                  autoComplete="off"
                  required
                  aria-invalid={Boolean(draftErrors.material)}
                  aria-describedby={draftErrors.material ? 'standard-label-material-error' : undefined}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addDraft();
                    }
                  }}
                />
                {draftErrors.material && <p id="standard-label-material-error" role="alert" className="text-xs text-destructive">{draftErrors.material}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="standard-label-copies">Quantidade de etiquetas <span aria-hidden="true">*</span></Label>
                <Input
                  id="standard-label-copies"
                  type="number"
                  min={1}
                  max={MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE}
                  step={1}
                  value={draft.copies}
                  onChange={event => {
                    setDraft(current => ({ ...current, copies: Number(event.target.value) }));
                    setDraftErrors(current => ({ ...current, copies: undefined }));
                  }}
                  inputMode="numeric"
                  required
                  aria-invalid={Boolean(draftErrors.copies)}
                  aria-describedby={draftErrors.copies ? 'standard-label-copies-error' : undefined}
                />
                {draftErrors.copies && <p id="standard-label-copies-error" role="alert" className="text-xs text-destructive">{draftErrors.copies}</p>}
              </div>
              <div className="flex items-end">
                <Button type="button" onClick={addDraft} className="w-full gap-2">
                  <Plus className="h-4 w-4" /> Adicionar à tiragem
                </Button>
              </div>
            </div>
          </Panel>

          <Panel
            eyebrow="03 · TIRAGEM"
            title="Amostras adicionadas"
            subtitle={samples.length === 0 ? 'A tiragem ainda está vazia.' : `${samples.length} amostra${samples.length === 1 ? '' : 's'} · ${totalLabels.toLocaleString('pt-BR')} etiquetas`}
            actions={samples.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setSamples([])}>Limpar</Button>
            ) : undefined}
            flush
          >
            {samples.length === 0 ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                <FilePdf className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">Adicione a primeira amostra</p>
                <p className="max-w-sm text-xs text-muted-foreground">A prévia ao lado já mostra como o texto será organizado.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {samples.map((sample, index) => (
                  <div key={sample.id} className="grid gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted font-mono text-xs font-bold text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold uppercase text-foreground">{sample.reference}</p>
                      <p className="truncate text-xs uppercase text-muted-foreground">{sample.color} · {sample.material}</p>
                    </div>
                    <div className="flex items-center gap-1 sm:justify-end">
                      <Badge variant="secondary">{sample.copies}×</Badge>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Duplicar amostra ${sample.reference}`} onClick={() => duplicateSample(sample)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Remover amostra ${sample.reference}`} onClick={() => removeSample(sample.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Panel
            eyebrow="PRÉVIA FÍSICA · ESCALA PROPORCIONAL"
            title={STANDARD_TEXT_LABEL_PRESETS[preset].label}
            subtitle="Duas etiquetas de 50 × 30 mm com vão central de 6 mm."
            actions={<Badge variant="outline">PDF vetorial</Badge>}
          >
            <div className="pb-2">
              <div className="w-full sm:min-w-[540px]">
                <div className="mb-2 grid grid-cols-[50fr_6fr_50fr] font-mono text-xs text-muted-foreground" aria-hidden="true">
                  <div className="flex justify-between px-1"><span>0</span><span>50 mm</span></div>
                  <div className="text-center">6</div>
                  <div className="flex justify-between px-1"><span>56</span><span>106 mm</span></div>
                </div>
                <div className="grid grid-cols-[50fr_6fr_50fr] items-stretch rounded-md bg-muted p-2 shadow-inner">
                  <ThermalLabelPreview preset={preset} sample={preview[0]} />
                  <div className="flex items-center justify-center">
                    <div className="h-full border-x border-dashed border-border" />
                  </div>
                  {preview[1] ? (
                    <ThermalLabelPreview preset={preset} sample={preview[1]} />
                  ) : (
                    <div className="flex aspect-[5/3] items-center justify-center rounded-sm border border-dashed border-border bg-background text-xs text-muted-foreground">
                      slot livre
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <p><strong className="text-foreground">Área segura:</strong> {STANDARD_TEXT_LABEL_GEOMETRY.artWidthMm} × {STANDARD_TEXT_LABEL_GEOMETRY.artHeightMm} mm</p>
              <p><strong className="text-foreground">Impressão:</strong> tamanho real · 100%</p>
              <p><strong className="text-foreground">Margens:</strong> zero · sem cabeçalho</p>
              <p><strong className="text-foreground">Sensor:</strong> GAP transmissivo</p>
            </div>
          </Panel>

          <Button
            type="button"
            size="lg"
            className="w-full gap-2"
            disabled={samples.length === 0 || isGenerating}
            onClick={() => void generatePdf()}
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Gerar PDF L42PRO ({totalLabels.toLocaleString('pt-BR')})
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            O PDF abre no tamanho físico 106 × 30 mm. Faça uma régua de teste antes de uma tiragem grande.
          </p>
        </div>
      </div>
    </div>
  );
}

function FormatMetric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Ruler }) {
  return (
    <div className="flex min-h-20 items-center gap-3 border-border p-4 sm:border-l sm:first:border-l-0">
      <div className="rounded-md bg-muted p-2 text-muted-foreground"><Icon className="h-4 w-4" /></div>
      <div>
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function ThermalLabelPreview({ preset, sample }: { preset: StandardTextLabelPreset; sample: StandardTextLabelSample }) {
  const normalized = normalizeStandardTextLabelSample({ ...sample, copies: 1 });
  if (preset === 'external_box') {
    return (
      <div className="aspect-[5/3] overflow-hidden rounded-sm border border-foreground/70 bg-background p-[3%] text-foreground shadow-sm">
        <p className="font-mono text-[7px] font-bold tracking-wider">CAIXA EXTERNA · REFERÊNCIA</p>
        <div className="mt-[2%] border-t border-foreground/70 pt-[3%]">
          <p className="truncate text-xl font-black leading-none tracking-tight">{normalized.reference}</p>
        </div>
        <div className="mt-[4%] border-t border-foreground/60 pt-[3%]">
          <p className="truncate text-[10px] font-bold leading-tight">COR · {normalized.color}</p>
        </div>
        <div className="mt-[3%] border-t border-foreground/60 pt-[3%]">
          <p className="truncate text-[9px] leading-tight">MATERIAL · {normalized.material}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="aspect-[5/3] overflow-hidden rounded-sm border border-foreground/70 bg-background p-[3%] text-center text-foreground shadow-sm">
      <p className="font-mono text-[7px] font-bold tracking-wider">EMBALAGEM INDIVIDUAL</p>
      <div className="mx-auto mt-[2%] w-4/5 border-t border-foreground/70 pt-[4%]">
        <p className="truncate text-lg font-black leading-none tracking-tight">REF. {normalized.reference}</p>
      </div>
      <p className="mt-[6%] truncate text-[10px] font-bold leading-tight">COR · {normalized.color}</p>
      <p className="mt-[5%] truncate text-[9px] leading-tight">MATERIAL · {normalized.material}</p>
    </div>
  );
}
