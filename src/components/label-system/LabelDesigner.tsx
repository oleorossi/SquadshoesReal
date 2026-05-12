import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { TextT as Type, Barcode, QrCode, Image, Hash, Calendar, ArrowLeft, MagnifyingGlassPlus as ZoomIn, MagnifyingGlassMinus as ZoomOut, GridFour as Grid3X3, Eye, FloppyDisk as Save, Trash as Trash2, Copy, Stack as Layers, DotsSixVertical as GripVertical, Cursor as MousePointer } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { LabelTemplate, LabelField } from '@/types/label-system';

const DATA_SOURCE_LABELS: Record<string, string> = {
  product_name: 'Nome do Produto',
  sku: 'SKU',
  order_number: 'Nº Pedido',
  barcode: 'Código de Barras',
  color: 'Cor',
  size: 'Tamanho',
  date: 'Data',
  counter: 'Contador',
  custom: 'Personalizado',
};

const FIELD_TYPE_ICON: Record<string, React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  dynamic_text: <Hash className="h-3.5 w-3.5" />,
  barcode: <Barcode className="h-3.5 w-3.5" />,
  qr_code: <QrCode className="h-3.5 w-3.5" />,
  image: <Image className="h-3.5 w-3.5" />,
};

const PALETTE_ITEMS = [
  { type: 'text' as const, label: 'Texto Estático', icon: <Type className="h-4 w-4" /> },
  { type: 'dynamic_text' as const, label: 'Texto Dinâmico', icon: <Hash className="h-4 w-4" /> },
  { type: 'barcode' as const, label: 'Código de Barras', icon: <Barcode className="h-4 w-4" /> },
  { type: 'qr_code' as const, label: 'QR Code', icon: <QrCode className="h-4 w-4" /> },
  { type: 'image' as const, label: 'Imagem', icon: <Image className="h-4 w-4" /> },
];

// Scale factor: 1mm = this many px on canvas
const MM_TO_PX = 2.5;

interface LabelDesignerProps {
  template: LabelTemplate;
  onSave: (template: LabelTemplate) => void;
  onBack: () => void;
}

export function LabelDesigner({ template: initialTemplate, onSave, onBack }: LabelDesignerProps) {
  const [template, setTemplate] = useState<LabelTemplate>({ ...initialTemplate });
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [showGrid, setShowGrid] = useState(true);
  const [dragInfo, setDragInfo] = useState<{ fieldId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedField = template.fields.find(f => f.id === selectedFieldId) || null;

  const canvasW = template.dimensions.width * MM_TO_PX * (zoom / 100);
  const canvasH = template.dimensions.height * MM_TO_PX * (zoom / 100);

  const addField = (type: LabelField['type']) => {
    const newField: LabelField = {
      id: crypto.randomUUID(),
      name: `Campo ${template.fields.length + 1}`,
      type,
      position: { x: 5, y: 5, width: type === 'barcode' ? 30 : type === 'qr_code' ? 20 : 40, height: type === 'qr_code' ? 20 : 10 },
      styling: { font_size: 10, font_weight: 'normal', text_align: 'left', text_transform: 'none' },
      data_source: type === 'barcode' ? 'barcode' : type === 'qr_code' ? 'barcode' : 'product_name',
      default_value: type === 'text' ? 'Texto' : undefined,
      barcode_format: type === 'barcode' ? 'CODE128' : type === 'qr_code' ? 'QR' : undefined,
    };
    setTemplate(prev => ({ ...prev, fields: [...prev.fields, newField], updated_at: new Date().toISOString() }));
    setSelectedFieldId(newField.id);
  };

  const updateField = useCallback((fieldId: string, updates: Partial<LabelField>) => {
    setTemplate(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, ...updates } : f),
      updated_at: new Date().toISOString(),
    }));
  }, []);

  const updateFieldPosition = useCallback((fieldId: string, posUpdates: Partial<LabelField['position']>) => {
    setTemplate(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, position: { ...f.position, ...posUpdates } } : f),
    }));
  }, []);

  const updateFieldStyling = useCallback((fieldId: string, styleUpdates: Partial<LabelField['styling']>) => {
    setTemplate(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, styling: { ...f.styling, ...styleUpdates } } : f),
    }));
  }, []);

  const removeField = (fieldId: string) => {
    setTemplate(prev => ({ ...prev, fields: prev.fields.filter(f => f.id !== fieldId) }));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  };

  const duplicateField = (fieldId: string) => {
    const src = template.fields.find(f => f.id === fieldId);
    if (!src) return;
    const dup: LabelField = { ...src, id: crypto.randomUUID(), name: `${src.name} (cópia)`, position: { ...src.position, x: src.position.x + 3, y: src.position.y + 3 } };
    setTemplate(prev => ({ ...prev, fields: [...prev.fields, dup] }));
    setSelectedFieldId(dup.id);
  };

  // Mouse drag on canvas
  const handleMouseDown = (e: React.MouseEvent, fieldId: string) => {
    e.stopPropagation();
    setSelectedFieldId(fieldId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const field = template.fields.find(f => f.id === fieldId);
    if (!field) return;
    setDragInfo({ fieldId, startX: e.clientX, startY: e.clientY, origX: field.position.x, origY: field.position.y });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragInfo) return;
    const scale = MM_TO_PX * (zoom / 100);
    const dx = (e.clientX - dragInfo.startX) / scale;
    const dy = (e.clientY - dragInfo.startY) / scale;
    const newX = Math.max(0, Math.round(dragInfo.origX + dx));
    const newY = Math.max(0, Math.round(dragInfo.origY + dy));
    updateFieldPosition(dragInfo.fieldId, { x: newX, y: newY });
  }, [dragInfo, zoom, updateFieldPosition]);

  const handleMouseUp = () => setDragInfo(null);

  const handleSave = () => {
    onSave(template);
    toast.success('Template salvo');
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <h2 className="font-semibold text-foreground">{template.name}</h2>
          <Badge variant="outline">{template.dimensions.width}×{template.dimensions.height}mm</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border rounded-md px-2 py-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom(z => Math.max(50, z - 25))}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs w-10 text-center">{zoom}%</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom(z => Math.min(300, z + 25))}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch checked={showGrid} onCheckedChange={setShowGrid} id="grid-toggle" />
            <Label htmlFor="grid-toggle" className="text-xs"><Grid3X3 className="h-3.5 w-3.5" /></Label>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Eye className="h-3.5 w-3.5" /> Preview
          </Button>
          <Button size="sm" className="gap-1.5" onClick={handleSave}>
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[200px_1fr_260px] gap-4 min-h-[500px]">
        {/* Left: Elements palette */}
        <Card className="overflow-hidden">
          <CardHeader className="py-3 px-3">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Elementos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="space-y-0.5">
              {PALETTE_ITEMS.map(item => (
                <button
                  key={item.type}
                  onClick={() => addField(item.type)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
            <Separator className="my-2" />
            <div className="px-3 pb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Dados disponíveis</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(DATA_SOURCE_LABELS).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[10px] cursor-default">{v}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Center: Canvas */}
        <Card className="overflow-auto flex items-center justify-center bg-muted/20">
          <div
            ref={canvasRef}
            className="relative bg-background border border-border shadow-sm select-none"
            style={{ width: canvasW, height: canvasH }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={() => { if (!dragInfo) setSelectedFieldId(null); }}
          >
            {/* Grid */}
            {showGrid && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.15 }}>
                <defs>
                  <pattern id="grid" width={5 * MM_TO_PX * (zoom / 100)} height={5 * MM_TO_PX * (zoom / 100)} patternUnits="userSpaceOnUse">
                    <path d={`M ${5 * MM_TO_PX * (zoom / 100)} 0 L 0 0 0 ${5 * MM_TO_PX * (zoom / 100)}`} fill="none" stroke="currentColor" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            )}

            {/* Fields */}
            {template.fields.map(f => {
              const scale = MM_TO_PX * (zoom / 100);
              const isSelected = f.id === selectedFieldId;
              return (
                <div
                  key={f.id}
                  className={`absolute flex items-center justify-center cursor-move transition-shadow ${isSelected ? 'ring-2 ring-primary shadow-md' : 'border border-dashed border-muted-foreground/40 hover:border-primary/60'}`}
                  style={{
                    left: f.position.x * scale,
                    top: f.position.y * scale,
                    width: f.position.width * scale,
                    height: f.position.height * scale,
                  }}
                  onMouseDown={(e) => handleMouseDown(e, f.id)}
                >
                  {/* Field content preview */}
                  <div className="text-center overflow-hidden px-0.5 w-full" style={{
                    fontSize: `${Math.max(8, f.styling.font_size * (zoom / 100) * 0.7)}px`,
                    fontWeight: f.styling.font_weight,
                    textAlign: f.styling.text_align,
                    textTransform: f.styling.text_transform,
                  }}>
                    {f.type === 'barcode' ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <Barcode className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[7px] text-muted-foreground">{f.barcode_format}</span>
                      </div>
                    ) : f.type === 'qr_code' ? (
                      <QrCode className="h-5 w-5 text-muted-foreground mx-auto" />
                    ) : f.type === 'image' ? (
                      <Image className="h-5 w-5 text-muted-foreground mx-auto" />
                    ) : (
                      <span className="truncate block text-foreground/70">
                        {f.default_value || DATA_SOURCE_LABELS[f.data_source] || f.name}
                      </span>
                    )}
                  </div>

                  {/* Resize handle */}
                  {isSelected && (
                    <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-primary rounded-sm cursor-se-resize" />
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Right: Properties panel */}
        <Card className="overflow-auto">
          <CardHeader className="py-3 px-3">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              {selectedField ? 'Propriedades' : 'Camadas'}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-4">
            {selectedField ? (
              <FieldProperties
                field={selectedField}
                onUpdate={(updates) => updateField(selectedField.id, updates)}
                onUpdatePosition={(pos) => updateFieldPosition(selectedField.id, pos)}
                onUpdateStyling={(style) => updateFieldStyling(selectedField.id, style)}
                onRemove={() => removeField(selectedField.id)}
                onDuplicate={() => duplicateField(selectedField.id)}
              />
            ) : (
              <LayersList
                fields={template.fields}
                selectedId={selectedFieldId}
                onSelect={setSelectedFieldId}
                onRemove={removeField}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* Properties panel for selected field */
function FieldProperties({
  field, onUpdate, onUpdatePosition, onUpdateStyling, onRemove, onDuplicate,
}: {
  field: LabelField;
  onUpdate: (u: Partial<LabelField>) => void;
  onUpdatePosition: (u: Partial<LabelField['position']>) => void;
  onUpdateStyling: (u: Partial<LabelField['styling']>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-1">
        {FIELD_TYPE_ICON[field.type]}
        <Badge variant="outline" className="text-[10px]">{field.type}</Badge>
        <div className="flex-1" />
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onDuplicate} title="Duplicar">
          <Copy className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={onRemove} title="Remover">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div>
        <Label className="text-xs">Nome</Label>
        <Input value={field.name} onChange={e => onUpdate({ name: e.target.value })} className="h-8 text-xs" />
      </div>

      {(field.type === 'text' || field.type === 'dynamic_text') && (
        <div>
          <Label className="text-xs">Fonte de Dados</Label>
          <Select value={field.data_source} onValueChange={v => onUpdate({ data_source: v as LabelField['data_source'] })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(DATA_SOURCE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {field.data_source === 'custom' && (
        <div>
          <Label className="text-xs">Valor</Label>
          <Input value={field.default_value || ''} onChange={e => onUpdate({ default_value: e.target.value })} className="h-8 text-xs" />
        </div>
      )}

      <Separator />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Posição (mm)</p>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-[10px]">X</Label><Input type="number" value={field.position.x} onChange={e => onUpdatePosition({ x: Number(e.target.value) })} className="h-7 text-xs" /></div>
        <div><Label className="text-[10px]">Y</Label><Input type="number" value={field.position.y} onChange={e => onUpdatePosition({ y: Number(e.target.value) })} className="h-7 text-xs" /></div>
        <div><Label className="text-[10px]">Largura</Label><Input type="number" value={field.position.width} onChange={e => onUpdatePosition({ width: Number(e.target.value) })} className="h-7 text-xs" /></div>
        <div><Label className="text-[10px]">Altura</Label><Input type="number" value={field.position.height} onChange={e => onUpdatePosition({ height: Number(e.target.value) })} className="h-7 text-xs" /></div>
      </div>

      <Separator />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Estilo</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">Tamanho</Label>
          <Input type="number" value={field.styling.font_size} onChange={e => onUpdateStyling({ font_size: Number(e.target.value) })} className="h-7 text-xs" />
        </div>
        <div>
          <Label className="text-[10px]">Peso</Label>
          <Select value={field.styling.font_weight} onValueChange={v => onUpdateStyling({ font_weight: v as 'normal' | 'bold' })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="normal" className="text-xs">Normal</SelectItem>
              <SelectItem value="bold" className="text-xs">Bold</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px]">Alinhamento</Label>
          <Select value={field.styling.text_align} onValueChange={v => onUpdateStyling({ text_align: v as 'left' | 'center' | 'right' })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left" className="text-xs">Esquerda</SelectItem>
              <SelectItem value="center" className="text-xs">Centro</SelectItem>
              <SelectItem value="right" className="text-xs">Direita</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px]">Transform</Label>
          <Select value={field.styling.text_transform} onValueChange={v => onUpdateStyling({ text_transform: v as 'none' | 'uppercase' | 'lowercase' })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">Normal</SelectItem>
              <SelectItem value="uppercase" className="text-xs">MAIÚSCULAS</SelectItem>
              <SelectItem value="lowercase" className="text-xs">minúsculas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {(field.type === 'barcode' || field.type === 'qr_code') && (
        <>
          <Separator />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Código</p>
          <div>
            <Label className="text-[10px]">Formato</Label>
            <Select value={field.barcode_format || 'CODE128'} onValueChange={v => onUpdate({ barcode_format: v as LabelField['barcode_format'] })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CODE128" className="text-xs">CODE128</SelectItem>
                <SelectItem value="EAN13" className="text-xs">EAN-13</SelectItem>
                <SelectItem value="QR" className="text-xs">QR Code</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}

/* Layers list */
function LayersList({
  fields, selectedId, onSelect, onRemove,
}: {
  fields: LabelField[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (fields.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-xs">
        <MousePointer className="h-6 w-6 mx-auto mb-2 opacity-40" />
        Adicione elementos da paleta à esquerda
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {fields.map((f, i) => (
        <div
          key={f.id}
          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${f.id === selectedId ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`}
          onClick={() => onSelect(f.id)}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground/40" />
          {FIELD_TYPE_ICON[f.type]}
          <span className="flex-1 truncate">{f.name}</span>
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); onRemove(f.id); }}>
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
