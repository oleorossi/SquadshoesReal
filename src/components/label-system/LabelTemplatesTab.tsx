import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LabelDesigner } from './LabelDesigner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, PencilSimple as Pencil, Trash as Trash2, Copy, Eye, PaintBucket, Star, Checks, Warning, Stack } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { LabelTemplate } from '@/types/label-system';
import { useLabelTemplates } from '@/hooks/useLabelTemplates';
import { validateLabelTemplate } from '@/lib/templateLabels';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

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
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplate | null>(null);
  const [designerTemplate, setDesignerTemplate] = useState<LabelTemplate | null>(null);

  if (designerTemplate) {
    return (
      <LabelDesigner
        template={designerTemplate}
        onSave={async (updated) => {
          await updateTemplate(updated);
          setDesignerTemplate(null);
        }}
        onBack={() => setDesignerTemplate(null)}
      />
    );
  }

  const filtered = templates.filter(template => {
    const matchesCategory = filter === 'all' || template.category === filter;
    return matchesCategory && searchMatchesAllTerms(
      search,
      template.name,
      CATEGORY_LABELS[template.category] || template.category,
      `${template.dimensions.width}x${template.dimensions.height}`,
      template.is_active ? 'ativo' : 'inativo',
    );
  });
  const activeCount = templates.filter(template => template.is_active).length;
  const builtinCount = templates.filter(template => isBuiltinDefault(template.id)).length;
  const reviewCount = templates.filter(template => !isBuiltinDefault(template.id) && validateLabelTemplate(template).length > 0).length;

  const handleToggleActive = async (id: string) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    if (!t.is_active) {
      const errors = validateLabelTemplate(t);
      if (errors.length > 0) { toast.error(errors[0]); return; }
    }
    try {
      await updateTemplate({ ...t, is_active: !t.is_active, updated_at: new Date().toISOString() });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar o template.');
    }
  };

  const handleDelete = async (id: string) => {
    if (isBuiltinDefault(id)) {
      toast.error('Templates padrão não podem ser removidos.');
      return;
    }
    try {
      await deleteTemplate(id);
      toast.success('Template removido');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível remover o template.');
    }
  };

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Modelos cadastrados" value={templates.length} icon={Stack} />
        <StatCard label="Ativos para geração" value={activeCount} icon={Checks} tone="success" />
        <StatCard label="Oficiais protegidos" value={builtinCount} hint="não editáveis" icon={Star} tone="primary" />
        <StatCard label="Exigem revisão" value={reviewCount} icon={Warning} tone={reviewCount > 0 ? 'warning' : 'default'} />
      </StatGrid>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, categoria, dimensão ou status…"
            resultCount={filtered.length}
            totalCount={templates.length}
            className="w-full lg:max-w-md"
          />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-full lg:w-52">
              <SelectValue placeholder="Filtrar categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => { setEditingTemplate(null); setDialogOpen(true); }} className="gap-2 lg:ml-auto">
            <Plus className="h-4 w-4" /> Novo modelo
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Os modelos oficiais preservam o padrão de impressão. Cópias personalizadas só entram na operação depois de validadas e ativadas.
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={Stack} title="Nenhum modelo encontrado" description="Ajuste a busca ou a categoria selecionada." />
        </div>
      ) : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map(t => {
          const isDefault = isBuiltinDefault(t.id);
          const validationErrors = validateLabelTemplate(t);
          return (
            <Card key={t.id} className={`${!t.is_active ? 'opacity-60' : ''} ${isDefault ? 'ring-1 ring-primary/30' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm">{t.name}</CardTitle>
                      {isDefault && <Star className="h-3.5 w-3.5 text-primary" weight="fill" />}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline">{CATEGORY_LABELS[t.category] || t.category}</Badge>
                      <Badge variant={t.is_active ? 'default' : 'secondary'}>{t.is_active ? 'Ativo' : 'Inativo'}</Badge>
                      {isDefault && <Badge variant="outline" className="text-xs border-primary/40 text-primary">Oficial</Badge>}
                      {!isDefault && validationErrors.length > 0 && <Badge variant="destructive" className="text-xs">Revisar</Badge>}
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
                  {!isDefault && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setDesignerTemplate(t)} title="Abrir editor" aria-label={`Abrir editor do modelo ${t.name}`}>
                        <PaintBucket className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleToggleActive(t.id)} title={t.is_active ? 'Desativar' : 'Ativar'} aria-label={`${t.is_active ? 'Desativar' : 'Ativar'} modelo ${t.name}`}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditingTemplate(t); setDialogOpen(true); }} title="Editar propriedades" aria-label={`Editar propriedades do modelo ${t.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" aria-label={`Duplicar modelo ${t.name}`} onClick={() => void duplicateTemplate(t)
                    .then(() => toast.success('Template duplicado'))
                    .catch(error => toast.error(error instanceof Error ? error.message : 'Não foi possível duplicar.'))}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  {!isDefault && (
                    <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Excluir modelo ${t.name}`} onClick={() => void handleDelete(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Editar modelo' : 'Novo modelo'}</DialogTitle>
          </DialogHeader>
          <TemplateForm
            initial={editingTemplate}
            onSave={async (t) => {
              if (editingTemplate) {
                await updateTemplate(t);
              } else {
                await addTemplate(t);
              }
              setDialogOpen(false);
              toast.success(editingTemplate ? 'Modelo atualizado' : 'Modelo criado');
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateForm({ initial, onSave }: { initial: LabelTemplate | null; onSave: (t: LabelTemplate) => void | Promise<void> }) {
  const [name, setName] = useState(initial?.name || '');
  const [category, setCategory] = useState<string>(initial?.category || 'thermal');
  const [width, setWidth] = useState(initial?.dimensions.width || 100);
  const [height, setHeight] = useState(initial?.dimensions.height || 30);
  const [dpi, setDpi] = useState(initial?.print_settings.dpi || 203);

  const CATEGORY_LABELS: Record<string, string> = {
    thermal: 'Térmica customizada',
    individual_box: 'Caixa individual customizada',
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Nome é obrigatório'); return; }
    if (!(width > 0) || !(height > 0)) { toast.error('Largura e altura precisam ser maiores que zero.'); return; }
    const now = new Date().toISOString();
    const template: LabelTemplate = {
      id: initial?.id || crypto.randomUUID(),
      name: name.trim(),
      category: category as LabelTemplate['category'],
      type: 'thermal',
      dimensions: { width, height, unit: 'mm' },
      fields: initial?.fields || [],
      print_settings: { dpi, color_mode: 'monochrome', copies_default: 1 },
      is_active: initial?.is_active ?? false,
      created_at: initial?.created_at || now,
      updated_at: now,
    };
    try {
      await onSave(template);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o template.');
    }
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
      <Button onClick={handleSubmit} className="w-full">Salvar modelo</Button>
    </div>
  );
}
