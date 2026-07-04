import { Plus, Trash as Trash2, Calculator, Info } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCan } from '@/hooks/useAccessControl';

/**
 * ⚠ SCAFFOLD NÃO LIGADO — este componente não está importado em lugar nenhum
 * do app (a edição real do BOM mora nos painéis de ficha técnica/financeiro,
 * que usam `src/lib/materialConsumption.ts`). Mantido como referência de UI.
 *
 * REGRA DE CONSUMO (CANÔNICA, ver CLAUDE.md):
 * - Material de ÁREA cortado de bobina (napa, couro, forro): `quantity_per_unit`
 *   está em **dm²/par**. NUNCA exibir/multiplicar cru como unidade linear — tem
 *   que ser convertido pela LARGURA da ficha de componente (`component_sheets`).
 *   Multiplicar dm²/par × qtd direto inflava ~100× (bug histórico 2026-05-30:
 *   napa 5,7 dm²/par × 720 = 4104 "m" em vez de ~30 m no PV-00116).
 * - Item linear DIRETO (tira, elástico) sem ficha de componente: já está na
 *   unidade nativa (metro/contagem) → NÃO converter.
 * - Cabedal e forro NÃO entram no BOM — são campos diretos da ficha
 *   (`upper_material` / `lining_material`). O BOM cobre só insumos avulsos.
 *
 * Logo, a coluna "Consumo/Par" abaixo é o valor BRUTO armazenado (dm²/par para
 * material de área); a conversão pra unidade física acontece no motor de
 * consumo, não aqui.
 */
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
  const perm = useCan('/fichas-tecnicas');
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2 font-bold text-foreground">
          <Calculator className="w-5 h-5 text-primary" />
          Lista de Materiais & Consumo (BOM)
        </div>
        {perm.canEdit && (
          <Button onClick={onAddMaterial} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Adicionar Insumo
          </Button>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Material de área (napa, couro, forro) é informado em{' '}
          <strong>dm²/par</strong> — convertido para a unidade física pela largura da
          ficha de componente. Item linear direto (tira, elástico) já vai na unidade
          nativa. Cabedal e forro ficam nos campos da ficha, não aqui.
        </span>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b text-muted-foreground uppercase text-xs font-bold">
              <th className="px-4 py-3 text-left">Componente</th>
              <th className="px-4 py-3 text-left">Material / Insumo</th>
              <th className="px-4 py-3 text-center">Unid.</th>
              <th className="px-4 py-3 text-right">Consumo/Par (bruto)</th>
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
                  <Button variant="outline" className="h-8 w-full justify-start text-xs text-muted-foreground font-normal px-2">
                    {/* Busca no seu estoque global */}
                    Selecionar material do estoque...
                  </Button>
                </td>
                <td className="px-4 py-2 text-center text-muted-foreground">
                  {item.unit || 'un'}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Input type="number" placeholder="0.000" className="h-8 text-xs w-24" />
                    <span className="text-xs text-muted-foreground w-10 text-left">
                      {item.unit || 'un'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2 text-center">
                  {perm.canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onRemoveMaterial(index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
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
