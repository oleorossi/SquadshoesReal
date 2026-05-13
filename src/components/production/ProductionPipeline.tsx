import { Scissors, Stack as Layers, GridFour as LayoutGrid, Pen, PaintBrush as Paintbrush, Wind, Hammer, Footprints, Package, Truck } from '@phosphor-icons/react';

// Ordem canônica pós PR1-PR3: prep (Palmilha‖Forração‖Aviamento) → Costura → restantes.
const STEPS = [
  { id: 'Corte Palmilha', label: 'C. Palmilha',  icon: Scissors,    color: 'text-orange-500' },
  { id: 'Corte Forração', label: 'C. Forração',  icon: Layers,      color: 'text-teal-500' },
  { id: 'Aviamento',      label: 'Aviamento',    icon: LayoutGrid,  color: 'text-purple-500' },
  { id: 'Costura',        label: 'Costura',      icon: Pen,         color: 'text-rose-500' },
  { id: 'Silk',           label: 'Silk',          icon: Paintbrush,  color: 'text-pink-500' },
  { id: 'Colagem',        label: 'Colagem',       icon: Wind,        color: 'text-amber-500' },
  { id: 'Montagem',       label: 'Montagem',      icon: Montagem,    color: 'text-blue-500' },
  { id: 'Solagem',        label: 'Solagem',       icon: Footprints,  color: 'text-lime-500' },
  { id: 'Acabamento',     label: 'Acabamento',    icon: Acabamento,  color: 'text-emerald-500' },
  { id: 'Expedição',      label: 'Expedição',     icon: Expedicao,   color: 'text-indigo-500' },
];

// Map legacy (pre-rename) step ids to their canonical equivalents.
// 'mesa' antigo virou Aviamento (PR 1); 'costura' antigo era apelido de
// Corte Forração (antes da PR 2 que criou Costura como setor próprio) — agora
// preservamos como setor canônico distinto.
const LEGACY_STEP_MAP: Record<string, string> = {
  corte:      'Corte Palmilha',
  palmilha:   'Corte Palmilha',
  forracao:   'Corte Forração',
  mesa:       'Aviamento',
  aviamento:  'Aviamento',
  costura:    'Costura',
  silk:       'Silk',
  colagem:    'Colagem',
  montagem:   'Montagem',
  solagem:    'Solagem',
  acabamento: 'Acabamento',
  expedicao:  'Expedição',
};

export function ProductionPipeline({ currentStep }: { orderId?: string, currentStep: string }) {
  const normalized = LEGACY_STEP_MAP[currentStep?.toLowerCase()] ?? currentStep;
  const currentIdx = STEPS.findIndex(s =>
    s.id === normalized ||
    s.id.toLowerCase() === normalized?.toLowerCase()
  );

  return (
    <div className="flex justify-between items-center w-full px-4 py-6 bg-card rounded-lg shadow-sm border overflow-x-auto">
      {STEPS.map((step, index) => {
        const isCompleted = currentIdx > index;
        const isCurrent = currentIdx === index;

        return (
          <div key={step.id} className="flex flex-1 items-center relative min-w-0">
            <div className="flex flex-col items-center z-10">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isCompleted ? 'bg-emerald-100 text-emerald-600 border-2 border-emerald-500' :
                  isCurrent ? `${step.color.replace('text', 'bg').replace('500', '100')} ${step.color} border-2 border-current scale-110 shadow-md` :
                  'bg-muted text-muted-foreground border-2 border-border'
                }`}
              >
                <step.icon className="w-4 h-4" />
              </div>
              <span className={`mt-1 text-[10px] font-medium text-center leading-tight ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                {step.label}
              </span>
            </div>

            {index < STEPS.length - 1 && (
              <div className="absolute top-4 left-[50%] right-[-50%] h-[2px] bg-muted -z-0">
                <div
                  className="h-full bg-emerald-500 transition-all duration-1000"
                  style={{ width: isCompleted ? '100%' : '0%' }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
