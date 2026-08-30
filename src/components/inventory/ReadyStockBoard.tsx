import { useMemo, useState } from 'react';
import { Plus, Trash as Trash2, CircleNotch as Loader2, Package, ShoppingBag } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { NumberInput } from '@/components/ui/number-input';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useProducts } from '@/hooks/useProducts';
import {
  useReadyStock,
  useSetReadyStockGrade,
  useUpdateReadyStock,
  useBatchDeleteReadyStock,
} from '@/hooks/useReadyStock';
import { encodeGradeNotes, groupItemsByLot, sizesToGradeLabel } from '@/lib/readyStockLots';
import { cn } from '@/lib/utils';
import { SearchInput } from '@/components/ui/search-input';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

function parseSizes(sizesStr: string | null): string[] {
  if (!sizesStr) return [];
  const match = sizesStr.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (match) {
    const sizes: string[] = [];
    for (let i = parseInt(match[1]); i <= parseInt(match[2]); i++) sizes.push(String(i));
    return sizes;
  }
  return sizesStr.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseColors(colorsStr: string | null): string[] {
  if (!colorsStr) return [];
  return colorsStr.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function ReadyStockBoard() {
  const { data: stock = [], isLoading } = useReadyStock();
  const { data: references = [] } = useTechnicalSheets();
  const { data: products = [] } = useProducts();
  const setGrade = useSetReadyStockGrade();
  const updateStock = useUpdateReadyStock();
  const batchDeleteStock = useBatchDeleteReadyStock();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selRef, setSelRef] = useState('');
  const [selColor, setSelColor] = useState('');
  const [gradeQty, setGradeQty] = useState<Record<string, number>>({});
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const activeRefs = useMemo(() => references.filter((r) => r.status === 'Ativo'), [references]);
  const selectedRef = useMemo(() => activeRefs.find((r) => r.id === selRef), [activeRefs, selRef]);
  const availableSizes = useMemo(() => parseSizes(selectedRef?.sizes || null), [selectedRef]);
  const availableColors = useMemo(() => {
    const fromText = parseColors(selectedRef?.colors || null);
    if (fromText.length > 0) return fromText;
    const ref = selectedRef as { cor_predominante_id?: string };
    if (!ref?.cor_predominante_id) return [];
    const colors = new Set<string>();
    products.filter((p) => p.active && p.group_id === ref.cor_predominante_id).forEach((p) => {
      p.color?.split(',').forEach((c) => { if (c.trim()) colors.add(c.trim()); });
    });
    return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [selectedRef, products]);

  const filtered = useMemo(() => stock.filter((s) => {
    const ref = s.technical_sheets;
    return searchMatchesAllTerms(search, ref?.name, ref?.code, s.color, s.size, ref?.shoe_category, ref?.brand);
  }), [stock, search]);

  const grouped = useMemo(() => groupItemsByLot(filtered).map((lot) => {
    const items = [...lot.items].sort((a, b) => parseInt(a.size) - parseInt(b.size));
    const ts = items[0].technical_sheets;
    const imageUrl = Array.isArray(ts?.color_images)
      ? (ts.color_images.find((c: { color: string; url?: string }) => c.color === items[0].color)?.url || ts?.image_url || '')
      : (ts?.image_url || '');
    return {
      key: lot.key,
      gradeLabel: lot.gradeLabel,
      color: items[0].color,
      refCode: ts?.code || '',
      refName: ts?.name || '—',
      items,
      totalQty: items.reduce((sum, row) => sum + row.quantity, 0),
      imageUrl,
    };
  }), [filtered]);

  const allSizes = useMemo(() => {
    const set = new Set<string>();
    grouped.forEach((g) => g.items.forEach((i) => set.add(i.size)));
    return Array.from(set).sort((a, b) => parseInt(a) - parseInt(b));
  }, [grouped]);

  const resetForm = () => {
    setSelRef(''); setSelColor(''); setGradeQty({}); setLocation(''); setNotes('');
  };

  const handleSubmit = async () => {
    if (!selRef || !selColor) return;
    const selectedSizes = Object.entries(gradeQty).filter(([, qty]) => qty > 0);
    if (selectedSizes.length === 0) return;
    const gradeLabel = sizesToGradeLabel(selectedSizes.map(([size]) => size));
    const markedNotes = encodeGradeNotes(gradeLabel, notes);
    await setGrade.mutateAsync(selectedSizes.map(([size, quantity]) => {
      const existing = stock.find((item) =>
        item.reference_id === selRef && item.color === selColor && item.size === size && !item.material_variant_id
      );
      return {
        id: existing?.id,
        reference_id: selRef,
        color: selColor,
        size,
        quantity,
        expectedQuantity: existing?.quantity ?? 0,
        location,
        notes: markedNotes,
      };
    }));
    setDialogOpen(false);
    resetForm();
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput className="flex-1 max-w-sm" placeholder="Buscar…" value={search} onChange={setSearch} resultCount={filtered.length} totalCount={stock.length} />
        <Button onClick={() => { resetForm(); setDialogOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> Definir estoque
        </Button>
      </div>

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Nenhum produto em pronta entrega. Clique em Definir estoque.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="text-xs">Foto</TableHead>
                  <TableHead className="text-xs">Refer.</TableHead>
                  <TableHead className="text-xs">Descrição</TableHead>
                  <TableHead className="text-center text-xs">Cor / grade</TableHead>
                  {allSizes.map((size) => <TableHead key={size} className="text-center text-xs w-12">{size}</TableHead>)}
                  <TableHead className="text-center text-xs">Pares</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map((g) => (
                  <TableRow key={g.key}>
                    <TableCell>
                      {g.imageUrl ? <img src={g.imageUrl} alt="" className="w-10 h-10 object-cover rounded" /> : <Package className="h-4 w-4 text-muted-foreground" />}
                    </TableCell>
                    <TableCell className="text-xs font-mono font-semibold">{g.refCode}</TableCell>
                    <TableCell className="text-xs">{g.refName}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-xs">{g.color}</Badge>
                      <div className="text-[10px] text-muted-foreground">{g.gradeLabel}</div>
                    </TableCell>
                    {allSizes.map((size) => {
                      const item = g.items.find((row) => row.size === size);
                      return (
                        <TableCell key={size} className={cn('text-center px-1', item ? '' : 'text-muted-foreground/30')}>
                          {item ? (
                            <NumberInput min={0} decimals={0} value={item.quantity} className="h-8 w-12 mx-auto text-center px-1"
                              onChange={(n) => updateStock.mutate({ id: item.id, quantity: n, expectedQuantity: item.quantity, location: item.location, notes: item.notes })} />
                          ) : ''}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center text-xs font-mono font-bold">{g.totalQty}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Remover linha da pronta entrega" onClick={() => {
                        if (confirm('Remover esta linha (referência, cor e grade)?')) {
                          void batchDeleteStock.mutateAsync(g.items.map((i) => ({ id: i.id, expectedQuantity: i.quantity })));
                        }
                      }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShoppingBag className="h-5 w-5" /> Definir grade no estoque</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Referência / Modelo</Label>
              <Select value={selRef} onValueChange={(v) => { setSelRef(v); setSelColor(''); setGradeQty({}); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {activeRefs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.code ? `${r.code} — ` : ''}{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedRef && (
              <div>
                <Label className="text-xs">Cor</Label>
                {availableColors.length > 0 ? (
                  <Select value={selColor} onValueChange={setSelColor}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a cor..." /></SelectTrigger>
                    <SelectContent>
                      {availableColors.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={selColor} onChange={(e) => setSelColor(e.target.value)} placeholder="Digite a cor..." className="mt-1" />
                )}
              </div>
            )}
            {selectedRef && selColor && (
              <>
                <div>
                  <Label className="text-xs mb-2 block">Grade — preencha só a faixa desta linha</Label>
                  <div className="grid grid-cols-5 gap-2">
                    {availableSizes.map((size) => (
                      <div key={size} className="text-center">
                        <p className="text-xs text-muted-foreground mb-1">Nº {size}</p>
                        <NumberInput min={0} decimals={0} value={gradeQty[size]} onChange={(n) => setGradeQty((prev) => ({ ...prev, [size]: n }))} className="text-center h-9 text-sm font-mono" placeholder="0" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Localização</Label>
                    <Input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Observação</Label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
                  </div>
                </div>
                <Button onClick={() => void handleSubmit()} disabled={setGrade.isPending || !selRef || !selColor || Object.values(gradeQty).every((v) => !v)} className="w-full">
                  {setGrade.isPending ? 'Salvando...' : 'Definir no estoque'}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
