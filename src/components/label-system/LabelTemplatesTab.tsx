import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LabelDesigner } from './LabelDesigner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Copy, Eye, PaintBucket, Star } from 'lucide-react';
import { toast } from 'sonner';
import type { LabelTemplate } from '@/types/label-system';
import { useLabelTemplates } from '@/hooks/useLabelTemplates';

const CATEGORY_LABELS: Record<string, string> = {
  individual_box: 'Caixa Individual',
  master_box: 'Caixa Master',
  hangtag: 'Hangtag',
  thermal: 'Térmica',
  shipping: 'Expedição',
  product: 'Produto',
};

export function LabelTemplatesTab() {
  const { templates, addTemplate, updateTemplate, deleteTemplate, duplicateTemplate, isBuiltinDefault } = useLabelTemplates();
  const [filter, setFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplate | null>(null);
  const [designerTemplate, setDesignerTemplate] = useState<LabelTemplate | null>(null);

  if (designerTemplate) {
    return (
      <LabelDesigner
        template={designerTemplate}
        onSave={(updated) => {
          updateTemplate(updated);
          setDesignerTemplate(null);
        }}
        onBack={() => setDesignerTemplate(null)}
      />
    );
  }

  const filtered = filter === 'all' ? templates : templates.filter(t => t.category === filter);

  const handleToggleActive = (id: string) => {
    const t = templates.find(x => x.id === id);
    if (t) updateTemplate({ ...t, is_active: !t.is_active, updated_at: new Date().toISOString() });
  };

  const handleDelete = (id: string) => {
    if (isBuiltinDefault(id)) {
      toast.error('Templates padrão não podem ser removidos.');
      return;
    }
    deleteTemplate(id);
    toast.success('Template removido');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => { setEditingTemplate(null); setDialogOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> Novo Template
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map(t => {
          const isDefault = isBuiltinDefault(t.id);
          return (
            <Card key={t.id} className={`${!t.is_active ? 'opacity-60' : ''} ${isDefault ? 'ring-1 ring-primary/30' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm">{t.name}</CardTitle>
                      {isDefault && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline">{CATEGORY_LABELS[t.category] || t.category}</Badge>
                      <Badge variant={t.is_active ? 'default' : 'secondary'}>{t.is_active ? 'Ativo' : 'Inativo'}</Badge>
                      {isDefault && <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-600">Padrão</Badge>}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="border rounded-md bg-muted/30 p-3 flex items-center justify-center" style={{ minHeight: 80 }}>
                  <div
                    className="bg-background border border-border relative"
                    style={{
                      width: `${Math.min(t.dimensions.width * 1.8, 180)}px`,
                      height: `${Math.min(t.dimensions.height * 1.8, 100)}px`,
                    }}
                  >
                    {t.fields.map(f => (
                      <div
                        key={f.id}
                        className="absolute border border-dashed border-primary/30 text-[7px] leading-tight text-muted-foreground flex items-center justify-center overflow-hidden"
                        style={{
                          left: `${(f.position.x / t.dimensions.width) * 100}%`,
                          top: `${(f.position.y / t.dimensions.height) * 100}%`,
                          width: `${(f.position.width / t.dimensions.width) * 100}%`,
                          height: `${(f.position.height / t.dimensions.height) * 100}%`,
                        }}
                      >
                        {f.name}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  {t.dimensions.width}×{t.dimensions.height}{t.dimensions.unit} · {t.fields.length} campos · {t.print_settings.dpi} DPI
                </div>

                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setDesignerTemplate(t)} title="Abrir Designer">
                    <PaintBucket className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleToggleActive(t.id)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingTemplate(t); setDialogOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { duplicateTemplate(t); toast.success('Template duplicado'); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  {!isDefault && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Editar Template' : 'Novo Template'}</DialogTitle>
          </DialogHeader>
          <TemplateForm
            initial={editingTemplate}
            onSave={(t) => {
              if (editingTemplate) {
                updateTemplate(t);
              } else {
                addTemplate(t);
              }
              setDialogOpen(false);
              toast.success(editingTemplate ? 'Template atualizado' : 'Template criado');
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateForm({ initial, onSave }: { initial: LabelTemplate | null; onSave: (t: LabelTemplate) => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [category, setCategory] = useState<string>(initial?.category || 'thermal');
  const [width, setWidth] = useState(initial?.dimensions.width || 100);
  const [height, setHeight] = useState(initial?.dimensions.height || 30);
  const [dpi, setDpi] = useState(initial?.print_settings.dpi || 203);

  const CATEGORY_LABELS: Record<string, string> = {
    individual_box: 'Caixa Individual',
    master_box: 'Caixa Master',
    hangtag: 'Hangtag',
    thermal: 'Térmica',
    shipping: 'Expedição',
  };

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('Nome é obrigatório'); return; }
    const now = new Date().toISOString();
    const template: LabelTemplate = {
      id: initial?.id || crypto.randomUUID(),
      name: name.trim(),
      category: category as LabelTemplate['category'],
      type: 'thermal',
      dimensions: { width, height, unit: 'mm' },
      fields: initial?.fields || [],
      print_settings: { dpi, color_mode: 'monochrome', copies_default: 1 },
      is_active: initial?.is_active ?? true,
      created_at: initial?.created_at || now,
      updated_at: now,
    };
    onSave(template);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Nome</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Etiqueta Térmica 100x30" />
      </div>
      <div>
        <Label>Categoria</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Largura (mm)</Label>
          <Input type="number" value={width} onChange={e => setWidth(Number(e.target.value))} />
        </div>
        <div>
          <Label>Altura (mm)</Label>
          <Input type="number" value={height} onChange={e => setHeight(Number(e.target.value))} />
        </div>
        <div>
          <Label>DPI</Label>
          <Select value={String(dpi)} onValueChange={v => setDpi(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="203">203</SelectItem>
              <SelectItem value="300">300</SelectItem>
              <SelectItem value="600">600</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={handleSubmit} className="w-full">Salvar Template</Button>
    </div>
  );
}
