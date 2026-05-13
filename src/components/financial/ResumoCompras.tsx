import React from 'react';
import { ResumoCalculoCompras } from '@/services/planejamento';
import { Card, CardContent } from '@/components/ui/card';
import { Warning as AlertTriangle, TrendUp as TrendingUp, Package } from '@phosphor-icons/react';

interface ResumoComprasProps {
  resumo: ResumoCalculoCompras;
}

export const ResumoCompras: React.FC<ResumoComprasProps> = ({ resumo }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <TrendingUp className="h-8 w-8 text-primary shrink-0" />
          <div>
            <p className="text-sm text-muted-foreground">Custo Total</p>
            <p className="text-2xl font-bold text-foreground">R$ {resumo.custoTotal.toFixed(2)}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <AlertTriangle className={`h-8 w-8 shrink-0 ${resumo.quantidadeItens.critico > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
          <div>
            <p className="text-sm text-muted-foreground">Críticos</p>
            <p className="text-2xl font-bold text-foreground">{resumo.quantidadeItens.critico}</p>
            <p className="text-xs text-muted-foreground">R$ {resumo.custoPorCategoria.critico.toFixed(2)}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <Package className="h-8 w-8 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm text-muted-foreground">Próxima Análise</p>
            <p className="text-lg font-semibold text-foreground">{resumo.dataProximaAnalise}</p>
            <p className="text-xs text-muted-foreground">Daqui a 7 dias</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
