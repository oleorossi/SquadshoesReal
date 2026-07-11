import { Scissors, Stack as Layers, GridFour as LayoutGrid, Pen, PaintBrush as Paintbrush, Wind, Hammer, Footprints, Sparkle as Sparkles, Truck } from '@phosphor-icons/react';

// Ordem canônica pós PR1-PR3: prep (Palmilha‖Forração‖Aviamento) → Costura → restantes.
// bg precisa ser classe LITERAL (Tailwind JIT não gera classe montada em runtime)
const STEPS = [
  { id: 'Corte Palmilha', label: 'C. Palmilha',  icon: Scissors,    color: 'text-orange-500',  bg: 'bg-orange-500/10' },
  { id: 'Corte Forração', label: 'C. Forração',  icon: Layers,      color: 'text-teal-500',    bg: 'bg-teal-500/10' },
  { id: 'Aviamento',      label: 'Aviamento',    icon: LayoutGrid,  color: 'text-purple-500',  bg: 'bg-purple-500/10' },
  { id: 'Costura',        label: 'Costura',      icon: Pen,         color: 'text-rose-500',    bg: 'bg-rose-500/10' },
  { id: 'Silk',           label: 'Silk',          icon: Paintbrush,  color: 'text-pink-500',    bg: 'bg-pink-500/10' },
  { id: 'Colagem',        label: 'Colagem',       icon: Wind,        color: 'text-amber-500',   bg: 'bg-amber-500/10' },
  { id: 'Montagem',       label: 'Montagem',      icon: Hammer,      color: 'text-blue-500',    bg: 'bg-blue-500/10' },
  { id: 'Solagem',        label: 'Solagem',       icon: Footprints,  color: 'text-lime-500',    bg: 'bg-lime-500/10' },
  { id: 'Acabamento',     label: 'Acabamento',    icon: Sparkles,    color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  { id: 'Expedição',      label: 'Expedição',     icon: Truck,       color: 'text-indigo-500',  bg: 'bg-indigo-500/10' },
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
                  isCompleted ? 'bg-emerald-500/10 text-emerald-600 border-2 border-emerald-500' :
                  isCurrent ? `${step.bg} ${step.color} border-2 border-current scale-110 shadow-md` :
                  'bg-muted text-muted-foreground border-2 border-border'
                }`}
              >
                <step.icon className="w-4 h-4" />
              </div>
              <span className={`mt-1 text-xs font-medium text-center leading-tight ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
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
