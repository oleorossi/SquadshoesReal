import React, { useState, useEffect } from 'react';
 import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
 import { Switch } from '@/components/ui/switch';
 import { Calculator, Info } from 'lucide-react';
 import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { GroupSupplierMaterial } from '@/hooks/useGroupSuppliers';
import { CONSUMPTION_UNITS_BY_GROUP } from '@/lib/measurementUnits';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: GroupSupplierMaterial | null;
  onSubmit: (data: Partial<GroupSupplierMaterial>) => void;
};

const emptyForm = {
  material_name: '',
  material_code: '',
  color: '',
  width: '',
  weight: '',
  thickness: '',
  composition: '',
  unit: 'metro',
  unit_price: 0,
  minimum_order: 0,
  stock_available: 0,
  invoice_number: '',
  invoice_date: '',
  invoice_value: 0,
  invoice_key: '',
  notes: '',
  active: true,
};

export default function MaterialFormDialog({ open, onOpenChange, editing, onSubmit }: Props) {
   const [form, setForm] = useState(emptyForm);
   const [showCalculator, setShowCalculator] = useState(false);
   const [testConsumption, setTestConsumption] = useState<string>('');
   const [calculatedLinear, setCalculatedLinear] = useState<number | null>(null);
 
   const calculateTest = () => {
     const dm2 = parseFloat(testConsumption);
     const widthStr = form.width.replace(/[^\d.]/g, '');
     const width = parseFloat(widthStr);
 
     if (!isNaN(dm2) && !isNaN(width) && width > 0) {
       // 1 m linear = largura * 10 dm (largura convertida para dm)
       // 1 m linear = (largura * 10) dm2
       // consumo linear = dm2 / (largura * 10)
       const result = dm2 / (width * 10);
       setCalculatedLinear(result);
     } else {
       setCalculatedLinear(null);
     }
   };

  useEffect(() => {
    if (editing) {
      setForm({
        material_name: editing.material_name || '',
        material_code: editing.material_code || '',
        color: editing.color || '',
        width: editing.width || '',
        weight: editing.weight || '',
        thickness: editing.thickness || '',
        composition: editing.composition || '',
        unit: editing.unit || 'metro',
        unit_price: editing.unit_price || 0,
        minimum_order: editing.minimum_order || 0,
        stock_available: editing.stock_available || 0,
        invoice_number: editing.invoice_number || '',
        invoice_date: editing.invoice_date || '',
        invoice_value: editing.invoice_value || 0,
        invoice_key: editing.invoice_key || '',
        notes: editing.notes || '',
        active: editing.active ?? true,
      });
    } else {
      setForm(emptyForm);
    }
  }, [editing, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      invoice_date: form.invoice_date || null,
    });
    onOpenChange(false);
  };

  const set = (key: string, val: string | number | boolean) => setForm(f => ({ ...f, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar Material' : 'Novo Material'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          {/* Dados do Material */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2">Dados do Material</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label>Nome do Material</Label>
                <Input value={form.material_name} onChange={e => set('material_name', e.target.value)} required className="mt-1" placeholder="Ex: Couro Bovino Napa" />
              </div>
              <div>
                <Label>Código</Label>
                <Input value={form.material_code} onChange={e => set('material_code', e.target.value)} className="mt-1" placeholder="REF-001" />
              </div>
              <div>
                <Label>Cor</Label>
                <Input value={form.color} onChange={e => set('color', e.target.value)} className="mt-1" placeholder="Ex: Preto, Caramelo" />
              </div>
              <div>
                <Label>Composição</Label>
                <Input value={form.composition} onChange={e => set('composition', e.target.value)} className="mt-1" placeholder="Ex: 100% couro bovino" />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch checked={form.active} onCheckedChange={v => set('active', v)} />
                <Label>Ativo</Label>
              </div>
            </div>
          </div>

           {/* Dimensões e Medidas */}
           <div>
             <div className="flex items-center justify-between mb-2">
               <p className="text-sm font-semibold text-muted-foreground">Dimensões e Medidas</p>
               <Button 
                 type="button" 
                 variant="ghost" 
                 size="sm" 
                 className="h-7 text-xs flex gap-1 items-center"
                 onClick={() => setShowCalculator(!showCalculator)}
               >
                 <Calculator className="h-3 w-3" />
                 Testar Consumo
               </Button>
             </div>
             
             {showCalculator && (
               <div className="mb-4 p-4 border rounded-lg bg-muted/30 space-y-3">
                 <div className="flex items-center gap-2 text-primary">
                   <Calculator className="h-4 w-4" />
                   <h4 className="text-sm font-medium">Calculadora de Conversão (dm² → Metro Linear)</h4>
                 </div>
                 
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div>
                     <Label className="text-xs">Largura do Material (m)</Label>
                     <Input 
                       value={form.width} 
                       onChange={e => set('width', e.target.value)}
                       placeholder="Ex: 1.40" 
                       className="h-8 mt-1"
                     />
                     <p className="text-[10px] text-muted-foreground mt-1">Informe a largura útil em metros.</p>
                   </div>
                   <div>
                     <Label className="text-xs">Consumo em dm²</Label>
                     <div className="flex gap-2 mt-1">
                       <Input 
                         type="number"
                         value={testConsumption} 
                         onChange={e => setTestConsumption(e.target.value)}
                         placeholder="Ex: 25.5" 
                         className="h-8"
                       />
                       <Button type="button" size="sm" className="h-8" onClick={calculateTest}>Calcular</Button>
                     </div>
                   </div>
                 </div>
 
                 {calculatedLinear !== null && (
                   <Alert className="bg-primary/5 border-primary/20">
                     <Info className="h-4 w-4 text-primary" />
                     <AlertTitle className="text-sm">Resultado do Cálculo</AlertTitle>
                     <AlertDescription className="text-xs">
                       O consumo de <strong>{testConsumption} dm²</strong> em um material de <strong>{form.width}m</strong> de largura equivale a:
                       <div className="text-lg font-bold text-primary mt-1">
                         {calculatedLinear.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 4 })} metros lineares
                       </div>
                       <p className="text-[10px] text-muted-foreground mt-1">
                         Fórmula: dm² / (Largura × 10)
                       </p>
                     </AlertDescription>
                   </Alert>
                 )}
               </div>
             )}
 
             <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
               <div className={showCalculator ? "opacity-50 pointer-events-none" : ""}>
                 <Label>Largura</Label>
                 <Input value={form.width} onChange={e => set('width', e.target.value)} className="mt-1" placeholder="Ex: 1.40m" />
               </div>
              <div>
                <Label>Peso</Label>
                <Input value={form.weight} onChange={e => set('weight', e.target.value)} className="mt-1" placeholder="Ex: 0.8 kg/m" />
              </div>
              <div>
                <Label>Espessura</Label>
                <Input value={form.thickness} onChange={e => set('thickness', e.target.value)} className="mt-1" placeholder="Ex: 1.2mm" />
              </div>
              <div>
                <Label>Unidade</Label>
                <Select value={form.unit} onValueChange={v => set('unit', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONSUMPTION_UNITS_BY_GROUP).map(([groupName, units]) => (
                      <React.Fragment key={groupName}>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
                          {groupName}
                        </div>
                        {units.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                      </React.Fragment>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Valores e Quantidades */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2">Valores e Quantidades</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <Label>Preço Unitário (R$)</Label>
                <Input type="number" step="0.01" min={0} value={form.unit_price} onChange={e => set('unit_price', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Pedido Mínimo</Label>
                <Input type="number" step="0.01" min={0} value={form.minimum_order} onChange={e => set('minimum_order', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Estoque Disponível</Label>
                <Input type="number" step="0.01" min={0} value={form.stock_available} onChange={e => set('stock_available', Number(e.target.value))} className="mt-1" />
              </div>
            </div>
          </div>

          {/* Nota Fiscal */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2">Nota Fiscal</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label>Nº NF</Label>
                <Input value={form.invoice_number} onChange={e => set('invoice_number', e.target.value)} className="mt-1" placeholder="000001" />
              </div>
              <div>
                <Label>Data NF</Label>
                <Input type="date" value={form.invoice_date} onChange={e => set('invoice_date', e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Valor NF (R$)</Label>
                <Input type="number" step="0.01" min={0} value={form.invoice_value} onChange={e => set('invoice_value', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Chave NF-e</Label>
                <Input value={form.invoice_key} onChange={e => set('invoice_key', e.target.value)} className="mt-1" placeholder="Chave de acesso" />
              </div>
            </div>
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="mt-1" rows={2} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit">{editing ? 'Salvar' : 'Adicionar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
