import { useState } from 'react';
import { CircleNotch as Loader2, MagnifyingGlass as Search, Buildings as Building2, MapPin, Phone, CurrencyDollar as DollarSign } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Client, ClientFormData, EconomicGroup } from '@/hooks/useClients';
import ClientLogoTab from './ClientLogoTab';
import RepresentativeTab from './RepresentativeTab';
import ClientAddressesTab from './ClientAddressesTab';
import ClientContactsTab from './ClientContactsTab';

const ESTADOS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingClient: Client | null;
  form: ClientFormData;
  setForm: React.Dispatch<React.SetStateAction<ClientFormData>>;
  economicGroups: EconomicGroup[];
  onSubmit: (e: React.FormEvent) => void;
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchCep(cep: string) {
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) return null;
  try {
    const res = await fetchWithTimeout(`https://viacep.com.br/ws/${clean}/json/`);
    const data = await res.json();
    if (data.erro) return null;
    return data;
  } catch {
    return null;
  }
}

async function fetchCnpj(cnpj: string) {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) return null;
  try {
    const res = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

export default function ClientFormDialog({ open, onOpenChange, editingClient, form, setForm, economicGroups, onSubmit }: Props) {
  const [loadingCep, setLoadingCep] = useState(false);
  const [loadingCnpj, setLoadingCnpj] = useState(false);

  const handleCepBlur = async () => {
    const clean = form.cep.replace(/\D/g, '');
    if (clean.length !== 8) return;
    setLoadingCep(true);
    const data = await fetchCep(clean);
    setLoadingCep(false);
    if (data) {
      setForm(f => ({
        ...f,
        endereco: data.logradouro || f.endereco,
        cidade: data.localidade || f.cidade,
        estado: data.uf || f.estado,
      }));
      toast.success('Endereço preenchido automaticamente!');
    } else {
      toast.error('CEP não encontrado.');
    }
  };

  const handleCnpjSearch = async () => {
    const clean = form.cnpj.replace(/\D/g, '');
    if (clean.length !== 14) {
      toast.error('CNPJ deve ter 14 dígitos.');
      return;
    }
    setLoadingCnpj(true);
    const data = await fetchCnpj(clean);
    setLoadingCnpj(false);
    if (data) {
      setForm(f => ({
        ...f,
        razao_social: data.razao_social || f.razao_social,
        nome_fantasia: data.nome_fantasia || f.nome_fantasia,
        endereco: [data.descricao_tipo_de_logradouro, data.logradouro, data.numero, data.complemento].filter(Boolean).join(', ') || f.endereco,
        cidade: data.municipio || f.cidade,
        estado: data.uf || f.estado,
        cep: data.cep ? data.cep.replace(/\D/g, '').replace(/(\d{5})(\d{3})/, '$1-$2') : f.cep,
        telefone: data.ddd_telefone_1 || f.telefone,
        email: data.email || f.email,
      }));
      toast.success('Dados do CNPJ preenchidos automaticamente!');
    } else {
      toast.error('CNPJ não encontrado na Receita Federal.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingClient ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          <Tabs defaultValue="dados">
            <TabsList className="w-full">
              <TabsTrigger value="dados" className="flex-1">Dados</TabsTrigger>
              {editingClient && <TabsTrigger value="enderecos" className="flex-1">Endereços</TabsTrigger>}
              {editingClient && <TabsTrigger value="contatos" className="flex-1">Contatos</TabsTrigger>}
              {editingClient && <TabsTrigger value="representante" className="flex-1">Representante</TabsTrigger>}
            </TabsList>

            <TabsContent value="dados" className="space-y-3 mt-3">
              {/* CARD 1 — Identificação */}
              <div className="rounded-xl border bg-card shadow-sm">
                <div className="px-4 py-2.5 border-b flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold">Identificação</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">Dados oficiais da empresa</span>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <Label className="text-xs">Razão Social *</Label>
                    <Input value={form.razao_social} onChange={e => setForm(f => ({ ...f, razao_social: e.target.value }))} required className="mt-1 h-9" />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Nome Fantasia</Label>
                    <Input value={form.nome_fantasia} onChange={e => setForm(f => ({ ...f, nome_fantasia: e.target.value }))} className="mt-1 h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">CNPJ</Label>
                    <div className="relative mt-1">
                      <Input
                        value={form.cnpj}
                        onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))}
                        className="font-mono pr-10 h-9"
                        placeholder="00.000.000/0000-00"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full w-9 hover:bg-primary/10"
                        onClick={handleCnpjSearch}
                        disabled={loadingCnpj}
                        title="Buscar dados do CNPJ na Receita Federal"
                      >
                        {loadingCnpj ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Inscrição Estadual</Label>
                    <Input value={form.inscricao_estadual} onChange={e => setForm(f => ({ ...f, inscricao_estadual: e.target.value }))} className="mt-1 h-9 font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs">Código da Filial</Label>
                    <Input
                      value={form.branch_code ?? ''}
                      onChange={e => setForm(f => ({ ...f, branch_code: e.target.value || null }))}
                      className="mt-1 h-9 font-mono"
                      placeholder='ex: "L12", "SP-03"'
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Código que o cliente passa pra identificar a unidade dele.</p>
                  </div>
                  <div>
                    <Label className="text-xs">Nome da Filial</Label>
                    <Input
                      value={form.branch_name ?? ''}
                      onChange={e => setForm(f => ({ ...f, branch_name: e.target.value || null }))}
                      className="mt-1 h-9"
                      placeholder='ex: "Loja Botafogo"'
                    />
                  </div>
                </div>
              </div>

              {/* CARD 2 — Endereço */}
              <div className="rounded-xl border bg-card shadow-sm">
                <div className="px-4 py-2.5 border-b flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold">Endereço</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">CEP busca dados automaticamente</span>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">CEP</Label>
                    <div className="relative mt-1">
                      <Input
                        value={form.cep}
                        onChange={e => setForm(f => ({ ...f, cep: e.target.value }))}
                        onBlur={handleCepBlur}
                        className="font-mono pr-8 h-9"
                        placeholder="00000-000"
                      />
                      {loadingCep && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Estado</Label>
                    <Select value={form.estado} onValueChange={v => setForm(f => ({ ...f, estado: v }))}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="UF" /></SelectTrigger>
                      <SelectContent>
                        {ESTADOS.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Cidade</Label>
                    <Input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} className="mt-1 h-9" />
                  </div>
                  <div className="md:col-span-4">
                    <Label className="text-xs">Endereço completo</Label>
                    <Input value={form.endereco} onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} className="mt-1 h-9" placeholder="Rua, Número, Bairro, Complemento" />
                  </div>
                </div>
              </div>

              {/* CARD 3 — Contato */}
              <div className="rounded-xl border bg-card shadow-sm">
                <div className="px-4 py-2.5 border-b flex items-center gap-2">
                  <Phone className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold">Contato</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">Canais de comunicação</span>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Telefone</Label>
                    <Input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} className="mt-1 h-9 font-mono" placeholder="(00) 00000-0000" />
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1 h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Pessoa de Contato</Label>
                    <Input value={form.contato} onChange={e => setForm(f => ({ ...f, contato: e.target.value }))} className="mt-1 h-9" />
                  </div>
                </div>
              </div>

              {/* CARD 4 — Comercial & Configurações */}
              <div className="rounded-xl border bg-card shadow-sm">
                <div className="px-4 py-2.5 border-b flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold">Comercial & Configurações</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">Grupo, crédito e regras</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Grupo Econômico</Label>
                      <Select value={form.economic_group_id || 'none'} onValueChange={v => setForm(f => ({ ...f, economic_group_id: v === 'none' ? null : v }))}>
                        <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem grupo</SelectItem>
                          {economicGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground mt-1">Lojas do mesmo grupo aparecem agrupadas na lista.</p>
                    </div>
                    <div>
                      <Label className="text-xs">Limite de Crédito (R$)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={100}
                        value={form.credit_limit || ''}
                        onChange={e => setForm(f => ({ ...f, credit_limit: parseFloat(e.target.value) || 0 }))}
                        className="mt-1 h-9 font-mono"
                        placeholder="0,00"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Observações</Label>
                    <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} placeholder="Notas internas, condições especiais, histórico..." />
                  </div>
                  <div className="flex items-center gap-6 pt-1">
                    <div className="flex items-center gap-2">
                      <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
                      <Label className="text-xs cursor-pointer">Cliente Ativo</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={form.accepts_bundled_packaging} onCheckedChange={v => setForm(f => ({ ...f, accepts_bundled_packaging: v }))} />
                      <Label className="text-xs cursor-pointer">Permite Amarrados</Label>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Aba SILK (Logo) removida em 2026-06: silk agora é gerenciada
                centralmente em /silks (por solado / cliente / grupo econômico).
                clients.silk_url permanece no banco por compat (não é mais
                editável neste form). */}

            {editingClient && (
              <>
                <TabsContent value="enderecos" className="mt-3">
                  <ClientAddressesTab clientId={editingClient.id} />
                </TabsContent>

                <TabsContent value="contatos" className="mt-3">
                  <ClientContactsTab clientId={editingClient.id} />
                </TabsContent>

                <TabsContent value="representante" className="mt-3">
                  <RepresentativeTab entityId={editingClient.id} type="client" />
                </TabsContent>
              </>
            )}
          </Tabs>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit">{editingClient ? 'Salvar' : 'Cadastrar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
