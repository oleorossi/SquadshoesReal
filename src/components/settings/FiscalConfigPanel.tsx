import { useState, useEffect } from 'react';
import { Save, Loader2, Upload, FileCheck, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useFiscalConfig, useSaveFiscalConfig } from '@/hooks/useNfe';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function FiscalConfigPanel() {
  const { data: config, isLoading } = useFiscalConfig();
  const saveConfig = useSaveFiscalConfig();
  const [form, setForm] = useState<any>({});
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const set = (key: string, value: string) => setForm((f: any) => ({ ...f, [key]: value }));

  const handleSave = () => {
    const { id, created_at, updated_at, ...data } = form;
    saveConfig.mutate(data);
  };

  const handleCertUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.pfx') && !file.name.endsWith('.p12')) {
      toast.error('Selecione um arquivo .pfx ou .p12');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Certificado deve ter no máximo 5MB.');
      return;
    }
    setUploading(true);
    // Sanitize filename to prevent path traversal — only allow alnum, dot, dash, underscore.
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `certificates/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from('certificates').upload(path, file);
    if (error) {
      toast.error('Erro ao enviar certificado: ' + error.message);
    } else {
      set('certificate_path', path);
      toast.success('Certificado enviado com sucesso!');
    }
    setUploading(false);
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Ambiente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Ambiente e Certificado
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
          <div>
            <Label>Certificado Digital A1 (.pfx)</Label>
            <div className="flex items-center gap-2 mt-1">
              <label className="cursor-pointer">
                <Input type="file" accept=".pfx,.p12" onChange={handleCertUpload} className="hidden" />
                <Button variant="outline" size="sm" asChild disabled={uploading}>
                  <span>{uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />} Enviar Certificado</span>
                </Button>
              </label>
              {form.certificate_path && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <FileCheck className="h-3 w-3" /> Certificado configurado
                </Badge>
              )}
            </div>
          </div>
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
