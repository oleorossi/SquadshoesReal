import { useState, useMemo, useRef, useCallback } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
 import { Plus, Loader2, Palette, ImagePlus, Barcode, Tag, Square, Upload, Camera, X, Check, Search, Layers, ChevronDown, ChevronUp, Trash2, CheckSquare, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
 import { Badge } from '@/components/ui/badge';
 import { Checkbox } from '@/components/ui/checkbox';
 import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
 import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
 import { cn } from '@/lib/utils';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { useColorVariants, useAddColorVariant, useUpdateColorVariant, useDeleteColorVariant, recolorImage } from '@/hooks/useColorVariants';
import { useVariantGroupImages, useUpsertVariantGroupImage } from '@/hooks/useVariantGroupImages';
import { useProducts } from '@/hooks/useProducts';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAllGroupColors } from '@/hooks/useGroupColors';
import { toast } from 'sonner';

interface ColorVariantsTabProps {
  sheetId: string;
  sheetCode?: string;
  sheetImageUrl?: string;
}

export function ColorVariantsTab({ sheetId, sheetCode, sheetImageUrl }: ColorVariantsTabProps) {
  const { data: variants = [], isLoading } = useColorVariants(sheetId);
  const addVariant = useAddColorVariant();
  const updateVariant = useUpdateColorVariant();
  const deleteVariant = useDeleteColorVariant();
  const { data: products = [] } = useProducts();
  const { data: groupImages = [] } = useVariantGroupImages(sheetId);
  const upsertGroupImage = useUpsertVariantGroupImage();

  const [newColor, setNewColor] = useState('');
   const [recoloring, setRecoloring] = useState<string | null>(null);
   const incrementLastNumber = (str: string) => {
     const match = str.match(/(\d+)(?!.*\d)/);
     if (!match) return str + '1';
     const num = parseInt(match[0], 10) + 1;
     const startIdx = match.index!;
     return str.substring(0, startIdx) + num.toString().padStart(match[0].length, '0') + str.substring(startIdx + match[0].length);
   };
 
   const generateNextSku = (customVariants?: any[]) => {
     const targetVariants = customVariants || variants;
     if (targetVariants.length > 0) {
       const sorted = [...targetVariants].sort((a, b) => (b.sku || '').localeCompare(a.sku || '', undefined, { numeric: true }));
       const lastSku = sorted[0]?.sku;
       if (lastSku) return incrementLastNumber(lastSku);
     }
     if (sheetCode) return incrementLastNumber(sheetCode);
     return '';
   };
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadingGroupImg, setUploadingGroupImg] = useState<string | null>(null);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bomSearch, setBomSearch] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [expandedVariant, setExpandedVariant] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const cancelRef = useRef(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const groupFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { data: allGroupColors = [] } = useAllGroupColors();

  const NAPA_SOFT_HEX: Record<string, string> = {
    'TÂMARA': '#5B3D31', 'NEW WHISKY': '#8C5B3F', 'CAPPUCCINO': '#9F7D61',
    'COGUMELO': '#B09B84', 'PORCELANA': '#E5D3B1', 'MERLOT': '#6F2629',
    'TELHA': '#AD4B31', 'NEW TAN': '#D1A686', 'NATURAL': '#A8846E',
    'TEQUILA': '#D4AF6B', 'MILK': '#F1EBD1', 'CARMIM': '#AF2228',
    'CAMAFEU': '#BC8675', 'DÁLIA': '#E7CDC1', 'ORGANZA': '#E8BD9B',
    'OFF WHITE': '#E2E4D9', 'BRANCO': '#F6F7F9', 'ÍNDIGO': '#202945',
    'ÉBANO': '#4A4D4E', 'CACTO': '#4C4F2B', 'CONCRETO': '#7D756C',
    'MUSGO': '#C7D19E', 'CEU': '#B8CEDC', 'ROCHA': '#4D423F', 'PRETO': '#212123',
    'ADOCICADO': '#E8CCD1', 'BABY BLUE': '#89CFF0', 'BRIDAL': '#F2E7D5',
    'CERRADO': '#7E745A', 'CHANTILLY': '#F4EDE4', 'ERVA-MATE': '#78866B',
    'GELATO': '#F0B27A', 'GRAPE': '#6F2DA8', 'LIMONCELLO': '#F9E076',
    'PICOLE': '#A2D9CE',
  };

  const { data: sheetSpecs } = useQuery({
    queryKey: ['sheet_specs_for_colors', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('upper_material, lining_material, insole_material, lining_accessories, components_accessories')
        .eq('id', sheetId)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const { data: productGroups = [] } = useQuery({
    queryKey: ['product_groups_colors'],
    queryFn: async () => {
      const { data } = await supabase.from('product_groups').select('id, name, colors');
      return data || [];
    },
    staleTime: 0,
    gcTime: 30 * 1000,
  });

  const { data: groupSupplierMaterials = [] } = useQuery({
    queryKey: ['group_supplier_materials_for_colors'],
    queryFn: async () => {
      const { data } = await supabase
        .from('group_supplier_materials')
        .select('group_id, color, material_name')
        .eq('active', true);
      return data || [];
    },
    staleTime: 0,
    gcTime: 30 * 1000,
  });

  const normalizeGroupValue = (value?: string | null) => value?.trim().toLowerCase() || '';

  const uniqueSortedColors = (colors: string[]) =>
    Array.from(new Set(colors.map(c => c.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const getDerivedProductColor = (product: any) => {
    const productName = product.name?.trim() || '';
    if (productName.includes(':')) return productName.split(':').pop()?.trim() || '';
    if (productName.includes(' - ')) return productName.split(' - ').pop()?.trim() || '';
    return product.color?.trim() ? '' : productName;
  };

  const getColorsFromProducts = (groupId: string) =>
    uniqueSortedColors(products.filter(p => p.active && p.group_id === groupId).flatMap(p => {
      const colors: string[] = [];
      if (p.color?.trim()) colors.push(p.color.trim());
      const derived = getDerivedProductColor(p);
      if (derived) colors.push(derived);
      return colors;
    }));

  const getColorsFromGroupSupplierMaterials = (groupId: string) =>
    uniqueSortedColors(groupSupplierMaterials.filter((m: any) => m.group_id === groupId).flatMap((m: any) => {
      if (m.color?.trim()) return [m.color.trim()];
      const name = m.material_name?.trim() || '';
      if (name.includes(':')) return [name.split(':').pop()?.trim() || ''];
      if (name.includes(' - ')) return [name.split(' - ').pop()?.trim() || ''];
      return [];
    }));

  const mergeAllGroupColors = (group: any): string[] => {
    const all: string[] = [];
    if (group.colors) all.push(...group.colors.split(','));
    all.push(...getColorsFromGroupSupplierMaterials(group.id));
    all.push(...getColorsFromProducts(group.id));
    allGroupColors
      .filter(gc => gc.group_id === group.id)
      .forEach(gc => all.push(gc.color_name));
    return uniqueSortedColors(all);
  };

  const getColorsFromGroupName = (groupName: string): string[] => {
    const normalized = normalizeGroupValue(groupName);
    const group = productGroups.find((g: any) => g.id === groupName || normalizeGroupValue(g.name) === normalized);
    return group ? mergeAllGroupColors(group) : [];
  };

  // Resolve groups used in BOM with their real UUIDs
  const bomMaterialGroups = useMemo(() => {
    const result: { groupName: string; groupId: string; realGroupId: string }[] = [];
    const seen = new Set<string>();

    const addGroup = (name: string | null | undefined, category: string) => {
      if (!name) return;
      const key = normalizeGroupValue(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const group = productGroups.find((g: any) => g.id === name || normalizeGroupValue(g.name) === key);
      if (group) {
        result.push({ groupName: `${category}: ${group.name}`, groupId: key, realGroupId: group.id });
      }
    };

    if (sheetSpecs) {
      addGroup(sheetSpecs.upper_material, 'Cabedal');
      addGroup(sheetSpecs.insole_material, 'Palmilha');
      addGroup(sheetSpecs.lining_material, 'Forração');
    }

    return result;
  }, [sheetSpecs, productGroups]);

  const bomColorsByGroup = useMemo(() => {
    const result: { groupName: string; groupId: string; colors: string[] }[] = [];
    const seen = new Set<string>();

    const addGroup = (name: string | null | undefined, category: string) => {
      if (!name) return;
      const key = normalizeGroupValue(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const colors = getColorsFromGroupName(name);
      if (colors.length > 0) result.push({ groupName: `${category}: ${name}`, groupId: key, colors });
    };

    if (sheetSpecs) {
      addGroup(sheetSpecs.upper_material, 'Material Predominante (Cabedal)');
      addGroup(sheetSpecs.insole_material, 'Material e Palmilha');
    }

    return result;
  }, [sheetSpecs, productGroups, groupSupplierMaterials, products, allGroupColors]);

  const bomColors = useMemo(() => {
    const all = new Set<string>();
    bomColorsByGroup.forEach(g => g.colors.forEach(c => all.add(c)));
    return Array.from(all).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [bomColorsByGroup]);

  const existingColors = new Set(variants.map(v => v.color.toLowerCase()));

  const getHex = useCallback((colorName: string) => {
    const groupColorHex = allGroupColors.find(gc => gc.color_name.toUpperCase() === colorName.toUpperCase())?.color_hex;
    return groupColorHex || NAPA_SOFT_HEX[colorName.toUpperCase()] || '';
  }, [allGroupColors]);

   const handleAddColor = async (color: string, skipImage = false, sku?: string, barcode?: string): Promise<any> => {
     const c = color.trim();
     if (!c || existingColors.has(c.toLowerCase())) return;
     
     const finalSku = sku || generateNextSku();
     const variant = await addVariant.mutateAsync({ 
       reference_id: sheetId, 
       color: c, 
       sku: finalSku,
       barcode: barcode
     });

    if (sheetImageUrl && variant && !skipImage) {
      setRecoloring(variant.id);
      try {
        const hex = getHex(c) || c;
        const url = await recolorImage(sheetImageUrl, hex, sheetCode || 'REF');
        await updateVariant.mutateAsync({ id: variant.id, data: { image_url: url } });
        toast.success(`Imagem recolorida para ${c}`);
      } catch (err: any) {
        console.error('Recolor error:', err);
        toast.info(`Cor ${c} adicionada. Imagem não pôde ser gerada automaticamente.`);
      } finally {
        setRecoloring(null);
      }
    }
     setNewColor('');
     return variant;
  };

  const handleAddFromInput = () => {
    if (newColor.trim()) handleAddColor(newColor.trim());
  };

  const handleUploadImage = async (variantId: string, file: File) => {
    setUploading(variantId);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `variant-${variantId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      await updateVariant.mutateAsync({ id: variantId, data: { image_url: publicUrl } });
      toast.success('Foto enviada com sucesso!');
    } catch (err: any) {
      toast.error(`Erro ao enviar foto: ${err.message}`);
    } finally {
      setUploading(null);
      setDragOver(null);
    }
  };

  const handleUploadGroupImage = async (variantId: string, groupId: string, file: File) => {
    const key = `${variantId}-${groupId}`;
    setUploadingGroupImg(key);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `variant-${variantId}-group-${groupId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      await upsertGroupImage.mutateAsync({ variantId, groupId, imageUrl: publicUrl });
      toast.success('Foto do material enviada!');
    } catch (err: any) {
      toast.error(`Erro ao enviar foto: ${err.message}`);
    } finally {
      setUploadingGroupImg(null);
    }
  };

  const handleDrop = (variantId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleUploadImage(variantId, file);
    }
  };

  const getGroupImageForVariant = (variantId: string, groupId: string) => {
    return groupImages.find(gi => gi.variant_id === variantId && gi.group_id === groupId);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === variants.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(variants.map(v => v.id)));
    }
  };

  const handleBulkRecolor = async () => {
    const selectedList = variants.filter(v => selectedIds.has(v.id));
    if (selectedList.length === 0) return;
    
    setBulkAdding(true);
    cancelRef.current = false;
    
    let count = 0;
    for (const v of selectedList) {
      if (cancelRef.current) break;
      if (!sheetImageUrl) continue;
      
      setRecoloring(v.id);
      try {
        const hex = getHex(v.color) || v.color;
        const url = await recolorImage(sheetImageUrl, hex, sheetCode || 'REF');
        await updateVariant.mutateAsync({ id: v.id, data: { image_url: url } });
        count++;
      } catch (err) {
        console.error(`Error recoloring ${v.color}:`, err);
      } finally {
        setRecoloring(null);
      }
    }
    
    setBulkAdding(false);
    setSelectedIds(new Set());
    toast.success(`${count} imagem(ns) gerada(s) com sucesso.`);
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Deseja realmente excluir ${selectedIds.size} variante(s)?`)) return;
    
    const ids = Array.from(selectedIds);
    setBulkAdding(true);
    try {
      for (const id of ids) {
        await deleteVariant.mutateAsync(id);
      }
      setSelectedIds(new Set());
      toast.success('Variantes excluídas com sucesso.');
    } catch (err) {
      toast.error('Erro ao excluir algumas variantes.');
    } finally {
      setBulkAdding(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  const filteredBomColorsByGroup = bomColorsByGroup.map(grp => ({
    ...grp,
    colors: bomSearch
      ? grp.colors.filter(c => c.toLowerCase().includes(bomSearch.toLowerCase()))
      : grp.colors,
  })).filter(grp => grp.colors.length > 0);

  const hasMultipleGroups = bomMaterialGroups.length > 1;

  return (
    <div className="space-y-6">
      {/* Header with manual add */}
      <div className="flex flex-col gap-4 max-w-md">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Adicionar nova cor de venda</Label>
          <div className="flex gap-2">
            <Input
              value={newColor}
              onChange={e => setNewColor(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddFromInput(); } }}
              placeholder="Ex: Tâmara, Preto, New Whisky..."
              className="h-9 text-xs"
            />
            <Button size="sm" onClick={handleAddFromInput} disabled={!newColor.trim()} className="h-9 px-4 shrink-0 text-xs">
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        </div>
      </div>
      {/* BOM Colors Section */}
      {bomColorsByGroup.length > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="p-4 border-b flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Cores disponíveis no BOM</h3>
              <Badge variant="secondary" className="text-[10px] font-mono">
                {bomColors.filter(c => !existingColors.has(c.toLowerCase())).length} pendente(s)
              </Badge>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={bomSearch}
                  onChange={e => setBomSearch(e.target.value)}
                  placeholder="Buscar cor..."
                  className="h-8 w-44 pl-8 text-xs"
                />
                {bomSearch && (
                  <button onClick={() => setBomSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>
              {bomColors.some(c => !existingColors.has(c.toLowerCase())) && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={bulkAdding}
                    onClick={async () => {
                      cancelRef.current = false;
                      setBulkAdding(true);
                       const toAdd = bomColors.filter(c => !existingColors.has(c.toLowerCase()));
                       let currentVariants = [...variants];
                       for (const c of toAdd) {
                         if (cancelRef.current) break;
                         const nextSku = generateNextSku(currentVariants);
                         const variant = await handleAddColor(c, false, nextSku);
                         if (variant) currentVariants.push(variant);
                       }
                      setBulkAdding(false);
                    }}
                  >
                    {bulkAdding ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                    Incluir todas
                  </Button>
                  {bulkAdding && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        cancelRef.current = true;
                        toast.info('Geração será interrompida após a cor atual.');
                      }}
                    >
                      <Square className="h-3.5 w-3.5 mr-1" /> Parar
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={bulkAdding}
                    onClick={async () => {
                      setBulkAdding(true);
                       const toAdd = bomColors.filter(c => !existingColors.has(c.toLowerCase()));
                       let currentVariants = [...variants];
                       for (const c of toAdd) {
                         const nextSku = generateNextSku(currentVariants);
                         const variant = await handleAddColor(c, true, nextSku);
                         if (variant) currentVariants.push(variant);
                       }
                      setBulkAdding(false);
                      toast.success('Todas as cores adicionadas (sem imagens).');
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Sem imagens
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="p-4 space-y-3">
            {filteredBomColorsByGroup.map(grp => {
              const pending = grp.colors.filter(c => !existingColors.has(c.toLowerCase()));
              // Extract the material/product name from groupName (e.g. "Material Predominante (Cabedal): NAPA SOFT" → "NAPA SOFT")
              const materialName = grp.groupName.includes(':') ? grp.groupName.split(':').pop()?.trim() || grp.groupName : grp.groupName;
              return (
                <div key={grp.groupId}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-muted-foreground">{grp.groupName}</span>
                    {pending.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">({pending.length} restante{pending.length > 1 ? 's' : ''})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {grp.colors.map(c => {
                      const hex = getHex(c);
                      const alreadyAdded = existingColors.has(c.toLowerCase());
                      return (
                        <button
                          key={c}
                          disabled={alreadyAdded || bulkAdding}
                          onClick={() => !alreadyAdded && handleAddColor(c)}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
                            ${alreadyAdded
                              ? 'bg-muted/50 border-primary/20 text-foreground cursor-default'
                              : 'bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer hover:shadow-sm'
                            }`}
                        >
                          {alreadyAdded ? <Check className="h-3 w-3 text-primary shrink-0" /> : <Plus className="h-3 w-3 text-muted-foreground shrink-0" />}
                          <span className="font-semibold text-foreground">{materialName}</span>
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0"
                            style={{ backgroundColor: hex || '#22c55e' }}
                          >
                            {hex && (
                              <span
                                className="w-2.5 h-2.5 rounded-full border border-white/30 shrink-0"
                                style={{ backgroundColor: hex }}
                              />
                            )}
                            {c}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {bomColors.every(c => existingColors.has(c.toLowerCase())) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Check className="h-4 w-4 text-green-500" />
                Todas as cores do BOM já foram adicionadas
              </div>
            )}
          </div>
        </div>
      )}

      {/* Color variants grid */}
      {variants.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                Variantes cadastradas
                <Badge variant="secondary" className="text-[10px] font-mono">{variants.length}</Badge>
              </h3>
              <div className="flex items-center gap-2 ml-2 pl-4 border-l">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px] px-2"
                  onClick={toggleSelectAll}
                >
                  {selectedIds.size === variants.length && variants.length > 0 ? (
                    <CheckSquare className="h-3.5 w-3.5 mr-1 text-primary" />
                  ) : (
                    <Square className="h-3.5 w-3.5 mr-1 text-muted-foreground/40" />
                  )}
                  {selectedIds.size === variants.length && variants.length > 0 ? 'Desmarcar todos' : 'Selecionar todos'}
                </Button>

                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                    <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {selectedIds.size} selecionado(s)
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2 text-primary hover:text-primary"
                      onClick={handleBulkRecolor}
                      disabled={bulkAdding}
                    >
                      <ImagePlus className="h-3.5 w-3.5 mr-1" /> Gerar fotos
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2 text-destructive hover:bg-destructive/10"
                      onClick={handleBulkDelete}
                      disabled={bulkAdding}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {hasMultipleGroups && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                {bomMaterialGroups.length} grupo(s) de material
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {variants.map(v => {
              const blackVariantImg = !v.image_url
                ? variants.find(bv => {
                    const c = bv.color?.toLowerCase().trim() || '';
                    return (c.includes('preta') || c.includes('preto') || c === 'black') && !!bv.image_url;
                  })?.image_url
                : undefined;
              const fallbackImg = v.image_url || blackVariantImg || sheetImageUrl;
              const isBlackFallback = !v.image_url && !!blackVariantImg;
              const isSheetFallback = !v.image_url && !blackVariantImg && !!sheetImageUrl;
              const hex = getHex(v.color);
              const isDragging = dragOver === v.id;
              const isExpanded = expandedVariant === v.id;
              const variantGroupImgs = groupImages.filter(gi => gi.variant_id === v.id);

              return (
                <div
                  key={v.id}
                  className={`group rounded-xl border bg-card overflow-hidden transition-all hover:shadow-md relative ${selectedIds.has(v.id) ? 'ring-2 ring-primary ring-inset' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(v.id); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={e => handleDrop(v.id, e)}
                >
                  <div className="absolute top-2 left-2 z-10">
                    <Checkbox
                      checked={selectedIds.has(v.id)}
                      onCheckedChange={() => toggleSelect(v.id)}
                      className="h-4 w-4 border-muted-foreground/30 bg-background/80 backdrop-blur-sm data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary"
                    />
                  </div>
                  {/* Main image area */}
                  <div className={`relative aspect-square bg-muted/50 flex items-center justify-center transition-colors ${isDragging ? 'ring-2 ring-primary ring-inset bg-primary/5' : ''}`}>
                    {recoloring === v.id || uploading === v.id ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-[10px] text-muted-foreground">{uploading === v.id ? 'Enviando...' : 'Gerando...'}</span>
                      </div>
                    ) : isDragging ? (
                      <div className="flex flex-col items-center gap-2 text-primary">
                        <Upload className="h-8 w-8" />
                        <span className="text-xs font-medium">Soltar aqui</span>
                      </div>
                    ) : fallbackImg ? (
                      <>
                        <SignedImage src={fallbackImg} alt={v.color} className="w-full h-full object-cover" />
                        {(isBlackFallback || isSheetFallback) && (
                          <span className="absolute top-1.5 left-1.5 text-[9px] bg-amber-100/90 text-amber-700 px-1.5 py-0.5 rounded-full font-medium backdrop-blur-sm">
                            {isBlackFallback ? 'Ref: Preta' : 'Foto base'}
                          </span>
                        )}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="text-[10px] h-7 shadow-lg"
                            onClick={() => fileInputRefs.current[v.id]?.click()}
                          >
                            <Upload className="h-3 w-3 mr-1" /> {v.image_url ? 'Trocar' : 'Enviar'}
                          </Button>
                          {!v.image_url && sheetImageUrl && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="text-[10px] h-7 shadow-lg"
                              onClick={async () => {
                                setRecoloring(v.id);
                                try {
                                  const h = getHex(v.color) || v.color;
                                  const url = await recolorImage(sheetImageUrl, h, sheetCode || 'REF');
                                  await updateVariant.mutateAsync({ id: v.id, data: { image_url: url } });
                                  toast.success(`Imagem gerada para ${v.color}`);
                                } catch (err: any) {
                                  toast.error(err.message || 'Erro ao gerar imagem');
                                } finally {
                                  setRecoloring(null);
                                }
                              }}
                            >
                              <ImagePlus className="h-3 w-3 mr-1" /> Gerar
                            </Button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div
                        className="flex flex-col items-center justify-center gap-2 w-full h-full cursor-pointer hover:bg-muted/80 transition-colors"
                        onClick={() => fileInputRefs.current[v.id]?.click()}
                      >
                        <div className="w-10 h-10 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                          <Camera className="h-5 w-5 text-muted-foreground/50" />
                        </div>
                        <span className="text-[10px] text-muted-foreground">Clique ou arraste</span>
                        {sheetImageUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[10px] h-6 mt-1"
                            onClick={async (e) => {
                              e.stopPropagation();
                              setRecoloring(v.id);
                              try {
                                const h = getHex(v.color) || v.color;
                                const url = await recolorImage(sheetImageUrl, h, sheetCode || 'REF');
                                await updateVariant.mutateAsync({ id: v.id, data: { image_url: url } });
                                toast.success(`Imagem gerada para ${v.color}`);
                              } catch (err: any) {
                                toast.error(err.message || 'Erro ao gerar imagem');
                              } finally {
                                setRecoloring(null);
                              }
                            }}
                          >
                            <ImagePlus className="h-3 w-3 mr-1" /> Auto-gerar
                          </Button>
                        )}
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      ref={el => { fileInputRefs.current[v.id] = el; }}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadImage(v.id, file);
                        e.target.value = '';
                      }}
                    />
                  </div>

                  {/* Info */}
                  <div className="p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {hex && (
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                            style={{ backgroundColor: hex }}
                          />
                        )}
                        <span className="text-xs font-semibold truncate">{v.color}</span>
                      </div>
                      <DeleteConfirmButton onConfirm={() => deleteVariant.mutate(v.id)} size="sm" />
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Tag className="h-2.5 w-2.5 shrink-0" />
                      <span className="font-mono truncate">{v.sku}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Barcode className="h-2.5 w-2.5 shrink-0" />
                      <span className="font-mono truncate">{v.barcode}</span>
                    </div>

                    {/* Material group photos toggle */}
                    {bomMaterialGroups.length > 0 && (
                      <button
                        onClick={() => setExpandedVariant(isExpanded ? null : v.id)}
                        className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors w-full pt-1"
                      >
                        <Layers className="h-2.5 w-2.5 shrink-0" />
                        <span className="font-medium">Fotos por material</span>
                        {variantGroupImgs.length > 0 && (
                          <Badge variant="secondary" className="text-[8px] h-3.5 px-1 ml-auto mr-1">{variantGroupImgs.length}</Badge>
                        )}
                        {isExpanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                      </button>
                    )}
                  </div>

                  {/* Expanded material group images */}
                  {isExpanded && bomMaterialGroups.length > 0 && (
                    <div className="border-t bg-muted/30 p-2 space-y-2">
                      {bomMaterialGroups.map(grp => {
                        const gImg = getGroupImageForVariant(v.id, grp.realGroupId);
                        const inputKey = `${v.id}-${grp.realGroupId}`;
                        const isUploadingThis = uploadingGroupImg === inputKey;

                        return (
                          <div key={grp.realGroupId} className="flex items-center gap-2">
                            {/* Thumbnail */}
                            <div className="w-12 h-12 rounded-lg border bg-background flex-shrink-0 overflow-hidden flex items-center justify-center">
                              {isUploadingThis ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              ) : gImg ? (
                                <SignedImage src={gImg.image_url} alt={`${v.color} - ${grp.groupName}`} className="w-full h-full object-cover" />
                              ) : (
                                <Camera className="h-4 w-4 text-muted-foreground/40" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-[10px] font-medium text-foreground truncate block">{grp.groupName}</span>
                              <button
                                className="text-[9px] text-primary hover:underline"
                                onClick={() => groupFileInputRefs.current[inputKey]?.click()}
                              >
                                {gImg ? 'Trocar foto' : 'Enviar foto'}
                              </button>
                            </div>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              ref={el => { groupFileInputRefs.current[inputKey] = el; }}
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) handleUploadGroupImage(v.id, grp.realGroupId, file);
                                e.target.value = '';
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {variants.length === 0 && bomColors.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Palette className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhuma variante de cor cadastrada</p>
          <p className="text-xs mt-1">Adicione materiais no BOM para ver as cores disponíveis, ou adicione manualmente</p>
        </div>
      )}
    </div>
  );
}
