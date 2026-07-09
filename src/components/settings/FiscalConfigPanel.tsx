import { useState, useEffect } from 'react';
import { FloppyDisk as Save, CircleNotch as Loader2, Buildings as Building2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useFiscalConfig, useSaveFiscalConfig } from '@/hooks/useNfe';

export default function FiscalConfigPanel() {
  const { data: config, isLoading } = useFiscalConfig();
  const saveConfig = useSaveFiscalConfig();
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const set = (key: string, value: string) => setForm((f: any) => ({ ...f, [key]: value }));

  const handleSave = () => {
    const { id, created_at, updated_at, ...data } = form;
    saveConfig.mutate(data);
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Ambiente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Ambiente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ambiente</Label>
              <Select value={form.ambiente || 'homologacao'} onValueChange={v => set('ambiente', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="homologacao">Homologação (Testes)</SelectItem>
                  <SelectItem value="producao">Produção</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Série NF-e</Label>
              <Input type="number" value={form.serie_nfe || 1} onChange={e => set('serie_nfe', e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O certificado digital A1 é configurado no painel ClickNotas —
            não é gerenciado por aqui.
          </p>
        </CardContent>
      </Card>

      {/* Dados do Emitente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Dados do Emitente</CardTitle>
          <CardDescription className="text-xs">Informações fiscais da sua empresa</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>CNPJ</Label><Input value={form.cnpj || ''} onChange={e => set('cnpj', e.target.value)} placeholder="00.000.000/0000-00" /></div>
            <div><Label>Inscrição Estadual</Label><Input value={form.inscricao_estadual || ''} onChange={e => set('inscricao_estadual', e.target.value)} /></div>
            <div><Label>Razão Social</Label><Input value={form.razao_social || ''} onChange={e => set('razao_social', e.target.value)} /></div>
            <div><Label>Nome Fantasia</Label><Input value={form.nome_fantasia || ''} onChange={e => set('nome_fantasia', e.target.value)} /></div>
            <div>
              <Label>Regime Tributário</Label>
              <Select value={form.regime_tributario || '1'} onValueChange={v => set('regime_tributario', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Simples Nacional</SelectItem>
                  <SelectItem value="2">Simples Nacional - Excesso</SelectItem>
                  <SelectItem value="3">Regime Normal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Natureza da Operação</Label><Input value={form.natureza_operacao || ''} onChange={e => set('natureza_operacao', e.target.value)} /></div>
            <div><Label>CFOP Padrão</Label><Input value={form.cfop || ''} onChange={e => set('cfop', e.target.value)} placeholder="5102" /></div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Endereço */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Endereço do Emitente</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Logradouro</Label><Input value={form.logradouro || ''} onChange={e => set('logradouro', e.target.value)} /></div>
            <div><Label>Número</Label><Input value={form.numero || ''} onChange={e => set('numero', e.target.value)} /></div>
            <div><Label>Complemento</Label><Input value={form.complemento || ''} onChange={e => set('complemento', e.target.value)} /></div>
            <div><Label>Bairro</Label><Input value={form.bairro || ''} onChange={e => set('bairro', e.target.value)} /></div>
            <div><Label>Cidade</Label><Input value={form.cidade || ''} onChange={e => set('cidade', e.target.value)} /></div>
            <div><Label>UF</Label><Input value={form.uf || ''} onChange={e => set('uf', e.target.value)} maxLength={2} /></div>
            <div><Label>CEP</Label><Input value={form.cep || ''} onChange={e => set('cep', e.target.value)} placeholder="00000-000" /></div>
            <div className="col-span-2"><Label>Código do Município (IBGE)</Label><Input value={form.codigo_municipio || ''} onChange={e => set('codigo_municipio', e.target.value)} placeholder="Ex: 3550308" /></div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saveConfig.isPending} className="w-full">
        {saveConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        Salvar Configuração Fiscal
      </Button>
    </div>
  );
}
