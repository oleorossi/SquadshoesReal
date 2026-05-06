import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Printer, Upload, Plus, Minus, RotateCcw, Eye } from 'lucide-react';
import { buildThermalLabelsHtml, buildBoxIdentificationHtml, DEFAULT_THERMAL_CONFIG } from '@/lib/printLabels';
import { supabase } from '@/integrations/supabase/client';

const FALLBACK_SIZES = [
  '20','21','22','23','24','25','26','27','28','29','30','31','32','33',
  '34','35','36','37','38','39','40'
];

interface SizeEntry { size: string; qty: string; }

interface ManualForm {
  labelType: string;
  lote: string;
  obs: string;
  referencia: string;
  materials: string[];
  cor: string;
  preco: string;
  imageUrl: string;
  idioma: string;
  copies: string;
  senderName: string;
  senderCnpj: string;
  recipientName: string;
  recipientCnpj: string;
  sizes: SizeEntry[];
}

const EMPTY: ManualForm = {
  labelType: 'thermal',
  lote: '',
  obs: '',
  referencia: '',
  materials: ['', '', '', '', '', ''],
  cor: '',
  preco: '',
  imageUrl: '',
  idioma: 'PT',
  copies: '1',
  senderName: '',
  senderCnpj: '',
  recipientName: '',
  recipientCnpj: '',
  sizes: FALLBACK_SIZES.map(s => ({ size: s, qty: '' })),
};

function openPrint(html: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 900);
}

export function LabelManualTab() {
  const [form, setForm] = useState<ManualForm>(EMPTY);
  const fileRef = useRef<HTMLInputElement>(null);
  const [registeredSizes, setRegisteredSizes] = useState<string[]>(FALLBACK_SIZES);

  useEffect(() => {
    supabase
      .from('sole_technical_specs')
      .select('size')
      .then(({ data }) => {
        if (data && data.length > 0) {
          const unique = [...new Set(data.map(r => String(r.size)))].sort((a, b) => Number(a) - Number(b));
          if (unique.length > 0) {
            setRegisteredSizes(unique);
            setForm(prev => ({
              ...prev,
              sizes: unique.map(s => ({ size: s, qty: '' })),
            }));
          }
        }
      });
  }, []);

  const set = <K extends keyof ManualForm>(field: K, value: ManualForm[K]) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const setMaterial = (idx: number, value: string) =>
    setForm(prev => {
      const materials = [...prev.materials];
      materials[idx] = value;
      return { ...prev, materials };
    });

  const setSizeEntry = (idx: number, field: keyof SizeEntry, value: string) =>
    setForm(prev => ({
      ...prev,
      sizes: prev.sizes.map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }));

  const addSize = () =>
    setForm(prev => ({ ...prev, sizes: [...prev.sizes, { size: '', qty: '' }] }));

  const removeSize = (idx: number) =>
    setForm(prev => ({ ...prev, sizes: prev.sizes.filter((_, i) => i !== idx) }));

  const loadPreset = () => {
    setForm(prev => ({ ...prev, sizes: registeredSizes.map(s => ({ size: s, qty: '' })) }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => set('imageUrl', (ev.target?.result as string) ?? '');
    reader.readAsDataURL(file);
  };

  const grade = form.sizes.filter(s => s.size && Number(s.qty) > 0).map(s => ({ size: s.size, qty: Number(s.qty) }));
  const totalPairs = grade.reduce((s, e) => s + e.qty, 0);
  const copies = Math.max(1, Number(form.copies) || 1);
  const mainMaterial = form.materials.filter(Boolean).join(', ');

  const handlePrint = () => {
    if (form.labelType === 'thermal') {
      const rows = grade.length > 0
        ? grade.flatMap(g =>
            Array.from({ length: copies }, () => ({
              refCode: form.referencia,
              refName: form.materials[0] || form.referencia,
              mainMaterial,
              color: form.cor,
              size: g.size,
              barcode: (form.referencia + g.size).replace(/\s/g, ''),
              imageUrl: form.imageUrl || undefined,
              clientOrderNumber: form.lote || undefined,
              qty: g.qty > 1 ? g.qty : undefined,
            }))
          )
        : Array.from({ length: copies }, () => ({
            refCode: form.referencia,
            refName: form.materials[0] || form.referencia,
            mainMaterial,
            color: form.cor,
            size: '',
            barcode: form.referencia.replace(/\s/g, '') || 'MANUAL',
            imageUrl: form.imageUrl || undefined,
            clientOrderNumber: form.lote || undefined,
          }));
      openPrint(buildThermalLabelsHtml(rows, '', { width: 100, height: 30 }, DEFAULT_THERMAL_CONFIG));
    } else if (form.labelType === 'box') {
      const items = Array.from({ length: copies }, (_, i) => ({
        orderNumber: form.lote || '—',
        refCode: form.referencia,
        refName: form.materials[0] || form.referencia,
        color: form.cor,
        boxNumber: i + 1,
        totalBoxes: copies,
        senderName: form.senderName || 'Empresa',
        senderCnpj: form.senderCnpj || '—',
        recipientName: form.recipientName || undefined,
        recipientCnpj: form.recipientCnpj || undefined,
        mainMaterial: mainMaterial || undefined,
        grade,
        barcode: form.referencia.replace(/\s/g, '') || undefined,
        imageUrl: form.imageUrl || undefined,
      }));
      openPrint(buildBoxIdentificationHtml(items));
    } else if (form.labelType === 'hangtag') {
      openPrint(buildHangtagManualHtml(form, grade, copies));
    }
  };

  const handlePreview = () => {
    if (form.labelType === 'thermal') {
      const label = {
        refCode: form.referencia,
        refName: form.materials[0] || form.referencia,
        mainMaterial,
        color: form.cor,
        size: grade[0]?.size || '',
        barcode: (form.referencia + (grade[0]?.size || '')).replace(/\s/g, '') || 'PREVIEW',
        imageUrl: form.imageUrl || undefined,
        clientOrderNumber: form.lote || undefined,
      };
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(buildThermalLabelsHtml([label], '', { width: 100, height: 30 }, DEFAULT_THERMAL_CONFIG));
      w.document.close();
    } else if (form.labelType === 'foot') {
      handlePrint();
    } else {
      handlePrint();
    }
  };

  const isBox = form.labelType === 'box';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Preenchimento Manual de Etiqueta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Row 1 — type + lote + obs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo de Impressão</Label>
              <Select value={form.labelType} onValueChange={v => set('labelType', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="thermal">Etiqueta Térmica (100×30 mm)</SelectItem>
                  <SelectItem value="box">Rótulo Caixa (190×138 mm)</SelectItem>
                  <SelectItem value="hangtag">Hangtag / Penduricalho</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Lote / Ordem</Label>
              <Input className="h-8 text-sm" value={form.lote} onChange={e => set('lote', e.target.value)} placeholder="Ex: OP-2024-001" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Obs.</Label>
              <Input className="h-8 text-sm" value={form.obs} onChange={e => set('obs', e.target.value)} />
            </div>
          </div>

          {/* Row 2 — ref + cor + preço */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Referência</Label>
              <Input className="h-8 text-sm" value={form.referencia} onChange={e => set('referencia', e.target.value)} placeholder="Ex: REF-001" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cor</Label>
              <Input className="h-8 text-sm" value={form.cor} onChange={e => set('cor', e.target.value)} placeholder="Ex: Preto" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Preço</Label>
              <Input className="h-8 text-sm" value={form.preco} onChange={e => set('preco', e.target.value)} placeholder="R$ 0,00" />
            </div>
          </div>

          {/* Materials */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Materiais / Composição</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {form.materials.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">Material {i + 1}:</span>
                  <Input className="h-7 text-sm flex-1" value={m} onChange={e => setMaterial(i, e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          {/* Image + idioma + copies */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1 sm:col-span-1">
              <Label className="text-xs">Imagem</Label>
              <div className="flex gap-1">
                <Input
                  className="h-8 text-sm flex-1 min-w-0"
                  value={form.imageUrl.startsWith('data:') ? '(arquivo local)' : form.imageUrl}
                  onChange={e => set('imageUrl', e.target.value)}
                  placeholder="URL da imagem"
                />
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />
                </Button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </div>
              {form.imageUrl && (
                <div className="mt-1 h-16 flex items-center justify-center border rounded bg-muted/30">
                  <img
                    src={form.imageUrl}
                    alt="preview"
                    className="max-h-14 max-w-full object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Idioma</Label>
              <Select value={form.idioma} onValueChange={v => set('idioma', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PT">Português (PT)</SelectItem>
                  <SelectItem value="EN">English (EN)</SelectItem>
                  <SelectItem value="ES">Español (ES)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cópias / Qtd. por tamanho</Label>
              <Input className="h-8 text-sm" type="number" min={1} max={999} value={form.copies} onChange={e => set('copies', e.target.value)} />
            </div>
          </div>

          {/* Sender/recipient — only for box */}
          {isBox && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Remetente / Destinatário</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Remetente</Label>
                  <Input className="h-8 text-sm" value={form.senderName} onChange={e => set('senderName', e.target.value)} placeholder="Nome da empresa" />
                  <Input className="h-8 text-sm" value={form.senderCnpj} onChange={e => set('senderCnpj', e.target.value)} placeholder="CNPJ" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Destinatário (opcional)</Label>
                  <Input className="h-8 text-sm" value={form.recipientName} onChange={e => set('recipientName', e.target.value)} placeholder="Nome do destinatário" />
                  <Input className="h-8 text-sm" value={form.recipientCnpj} onChange={e => set('recipientCnpj', e.target.value)} placeholder="CNPJ" />
                </div>
              </div>
            </div>
          )}

          <Separator />

          {/* Size grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold">Numeração / Grade</Label>
                {totalPairs > 0 && (
                  <Badge variant="secondary" className="text-xs">{totalPairs} pares</Badge>
                )}
              </div>
              <div className="flex gap-1 flex-wrap">
                <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => loadPreset()}>
                  Grade Cadastrada ({registeredSizes[0]}–{registeredSizes[registeredSizes.length - 1]})
                </Button>
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={addSize} title="Adicionar tamanho">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto pb-1">
              <table className="border-collapse text-center text-sm select-none">
                <thead>
                  <tr>
                    {form.sizes.map((_, i) => (
                      <th key={i} className="px-1 py-0.5 text-xs text-muted-foreground font-normal w-14">Tam.</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {form.sizes.map((s, i) => (
                      <td key={i} className="px-0.5">
                        <Input
                          value={s.size}
                          onChange={e => setSizeEntry(i, 'size', e.target.value)}
                          className="h-7 w-13 text-center text-xs px-1"
                        />
                      </td>
                    ))}
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={form.sizes.length + 1} className="py-0.5">
                      <div className="text-xs text-muted-foreground text-left pl-1">Qt.:</div>
                    </td>
                  </tr>
                  <tr>
                    {form.sizes.map((s, i) => (
                      <td key={i} className="px-0.5">
                        <Input
                          type="number"
                          min={0}
                          value={s.qty}
                          onChange={e => setSizeEntry(i, 'qty', e.target.value)}
                          className="h-7 w-13 text-center text-xs px-1"
                        />
                      </td>
                    ))}
                    <td className="pl-1">
                      {/* spacer for remove buttons below */}
                    </td>
                  </tr>
                  <tr>
                    {form.sizes.map((_, i) => (
                      <td key={i} className="px-0.5 pt-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-13 rounded-sm"
                          onClick={() => removeSize(i)}
                          title="Remover"
                        >
                          <Minus className="h-2.5 w-2.5" />
                        </Button>
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={handlePrint} className="gap-2">
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <Button variant="outline" onClick={handlePreview} className="gap-2">
              <Eye className="h-4 w-4" />
              Pré-visualizar
            </Button>
            <Button variant="ghost" onClick={() => setForm(EMPTY)} className="gap-2 ml-auto">
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar
            </Button>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Hangtag manual HTML ─────────────────────────────────────────────────── */
function buildHangtagManualHtml(form: ManualForm, grade: { size: string; qty: number }[], copies: number): string {
  const price = form.preco
    ? parseFloat(form.preco.replace(/[^\d,.-]/g, '').replace(',', '.'))
    : 0;
  const fmtPrice = price > 0
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price)
    : '';

  const mainMaterial = form.materials.filter(Boolean).join(' | ');

  const tags = grade.length > 0
    ? grade.flatMap(g =>
        Array.from({ length: copies }, () =>
          buildSingleHangtag(form, g.size, mainMaterial, fmtPrice)
        )
      )
    : Array.from({ length: copies }, () =>
        buildSingleHangtag(form, '', mainMaterial, fmtPrice)
      );

  const pages: string[] = [];
  for (let i = 0; i < tags.length; i += 4) {
    const slice = tags.slice(i, i + 4);
    const isLast = i + 4 >= tags.length;
    pages.push(`<div class="page${!isLast ? ' pb' : ''}">${slice.join('')}</div>`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hangtag</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:Arial,sans-serif;background:#fff;color:#000;}
.page{display:flex;flex-wrap:wrap;width:200mm;gap:4mm;padding:8mm;align-content:flex-start;}
.page.pb{page-break-after:always;}
.tag{width:90mm;min-height:50mm;border:1.5px solid #000;padding:6mm;display:flex;flex-direction:column;gap:2mm;page-break-inside:avoid;}
.tag-ref{font-size:14pt;font-weight:bold;text-transform:uppercase;}
.tag-color{font-size:10pt;}
.tag-material{font-size:7pt;color:#555;margin-top:1mm;}
.tag-size{font-size:20pt;font-weight:bold;text-align:center;border:1px solid #000;padding:1mm 4mm;align-self:flex-start;margin-top:auto;}
.tag-price{font-size:12pt;font-weight:bold;text-align:right;margin-top:auto;}
.tag-lote{font-size:7pt;color:#888;}
@page{size:A4;margin:0;}
@media print{body{margin:0;}}
</style></head><body>${pages.join('')}</body></html>`;
}

function buildSingleHangtag(form: ManualForm, size: string, mainMaterial: string, fmtPrice: string): string {
  return `<div class="tag">
    <p class="tag-ref">${form.referencia || '—'}</p>
    <p class="tag-color">Cor: ${form.cor || '—'}</p>
    ${mainMaterial ? `<p class="tag-material">${mainMaterial}</p>` : ''}
    ${form.lote ? `<p class="tag-lote">Lote: ${form.lote}${form.obs ? ' — ' + form.obs : ''}</p>` : ''}
    ${size ? `<div class="tag-size">${size}</div>` : ''}
    ${fmtPrice ? `<p class="tag-price">${fmtPrice}</p>` : ''}
  </div>`;
}
