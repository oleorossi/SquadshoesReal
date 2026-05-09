import { ShoppingCart, AlertCircle, ArrowDownToLine } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface MaterialNeedItem {
  material_name: string;
  current_stock: number;
  total_needed: number;
  missing_qty: number;
  unit: string;
}

interface MaterialNeedGroup {
  group_name: string;
  items: MaterialNeedItem[];
}

interface MaterialNeedsReportProps {
  needsData: MaterialNeedGroup[];
}

export function MaterialNeedsReport({ needsData }: MaterialNeedsReportProps) {
  if (!needsData || needsData.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <ShoppingCart className="mx-auto h-12 w-12 mb-4 opacity-20" />
        <p>Nenhuma necessidade de material identificada para os pedidos confirmados.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-primary/5 p-6 rounded-lg border border-primary/10">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <h2 className="display text-xl text-primary">Planejamento de Compras (MRP)</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Necessidades baseadas no DNA dos Solados e Pedidos Ativos
          </p>
        </div>
        <Button className="flex items-center gap-2">
          <ArrowDownToLine className="h-4 w-4" />
          Exportar para Compras
        </Button>
      </div>

      <div className="grid gap-6">
        {needsData.map((group, groupIdx) => (
          <Card key={groupIdx} className="overflow-hidden border-t-4 border-t-primary">
            <div className="bg-muted/30 p-4 flex items-center justify-between border-b">
              <h3 className="font-bold text-lg">GRUPO: {group.group_name}</h3>
              <Badge variant="secondary">
                {group.items.length} ITENS PENDENTES
              </Badge>
            </div>
            
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material/Cor</TableHead>
                    <TableHead className="text-right">Estoque Atual</TableHead>
                    <TableHead className="text-right">Consumo Total (Pedidos)</TableHead>
                    <TableHead className="text-right">Falta Comprar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((item, itemIdx) => (
                    <TableRow key={itemIdx}>
                      <TableCell className="font-medium">{item.material_name}</TableCell>
                      <TableCell className="text-right">
                        {item.current_stock} {item.unit}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.total_needed} {item.unit}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm font-semibold bg-destructive/10 text-destructive">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {item.missing_qty} {item.unit}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
