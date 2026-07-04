import { Stack as Layers, Scissors, Cube as Box, Info } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { InlineEdit } from '../ui/InlineEdit';
import { parseSafeNumber, safeToFixed } from '@/lib/utils';
import { useCan } from '@/hooks/useAccessControl';

export interface ProductTechnicalSheetProps {
  product: {
    id: string;
    sku: string;
    name: string;
    total_cost: number;
    components: Array<{
      id: string;
      sector: string;
      part_name: string;
      material_name: string;
      unit: string;
      consumption: number;
      unit_price: number;
    }>;
  };
}

export function ProductTechnicalSheet({ product }: ProductTechnicalSheetProps) {
  const perm = useCan('/fichas-tecnicas');
  return (
    <div className="space-y-6">
      {/* 1. CABEÇALHO E ESTRUTURA BASE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 font-bold mb-4">
            <Info className="w-4 h-4 text-primary" />
            Dados Básicos
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase">REFERÊNCIA</label>
              <InlineEdit value={product.sku} productId={product.id} column="sku" />
            </div>
            <div className="mt-2">
              <label className="text-xs font-bold text-muted-foreground uppercase">DESCRIÇÃO</label>
              <InlineEdit value={product.name} productId={product.id} column="name" />
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 font-bold mb-4">
            <Box className="w-4 h-4 text-amber-500" />
            Estrutura (Base do Modelo)
          </div>
          <div className="space-y-3">
            <div className="bg-muted/50 p-2 rounded">
              <label className="text-xs font-bold text-muted-foreground uppercase">SOLADO (Fator Principal)</label>
              <div className="font-medium text-primary">
                <select className="w-full bg-transparent border-none focus:ring-0 text-sm">
                  <option>Selecione um Solado...</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/50 p-2 rounded">
                <label className="text-xs font-bold text-muted-foreground uppercase">FÔRMA</label>
                <div className="text-sm font-medium">--</div>
              </div>
              <div className="bg-muted/50 p-2 rounded">
                <label className="text-xs font-bold text-muted-foreground uppercase">PALMILHA</label>
                <div className="text-sm font-medium">--</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 font-bold mb-4">
            <Layers className="w-4 h-4 text-purple-500" />
            Configuração de Silk
          </div>
          <div className="text-center text-muted-foreground py-4 text-sm italic">
            Configurações de Silk indisponíveis
          </div>
        </Card>
      </div>

      {/* 2. TABELA DE CONSUMO DE COMPONENTES */}
      <Card className="p-0 overflow-hidden">
        <div className="bg-muted/50 p-4 border-b flex justify-between items-center">
          <div className="flex items-center gap-2 font-bold">
            <Scissors className="w-4 h-4 text-destructive" />
            Listagem de Materiais e Consumo
          </div>
          {perm.canEdit && (
            <button className="text-xs bg-card hover:bg-muted border px-3 py-1 rounded shadow-sm transition-all flex items-center gap-1">
              + Adicionar Componente
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground uppercase text-xs border-b">
              <tr>
                <th className="p-3 text-left font-medium">Setor</th>
                <th className="p-3 text-left font-medium">Componente</th>
                <th className="p-3 text-left font-medium">Material</th>
                <th className="p-3 text-center font-medium">Unid.</th>
                <th className="p-3 text-right font-medium">Consumo/Par</th>
                <th className="p-3 text-right font-medium">Custo Est.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {product.components?.map((comp) => (
                <tr key={comp.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3">{comp.sector}</td>
                  <td className="p-3">{comp.part_name}</td>
                  <td className="p-3 font-medium">{comp.material_name}</td>
                  <td className="p-3 text-center">{comp.unit}</td>
                  <td className="p-3 text-right">
                    <div className="inline-block w-20">
                      <InlineEdit
                        value={comp.consumption}
                        productId={comp.id}
                        column="consumption"
                        table="sheet_materials"
                      />
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono text-xs">
                    R$ {(parseSafeNumber(comp.unit_price) * parseSafeNumber(comp.consumption)).toFixed(2)}
                  </td>
                </tr>
              ))}
              {!product.components?.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground italic">
                    Nenhum componente cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="bg-muted/30 p-4 text-right border-t">
            <span className="text-muted-foreground mr-4 uppercase text-xs font-bold">Custo Total de Materiais:</span>
            <span className="text-lg font-bold text-foreground">
              R$ {safeToFixed(product.total_cost, 2)}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
