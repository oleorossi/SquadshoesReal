import { useState } from 'react';
import { useCompanies, useSaveCompany, useDeleteCompany, useSetPrimaryCompany, Company } from '@/hooks/useNfe';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Loader2, Plus, Pencil, Trash2, Star, Building2, Upload, FileCheck, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { CertificateSetupDialog } from './CertificateSetupDialog';
import { cn } from '@/lib/utils';

const BLANK: Partial<Company> = {
  cnpj: '', inscricao_estadual: '', razao_social: '', nome_fantasia: '',
  logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
  cep: '', codigo_municipio: '', regime_tributario: '1', serie_nfe: 1,
  ambiente: 'homologacao', certificate_path: '', natureza_operacao: 'Venda de Mercadoria',
  cfop: '5102', is_primary: false,
};

function CompanyForm({ company, onClose }: { company?: Company; onClose: () => void }) {
  const [form, setForm] = useState<any>(company || BLANK);
  const [uploading, setUploading] = useState(false);
  const save = useSaveCompany();

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

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
    const path = `certificates/company-${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from('certificates').upload(path, file);
    if (error) {
      toast.error('Erro ao enviar certificado: ' + error.message);
    } else {
      set('certificate_path', path);
      toast.success('Certificado enviado!');
    }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!form.cnpj || !form.razao_social) {
      toast.error('CNPJ e Razão Social são obrigatórios');
      return;
    }
    await save.mutateAsync(form);
    onClose();
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          {company ? 'Editar Empresa' : 'Nova Empresa / CNPJ'}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-2">
        {/* Ambiente e Certificado */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Ambiente e Certificado</CardTitle></CardHeader>
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
                <Input type="number" value={form.serie_nfe || 1} onChange={e => set('serie_nfe', Number(e.target.value))} />
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

        {/* Dados fiscais */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Dados Fiscais</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>CNPJ *</Label><Input value={form.cnpj || ''} onChange={e => set('cnpj', e.target.value)} placeholder="00.000.000/0000-00" /></div>
              <div><Label>Inscrição Estadual</Label><Input value={form.inscricao_estadual || ''} onChange={e => set('inscricao_estadual', e.target.value)} /></div>
              <div><Label>Razão Social *</Label><Input value={form.razao_social || ''} onChange={e => set('razao_social', e.target.value)} /></div>
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

        {/* Endereço */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Endereço</CardTitle></CardHeader>
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
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Salvar Empresa
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

type CertStatusRow = {
  id: string;
  cnpj: string;
  cert_status: 'pendente' | 'ativo' | 'expirado' | 'erro' | null;
  cert_valid_until: string | null;
  cert_subject_name: string | null;
  cert_uploaded_at: string | null;
  cert_focus_synced_at: string | null;
  cert_days_until_expiry: number | null;
  cert_severity: 'ok' | 'warning' | 'critical';
};

function useCertStatuses() {
  return useQuery({
    queryKey: ['companies_cert_status'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_companies_cert_status' as any)
        .select('*');
      if (error) throw error;
      const map = new Map<string, CertStatusRow>();
      for (const r of (data as any[]) || []) map.set(r.id, r as CertStatusRow);
      return map;
    },
  });
}

function CertStatusBadge({ status }: { status: CertStatusRow | undefined }) {
  if (!status || !status.cert_status) {
    return (
      <Badge variant="outline" className="gap-1 text-xs bg-red-500/10 text-red-700 border-red-500/40">
        <ShieldX className="h-2.5 w-2.5" /> Sem certificado
      </Badge>
    );
  }
  const days = status.cert_days_until_expiry;
  if (status.cert_status === 'expirado' || (days !== null && days < 0)) {
    return (
      <Badge variant="outline" className="gap-1 text-xs bg-red-500/10 text-red-700 border-red-500/40">
        <ShieldX className="h-2.5 w-2.5" /> Expirado
      </Badge>
    );
  }
  if (status.cert_status === 'erro') {
    return (
      <Badge variant="outline" className="gap-1 text-xs bg-red-500/10 text-red-700 border-red-500/40">
        <ShieldAlert className="h-2.5 w-2.5" /> Erro na Focus
      </Badge>
    );
  }
  if (status.cert_status === 'pendente') {
    return (
      <Badge variant="outline" className="gap-1 text-xs bg-amber-500/10 text-amber-700 border-amber-500/40">
        <ShieldAlert className="h-2.5 w-2.5" /> Pendente
      </Badge>
    );
  }
  if (days !== null && days < 30) {
    return (
      <Badge variant="outline" className={cn(
        'gap-1 text-xs',
        days < 7 ? 'bg-red-500/10 text-red-700 border-red-500/40'
                 : 'bg-amber-500/10 text-amber-700 border-amber-500/40',
      )}>
        <ShieldAlert className="h-2.5 w-2.5" />
        Expira em {days}d
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/40">
      <ShieldCheck className="h-2.5 w-2.5" />
      {days !== null ? `Válido (${days}d)` : 'Válido'}
    </Badge>
  );
}

export default function CompaniesPanel() {
  const { data: companies = [], isLoading } = useCompanies();
  const { data: certStatuses } = useCertStatuses();
  const deleteCompany = useDeleteCompany();
  const setPrimary = useSetPrimaryCompany();
  const [editTarget, setEditTarget] = useState<Company | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [certDialog, setCertDialog] = useState<Company | null>(null);

  const openNew = () => { setEditTarget(undefined); setFormOpen(true); };
  const openEdit = (c: Company) => { setEditTarget(c); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditTarget(undefined); };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Gerencie múltiplos CNPJs para emissão de NF-e. A empresa principal é usada por padrão.
        </p>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> Nova Empresa
        </Button>
      </div>

      {companies.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-3">Nenhuma empresa cadastrada</p>
            <p className="text-xs text-muted-foreground mb-4">Sem empresas cadastradas, o sistema usa a Configuração Fiscal padrão (menu Configurações).</p>
            <Button variant="outline" size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Cadastrar Empresa</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {companies.map(c => (
            <Card key={c.id} className={c.is_primary ? 'border-primary/40' : ''}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{c.nome_fantasia || c.razao_social}</span>
                      {c.is_primary && (
                        <Badge variant="outline" className="gap-1 text-xs bg-primary/10 text-primary border-primary/30">
                          <Star className="h-2.5 w-2.5" /> Principal
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-xs ${c.ambiente === 'producao' ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'}`}>
                        {c.ambiente === 'producao' ? 'Produção' : 'Homologação'}
                      </Badge>
                      <CertStatusBadge status={certStatuses?.get(c.id)} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{c.razao_social}</p>
                    <p className="text-xs text-muted-foreground">
                      CNPJ: {c.cnpj} · IE: {c.inscricao_estadual || '—'} · Série {c.serie_nfe}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.logradouro} {c.numero}, {c.bairro} — {c.cidade}/{c.uf}</p>
                    {(() => {
                      const st = certStatuses?.get(c.id);
                      if (!st?.cert_subject_name && !st?.cert_valid_until) return null;
                      return (
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                          {st.cert_subject_name && <>Subject: {st.cert_subject_name} · </>}
                          {st.cert_valid_until && <>Validade: {new Date(st.cert_valid_until).toLocaleDateString('pt-BR')}</>}
                        </p>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCertDialog(c)}
                      className="gap-1.5 h-8"
                      title="Configurar / atualizar certificado A1 na Focus NFe"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">
                        {certStatuses?.get(c.id)?.cert_status === 'ativo' ? 'Atualizar' : 'Certificado'}
                      </span>
                    </Button>
                    {!c.is_primary && (
                      <Button variant="ghost" size="icon" title="Tornar principal" onClick={() => setPrimary.mutate(c.id)} disabled={setPrimary.isPending}>
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" disabled={deleteCompany.isPending}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir empresa emissora?</AlertDialogTitle>
                          <AlertDialogDescription>
                            <strong>{c.razao_social}</strong> ({c.cnpj}) será removida permanentemente.
                            NF-e já emitidas com este CNPJ não serão afetadas, mas novas emissões não poderão usar esta empresa.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteCompany.mutate(c.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={closeForm}>
        {formOpen && <CompanyForm company={editTarget} onClose={closeForm} />}
      </Dialog>

      {certDialog && (
        <CertificateSetupDialog
          open={!!certDialog}
          onOpenChange={(v) => { if (!v) setCertDialog(null); }}
          cnpj={certDialog.cnpj}
          razaoSocial={certDialog.razao_social}
          hasCert={certStatuses?.get(certDialog.id)?.cert_status === 'ativo'}
        />
      )}
    </div>
  );
}
