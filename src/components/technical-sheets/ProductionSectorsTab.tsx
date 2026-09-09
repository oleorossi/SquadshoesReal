import { useEffect, useState } from 'react';
import { CircleNotch as Loader2, Factory, FloppyDisk as Save } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { SectionTitle } from '@/components/technical-sheets/sheetFormFields';

export const ALL_PRODUCTION_SECTORS = [
   // Sub-etapas paralelas de Corte (decisão 2026-05-12):
   //   - Corte Fibra: sempre (todo sapato tem palmilha)
   //   - Corte Forração: quando o modelo tem forração na palmilha
   // Costura dividida em DOIS setores independentes que trabalham lado a lado
   // (decisão do dono 2026-10-01, migration 20261001120000):
   //   - Costura Palmilha: costura palmilha + forração (interna)
   //   - Costura Cabedal: costura do cabedal (é a terceirizável)
   // ⚠ 'Corte Cabedal' NÃO é selecionável: o trigger
   // tg_normalize_production_sectors descarta ele do array (fora da lista
   // canônica), então o chip era salvo e sumia em silêncio. A impressão
   // decide essa sub-etapa pelos sinais reais de identidade/consumo do
   // Cabedal; tiras habilitadas são um fluxo independente.
   // ⚠ A ordem aqui espelha `canonical_stage_order()` no banco. Setor que
   // você adicionar aqui TEM que entrar na lista canônica do trigger também,
   // senão o usuário marca, salva, e o valor desaparece sem erro.
   { name: 'Corte Fibra',      order: 1 },
   { name: 'Corte Forração',   order: 2 },
   { name: 'Costura Palmilha', order: 3 },
   { name: 'Costura Cabedal',  order: 4 },
   { name: 'Aviamento',        order: 5 },
   { name: 'Silk',           order: 6 },
   { name: 'Colagem',        order: 7 },
   { name: 'Montagem',       order: 8 },
   { name: 'Solagem',        order: 9 },
   { name: 'Acabamento',     order: 10 },
   { name: 'Expedição',      order: 11 },
 ];

// Setores removidos automaticamente pelo trigger do banco
// (tg_strip_cut_sectors_when_ready_made) quando a palmilha é pronta na cor.
// O editor desabilita os chips pra não fingir que a seleção foi salva.
// Palmilha pronta na cor ⇒ não há palmilha pra cortar nem pra costurar. A
// costura de CABEDAL segue valendo (é outro componente).
const READY_MADE_STRIPPED_SECTORS = ['Corte Fibra', 'Corte Forração', 'Costura Palmilha'];
 
// Etapas fixas do setor Aviamento. Quando o user marca Aviamento em
// production_sectors, abre um sub-painel pra escolher quais dessas etapas
// se aplicam à ficha. A ficha de operador renderiza checklist por etapa.
const AVIAMENTO_STEPS = [
  'Frente',
  'Traseira',
  'Costura de tiras',
] as const;

// Rótulos disponíveis pra cada tira na "Configuração de Tiras" (onde se
// define material + consumo por numeração). Antes o rótulo era fixo
// "TIRA 1/2/3" (badge read-only); agora o usuário escolhe — útil pra marcar
// uma tira única ("TIRA") ou a de trás ("TRASEIRA"). UPPERCASE pra casar com
// os defaults antigos já gravados ('TIRA 1' etc.) sem precisar de migração.
// O label escolhido propaga pro pedido de venda ("Cores das Tiras"), pro
// resumo de tiras e pras fichas de operador (useOrderStraps lê strap.label).
export const STRAP_LABEL_OPTIONS = [
  'TIRA',
  'TIRA 1',
  'TIRA 2',
  'TIRA 3',
  'FRENTE',
  'TRASEIRA',
  'LATERAL',
] as const;

export function ProductionSectorsTab({
  sectors, onSave,
  aviamentoSteps,
  insoleReadyMade = false,
  saving = false,
}: {
  sectors: string[];
  onSave: (sectors: string[], aviamentoSteps: string[]) => void;
  aviamentoSteps: string[];
  /** Palmilha pronta na cor: o trigger do banco remove Corte Fibra/
   *  Corte Forração/Costura do roteiro — os chips ficam desabilitados. */
  insoleReadyMade?: boolean;
  saving?: boolean;
}) {
   const [localSectors, setLocalSectors] = useState<string[]>(sectors);
   const [localSteps, setLocalSteps] = useState<string[]>(aviamentoSteps);

   // Re-sincroniza com o valor PERSISTIDO quando a prop muda (refetch
   // pós-save). Sem isso, o painel continuava exibindo a seleção do usuário
   // mesmo quando um trigger do banco a revertia — e ele só descobria na
   // impressão, quando o setor "salvo" não saía (ou saía um removido).
   // Keyed pelo CONTEÚDO (JSON), não pela referência: o pai recria o array a
   // cada render e um dep cru resetaria a edição em andamento.
   const sectorsKey = JSON.stringify(sectors);
   const stepsKey = JSON.stringify(aviamentoSteps);
   useEffect(() => { setLocalSectors(JSON.parse(sectorsKey)); }, [sectorsKey]);
   useEffect(() => { setLocalSteps(JSON.parse(stepsKey)); }, [stepsKey]);

   const toggle = (sectorName: string) => {
    setLocalSectors(prev => {
      const next = prev.includes(sectorName)
        ? prev.filter(s => s !== sectorName)
        : [...prev, sectorName].sort((a, b) => {
            const orderA = ALL_PRODUCTION_SECTORS.find(s => s.name === a)?.order || 99;
            const orderB = ALL_PRODUCTION_SECTORS.find(s => s.name === b)?.order || 99;
            return orderA - orderB;
          });
      return next;
    });
  };

  const toggleStep = (step: string) => {
    setLocalSteps(prev =>
      prev.includes(step) ? prev.filter(s => s !== step) : [...prev, step],
    );
  };

  const isAviamentoActive = localSectors.includes('Aviamento');
  const hasChanges = JSON.stringify(localSectors) !== JSON.stringify(sectors)
    || (isAviamentoActive && JSON.stringify(localSteps) !== JSON.stringify(aviamentoSteps));

  return (
    <div className="space-y-4">
      <SectionTitle>Setores de Produção</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Selecione quais setores esta referência passa durante a produção. Apenas os setores marcados serão criados nas Ordens de Produção.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
         {ALL_PRODUCTION_SECTORS.map(sector => {
           const isActive = localSectors.includes(sector.name);
           // Pronta na cor: o trigger do banco remove esses setores em todo
           // save — marcar aqui era desfeito em silêncio (toast de sucesso
           // enganava e a ficha do setor nunca saía na impressão).
           const lockedByReadyMade = insoleReadyMade && READY_MADE_STRIPPED_SECTORS.includes(sector.name);
           return (
             <button
               key={sector.name}
               type="button"
               disabled={lockedByReadyMade}
               onClick={() => toggle(sector.name)}
               title={lockedByReadyMade
                 ? 'Indisponível: palmilha pronta na cor — o sistema remove este setor do roteiro automaticamente. Desligue "Palmilha pronta na cor" para usá-lo.'
                 : sector.name}
               className={cn(
                 'flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all min-w-0',
                 lockedByReadyMade
                   ? 'border-border bg-muted/20 text-muted-foreground/50 cursor-not-allowed opacity-60'
                   : isActive
                     ? 'border-primary bg-primary/10 text-primary cursor-pointer'
                     : 'border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground/50 cursor-pointer'
               )}
             >
               <Checkbox checked={isActive && !lockedByReadyMade} className="pointer-events-none shrink-0" />
               <span className="truncate">{sector.name}</span>
             </button>
           );
         })}
      </div>
      {insoleReadyMade && (
        <p className="text-xs text-warning">
          ⚠ Palmilha pronta na cor: Corte Fibra, Corte Forração e Costura são removidos do roteiro automaticamente.
        </p>
      )}

      {/* Sub-painel Aviamento: aparece só quando Aviamento está selecionado.
          Cada etapa marcada vira uma linha de checklist na ficha de operador
          de Aviamento (Frente/Traseira/Costura de tiras × numerações). */}
      {isAviamentoActive && (
        <div className="rounded-lg border-2 border-warning/30 bg-warning/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-warning">
            <Factory className="h-4 w-4 shrink-0" />
            <span className="text-sm font-bold">Etapas de Aviamento</span>
            <span className="text-xs text-muted-foreground">
              Marque quais aplicar nesta ficha · vira checklist na ficha de operador
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {AVIAMENTO_STEPS.map(step => {
              const isStepActive = localSteps.includes(step);
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => toggleStep(step)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-all min-w-0',
                    isStepActive
                      ? 'border-warning/40 bg-warning/10 text-warning cursor-pointer'
                      : 'border-border bg-card text-muted-foreground hover:border-warning/40 cursor-pointer'
                  )}
                >
                  <Checkbox checked={isStepActive} className="pointer-events-none shrink-0" />
                  <span className="truncate">{step}</span>
                </button>
              );
            })}
          </div>
          {localSteps.length === 0 && (
            <p className="text-xs text-warning">
              ⚠ Nenhuma etapa marcada — ficha de operador vai aparecer sem checklist de Aviamento.
            </p>
          )}
        </div>
      )}

      {hasChanges && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2">
          <span className="text-sm text-primary font-medium">
            {localSectors.length} setor(es){isAviamentoActive ? ` · ${localSteps.length} etapa(s) Aviamento` : ''}
          </span>
          <Button
            size="sm"
            onClick={() => onSave(localSectors, localSteps)}
            disabled={saving}
            className="gap-1"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {localSectors.map(s => (
          <Badge key={s} variant="default" className="text-xs">{s}</Badge>
        ))}
        {localSectors.length === 0 && (
          <span className="text-sm text-destructive">⚠ Nenhum setor selecionado — a OP usará todos os setores padrão.</span>
        )}
      </div>
    </div>
  );
}

