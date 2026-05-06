import { Button } from '@/components/ui/button';
import { PackageCheck, ShoppingCart, Info } from 'lucide-react';
import { ExplodedMaterial } from '@/hooks/useMaterialExplosion';

interface StockValidationResult {
  variant_id?: string;
  grid: Record<string, number>;
  generatePurchaseOrder: boolean;
  missingMaterials: { materialId: string; name: string; unit: string; missingAmount: number; currentStock: number }[];
}

interface Props {
  materials: ExplodedMaterial[];
  variantId?: string;
  grid: Record<string, number>;
  onBack: () => void;
  onConfirm: (result: StockValidationResult) => void;
}

export default function OrderStockValidationStep({ materials, variantId, grid, onBack, onConfirm }: Props) {
  const insufficientMaterials = materials.filter(m => !m.hasEnough);
  const hasAllStock = insufficientMaterials.length === 0;

  const missingMaterials = insufficientMaterials.map(m => ({
    materialId: m.materialId,
    name: m.name,
    unit: m.unit,
    missingAmount: Math.max(0, m.totalNeeded - m.availableStock),
    currentStock: m.availableStock,
  }));

  const handleConfirm = () => {
    onConfirm({
      variant_id: variantId,
      grid,
      generatePurchaseOrder: !hasAllStock,
      missingMaterials,
    });
  };

  return (
    <div className="space-y-6 animate-in zoom-in duration-300">
      {/* Status principal */}
      <div className={`p-6 rounded-2xl border-2 transition-all ${
        hasAllStock
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950'
          : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'
      }`}>
        <div className="flex justify-center mb-4">
          {hasAllStock
            ? <PackageCheck className="h-12 w-12 text-emerald-600" />
            : <ShoppingCart className="h-12 w-12 text-amber-600" />
          }
        </div>

        <h3 className="font-bold text-lg text-center">
          {hasAllStock ? 'Pronto para Produzir' : 'Atenção: Necessário Compra'}
        </h3>

        <p className="text-sm text-center text-muted-foreground mt-2">
          {hasAllStock
            ? `Todos os ${materials.length} materiais disponíveis em estoque.`
            : `${insufficientMaterials.length} material(is) com estoque insuficiente.`
          }
        </p>
      </div>

      {/* Tabela de materiais */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="p-3 text-left">Material</th>
              <th className="p-3 text-right">Necessário</th>
              <th className="p-3 text-right">Disponível</th>
              <th className="p-3 text-right">Falta</th>
            </tr>
          </thead>
          <tbody>
            {materials.map(m => {
              const missing = Math.max(0, m.totalNeeded - m.availableStock);
              return (
                <tr key={m.materialId} className={`border-t ${!m.hasEnough ? 'bg-destructive/5' : ''}`}>
                  <td className="p-3 font-medium">
                    <span>{m.name}</span>
                    {m.color && <span className="text-xs text-muted-foreground ml-1">({m.color})</span>}
                  </td>
                  <td className="p-3 text-right font-mono">{m.totalNeeded.toFixed(2)} {m.unit}</td>
                  <td className={`p-3 text-right font-mono ${m.hasEnough ? 'text-emerald-600' : 'text-destructive'}`}>
                    {m.availableStock.toFixed(2)} {m.unit}
                  </td>
                  <td className="p-3 text-right font-mono font-bold">
                    {missing > 0 ? (
                      <span className="text-destructive">-{missing.toFixed(2)}</span>
                    ) : (
                      <span className="text-emerald-600">✓</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Aviso de brecha de produção */}
      {!hasAllStock && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase flex items-center gap-2">
            <Info className="h-3 w-3" /> Brecha de Produção Ativada
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            O pedido será salvo e uma Ordem de Compra será gerada automaticamente para os {insufficientMaterials.length} material(is) faltante(s).
          </p>
        </div>
      )}

      {/* Navegação */}
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>Voltar</Button>
        <Button
          onClick={handleConfirm}
          className={hasAllStock
            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
            : 'bg-amber-600 hover:bg-amber-700 text-white'
          }
        >
          {hasAllStock ? 'Finalizar & Gerar OP' : 'Gerar OP + Ordem de Compra'}
        </Button>
      </div>
    </div>
  );
}
