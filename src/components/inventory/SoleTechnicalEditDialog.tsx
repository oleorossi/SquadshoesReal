import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Product } from '@/types/inventory';
import { useQueryClient } from '@tanstack/react-query';
import { useSuppliers } from '@/hooks/useSuppliers';
import { toast } from 'sonner';
import { Wrench, Truck, CurrencyDollar as DollarSign, Ruler, Gear as Settings2, Package as Package2 } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { SoleStandardMaterialsEditor } from './SoleStandardMaterialsEditor';
import { updateSoleProfile } from '@/services/soleProfileService';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
}

export function SoleTechnicalEditDialog({ open, onOpenChange, product }: Props) {
  const qc = useQueryClient();
  const { data: suppliers = [] } = useSuppliers();
  const [saving, setSaving] = useState(false);

  const [supplierId, setSupplierId] = useState<string>('');
  const [leadTime, setLeadTime] = useState<number>(0);
  const [moq, setMoq] = useState<number>(0);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [heelHeight, setHeelHeight] = useState<number>(0);
   const [soleMaterial, setSoleMaterial] = useState<string>('');
   const [notes, setNotes] = useState<string>('');
   const [isStandardItem, setIsStandardItem] = useState<boolean>(false);
   const [isFachetado, setIsFachetado] = useState<boolean>(false);
  const [insoleMode, setInsoleMode] = useState<'cortar' | 'pronta_na_cor'>('cortar');
  // Tipo do solado (Fase 1+ da reformulação): tradicional / palmilha_pronta / conjugado
  const [soleClassification, setSoleClassification] = useState<'tradicional' | 'palmilha_pronta' | 'conjugado'>('tradicional');

  useEffect(() => {
    if (product && open) {
      setSupplierId(product.supplier_id || '');
      setLeadTime(Number(product.supplier_lead_time_days || product.lead_time_days || 0));
      setMoq(Number((product as any).sole_moq || 0));
      setUnitPrice(Number(product.unit_price || 0));
       setHeelHeight(Number(product.heel_height || 0));
       setSoleMaterial(product.sole_material || '');
       setNotes(((product as any).sole_technical_notes as string) || '');
       setIsStandardItem((product as any).is_standard_sole_item || false);
       setIsFachetado((product as any).is_fachetado || false);
      setInsoleMode(((product as any).insole_mode as 'cortar' | 'pronta_na_cor') || 'cortar');
      setSoleClassification(((product as any).sole_classification as 'tradicional' | 'palmilha_pronta' | 'conjugado') || 'tradicional');
    }
  }, [product, open]);

  // Quando muda a classificação, deriva o insole_mode automaticamente:
  // palmilha_pronta → pronta_na_cor; resto → cortar.
  const handleClassificationChange = (value: 'tradicional' | 'palmilha_pronta' | 'conjugado') => {
    setSoleClassification(value);
    if (value === 'palmilha_pronta') {
      setInsoleMode('pronta_na_cor');
    } else {
      setInsoleMode('cortar');
    }
  };

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const result = await updateSoleProfile(product.id, {
        supplier_id: supplierId || null,
        supplier_lead_time_days: leadTime,
        sole_moq: moq,
        heel_height: heelHeight,
        sole_material: soleMaterial || null,
        sole_technical_notes: notes || null,
        is_standard_sole_item: isStandardItem,
        is_fachetado: isFachetado,
        insole_mode: insoleMode,
        sole_classification: soleClassification,
        unit_price: unitPrice,
      });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      toast.success(result.siblings_updated > 0
        ? `Dados técnicos atualizados em ${result.siblings_updated + 1} cores do solado!`
        : 'Dados técnicos do solado atualizados!');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Edição Técnica do Solado
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="outline">{product.name}</Badge>
            {product.color && <Badge variant="secondary">{product.color}</Badge>}
            {product.sku && <Badge variant="outline" className="font-mono text-xs">{product.sku}</Badge>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Tipo do Solado — driver principal da configuração */}
          <div className="space-y-3 p-4 rounded-lg border-2 border-primary/30 bg-primary/5">
            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Settings2 className="h-4 w-4 text-primary" />
              Tipo do Solado
            </h3>
            <Select value={soleClassification} onValueChange={(v) => handleClassificationChange(v as any)}>
              <SelectTrigger className="h-10 font-medium"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tradicional">
                  <div className="py-1">
                    <div className="font-semibold">Tradicional</div>
                    <div className="text-xs text-muted-foreground">Cada número individual · palmilha cortada (dm²)</div>
                  </div>
                </SelectItem>
                <SelectItem value="palmilha_pronta">
                  <div className="py-1">
                    <div className="font-semibold">Palmilha Pronta</div>
                    <div className="text-xs text-muted-foreground">Palmilha já vem pronta (un) · coligação cor cabedal/palmilha</div>
                  </div>
                </SelectItem>
                <SelectItem value="conjugado">
                  <div className="py-1">
                    <div className="font-semibold">Conjugado</div>
                    <div className="text-xs text-muted-foreground">Alguns números agrupados (ex.: 33/34, 39/40)</div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            {soleClassification === 'palmilha_pronta' && (
              <div className="text-xs text-foreground/80 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                <strong>Atenção:</strong> Solados deste tipo têm coligação <em>cor cabedal → cor palmilha</em>.
                Configure essa coligação na <strong>ficha técnica</strong> (campo "Cores Palmilha"). O sistema vai usar essa
                tabela pra escolher a palmilha certa quando emitir a ficha de produção.
              </div>
            )}
            {soleClassification === 'conjugado' && (
              <div className="text-xs text-foreground/80 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                <strong>Atenção:</strong> Solados conjugados têm algumas numerações agrupadas. Configure as conjugações
                na aba <strong>Conjugações</strong> deste cadastro (ex.: 33/34 conta como 1 par para essa numeração).
              </div>
            )}
          </div>

          {/* Fornecedor & Lead Time */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Truck className="h-4 w-4" />
              Fornecedor & Prazo
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Fornecedor padrão</Label>
                <Select value={supplierId || 'none'} onValueChange={v => setSupplierId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sem fornecedor —</SelectItem>
                    {suppliers.filter(s => s.active).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Lead time do solado (dias)</Label>
                <NumberInput min={0} value={leadTime} onChange={setLeadTime} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">
                  Prazo entre OC e chegada à fábrica. Usado no cálculo de data mínima de faturamento.
                </p>
             </div>
           </div>

           <Separator />

           {/* Configuração de Automação */}
           <div className="space-y-3">
             <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
               <Settings2 className="h-4 w-4" />
               Automação de Ficha Técnica
             </h3>
             <div className="flex items-center gap-2 p-3 rounded-md border bg-primary/5 border-primary/20">
               <Switch
                 id="is-standard-sole-item-edit"
                 checked={isStandardItem}
                 onCheckedChange={setIsStandardItem}
               />
               <div className="grid gap-1.5 leading-none">
                 <Label htmlFor="is-standard-sole-item-edit" className="text-sm font-medium leading-none cursor-pointer">
                   Item Padrão de Solado
                 </Label>
                 <p className="text-xs text-muted-foreground">
                   Se marcado, este item será adicionado automaticamente ao Bill of Materials (BOM) de todas as fichas técnicas que utilizarem este solado.
                 </p>
               </div>
             </div>
           </div>
         </div>

          <Separator />

          {/* Compra */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <DollarSign className="h-4 w-4" />
              Compra
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Custo unitário (R$/par)</Label>
                <NumberInput min={0} step="0.01" value={unitPrice} onChange={setUnitPrice} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">MOQ — pedido mínimo (pares)</Label>
                <NumberInput min={0} value={moq} onChange={setMoq} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">
                  Quantidade mínima exigida pelo fornecedor por OC. OCs automáticas serão arredondadas para cima.
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Especificações técnicas */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Ruler className="h-4 w-4" />
              Especificações
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Material</Label>
                <Input
                  value={soleMaterial}
                  onChange={e => setSoleMaterial(e.target.value)}
                  placeholder="Ex.: TR, PVC, EVA, Couro..."
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Altura do salto (mm)</Label>
                <NumberInput min={0} step="0.1" value={heelHeight} onChange={setHeelHeight} className="mt-1" />
              </div>
            </div>
          {soleClassification === 'tradicional' && (
            <div>
              <Label className="text-xs">Modo da palmilha</Label>
              <Select value={insoleMode} onValueChange={v => setInsoleMode(v as 'cortar' | 'pronta_na_cor')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cortar">Cortar (consome dm² de placa)</SelectItem>
                  <SelectItem value="pronta_na_cor">Pronta na cor (consome por par/numeração)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Define como a palmilha vinculada a este solado será debitada do estoque e contabilizada na ficha técnica.
              </p>
            </div>
          )}
          {soleClassification === 'palmilha_pronta' && (
            <div className="text-xs text-muted-foreground italic">
              Modo da palmilha definido automaticamente como <strong>Pronta na cor</strong> por causa do tipo do solado.
            </div>
          )}
          {soleClassification === 'conjugado' && (
            <div className="text-xs text-muted-foreground italic">
              Modo da palmilha definido automaticamente como <strong>Cortar (dm²)</strong> por causa do tipo do solado.
            </div>
          )}
            <div className="flex items-center gap-2 p-3 rounded-md border bg-amber-500/5 border-amber-500/20">
              <Switch
                id="is-fachetado"
                checked={isFachetado}
                onCheckedChange={setIsFachetado}
              />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="is-fachetado" className="text-sm font-medium leading-none cursor-pointer">
                  Solado Fachetado
                </Label>
                <p className="text-xs text-muted-foreground">
                  Solados fachetados levam forração aplicada sobre eles, sempre na cor da palmilha. Configure o consumo (dm²) por numeração na aba de especificações técnicas.
                </p>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notas técnicas</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Acabamento, fôrma, observações de produção, restrições do fornecedor..."
                className="mt-1 min-h-[80px]"
              />
            </div>
          </div>

          <Separator />

          {/* Consumos padrão — toda ficha que usar este solado herda esses materiais */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Package2 className="h-4 w-4" />
              Materiais Padrão de Consumo
            </h3>
            <SoleStandardMaterialsEditor
              soleGroupId={(product as any)?.group_id || ''}
              soleClassification={soleClassification}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Dados Técnicos'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
