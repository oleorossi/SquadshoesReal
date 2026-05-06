import React from 'react';
import { CalculoCusto } from '@/services/planejamento';
import { Badge } from '@/components/ui/badge';
import { AlertCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const CATEGORIA_LABEL = { ok: 'Disponível', baixo: 'Baixo Estoque', critico: 'Crítico' } as const;

interface TabelaPlanejamentoProps {
  calculos: CalculoCusto[];
}

export const TabelaPlanejamento: React.FC<TabelaPlanejamentoProps> = ({ calculos }) => {
  if (calculos.length === 0) {
    return <p className="text-center text-muted-foreground py-8">Nenhum material para exibir</p>;
  }

  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Material</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Estoque</TableHead>
            <TableHead className="text-right">Necessário</TableHead>
            <TableHead className="text-right">A Comprar</TableHead>
            <TableHead className="text-right">Custo Total</TableHead>
            <TableHead>Entrega</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calculos.map((c) => (
            <TableRow key={c.materialId}>
              <TableCell className="font-mono text-xs">{c.sku}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {c.categoria === 'critico' && <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                  <span className="font-medium text-foreground">{c.nome}</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={c.categoria === 'ok' ? 'default' : c.categoria === 'critico' ? 'destructive' : 'secondary'}>
                  {CATEGORIA_LABEL[c.categoria]}
                </Badge>
              </TableCell>
              <TableCell className="text-right text-muted-foreground">{c.estoqueConverted.toFixed(2)} {c.unidadeEstoque}</TableCell>
              <TableCell className="text-right text-muted-foreground">{c.quantidadeNecessaria.toFixed(2)} {c.unidadeNecessaria}</TableCell>
              <TableCell className="text-right font-medium text-foreground">{c.quantidadeAComprar} {c.unidadeCompra}</TableCell>
              <TableCell className="text-right font-semibold text-foreground">R$ {c.custoTotal.toFixed(2)}</TableCell>
              <TableCell className="text-muted-foreground">{c.dataVencimento} ({c.tempoReposicao}d)</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
