import { CheckCircle, Info, Lightning as Zap } from '@phosphor-icons/react';

interface Recommendation {
  status: 'SUCESSO' | 'EXCESSO';
  bestMatch?: {
    name: string;
  };
  occupancy: number;
  efficiency: 'ALTA' | 'BAIXA';
}

export function SmartDispatch({ recommendation, orderVolume }: { recommendation: Recommendation, orderVolume: number }) {
  if (recommendation.status === 'EXCESSO') {
    return (
      <div className="bg-destructive/90 p-6 rounded-3xl border-b-4 border-destructive text-destructive-foreground flex gap-4 items-center">
        <div className="h-12 w-12 bg-destructive-foreground/10 rounded-2xl flex items-center justify-center shrink-0">
          <Info className="h-6 w-6 text-destructive-foreground/70" />
        </div>
        <div>
          <h4 className="font-black uppercase tracking-tighter">Carga Excede a Frota</h4>
          <p className="text-xs opacity-70">O volume de {orderVolume.toFixed(2)}m³ exige contratação de transportadora externa ou duas viagens.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-primary p-6 rounded-3xl border-b-4 border-primary/50 text-primary-foreground animate-in slide-in-from-right duration-500">
      <div className="flex justify-between items-start mb-6">
        <div className="flex gap-3 items-center">
          <div className="h-10 w-10 bg-primary-foreground/15 rounded-xl flex items-center justify-center">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h4 className="text-xs font-black uppercase text-primary-foreground/60">Frota Recomendada</h4>
            <p className="text-lg font-black tracking-tighter uppercase italic">
              {recommendation.bestMatch?.name}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black font-mono leading-none">{recommendation.occupancy.toFixed(0)}%</p>
          <p className="text-xs font-bold text-primary-foreground/40 uppercase">Ocupação do Baú</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-primary-foreground/10 p-3 rounded-xl border border-primary-foreground/10">
          <p className="text-xs font-black text-primary-foreground/40 uppercase">Eficiência de Frete</p>
          <p className={`text-xs font-bold ${recommendation.efficiency === 'ALTA' ? 'text-lime-400' : 'text-amber-400'}`}>
            {recommendation.efficiency === 'ALTA' ? '🔥 ÓTIMA (Carga Cheia)' : '⚠️ MÉDIA (Espaço Sobrando)'}
          </p>
        </div>
        <div className="bg-primary-foreground/10 p-3 rounded-xl border border-primary-foreground/10">
          <p className="text-xs font-black text-primary-foreground/40 uppercase">Destino (Sugestão)</p>
          <p className="text-xs font-bold text-primary-foreground/80 uppercase italic">Grande Rio / RJ</p>
        </div>
      </div>

      <button className="w-full py-4 bg-primary-foreground/15 text-primary-foreground rounded-2xl font-black text-xs uppercase hover:bg-primary-foreground/25 border border-primary-foreground/20 transition-all flex items-center justify-center gap-2">
        <CheckCircle className="h-4 w-4" /> Confirmar Carregamento
      </button>
    </div>
  );
}
