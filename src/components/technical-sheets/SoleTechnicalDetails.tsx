import { useState, useEffect } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
 import { Footprints, Save, Loader2, RefreshCw, Layers, Shield, Plus, X, Copy, Info, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SoleConjugationPanel } from "@/components/inventory/SoleConjugationPanel";
 import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
   DialogFooter,
   DialogDescription,
 } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { parseSafeNumber, safeToFixed } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

interface SoleTechnicalDetailsProps {
  soleId: string;
  soleName?: string;
  shoeCategory?: string;
  onClose?: () => void;
}

interface SoleSpec {
  size: number;
  lining_consumption_dm2: number | null;
  insole_consumption_dm2: number | null;
  fachete_lining_consumption_dm2: number | null;
}

const SIZE_PRESETS = [
  { label: "Adulto 34–40", sizes: [34, 35, 36, 37, 38, 39, 40] },
  { label: "Adulto 33–42", sizes: [33, 34, 35, 36, 37, 38, 39, 40, 41, 42] },
  { label: "Infantil 25–34", sizes: [25, 26, 27, 28, 29, 30, 31, 32, 33, 34] },
  { label: "Baby 15–24", sizes: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24] },
];

export function SoleTechnicalDetails({ soleId, soleName, onClose }: SoleTechnicalDetailsProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [specs, setSpecs] = useState<Record<number, SoleSpec>>({});
  const [sizes, setSizes] = useState<number[]>([]);
  const [newSize, setNewSize] = useState("");
  const [groups, setGroups] = useState<any[]>([]);
   const [liningGroupId, setLiningGroupId] = useState<string | null>(null);
   const [insoleGroupId, setInsoleGroupId] = useState<string | null>(null);
   const [liningMaterialId, setLiningMaterialId] = useState<string | null>(null);
   const [insoleMaterialId, setInsoleMaterialId] = useState<string | null>(null);
   const [liningSearch, setLiningSearch] = useState("");
   const [insoleSearch, setInsoleSearch] = useState("");
   const [products, setProducts] = useState<any[]>([]);
    const [isReferenceLoading, setIsReferenceLoading] = useState(false);
    const [referencePreview, setReferencePreview] = useState<any | null>(null);
    const [referenceInfo, setReferenceInfo] = useState<{ id: string; name: string; date: string } | null>(null);
    const [soleGroupId, setSoleGroupId] = useState<string | null>(null);
  const [isFachetado, setIsFachetado] = useState<boolean>(false);

   useEffect(() => {
     if (soleId) {
       fetchAll().then((hasData) => {
         if (!hasData && soleName) {
           tryLoadReferenceSpecs(soleName, true);
         }
       });
       fetchMetadata();
       supabase
         .from('products')
         .select('group_id, is_fachetado')
         .eq('id', soleId)
         .single()
         .then(({ data }) => {
           const d = data as any;
           if (d?.group_id) setSoleGroupId(d.group_id);
           setIsFachetado((data as any)?.is_fachetado ?? false);
         });
     }
   }, [soleId]);

   const fetchMetadata = async () => {
     const [{ data: groupData }, { data: productData }] = await Promise.all([
       supabase.from("product_groups").select("id, name").order("name"),
       supabase.from("products").select("id, name, category, color").order("name")
     ]);
     if (groupData) setGroups(groupData);
     if (productData) setProducts(productData);
   };

   const fetchAll = async (): Promise<boolean> => {
      const [{ data: specsData }, { data: structData }] = await Promise.all([
       supabase.from("sole_technical_specs").select("*").eq("sole_id", soleId).order("size"),
       supabase.from("sole_structures").select("*").eq("sole_id", soleId),
     ]);
 
     // Check if there's reference info stored
     if (specsData && specsData.length > 0 && specsData[0].reference_sole_id) {
       const { data: refSole } = await supabase
         .from('products')
         .select('name')
         .eq('id', specsData[0].reference_sole_id)
         .single();
       
       if (refSole) {
         setReferenceInfo({
           id: specsData[0].reference_sole_id,
           name: refSole.name,
           date: new Date(specsData[0].reference_date).toLocaleString('pt-BR')
         });
       }
     }

    // Build grade from all saved sizes (even those with null consumption)
    const loadedSizes = (specsData || []).map((r: any) => Number(r.size)).sort((a, b) => a - b);
    setSizes(loadedSizes);

    const specsMap: Record<number, SoleSpec> = {};
    (specsData || []).forEach((item: any) => {
      specsMap[item.size] = {
        size: item.size,
        lining_consumption_dm2: item.lining_consumption_dm2,
        insole_consumption_dm2: item.insole_consumption_dm2,
        fachete_lining_consumption_dm2: item.fachete_lining_consumption_dm2 ?? null,
      };
    });
      setSpecs(specsMap);
 
      if (structData) {
        const lining = structData.find((d: any) => d.component_type === "Forro");
        const insole = structData.find((d: any) => d.component_type === "Palmilha");
         if (lining) {
           setLiningGroupId(lining.default_group_id);
           setLiningMaterialId((lining as any).lining_material_id);
         }
         if (insole) {
           setInsoleGroupId(insole.default_group_id);
           setInsoleMaterialId((insole as any).insole_material_id);
         }
      }
 
      return (specsData || []).length > 0;
    };
 
    const tryLoadReferenceSpecs = async (currentName: string, silent = false) => {
     if (!currentName || isReferenceLoading) return;
     
     // Extrair nome base (ex: "Saltinho Bloco - Preto" -> "Saltinho Bloco")
     const baseName = currentName.split(" - ")[0];
     if (!baseName) return;
 
     if (!silent) setIsReferenceLoading(true);
     
     try {
       // Buscar outros solados com mesmo nome base
       const { data: otherSoles } = await supabase
         .from("products")
         .select("id")
         .eq("category", "Solado")
         .neq("id", soleId)
         .ilike("name", `${baseName}%`);
         
       if (!otherSoles || otherSoles.length === 0) {
         if (!silent) toast.info("Nenhuma referência anterior encontrada para este solado.");
         return;
       }
       
       const otherIds = otherSoles.map(s => s.id);
       
       // Buscar as especificações mais recentes para estes solados
       const { data: recentSpecs } = await supabase
         .from("sole_technical_specs")
         .select("*")
         .in("sole_id", otherIds)
         .order("updated_at", { ascending: false })
         .limit(50);
 
       if (!recentSpecs || recentSpecs.length === 0) {
         if (!silent) toast.info("Nenhuma especificação preenchida encontrada em referências similares.");
         return;
       }
       
       // Agrupar pelo mais recente sole_id
       const mostRecentSoleId = recentSpecs[0].sole_id;
        const filteredSpecs = recentSpecs.filter(s => s.sole_id === mostRecentSoleId);
        
        // Buscar nome do solado de referência
        const { data: refProd } = await supabase.from('products').select('name').eq('id', mostRecentSoleId).single();
        const refName = refProd?.name || baseName;
 
        setReferencePreview({
          soleId: mostRecentSoleId,
          name: refName,
          date: new Date(recentSpecs[0].updated_at || recentSpecs[0].created_at).toLocaleString('pt-BR'),
          specs: filteredSpecs,
          baseName
        });
     } catch (err) {
       console.error("Erro ao carregar referência:", err);
       if (!silent) toast.error("Falha ao buscar dados da referência.");
     } finally {
       if (!silent) setIsReferenceLoading(false);
     }
   };


    const confirmPull = async () => {
      if (!referencePreview) return;
      
      const { specs: filteredSpecs, soleId: refSoleId, name: refName, date: refDate } = referencePreview;
      
      const loadedSizes = filteredSpecs.map((r: any) => Number(r.size)).sort((a, b) => a - b);
      setSizes(loadedSizes);
 
      const specsMap: Record<number, SoleSpec> = {};
      filteredSpecs.forEach((item: any) => {
        specsMap[item.size] = {
          size: item.size,
          lining_consumption_dm2: item.lining_consumption_dm2,
          insole_consumption_dm2: item.insole_consumption_dm2,
          fachete_lining_consumption_dm2: item.fachete_lining_consumption_dm2 ?? null,
        };
      });
      setSpecs(specsMap);
      
      // Carregar grupos também
      const { data: structData } = await supabase
        .from("sole_structures")
        .select("*")
        .eq("sole_id", refSoleId);
        
      if (structData) {
        const lining = structData.find((d: any) => d.component_type === "Forro");
        const insole = structData.find((d: any) => d.component_type === "Palmilha");
       if (lining) {
         setLiningGroupId(lining.default_group_id);
         setLiningMaterialId((lining as any).lining_material_id);
       }
       if (insole) {
         setInsoleGroupId(insole.default_group_id);
         setInsoleMaterialId((insole as any).insole_material_id);
       }
      }
 
      setReferenceInfo({
        id: refSoleId,
        name: refName,
        date: refDate
      });
      
      setReferencePreview(null);
      toast.success(`Consumos carregados da referência: ${refName}`);
    };
 
  const applyPreset = (presetSizes: number[]) => {
    setSizes(presetSizes);
    setSpecs((prev) => {
      const next: Record<number, SoleSpec> = {};
      presetSizes.forEach((s) => {
        next[s] = prev[s] || { size: s, lining_consumption_dm2: null, insole_consumption_dm2: null, fachete_lining_consumption_dm2: null };
      });
      return next;
    });
  };

  const addSize = () => {
    const n = parseInt(newSize.trim(), 10);
    if (!n || n < 10 || n > 60) { toast.error("Numeração inválida (10–60)"); return; }
    if (sizes.includes(n)) { toast.error("Numeração já adicionada"); return; }
    const next = [...sizes, n].sort((a, b) => a - b);
    setSizes(next);
    setSpecs((prev) => ({
      ...prev,
      [n]: { size: n, lining_consumption_dm2: null, insole_consumption_dm2: null, fachete_lining_consumption_dm2: null },
    }));
    setNewSize("");
  };

  const removeSize = (size: number) => {
    setSizes((prev) => prev.filter((s) => s !== size));
    setSpecs((prev) => {
      const next = { ...prev };
      delete next[size];
      return next;
    });
  };

  const handleInputChange = (size: number, field: keyof SoleSpec, value: string) => {
    const numValue = value === "" ? null : parseFloat(value.replace(",", "."));
    setSpecs((prev) => ({
      ...prev,
      [size]: {
        ...(prev[size] || { size, lining_consumption_dm2: null, insole_consumption_dm2: null, fachete_lining_consumption_dm2: null }),
        [field]: numValue,
      },
    }));
  };

  const fillRemaining = (field: "lining_consumption_dm2" | "insole_consumption_dm2" | "fachete_lining_consumption_dm2") => {
    const firstValue = Object.values(specs).find((s) => s[field] !== null)?.[field];
    if (firstValue === undefined || firstValue === null) return;
    const next = { ...specs };
    sizes.forEach((size) => {
      if (!next[size] || next[size][field] === null) {
        next[size] = { ...(next[size] || { size, lining_consumption_dm2: null, insole_consumption_dm2: null, fachete_lining_consumption_dm2: null }), [field]: firstValue };
      }
    });
    setSpecs(next);
  };

  const handleSave = async () => {
    if (sizes.length === 0) { toast.error("Defina ao menos uma numeração"); return; }
    setSaving(true);
    try {
      // Upsert ALL grade sizes (including those with null consumption — they define the grade)
      const dataToUpsert = sizes.map((size) => ({
        sole_id: soleId,
        size,
        lining_consumption_dm2: specs[size]?.lining_consumption_dm2 ?? null,
        insole_consumption_dm2: specs[size]?.insole_consumption_dm2 ?? null,
        fachete_lining_consumption_dm2: specs[size]?.fachete_lining_consumption_dm2 ?? null,
        reference_sole_id: referenceInfo?.id || null,
        reference_date: referenceInfo ? new Date().toISOString() : null
      }));
      const { error: specsError } = await supabase
        .from("sole_technical_specs")
        .upsert(dataToUpsert, { onConflict: "sole_id,size" });
      if (specsError) throw specsError;

      // Delete rows for sizes that were removed
      const { data: existing } = await supabase
        .from("sole_technical_specs")
        .select("size")
        .eq("sole_id", soleId);
      const existingSizes = (existing || []).map((r: any) => r.size);
      const toDelete = existingSizes.filter((s: number) => !sizes.includes(s));
      if (toDelete.length > 0) {
        await supabase
          .from("sole_technical_specs")
          .delete()
          .eq("sole_id", soleId)
          .in("size", toDelete);
      }

      // Save material groups (Forro / Palmilha)
      const structuresToUpsert = [];
       if (liningGroupId || liningMaterialId) {
         structuresToUpsert.push({ 
           sole_id: soleId, 
           component_type: "Forro", 
           default_group_id: liningGroupId,
           lining_material_id: liningMaterialId
         });
       }
       if (insoleGroupId || insoleMaterialId) {
         structuresToUpsert.push({ 
           sole_id: soleId, 
           component_type: "Palmilha", 
           default_group_id: insoleGroupId,
           insole_material_id: insoleMaterialId
         });
       }
      if (structuresToUpsert.length > 0) {
        const { error: structError } = await supabase
          .from("sole_structures")
          .upsert(structuresToUpsert, { onConflict: "sole_id,component_type" });
        if (structError) throw structError;
      }

      // Invalidate grade cache so SoleStandardItemsPanel refreshes immediately
      qc.invalidateQueries({ queryKey: ["sole_size_grade", soleId] });
      toast.success("Grade e consumos salvos!");
      if (onClose) onClose(); else window.history.back();
    } catch (error: any) {
      toast.error("Erro ao salvar: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-none shadow-none bg-transparent">
      <CardHeader className="px-0 pt-0">
        <div className="space-y-4">
          {referenceInfo && (
            <div className="bg-primary/8 border border-primary/20 p-2 rounded text-xs text-primary flex items-center gap-2">
              <Info className="h-4 w-4" />
              <span>Baseado na referência: <strong>{referenceInfo.name}</strong> em {referenceInfo.date}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Footprints className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-lg">Grade de Numerações e Consumos Base</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {soleName || "Solado"} — define a grade e os consumos de forração/palmilha por numeração
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                onClick={() => soleName && tryLoadReferenceSpecs(soleName)} 
                disabled={saving || isReferenceLoading || !soleName}
                className="gap-2 shrink-0 border-blue-200 hover:border-blue-400 text-blue-700 bg-blue-50/50"
              >
                {isReferenceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                Puxar Dados da Referência
              </Button>
              <Button onClick={handleSave} disabled={saving} className="gap-2 shrink-0">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <Dialog open={!!referencePreview} onOpenChange={(open) => !open && setReferencePreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Revisar Consumos do Solado de Referência</DialogTitle>
            <DialogDescription>
              Valores encontrados em: {referencePreview?.name} ({referencePreview?.date})
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-[400px] overflow-y-auto border rounded-md p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-center py-2">TAM</th>
                  <th className="text-right py-2 px-4">Forração (dm²)</th>
                  <th className="text-right py-2 px-4">Palmilha (dm²)</th>
                  {isFachetado && <th className="text-right py-2 px-4">Fachete (dm²)</th>}
                </tr>
              </thead>
              <tbody>
                {referencePreview?.specs.map((spec: any, i: number) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="text-center py-2 font-bold">{spec.size}</td>
                    <td className="text-right py-2 px-4 font-mono">
                      {spec.lining_consumption_dm2 !== null ? safeToFixed(spec.lining_consumption_dm2, 2) : "-"}
                    </td>
                    <td className="text-right py-2 px-4 font-mono">
                      {spec.insole_consumption_dm2 !== null ? safeToFixed(spec.insole_consumption_dm2, 2) : "-"}
                    </td>
                    {isFachetado && (
                      <td className="text-right py-2 px-4 font-mono">
                        {spec.fachete_lining_consumption_dm2 != null ? safeToFixed(spec.fachete_lining_consumption_dm2, 2) : "-"}
                      </td>
                    )}
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
              Substituir Grade e Consumos Atuais
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CardContent className="px-0 space-y-5">
        {/* Grade management */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Grade de numerações</span>
            {sizes.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {sizes.length} tam. · {sizes[0]}–{sizes[sizes.length - 1]}
              </Badge>
            )}
          </div>

          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {SIZE_PRESETS.map((p) => (
              <Button key={p.label} size="sm" variant="outline" className="h-7 text-xs" onClick={() => applyPreset(p.sizes)}>
                {p.label}
              </Button>
            ))}
          </div>

          {/* Active sizes */}
          {sizes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sizes.map((s) => (
                <span key={s} className="inline-flex items-center gap-0.5 bg-background border border-border rounded px-2 py-0.5 text-xs font-mono">
                  {s}
                  <button onClick={() => removeSize(s)} className="ml-0.5 text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Add custom size */}
          <div className="flex items-center gap-2 max-w-xs">
            <Input
              placeholder="Ex: 41"
              value={newSize}
              onChange={(e) => setNewSize(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSize()}
              className="h-8 text-sm"
            />
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={addSize}>
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </Button>
          </div>
        </div>

         {/* Material specific selection */}
         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-muted/30 p-4 rounded-lg">
           <div className="space-y-2">
             <Label className="flex items-center gap-2 text-sm">
               <Layers className="h-4 w-4 text-purple-600" /> Material — Forração
             </Label>
             <div className="flex flex-col gap-2">
               <Select value={liningMaterialId || "none"} onValueChange={(v) => setLiningMaterialId(v === "none" ? null : v)}>
                 <SelectTrigger className="h-9">
                   <SelectValue placeholder="Selecionar material específico…" />
                 </SelectTrigger>
                 <SelectContent className="max-h-[300px]">
                   <div className="p-2 sticky top-0 bg-popover z-10 border-b">
                     <div className="relative">
                       <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                       <Input
                         placeholder="Buscar material..."
                         value={liningSearch}
                         onChange={(e) => setLiningSearch(e.target.value)}
                         className="h-7 text-xs pl-7"
                       />
                     </div>
                   </div>
                   <SelectItem value="none">Nenhum (usar grupo)</SelectItem>
                   {products
                     .filter(p => !liningSearch || p.name.toLowerCase().includes(liningSearch.toLowerCase()) || p.category?.toLowerCase().includes(liningSearch.toLowerCase()))
                     .slice(0, 100)
                     .map((p) => (
                       <SelectItem key={p.id} value={p.id}>
                         <div className="flex flex-col">
                           <span className="text-xs">{p.name}</span>
                           <span className="text-[10px] text-muted-foreground">{p.category} {p.color ? `· ${p.color}` : ""}</span>
                         </div>
                       </SelectItem>
                     ))}
                 </SelectContent>
               </Select>
               
               {!liningMaterialId && (
                 <div className="space-y-1">
                   <Label className="text-[10px] text-muted-foreground ml-1">Ou selecione um grupo genérico:</Label>
                   <Select value={liningGroupId || "none"} onValueChange={(v) => setLiningGroupId(v === "none" ? null : v)}>
                     <SelectTrigger className="h-8 text-xs">
                       <SelectValue placeholder="Selecionar grupo…" />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem value="none">Nenhum</SelectItem>
                       {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                     </SelectContent>
                   </Select>
                 </div>
               )}
             </div>
           </div>

           <div className="space-y-2">
             <Label className="flex items-center gap-2 text-sm">
               <Shield className="h-4 w-4 text-blue-600" /> Material — Palmilha
             </Label>
             <div className="flex flex-col gap-2">
               <Select value={insoleMaterialId || "none"} onValueChange={(v) => setInsoleMaterialId(v === "none" ? null : v)}>
                 <SelectTrigger className="h-9">
                   <SelectValue placeholder="Selecionar material específico…" />
                 </SelectTrigger>
                 <SelectContent className="max-h-[300px]">
                   <div className="p-2 sticky top-0 bg-popover z-10 border-b">
                     <div className="relative">
                       <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                       <Input
                         placeholder="Buscar material..."
                         value={insoleSearch}
                         onChange={(e) => setInsoleSearch(e.target.value)}
                         className="h-7 text-xs pl-7"
                       />
                     </div>
                   </div>
                   <SelectItem value="none">Nenhum (usar grupo)</SelectItem>
                   {products
                     .filter(p => !insoleSearch || p.name.toLowerCase().includes(insoleSearch.toLowerCase()) || p.category?.toLowerCase().includes(insoleSearch.toLowerCase()))
                     .slice(0, 100)
                     .map((p) => (
                       <SelectItem key={p.id} value={p.id}>
                         <div className="flex flex-col">
                           <span className="text-xs">{p.name}</span>
                           <span className="text-[10px] text-muted-foreground">{p.category} {p.color ? `· ${p.color}` : ""}</span>
                         </div>
                       </SelectItem>
                     ))}
                 </SelectContent>
               </Select>

               {!insoleMaterialId && (
                 <div className="space-y-1">
                   <Label className="text-[10px] text-muted-foreground ml-1">Ou selecione um grupo genérico:</Label>
                   <Select value={insoleGroupId || "none"} onValueChange={(v) => setInsoleGroupId(v === "none" ? null : v)}>
                     <SelectTrigger className="h-8 text-xs">
                       <SelectValue placeholder="Selecionar grupo…" />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem value="none">Nenhum</SelectItem>
                       {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                     </SelectContent>
                   </Select>
                 </div>
               )}
             </div>
           </div>
         </div>

        {/* Consumption table */}
        {sizes.length > 0 && (
          <div className="rounded-md border overflow-hidden">
            {isFachetado && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border-b border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                <span className="font-semibold">Solado Fachetado</span>
                <span className="text-amber-600/70">— preencha o consumo de forração do fachete por numeração (cor da palmilha)</span>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-16 text-center font-bold">TAM</TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between">
                      <span>Forração (dm²/par)</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" title="Replicar primeiro valor" onClick={() => fillRemaining("lining_consumption_dm2")}>
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center justify-between">
                      <span>Palmilha (dm²/par)</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" title="Replicar primeiro valor" onClick={() => fillRemaining("insole_consumption_dm2")}>
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableHead>
                  {isFachetado && (
                    <TableHead className="bg-amber-500/5">
                      <div className="flex items-center justify-between">
                        <span className="text-amber-700 dark:text-amber-400">Fachete (dm²/par)</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Replicar primeiro valor" onClick={() => fillRemaining("fachete_lining_consumption_dm2")}>
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sizes.map((size) => (
                  <TableRow key={size} className="hover:bg-muted/30">
                    <TableCell className="text-center font-bold bg-muted/20">{size}</TableCell>
                    <TableCell>
                      <Input
                        type="text"
                        inputMode="decimal"
                        className="h-8 text-right font-mono"
                        value={specs[size]?.lining_consumption_dm2?.toString() ?? ""}
                        onChange={(e) => handleInputChange(size, "lining_consumption_dm2", e.target.value)}
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="text"
                        inputMode="decimal"
                        className="h-8 text-right font-mono"
                        value={specs[size]?.insole_consumption_dm2?.toString() ?? ""}
                        onChange={(e) => handleInputChange(size, "insole_consumption_dm2", e.target.value)}
                        placeholder="0.00"
                      />
                    </TableCell>
                    {isFachetado && (
                      <TableCell className="bg-amber-500/5">
                        <Input
                          type="text"
                          inputMode="decimal"
                          className="h-8 text-right font-mono border-amber-500/30 focus-visible:ring-amber-500/30"
                          value={specs[size]?.fachete_lining_consumption_dm2?.toString() ?? ""}
                          onChange={(e) => handleInputChange(size, "fachete_lining_consumption_dm2", e.target.value)}
                          placeholder="0.00"
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Conjugation panel */}
        <SoleConjugationPanel soleGroupId={soleGroupId} soleName={soleName} />
      </CardContent>
    </Card>
  );
}
