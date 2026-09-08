import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleNotch as Loader2, Plus, Trash as Trash2, ImageSquare as ImagePlus } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SignedImage } from '@/components/ui/signed-image';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { SheetFormData } from '@/hooks/useTechnicalSheets';

/* ===== Photos by Color Tab ===== */
export function PhotosByColorTab({ sheetId, form, groups, products }: {
  sheetId: string;
  form: SheetFormData;
  groups: any[];
  products: any[];
}) {
  const qc = useQueryClient();
  const { data: colorVariants = [], isLoading } = useQuery({
    queryKey: ['color_variants_photos', sheetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reference_color_variants')
        .select('*')
        .eq('reference_id', sheetId)
        .order('color');
      if (error) throw error;
      return data || [];
    },
  });

  // Cores DISPONÍVEIS EM ESTOQUE (decisão 2026-06-02): só cores de produtos com
  // quantity>0 nos materiais do modelo (cabedal + forração). Antes listava a
  // paleta INTEIRA da forração (incl. cores sem material) → confuso. Agora só
  // aparece o que a fábrica realmente tem em estoque, e por adição sob demanda.
  const stockColors = useMemo(() => {
    const groupNames = [form.upper_material, form.lining_material].filter(Boolean) as string[];
    ((form as any).lining_accessories || []).forEach((c: any) => { if (c.material) groupNames.push(c.material); });
    const groupIds = new Set(groups.filter((g: any) => groupNames.includes(g.name)).map((g: any) => g.id));
    const set = new Set<string>();
    products
      .filter((p: any) => p.active && Number(p.quantity) > 0 && groupIds.has(p.group_id))
      .forEach((p: any) => {
        if (p.color?.trim()) p.color.split(',').forEach((c: string) => { const t = c.trim(); if (t) set.add(t); });
      });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [form, groups, products]);

  // Cores já engajadas: com registro de variante (com/sem foto) + as adicionadas
  // agora pelo usuário (ainda sem upload). Só estas viram slot de foto.
  const [addedColors, setAddedColors] = useState<string[]>([]);
  const shownColors = useMemo(() => {
    const set = new Set<string>();
    colorVariants.forEach((v: any) => { if (v.color?.trim()) set.add(v.color.trim()); });
    addedColors.forEach(c => { if (c.trim()) set.add(c.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [colorVariants, addedColors]);
  const pickableColors = useMemo(
    () => stockColors.filter(c => !shownColors.includes(c)),
    [stockColors, shownColors],
  );

  const [uploading, setUploading] = useState<string | null>(null);

  const handleUpload = async (color: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(color);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `color-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      const existing = colorVariants.find((v: any) => v.color === color);
      if (existing) {
        await supabase.from('reference_color_variants').update({ image_url: publicUrl }).eq('id', existing.id);
      } else {
        await supabase.from('reference_color_variants').insert({ reference_id: sheetId, color, image_url: publicUrl });
      }
      qc.invalidateQueries({ queryKey: ['color_variants_photos', sheetId] });
      qc.invalidateQueries({ queryKey: ['color_variants', sheetId] });
      toast.success(`Foto para ${color} salva!`);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setUploading(null);
    }
  };

  const handleRemove = async (color: string) => {
    const existing = colorVariants.find((v: any) => v.color === color);
    if (existing) {
      await supabase.from('reference_color_variants').update({ image_url: '' }).eq('id', existing.id);
      qc.invalidateQueries({ queryKey: ['color_variants_photos', sheetId] });
      qc.invalidateQueries({ queryKey: ['color_variants', sheetId] });
      toast.success(`Foto de ${color} removida`);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (stockColors.length === 0 && shownColors.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-0">
          <EmptyState
            icon={ImagePlus}
            title="Nenhuma cor em estoque"
            description='As cores aparecem a partir dos produtos COM estoque (qtd > 0) nos materiais de cabedal/forração deste modelo. Dê entrada de estoque ou ajuste os materiais na aba "Materiais & BOM".'
            size="sm"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2"><ImagePlus className="h-4 w-4 text-primary" /> Fotos por Cor</h3>
        <p className="text-xs text-muted-foreground mt-1">Adicione uma cor (disponível em estoque) e suba a foto do produto naquela cor. A foto aparece no pedido e na ficha do operador ao escolher a cor.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value="" onValueChange={(c) => { if (c) setAddedColors(prev => (prev.includes(c) ? prev : [...prev, c])); }}>
          <SelectTrigger className="h-9 w-72">
            <SelectValue placeholder={pickableColors.length ? '+ Adicionar cor em estoque…' : 'Todas as cores em estoque já listadas'} />
          </SelectTrigger>
          <SelectContent>
            {pickableColors.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{stockColors.length} cor(es) em estoque</span>
      </div>

      {shownColors.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Selecione uma cor em estoque acima para subir a foto.</p>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
        {shownColors.map(color => {
          const variant = colorVariants.find((v: any) => v.color === color);
          const hasImage = variant?.image_url;
          return (
            <div key={color} className="relative group flex flex-col items-center">
              <div className="w-full aspect-square rounded-lg border-2 border-border bg-muted overflow-hidden flex items-center justify-center relative shadow-sm group-hover:border-primary/50 transition-colors">
                {hasImage ? (
                  <SignedImage src={variant.image_url} alt={color} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground/40">
                    <ImagePlus className="h-8 w-8" />
                    <span className="text-xs">Sem foto</span>
                  </div>
                )}
                {uploading === color ? (
                  <div className="absolute inset-0 bg-background/60 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
                ) : (
                  <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 transition-opacity">
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(color, e)} />
                    <Plus className="h-6 w-6 text-white mb-1" />
                    <span className="text-xs text-white font-bold">{hasImage ? 'Alterar' : 'Upload'}</span>
                  </label>
                )}
                {hasImage && !uploading && (
                  <Button variant="destructive" size="icon" aria-label="Remover foto da cor" className="h-5 w-5 absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 shadow-sm"
                    onClick={(e) => { e.stopPropagation(); handleRemove(color); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <span className="text-xs font-semibold mt-1.5 truncate w-full text-center px-1" title={color}>{color}</span>
              {hasImage && <Badge variant="default" className="text-[8px] h-3.5 px-1 mt-0.5">✓ com foto</Badge>}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
