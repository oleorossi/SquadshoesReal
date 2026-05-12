 import { useState, useEffect } from 'react';
 import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
 import { CircleNotch as Loader2, FloppyDisk as Save, Percent, Calculator, Gear as Settings2, Package } from '@phosphor-icons/react';
 import { useCostParameters, useUpdateCostParameter } from '@/hooks/useGlobalSettings';
 
 export default function GlobalParametersPanel() {
   const { data: parameters, isLoading } = useCostParameters();
   const updateParameter = useUpdateCostParameter();
   const [values, setValues] = useState<Record<string, number>>({});
 
   useEffect(() => {
     if (parameters) {
       const newValues: Record<string, number> = {};
       parameters.forEach(p => {
         newValues[p.key] = p.value;
       });
       setValues(newValues);
     }
   }, [parameters]);
 
   const handleSave = async (key: string) => {
     await updateParameter.mutateAsync({ key, value: values[key] });
   };
 
   if (isLoading) {
     return (
       <div className="flex items-center justify-center py-10">
         <Loader2 className="h-6 w-6 animate-spin text-primary" />
       </div>
     );
   }
 
   const overhead = parameters?.find(p => p.key === 'overhead_pct');
 
   return (
     <div className="space-y-6">
       <div>
         <h3 className="text-lg font-semibold flex items-center gap-2">
           <Settings2 className="h-5 w-5 text-primary" />
           Parâmetros Globais
         </h3>
         <p className="text-sm text-muted-foreground">
           Defina valores padrão e unidades principais que afetam os cálculos de todo o sistema.
         </p>
       </div>
 
       <div className="grid gap-6">
         <Card>
           <CardHeader className="pb-3">
             <CardTitle className="text-sm font-medium flex items-center gap-2">
               <Calculator className="h-4 w-4 text-primary" />
               Custos e Precificação
             </CardTitle>
             <CardDescription className="text-xs">
               Parâmetros usados no cálculo de rentabilidade e formação de preço.
             </CardDescription>
           </CardHeader>
           <CardContent className="space-y-4">
             {overhead && (
               <div className="flex flex-col space-y-2">
                 <div className="flex items-center justify-between">
                   <div className="space-y-0.5">
                     <Label htmlFor="overhead" className="text-sm font-medium">Overhead / Par (%)</Label>
                     <p className="text-xs text-muted-foreground">{overhead.description}</p>
                   </div>
                   <div className="flex items-center gap-2 w-48">
                     <div className="relative flex-1">
                       <Input
                         id="overhead"
                         type="number"
                         step="0.01"
                         value={values['overhead_pct'] !== undefined ? (values['overhead_pct'] * 100).toFixed(2) : ''}
                         onChange={(e) => {
                           const val = parseFloat(e.target.value) / 100;
                           setValues(prev => ({ ...prev, overhead_pct: val }));
                         }}
                         className="pr-8"
                       />
                       <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                     </div>
                     <Button 
                       size="sm" 
                       onClick={() => handleSave('overhead_pct')}
                       disabled={updateParameter.isPending}
                     >
                       {updateParameter.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                     </Button>
                   </div>
                 </div>
               </div>
             )}
           </CardContent>
         </Card>
 
         <Card>
           <CardHeader className="pb-3">
             <CardTitle className="text-sm font-medium flex items-center gap-2">
               <Package className="h-4 w-4 text-primary" />
               Unidades e Padrões
             </CardTitle>
             <CardDescription className="text-xs">
               Unidades de medida e configurações padrão de materiais.
             </CardDescription>
           </CardHeader>
           <CardContent>
             <p className="text-sm text-muted-foreground italic text-center py-4">
               Funcionalidade em desenvolvimento para unificação de unidades de medida (Par, Metro, Unidade, etc).
             </p>
           </CardContent>
         </Card>
       </div>
     </div>
   );
 }