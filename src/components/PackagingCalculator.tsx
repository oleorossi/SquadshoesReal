import { useMemo } from 'react';
<<<<<<< Updated upstream
import { Box, Stack as Layers, Link as LinkIcon, WarningCircle as AlertCircle, Package, ArrowRight } from '@phosphor-icons/react';
=======
import { Cube as Box, Stack as Layers, Link as LinkIcon, WarningCircle as AlertCircle, Package, ArrowRight } from '@phosphor-icons/react';
>>>>>>> Stashed changes
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { calculateBestPackaging } from '@/utils/packaging-calculator';
import { PackagingResult } from '@/types/packaging';

interface PackagingCalculatorProps {
  totalPairs: number;
  modelName: string;
  preferredMethod?: string;
  individualBoxDims?: { l: number; w: number; h: number };
}

export function PackagingCalculator({
  totalPairs,
  modelName,
  preferredMethod = 'master',
  individualBoxDims = { l: 30, w: 20, h: 12 }
}: PackagingCalculatorProps) {

  const result = useMemo(() => {
    return calculateBestPackaging(totalPairs, preferredMethod, individualBoxDims);
  }, [totalPairs, preferredMethod, individualBoxDims]);

  const getMethodBadge = (method: PackagingResult['method']) => {
    switch (method) {
      case 'master':
        return <Badge variant="default" className="bg-blue-600">Caixa Master</Badge>;
      case 'colmeia':
        return <Badge variant="secondary" className="bg-purple-600 text-white">Colmeia</Badge>;
      case 'amarrado':
        return <Badge variant="outline" className="border-orange-500 text-orange-600">Amarrado</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto overflow-hidden shadow-lg">
      <CardHeader className="bg-muted/40 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Package className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl font-bold text-foreground">Sugestão de Embalagem</CardTitle>
              <p className="text-sm text-muted-foreground font-medium">{modelName}</p>
            </div>
          </div>
          {getMethodBadge(result.method)}
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Opção Escolhida Automaticamente */}
          <div className="flex flex-col items-center p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 transition-all hover:shadow-md">
            <div className="p-2 bg-blue-500/15 rounded-full mb-3">
              <Layers className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-1">
              {result.method === 'master' ? 'Caixas Master' : result.method === 'colmeia' ? 'Colmeias' : 'Amarrados'}
            </span>
            <span className="text-3xl font-bold text-foreground">{result.quantityMaster}</span>
            <span className="text-[10px] text-muted-foreground font-medium mt-1">
              (Contendo 12 pares cada)
            </span>
          </div>

          <div className="flex flex-col items-center p-4 rounded-xl bg-muted/50 border border-border transition-all hover:shadow-md">
            <div className="p-2 bg-muted rounded-full mb-3">
              <LinkIcon className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Amarrado</span>
            <span className="text-3xl font-bold text-foreground">0</span>
            <span className="text-[10px] text-muted-foreground font-medium mt-1">Nenhum adicional</span>
          </div>

          <div className="flex flex-col items-center p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 transition-all hover:shadow-md">
            <div className="p-2 bg-amber-500/15 rounded-full mb-3">
              <Box className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 mb-1">Sobra Indiv.</span>
            <span className="text-3xl font-bold text-foreground">{result.remainingIndividual}</span>
            <span className="text-[10px] text-amber-600/70 font-medium mt-1">pares avulsos</span>
          </div>
        </div>

        <div className="p-4 bg-primary rounded-xl shadow-inner">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary-foreground/70 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary-foreground/50 mb-1">Resumo Logístico</p>
              <p className="text-sm leading-relaxed text-primary-foreground">
                Utilizar <span className="text-lime-400 font-bold">{result.quantityMaster}</span> {result.method === 'master' ? 'Caixas Master G' : 'Colmeias G'}
                {result.remainingIndividual > 0 && (
                  <> + <span className="text-amber-400 font-bold">{result.remainingIndividual}</span> Caixas Individuais nº 14</>
                )}.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-between items-center text-[10px] text-muted-foreground px-1 italic">
          <span>* Cálculo sugerido com base nas dimensões do modelo e volume total</span>
          <span className="flex items-center gap-1">Total: {totalPairs} pares <ArrowRight className="w-3 h-3" /></span>
        </div>
      </CardContent>
    </Card>
  );
}
