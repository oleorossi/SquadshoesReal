import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
 import { Trash as Trash2, PlusCircle, FloppyDisk as Save, Copy, CircleNotch as Loader2, Info } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

 import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
   DialogFooter,
   DialogDescription,
 } from "@/components/ui/dialog";
 
 interface TechnicalSheetItem {
   id?: string;
   material_id: string;
   consumption_per_pair: number;
 }
 
 interface ReferencePreview {
   referenceName: string;
   referenceId: string;
   date: string;
   items: TechnicalSheetItem[];
 }

export function TechnicalSheetEditor({ product_id }: { product_id: string }) {
  const [items, setItems] = useState<TechnicalSheetItem[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
   const [saving, setSaving] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [referencePreview, setReferencePreview] = useState<ReferencePreview | null>(null);
   const [referenceInfo, setReferenceInfo] = useState<{ id: string; name: string; date: string } | null>(null);
 
   const pullLastFilled = async () => {
     setPulling(true);
     try {
       const { data: product } = await supabase.from('products').select('name').eq('id', product_id).single();
       if (!product) return;
 
       const baseName = product.name.split(" - ")[0];
 
       const { data: otherProducts } = await supabase
         .from('products')
         .select('id')
         .neq('id', product_id)
         .ilike('name', `${baseName}%`);
 
       if (!otherProducts || otherProducts.length === 0) {
         toast.info("Nenhuma referência similar encontrada.");
         return;
       }
 
        const { data: lastSheet } = await supabase
          .from('product_technical_sheets')
          .select('*, products!product_technical_sheets_parent_product_id_fkey(name)')
          .in('parent_product_id', otherProducts.map(p => p.id))
          .order('created_at', { ascending: false });
  
        if (!lastSheet || lastSheet.length === 0) {
         toast.info("Nenhuma ficha preenchida encontrada em referências similares.");
         return;
       }
 
       // Filtrar apenas itens do produto mais recentemente atualizado que tenha itens
        const mostRecentParentId = lastSheet[0].parent_product_id;
        const itemsToCopy = lastSheet.filter(item => item.parent_product_id === mostRecentParentId);
        const referenceName = (itemsToCopy[0] as any).products?.name || baseName;
        const referenceDate = new Date(itemsToCopy[0].created_at).toLocaleString('pt-BR');
 
        setReferencePreview({
          referenceName,
          referenceId: mostRecentParentId,
          date: referenceDate,
          items: itemsToCopy.map(item => ({
            material_id: item.material_id,
            consumption_per_pair: item.consumption_per_pair
          }))
        });
     } catch (err: any) {
       toast.error("Erro ao puxar dados: " + err.message);
     } finally {
       setPulling(false);
     }
   };
 

   const confirmPull = () => {
     if (!referencePreview) return;
     setItems(referencePreview.items);
      setReferenceInfo({
        id: referencePreview.referenceId,
        name: referencePreview.referenceName,
        date: referencePreview.date
      });
     setReferencePreview(null);
     toast.success(`Ficha técnica carregada da referência (${referencePreview.referenceName})`);
   };
 
  useEffect(() => {
    fetchData();
  }, [product_id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch existing technical sheet items
      const { data: existingItems, error: itemsError } = await supabase
        .from('product_technical_sheets')
        .select('*')
        .eq('parent_product_id', product_id);

      if (itemsError) throw itemsError;
      setItems(existingItems || []);
 
      // If there's a reference stored, fetch its info
      if (existingItems && existingItems.length > 0 && existingItems[0].reference_product_id) {
        const { data: refProd } = await supabase
          .from('products')
          .select('name')
          .eq('id', existingItems[0].reference_product_id)
          .single();
        
         if (refProd) {
           setReferenceInfo({
             id: existingItems[0].reference_product_id,
             name: refProd.name,
             date: new Date(existingItems[0].reference_date).toLocaleString('pt-BR')
           });
         }
      }

      // Fetch materials (products with specific categories or all products)
      const { data: allMaterials, error: materialsError } = await supabase
        .from('products')
        .select('id, name, unit, sku')
        .order('name');

      if (materialsError) throw materialsError;
      setMaterials(allMaterials || []);
    } catch (error: any) {
      toast.error("Erro ao carregar dados: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => {
    setItems([...items, { material_id: '', consumption_per_pair: 0 }]);
  };

  const removeItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const updateItem = (index: number, field: keyof TechnicalSheetItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // First, delete existing items for this product
      const { error: deleteError } = await supabase
        .from('product_technical_sheets')
        .delete()
        .eq('parent_product_id', product_id);

      if (deleteError) throw deleteError;

      // Then insert the new items
      if (items.length > 0) {
        const itemsToInsert = items
          .filter(item => item.material_id && item.consumption_per_pair > 0)
          .map(item => ({
            parent_product_id: product_id,
            material_id: item.material_id,
            consumption_per_pair: item.consumption_per_pair,
             reference_product_id: referenceInfo?.id || null,
             reference_date: referenceInfo ? new Date().toISOString() : null
          }));

        if (itemsToInsert.length > 0) {
          const { error: insertError } = await supabase
            .from('product_technical_sheets')
            .insert(itemsToInsert);

          if (insertError) throw insertError;
        }
      }

      toast.success("Ficha técnica salva com sucesso!");
      window.history.back();
    } catch (error: any) {
      toast.error("Erro ao salvar: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>Carregando...</div>;

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
      {referenceInfo && (
        <div className="bg-blue-50 border border-blue-200 p-2 rounded text-xs text-blue-800 flex items-center gap-2">
          <Info className="h-4 w-4" />
          <span>Baseado na referência: <strong>{referenceInfo.name}</strong> em {referenceInfo.date}</span>
        </div>
      )}
 
      <div className="flex items-center justify-between border-bottom pb-2">
         <h3 className="text-lg font-semibold flex items-center gap-2">
           <PlusCircle className="h-5 w-5" />
           Ficha Técnica (Consumo por Par)
         </h3>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={pullLastFilled} 
              disabled={pulling || saving}
              className="gap-2 border-blue-200 hover:border-blue-400 text-blue-700 bg-blue-50/50"
            >
              {pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              Puxar Dados da Referência
            </Button>
            <Button 
              variant="default" 
              size="sm" 
              onClick={handleSave} 
              disabled={saving}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {saving ? "Salvando..." : "Salvar Ficha"}
            </Button>
          </div>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className="flex flex-wrap items-end gap-3 pb-3 border-b last:border-0">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Material / Insumo
              </label>
              <Select 
                value={item.material_id} 
                onValueChange={(val) => updateItem(index, 'material_id', val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o material" />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-32">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Consumo
              </label>
              <Input
                type="number"
                step="0.0001"
                placeholder="0.0000"
                value={item.consumption_per_pair}
                onChange={(e) => updateItem(index, 'consumption_per_pair', parseFloat(e.target.value))}
              />
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => removeItem(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      
      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={addItem}
      >
        <PlusCircle className="mr-2 h-4 w-4" />
        Adicionar Componente à Ficha
      </Button>
      <Dialog open={!!referencePreview} onOpenChange={(open) => !open && setReferencePreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Revisar Consumos da Referência</DialogTitle>
            <DialogDescription>
              Valores encontrados em: {referencePreview?.referenceName} ({referencePreview?.date})
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-[400px] overflow-y-auto border rounded-md p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Material</th>
                  <th className="text-right py-2">Consumo Sugerido</th>
                </tr>
              </thead>
              <tbody>
                {referencePreview?.items.map((item, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2">
                      {materials.find(m => m.id === item.material_id)?.name || item.material_id}
                    </td>
                    <td className="text-right py-2 font-mono">
                      {item.consumption_per_pair.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
 
          <DialogFooter>
            <Button variant="outline" onClick={() => setReferencePreview(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmPull}>
              Substituir Consumos Atuais
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
 
    </div>
  );
}
