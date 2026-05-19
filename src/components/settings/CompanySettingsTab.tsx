/**
 * Configuração da empresa empregadora — usado em:
 *  - Espelho de Ponto (Portaria 671 art. 84 — identificação empregador)
 *  - AEJ (Arquivo Eletrônico de Jornada — registros tipo 1/2)
 *  - PDFs fiscais (NF-e/CT-e — escapa fallback de outros lugares)
 *
 * Singleton: 1 row em company_settings com is_default=true. Edição inline,
 * salva via mutation. Bloqueia salvar se CNPJ inválido (precisa
 * obrigatoriamente 1 identificador — constraint do banco).
 */
import { useState, useEffect } from 'react';
import { useCompanySettings, useUpdateCompanySettings, isValidCNPJ } from '@/hooks/useCompanySettings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Buildings as Building, CircleNotch as Loader2, FloppyDisk as Save, Warning as AlertTriangle } from '@phosphor-icons/react';

export default function CompanySettingsTab() {
  const { data: settings, isLoading } = useCompanySettings();
  const updateMut = useUpdateCompanySettings();
  const [form, setForm] = useState({
    razao_social: '',
    nome_fantasia: '',
    cnpj: '',
    cei: '',
    caepf: '',
    cno: '',
    endereco: '',
    cep: '',
    cidade: '',
    uf: '',
    telefone: '',
    email: '',
  });

  useEffect(() => {
    if (settings) {
      setForm({
        razao_social: settings.razao_social || '',
        nome_fantasia: settings.nome_fantasia || '',
        cnpj: settings.cnpj || '',
        cei: settings.cei || '',
        caepf: settings.caepf || '',
        cno: settings.cno || '',
        endereco: settings.endereco || '',
        cep: settings.cep || '',
        cidade: settings.cidade || '',
        uf: settings.uf || '',
        telefone: settings.telefone || '',
        email: settings.email || '',
      });
    }
  }, [settings]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!settings) {
    return <p className="text-sm text-muted-foreground">company_settings sem row default — rodar migration 20260629190000.</p>;
  }

  const cnpjClean = form.cnpj.replace(/\D/g, '');
  const cnpjValid = isValidCNPJ(cnpjClean);
  const cnpjPlaceholder = cnpjClean === '00000000000000';

  const handleSave = () => {
    if (!form.razao_social.trim()) return;
    updateMut.mutate({
      id: settings.id,
      razao_social: form.razao_social.trim(),
      nome_fantasia: form.nome_fantasia.trim() || null,
      cnpj: cnpjClean || null,
      cei: form.cei.trim() || null,
      caepf: form.caepf.trim() || null,
      cno: form.cno.trim() || null,
      endereco: form.endereco.trim() || null,
      cep: form.cep.replace(/\D/g, '') || null,
      cidade: form.cidade.trim() || null,
      uf: form.uf.trim().toUpperCase() || null,
      telefone: form.telefone.replace(/\D/g, '') || null,
      email: form.email.trim() || null,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building className="h-4 w-4 text-primary" />
          Empresa (Empregador)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Identificação obrigatória pra Espelho de Ponto e AEJ (Portaria MTE 671/2021). Pelo menos um identificador (CNPJ, CEI, CAEPF ou CNO) é exigido.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {cnpjPlaceholder && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
            <p className="text-amber-700 dark:text-amber-400">
              CNPJ ainda é placeholder (00.000.000/0000-00). Preencha com o CNPJ real da empresa pra documentos fiscais e o Espelho de Ponto serem válidos.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Razão Social <span className="text-destructive">*</span></Label>
            <Input value={form.razao_social} onChange={e => setForm(f => ({ ...f, razao_social: e.target.value }))} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Nome Fantasia</Label>
            <Input value={form.nome_fantasia} onChange={e => setForm(f => ({ ...f, nome_fantasia: e.target.value }))} className="h-9" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">CNPJ</Label>
            <Input value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} className={`h-9 font-mono ${!cnpjValid && cnpjClean ? 'border-destructive' : ''}`} placeholder="14 dígitos" maxLength={18} />
            {cnpjClean && !cnpjValid && <p className="text-[10px] text-destructive mt-0.5">CNPJ precisa ter 14 dígitos</p>}
          </div>
          <div>
            <Label className="text-xs">CEI</Label>
            <Input value={form.cei} onChange={e => setForm(f => ({ ...f, cei: e.target.value }))} className="h-9 font-mono" placeholder="opcional" />
          </div>
          <div>
            <Label className="text-xs">CAEPF</Label>
            <Input value={form.caepf} onChange={e => setForm(f => ({ ...f, caepf: e.target.value }))} className="h-9 font-mono" placeholder="opcional" />
          </div>
          <div>
            <Label className="text-xs">CNO</Label>
            <Input value={form.cno} onChange={e => setForm(f => ({ ...f, cno: e.target.value }))} className="h-9 font-mono" placeholder="opcional" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Endereço</Label>
            <Input value={form.endereco} onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} className="h-9" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">CEP</Label>
              <Input value={form.cep} onChange={e => setForm(f => ({ ...f, cep: e.target.value }))} className="h-9 font-mono" maxLength={9} />
            </div>
            <div>
              <Label className="text-xs">Cidade</Label>
              <Input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">UF</Label>
              <Input value={form.uf} onChange={e => setForm(f => ({ ...f, uf: e.target.value.toUpperCase() }))} className="h-9 uppercase" maxLength={2} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Telefone</Label>
            <Input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} className="h-9 font-mono" />
          </div>
          <div>
            <Label className="text-xs">E-mail</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="h-9" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button onClick={handleSave} disabled={updateMut.isPending || !form.razao_social.trim()} className="gap-1.5">
            {updateMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
