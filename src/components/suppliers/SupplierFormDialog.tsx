import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Info, Plus, Star, Trash } from '@phosphor-icons/react';
import type { Supplier } from '@/hooks/useSuppliers';

const STATES = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const CATEGORIES: { value: NonNullable<Supplier['supplier_category']>; label: string }[] = [
  { value: 'materia_prima', label: 'Matéria-prima' },
  { value: 'servico',       label: 'Serviço (terceirização)' },
  { value: 'embalagem',     label: 'Embalagem' },
  { value: 'outro',         label: 'Outro' },
];

const HOMOLOGATION_STATUS: { value: NonNullable<Supplier['homologation_status']>; label: string; tone: 'success' | 'warning' | 'destructive' }[] = [
  { value: 'ativo',           label: 'Ativo / Homologado',  tone: 'success' },
  { value: 'em_homologacao',  label: 'Em homologação',      tone: 'warning' },
  { value: 'bloqueado',       label: 'Bloqueado',           tone: 'destructive' },
];

const DEFAULT_PAYMENT_TERMS = [{ days: 30, percentage: 100 }];

function normalizedPaymentTerms(value: Supplier['payment_terms_structured']) {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_PAYMENT_TERMS.map((entry) => ({ ...entry }));
  return value.map((entry) => ({ days: Number(entry.days) || 0, percentage: Number(entry.percentage) || 0 }));
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Supplier | null;
  onSubmit: (data: Partial<Supplier>) => void;
};

const empty: Partial<Supplier> = {
  name: '', trade_name: '', cnpj: '', ie: '', contact_name: '', phone: '', email: '',
  address: '', city: '', state: '', zip_code: '', payment_terms: '', lead_time_days: 15,
  notes: '', active: true, is_own_manufacturing: false,
  min_order_quantity: 0,
  supplier_category: 'materia_prima',
  homologation_status: 'ativo',
  certifications: '',
  quality_rating: null,
  delivery_rating: null,
  price_rating: null,
  service_rating: null,
  payment_terms_structured: DEFAULT_PAYMENT_TERMS,
};

// ── Mini-componente: rating de 0-5 estrelas (clicável) ────────────────────
function StarRating({ value, onChange }: { value: number | null | undefined; onChange: (n: number | null) => void }) {
  const current = Number(value || 0);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(current === n ? null : n)}
          className="p-0.5 transition-colors"
          aria-label={`${n} estrelas`}
        >
          <Star
            weight={n <= current ? 'fill' : 'regular'}
            className={n <= current ? 'h-4 w-4 text-amber-500' : 'h-4 w-4 text-muted-foreground/40 hover:text-amber-500/60'}
          />
        </button>
      ))}
      {current > 0 && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-1 text-xs text-muted-foreground hover:text-destructive"
          aria-label="Limpar rating"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function SupplierFormDialog({ open, onOpenChange, editing, onSubmit }: Props) {
  const [form, setForm] = useState<Partial<Supplier>>(empty);

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name || '', trade_name: editing.trade_name || '', cnpj: editing.cnpj || '',
        ie: editing.ie || '', contact_name: editing.contact_name || '', phone: editing.phone || '',
        email: editing.email || '', address: editing.address || '', city: editing.city || '',
        state: editing.state || '', zip_code: editing.zip_code || '', payment_terms: editing.payment_terms || '',
        payment_terms_structured: normalizedPaymentTerms(editing.payment_terms_structured),
        lead_time_days: Number(editing.lead_time_days) > 0 ? editing.lead_time_days : 15, notes: editing.notes || '', active: editing.active ?? true,
        is_own_manufacturing: editing.is_own_manufacturing ?? false,
        min_order_quantity: editing.min_order_quantity ?? 0,
        supplier_category: editing.supplier_category || 'materia_prima',
        homologation_status: editing.homologation_status || 'ativo',
        certifications: editing.certifications || '',
        quality_rating: editing.quality_rating ?? null,
        delivery_rating: editing.delivery_rating ?? null,
        price_rating: editing.price_rating ?? null,
        service_rating: editing.service_rating ?? null,
      });
    } else setForm({ ...empty, payment_terms_structured: DEFAULT_PAYMENT_TERMS.map((entry) => ({ ...entry })) });
  }, [editing, open]);

  const terms = normalizedPaymentTerms(form.payment_terms_structured);
  const termsTotal = terms.reduce((sum, entry) => sum + Number(entry.percentage || 0), 0);
  const termsValid = Boolean(form.is_own_manufacturing) || (
    Boolean(String(form.payment_terms || '').trim())
    &&
    terms.length > 0
    && terms.every((entry) => Number.isInteger(entry.days) && entry.days >= 0 && entry.percentage > 0)
    && Math.abs(termsTotal - 100) < 0.01
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!termsValid) return;
    onSubmit({
      ...form,
      payment_terms_structured: form.is_own_manufacturing ? null : terms,
    });
    onOpenChange(false);
  };
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setForm(f => ({ ...f, [k]: v }));

  const setPaymentTerm = (index: number, field: 'days' | 'percentage', value: number) => {
    const next = terms.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry);
    set('payment_terms_structured', next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar Fornecedor' : 'Novo Fornecedor'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 mt-2">

          {/* ── 1. Identificação ── */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">1 · Identificação</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Label>Razão Social *</Label>
                <Input value={form.name || ''} onChange={e => set('name', e.target.value)} required className="mt-1" />
              </div>
              <div>
                <Label>Nome Fantasia</Label>
                <Input value={form.trade_name || ''} onChange={e => set('trade_name', e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>CNPJ</Label>
                <Input value={form.cnpj || ''} onChange={e => set('cnpj', e.target.value)} className="mt-1" placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <Label>Inscrição Estadual</Label>
                <Input value={form.ie || ''} onChange={e => set('ie', e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.supplier_category || 'materia_prima'} onValueChange={v => set('supplier_category', v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <Switch checked={form.active ?? true} onCheckedChange={v => set('active', v)} />
                <Label>Fornecedor Ativo</Label>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <Switch checked={form.is_own_manufacturing ?? false} onCheckedChange={v => {
                  set('is_own_manufacturing', v);
                  if (v) set('payment_terms', '');
                }} />
                <Label>Fabricação Própria</Label>
              </div>
            </div>
          </div>

          {/* ── 2. Contato ── */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">2 · Contato</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><Label>Nome do contato</Label><Input value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} className="mt-1" /></div>
              <div><Label>Telefone</Label><Input value={form.phone || ''} onChange={e => set('phone', e.target.value)} className="mt-1" placeholder="(00) 00000-0000" /></div>
              <div><Label>E-mail</Label><Input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} className="mt-1" /></div>
            </div>
          </div>

          {/* ── 3. Endereço ── */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">3 · Endereço</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2"><Label>Endereço</Label><Input value={form.address || ''} onChange={e => set('address', e.target.value)} className="mt-1" /></div>
              <div><Label>Cidade</Label><Input value={form.city || ''} onChange={e => set('city', e.target.value)} className="mt-1" /></div>
              <div>
                <Label>UF</Label>
                <Select value={form.state || ''} onValueChange={v => set('state', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="UF" /></SelectTrigger>
                  <SelectContent>{STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>CEP</Label><Input value={form.zip_code || ''} onChange={e => set('zip_code', e.target.value)} className="mt-1" placeholder="00000-000" /></div>
            </div>
          </div>

          {/* ── 4. Condições Comerciais ── */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">4 · Condições Comerciais</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {!form.is_own_manufacturing && (
                <div className="sm:col-span-2">
                  <Label>Rótulo da condição de pagamento *</Label>
                  <Input value={form.payment_terms || ''} onChange={e => set('payment_terms', e.target.value)} className="mt-1" placeholder="Ex: 30/60/90 DDL" />
                  <p className="mt-0.5 text-xs text-muted-foreground">Este texto é apenas a identificação visível; os vencimentos usam as parcelas estruturadas abaixo.</p>
                </div>
              )}
              <div>
                <Label>Prazo de Entrega (dias)</Label>
                <Input type="number" min={0} value={form.lead_time_days ?? 15} onChange={e => set('lead_time_days', Number(e.target.value))} className="mt-1" placeholder="15" />
                <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  Lead time em dias corridos. Sem valor válido, o planejamento usa <strong>15 dias</strong>.
                </p>
              </div>
              <div>
                <Label>Pedido Mínimo (MOQ)</Label>
                <Input type="number" min={0} step="0.01" value={form.min_order_quantity ?? 0} onChange={e => set('min_order_quantity', Number(e.target.value))} className="mt-1" placeholder="0" />
                <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  Quantidade mínima exigida pelo fornecedor por OC.
                </p>
              </div>
            </div>

            {!form.is_own_manufacturing && (
              <div className="mt-4 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label>Parcelas estruturadas *</Label>
                    <p className="text-xs text-muted-foreground">Dias corridos após a emissão da NF. A soma deve ser exatamente 100%.</p>
                  </div>
                  <Badge variant={termsValid ? 'outline' : 'destructive'}>
                    Total {termsTotal.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%
                  </Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {terms.map((entry, index) => (
                    <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] items-end gap-2">
                      <div>
                        <Label htmlFor={`supplier-term-days-${index}`} className="text-xs">Dias</Label>
                        <Input
                          id={`supplier-term-days-${index}`}
                          type="number"
                          min={0}
                          step={1}
                          value={entry.days}
                          onChange={(event) => setPaymentTerm(index, 'days', Number(event.target.value))}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`supplier-term-percent-${index}`} className="text-xs">Percentual</Label>
                        <Input
                          id={`supplier-term-percent-${index}`}
                          type="number"
                          min={0.0001}
                          max={100}
                          step="0.0001"
                          value={entry.percentage}
                          onChange={(event) => setPaymentTerm(index, 'percentage', Number(event.target.value))}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover parcela ${index + 1}`}
                        disabled={terms.length === 1}
                        onClick={() => set('payment_terms_structured', terms.filter((_, entryIndex) => entryIndex !== index))}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => set('payment_terms_structured', [...terms, { days: 0, percentage: 0 }])}
                >
                  <Plus className="mr-1 h-4 w-4" /> Adicionar parcela
                </Button>
                {!termsValid && (
                  <p className="mt-2 text-xs font-medium text-destructive">Informe dias inteiros não negativos, percentuais positivos e total de 100% para salvar.</p>
                )}
              </div>
            )}

            {/* Lead time real (só quando há dado calculado) */}
            {editing?.avg_lead_time_days != null && (
              <div className="mt-3 p-2.5 rounded-md border border-blue-500/20 bg-blue-500/5 text-xs flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-blue-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-bold text-blue-700 dark:text-blue-300">Lead time real (calculado das últimas 20 OCs recebidas)</p>
                  <p className="text-muted-foreground mt-0.5">
                    Média: <strong>{editing.avg_lead_time_days} dias</strong>
                    {editing.on_time_rate != null && (
                      <> · Pontualidade: <strong>{editing.on_time_rate}%</strong></>
                    )}
                    {editing.last_purchase_date && (
                      <> · Última compra: <strong>{new Date(editing.last_purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}</strong></>
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── 5. Homologação & Performance ── */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">5 · Homologação & Performance</p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Status de Homologação</Label>
                  <Select value={form.homologation_status || 'ativo'} onValueChange={v => set('homologation_status', v as any)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOMOLOGATION_STATUS.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Certificações</Label>
                  <Input
                    value={form.certifications || ''}
                    onChange={e => set('certifications', e.target.value)}
                    className="mt-1"
                    placeholder="ISO 9001, ABNT NBR..., laudo SGS"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Qualidade</Label>
                  <StarRating value={form.quality_rating} onChange={v => set('quality_rating', v as any)} />
                </div>
                <div>
                  <Label className="text-xs">Entrega</Label>
                  <StarRating value={form.delivery_rating} onChange={v => set('delivery_rating', v as any)} />
                </div>
                <div>
                  <Label className="text-xs">Preço</Label>
                  <StarRating value={form.price_rating} onChange={v => set('price_rating', v as any)} />
                </div>
                <div>
                  <Label className="text-xs">Atendimento</Label>
                  <StarRating value={form.service_rating} onChange={v => set('service_rating', v as any)} />
                </div>
              </div>
            </div>
          </div>

          {/* ── 6. Observações ── */}
          <div>
            <Label>Observações</Label>
            <Textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} className="mt-1" rows={2} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!termsValid}>{editing ? 'Salvar' : 'Cadastrar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
