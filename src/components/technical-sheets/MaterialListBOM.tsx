import { Plus, Trash2, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Material {
  unit?: string;
  [key: string]: any;
}

interface MaterialListBOMProps {
  materials: Material[];
  onAddMaterial: () => void;
  onRemoveMaterial: (index: number) => void;
}

export function MaterialListBOM({ materials, onAddMaterial, onRemoveMaterial }: MaterialListBOMProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2 font-bold text-foreground">
          <Calculator className="w-5 h-5 text-primary" />
          Lista de Materiais & Consumo (BOM)
        </div>
        <Button onClick={onAddMaterial} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Adicionar Insumo
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b text-muted-foreground uppercase text-[10px] font-bold">
              <th className="px-4 py-3 text-left">Componente</th>
              <th className="px-4 py-3 text-left">Material / Insumo</th>
              <th className="px-4 py-3 text-center">Unid.</th>
              <th className="px-4 py-3 text-right">Consumo/Par</th>
              <th className="px-4 py-3 text-center">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {materials.map((item, index) => (
              <tr key={index}>
                <td className="px-4 py-2">
                  <Input placeholder="Peça..." className="h-8 text-xs" />
                </td>
                <td className="px-4 py-2">
                  <Button variant="outline" className="h-8 w-full justify-start text-[10px] text-muted-foreground font-normal px-2">
                    {/* Busca no seu estoque global */}
                    Selecionar material do estoque...
                  </Button>
                </td>
                <td className="px-4 py-2 text-center text-muted-foreground">
                  {item.unit || 'un'}
                </td>
                <td className="px-4 py-2 text-right">
                  <Input type="number" placeholder="0.000" className="h-8 text-xs w-24 ml-auto" />
                </td>
                <td className="px-4 py-2 text-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onRemoveMaterial(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {materials.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground italic">
                  Nenhum material adicionado. Clique em "Adicionar Insumo" para começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
