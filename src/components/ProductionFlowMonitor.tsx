import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Scissors, Hammer, PackageCheck, ChevronRight, LucideIcon } from 'lucide-react';

interface SectorStatus {
  name: string;
  icon: LucideIcon;
  daysAhead: number; // Dias de produção já prontos/adiantados
  totalOrders: number;
  completedOrders: number;
  status: 'optimal' | 'warning' | 'critical';
}

const ProductionFlowMonitor = () => {
  // Simulação de dados vindos da API de OPs (Ordens de Produção)
  const sectors: SectorStatus[] = [
    { name: 'Corte', icon: Scissors, daysAhead: 12, totalOrders: 150, completedOrders: 120, status: 'optimal' },
    { name: 'Preparação/Aviamento', icon: PackageCheck, daysAhead: 5, totalOrders: 150, completedOrders: 80, status: 'warning' },
    { name: 'Montagem', icon: Hammer, daysAhead: 1, totalOrders: 150, completedOrders: 40, status: 'critical' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
      {sectors.map((sector) => (
        <Card key={sector.name} className={`border-l-4 ${
          sector.status === 'optimal' ? 'border-l-green-500' : 
          sector.status === 'warning' ? 'border-l-yellow-500' : 'border-l-red-500'
        }`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">{sector.name}</CardTitle>
            <sector.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="display text-2xl tabular-nums">{sector.daysAhead} Dias</div>
            <p className="text-xs text-muted-foreground">de frente na produção</p>
            
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span>Progresso da Meta</span>
                <span>{Math.round((sector.completedOrders / sector.totalOrders) * 100)}%</span>
              </div>
              <Progress value={(sector.completedOrders / sector.totalOrders) * 100} className="h-1.5" />
            </div>

            {sector.daysAhead >= 7 && (
              <Badge variant="secondary" className="mt-3 bg-blue-100 text-blue-700 hover:bg-blue-100 border-none">
                <ChevronRight className="h-3 w-3 mr-1" /> Puxando pedidos de 15 dias
              </Badge>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default ProductionFlowMonitor;
