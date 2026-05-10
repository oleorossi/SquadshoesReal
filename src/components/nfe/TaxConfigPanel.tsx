import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Calculator, FileText, MapPin, Truck, AlertTriangle, CheckCircle2,
} from 'lucide-react';

interface CompanyTax {
  id: string;
  cnpj: string;
  razao_social: string;
  regime_tributario: string;
  pis_cofins_regime: string | null;
  natureza_operacao: string | null;
  cfop: string | null;
  cfop_industrial_interno: string | null;
  cfop_industrial_externo: string | null;
  cfop_revenda_interno: string | null;
  cfop_revenda_externo: string | null;
  ambiente: string;
  serie_nfe: number;
  uf: string;
}

const REGIME_LABEL: Record<string, string> = {
  '1': 'Simples Nacional',
  '2': 'Simples Nacional — excesso sublimite',
  '3': 'Regime Normal (Lucro Real/Presumido)',
};

const PIS_COFINS_LABEL: Record<string, string> = {
  simples_nacional: 'Simples Nacional (PIS/COFINS no DAS)',
  cumulativo:       'Cumulativo (Lucro Presumido)',
  nao_cumulativo:   'Não-cumulativo (Lucro Real)',
};

export default function TaxConfigPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies-tax'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select(`id, cnpj, razao_social, regime_tributario, pis_cofins_regime,
                 natureza_operacao, cfop, cfop_industrial_interno, cfop_industrial_externo,
                 cfop_revenda_interno, cfop_revenda_externo, ambiente, serie_nfe, uf,
                 is_primary, active`)
        .eq('active', true)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as (CompanyTax & { is_primary: boolean; active: boolean })[];
    },
  });

  const primary = companies.find((c) => c.is_primary) ?? companies[0];
  const [form, setForm] = useState<Partial<CompanyTax>>({});

  useEffect(() => {
    if (primary && Object.keys(form).length === 0) {
      setForm({
        regime_tributario: primary.regime_tributario,
        pis_cofins_regime: primary.pis_cofins_regime ?? 'simples_nacional',
        natureza_operacao: primary.natureza_operacao ?? 'Venda de Mercadoria',
        cfop_industrial_interno: primary.cfop_industrial_interno ?? '5101',
        cfop_industrial_externo: primary.cfop_industrial_externo ?? '6101',
        cfop_revenda_interno:    primary.cfop_revenda_interno ?? '5102',
        cfop_revenda_externo:    primary.cfop_revenda_externo ?? '6102',
        serie_nfe: primary.serie_nfe ?? 1,
      });
    }
  }, [primary, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!primary) throw new Error('Nenhuma empresa ativa');
      const { error } = await supabase
        .from('companies')
        .update({
          regime_tributario: form.regime_tributario,
          pis_cofins_regime: form.pis_cofins_regime,
          natureza_operacao: form.natureza_operacao,
          cfop_industrial_interno: form.cfop_industrial_interno,
          cfop_industrial_externo: form.cfop_industrial_externo,
          cfop_revenda_interno:    form.cfop_revenda_interno,
          cfop_revenda_externo:    form.cfop_revenda_externo,
          serie_nfe: form.serie_nfe,
          updated_at: new Date().toISOString(),
        })
        .eq('id', primary.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Tributação atualizada');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['companies-tax'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });

  const set = <K extends keyof CompanyTax>(key: K, value: CompanyTax[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (isLoading) {
    return <Card><CardContent className="p-6">Carregando…</CardContent></Card>;
  }

  if (!primary) {
    return (
      <Card className="border-amber-500/30">
        <CardContent className="p-6 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Nenhuma empresa cadastrada</p>
            <p className="text-xs text-muted-foreground mt-1">
              Cadastre uma empresa em <strong>Empresas / CNPJs</strong> antes de configurar tributação.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Tributação
          </h3>
          <p className="text-xs text-muted-foreground">
            Regime tributário, CFOPs por operação e parâmetros fiscais aplicados na emissão da NF-e.
          </p>
        </div>
        {!editing && (
          <Button onClick={() => setEditing(true)} variant="outline" size="sm">Editar</Button>
        )}
      </div>

      {/* Regime + Natureza */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" /> Regime tributário
          </CardTitle>
          <CardDescription className="text-xs">
            Define como impostos são calculados na NF-e. Squad Shoes opera no <strong>Simples Nacional</strong> (CRT=1).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Regime tributário (CRT)</Label>
              <Select
                value={form.regime_tributario}
                onValueChange={(v) => set('regime_tributario', v)}
                disabled={!editing}
              >
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(REGIME_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{k} — {v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Regime PIS/COFINS</Label>
              <Select
                value={form.pis_cofins_regime ?? 'simples_nacional'}
                onValueChange={(v) => set('pis_cofins_regime', v)}
                disabled={!editing}
              >
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PIS_COFINS_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Natureza da operação</Label>
            <Input
              value={form.natureza_operacao ?? ''}
              onChange={(e) => set('natureza_operacao', e.target.value)}
              disabled={!editing}
              className="h-9 mt-1"
              placeholder="Ex: Venda de Mercadoria, Industrialização, Remessa..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Série NF-e</Label>
              <Input
                type="number"
                min={1}
                max={999}
                value={form.serie_nfe ?? 1}
                onChange={(e) => set('serie_nfe', Number(e.target.value))}
                disabled={!editing}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Ambiente</Label>
              <div className="h-9 flex items-center mt-1">
                <Badge variant="outline" className={primary.ambiente === 'producao'
                  ? 'bg-green-500/10 text-green-700 border-green-500/30'
                  : 'bg-amber-500/10 text-amber-700 border-amber-500/30'}>
                  {primary.ambiente === 'producao' ? 'Produção (vale fiscal)' : 'Homologação (teste, sem valor fiscal)'}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CFOPs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Truck className="h-4 w-4" /> CFOPs por operação
          </CardTitle>
          <CardDescription className="text-xs">
            CFOP correto depende da origem (produção própria ou revenda) e destino (mesma UF ou interestadual).
            Sistema escolhe automaticamente baseado nessas 4 combinações.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CfopField
              label="Indústria — mesma UF"
              hint="Produção própria entregue dentro de RJ"
              value={form.cfop_industrial_interno ?? ''}
              onChange={(v) => set('cfop_industrial_interno', v)}
              disabled={!editing}
              suggestion="5101"
            />
            <CfopField
              label="Indústria — outra UF"
              hint="Produção própria entregue em outro estado"
              value={form.cfop_industrial_externo ?? ''}
              onChange={(v) => set('cfop_industrial_externo', v)}
              disabled={!editing}
              suggestion="6101"
            />
            <CfopField
              label="Revenda — mesma UF"
              hint="Mercadoria comprada de terceiro pra revender, dentro de RJ"
              value={form.cfop_revenda_interno ?? ''}
              onChange={(v) => set('cfop_revenda_interno', v)}
              disabled={!editing}
              suggestion="5102"
            />
            <CfopField
              label="Revenda — outra UF"
              hint="Mercadoria comprada pra revender, interestadual"
              value={form.cfop_revenda_externo ?? ''}
              onChange={(v) => set('cfop_revenda_externo', v)}
              disabled={!editing}
              suggestion="6102"
            />
          </div>
        </CardContent>
      </Card>

      {/* Status */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong className="text-foreground">22 fichas técnicas com NCM cadastrado</strong> (64041100, 64041900, 64022000 — calçados/sandálias)</p>
              <p>
                <MapPin className="h-3 w-3 inline mr-1" />
                Origem fiscal: {primary.uf}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <div className="flex items-center justify-end gap-2 sticky bottom-0 bg-background py-3 border-t">
          <Button variant="ghost" onClick={() => { setEditing(false); setForm({}); }}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar tributação'}
          </Button>
        </div>
      )}
    </div>
  );
}

function CfopField({
  label, hint, value, onChange, disabled, suggestion,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  suggestion: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        disabled={disabled}
        placeholder={suggestion}
        maxLength={4}
        className="h-9 mt-1 font-mono"
      />
      <p className="text-[10px] text-muted-foreground mt-0.5">{hint} · sugerido <strong>{suggestion}</strong></p>
    </div>
  );
}
