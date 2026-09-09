import { useState, useMemo, useRef } from 'react';
import { CircleNotch as Loader2, Plus, Trash as Trash2, FileText } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useClients } from '@/hooks/useClients';
import { useProducts } from '@/hooks/useProducts';
import { useCreateStandaloneNfeDraft, useCompanies, StandaloneNfeItem } from '@/hooks/useNfe';
import { useAccessControl } from '@/hooks/useAccessControl';
import { CurrencyInput } from '@/components/ui/currency-input';
import { NumberInput } from '@/components/ui/number-input';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from 'sonner';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

interface DraftItem extends StandaloneNfeItem {
  _key: string;
}

function makeKey() {
  return Math.random().toString(36).slice(2);
}

const emptyItem = (): DraftItem => ({
  _key: makeKey(),
  product_id: '',
  color: '',
  quantity: 0,
  unit_price: 0,
  grade: {},
});

export default function StandaloneNfePanel() {
  const { data: clients = [] } = useClients();
  const { data: products = [] } = useProducts();
  const { data: companies = [] } = useCompanies();
  const createDraft = useCreateStandaloneNfeDraft();
  const { isAdmin, roles } = useAccessControl();

  const canCreateDraft = isAdmin
    || roles.includes('gerente')
    || roles.includes('comercial')
    || roles.includes('nfe_operator');
  const clientRequestIdRef = useRef(crypto.randomUUID());

  const [clientId, setClientId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);

  const activeClients = useMemo(
    () => (clients || []).filter((c: any) => c.active !== false),
    [clients],
  );
  const matchedClients = useMemo(
    () => activeClients.filter((c: any) => searchMatchesAllTerms(clientSearch, c.razao_social, c.nome_fantasia, c.cnpj)),
    [activeClients, clientSearch],
  );
  const filteredClients = useMemo(() => matchedClients.slice(0, 50), [matchedClients]);

  const stockedProducts = useMemo(
    () => (products || []).filter((p: any) => p.active !== false && Number(p.quantity || 0) > 0),
    [products],
  );
  const matchedProducts = useMemo(
    () => stockedProducts.filter((p: any) => searchMatchesAllTerms(productSearch, p.name, p.sku)),
    [stockedProducts, productSearch],
  );
  const filteredProducts = useMemo(() => matchedProducts.slice(0, 100), [matchedProducts]);

  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const selectedClient = clients.find((c: any) => c.id === clientId);

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems(prev => prev.map(i => (i._key === key ? { ...i, ...patch } : i)));
  };

  const removeItem = (key: string) => {
    setItems(prev => (prev.length === 1 ? [emptyItem()] : prev.filter(i => i._key !== key)));
  };

  const addItem = () => setItems(prev => [...prev, emptyItem()]);

  // Grade detalhada: input "35:3, 36:5, 37:4" → JSONB
  const parseGrade = (text: string): Record<string, number> => {
    const result: Record<string, number> = {};
    text.split(/[,;]/).forEach(part => {
      const m = part.trim().match(/^(\d+)\s*[:=]\s*(\d+)$/);
      if (m) result[m[1]] = Number(m[2]);
    });
    return result;
  };

  const gradeToText = (g: Record<string, number>) =>
    Object.entries(g)
      .filter(([, q]) => Number(q) > 0)
      .map(([s, q]) => `${s}:${q}`)
      .join(', ');

  const handleCreateDraft = async () => {
    if (!canCreateDraft) {
      toast.error('Você não tem permissão para criar este rascunho.');
      return;
    }
    if (!clientId) {
      toast.error('Selecione um cliente.');
      return;
    }
    if (!selectedClient?.cnpj) {
      toast.error('Cliente sem CNPJ. Atualize o cadastro.');
      return;
    }
    const validItems = items.filter(i => i.product_id && i.quantity > 0 && i.unit_price > 0);
    if (validItems.length === 0) {
      toast.error('Adicione ao menos um item com produto, quantidade e preço.');
      return;
    }
    // Validação de grade: soma deve bater com quantity total
    for (const it of validItems) {
      const gradeSum = Object.values(it.grade).reduce((s, v) => s + Number(v || 0), 0);
      if (gradeSum > 0 && gradeSum !== it.quantity) {
        const prodName = products.find((p: any) => p.id === it.product_id)?.name || it.product_id;
        toast.error(`Grade de "${prodName}" soma ${gradeSum} mas quantity = ${it.quantity}. Ajuste antes de emitir.`);
        return;
      }
    }
    await createDraft.mutateAsync({
      clientId,
      companyId: companyId || undefined,
      items: validItems.map(({ _key, ...rest }) => rest),
      notes: notes.trim() || undefined,
      clientRequestId: clientRequestIdRef.current,
    });
    // O intent só gira após sucesso definitivo. Timeout/retry reaproveita a
    // mesma chave e recebe o receipt original sem duplicar o PV.
    clientRequestIdRef.current = crypto.randomUUID();
    setItems([emptyItem()]);
    setNotes('');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
        <strong>NF avulsa</strong> — primeiro cria um PV auditável em Rascunho, sem transmitir nada.
        Cliente, política comercial e dados do produto precisam ser validados antes da emissão.
        Use para mercadorias em estoque que não passam por ondas de produção.
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cliente e Empresa Emitente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cliente *</Label>
              <SearchInput
                className="mt-1"
                inputClassName="h-9 text-sm"
                placeholder="Buscar cliente por razão social, fantasia ou CNPJ…"
                value={clientSearch}
                onChange={setClientSearch}
                resultCount={matchedClients.length}
                totalCount={activeClients.length}
              />
              {clientSearch && matchedClients.length === 0 && (
                <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">Nenhum resultado para "{clientSearch}"</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs shrink-0"
                    onClick={() => setClientSearch('')}
                  >
                    Limpar busca
                  </Button>
                </div>
              )}
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="mt-2 h-9 text-sm">
                  <SelectValue placeholder="Selecionar cliente" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {filteredClients.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum cliente encontrado</div>
                  ) : (
                    filteredClients.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="font-medium">{c.razao_social}</span>
                        {c.cnpj && <span className="text-xs text-muted-foreground ml-2">{c.cnpj}</span>}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {selectedClient && (
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {selectedClient.cnpj || 'Sem CNPJ'} · {selectedClient.cidade || '—'}/{selectedClient.estado || '—'}
                  {!selectedClient.cnpj && (
                    <Badge variant="outline" className="ml-2 text-amber-600 border-amber-300 text-xs">
                      Sem CNPJ
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs">Empresa emitente</Label>
              {(() => {
                const primary = (companies || []).find((c: any) => c.is_primary && c.active !== false);
                const primaryLabel = primary
                  ? `${primary.nome_fantasia || primary.razao_social} (principal)`
                  : 'Usar empresa principal';
                return (
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger className="mt-1 h-9 text-sm">
                      <SelectValue placeholder={primaryLabel} />
                    </SelectTrigger>
                    <SelectContent>
                      {(companies || [])
                        .filter((c: any) => c.active !== false)
                        .map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome_fantasia || c.razao_social}
                            {c.is_primary && <Badge variant="secondary" className="ml-2 text-xs">Principal</Badge>}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                );
              })()}
              <p className="mt-1.5 text-xs text-muted-foreground">
                Se vazio, usa a empresa marcada como principal.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Itens ({items.length})</CardTitle>
          <Button onClick={addItem} variant="outline" size="sm" className="h-8 gap-1">
            <Plus className="h-3.5 w-3.5" /> Adicionar item
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <SearchInput
            inputClassName="h-8 text-xs"
            placeholder="Buscar produto por nome ou SKU…"
            value={productSearch}
            onChange={setProductSearch}
            resultCount={matchedProducts.length}
            totalCount={stockedProducts.length}
          />
          {productSearch && matchedProducts.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">Nenhum resultado para "{productSearch}"</span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs shrink-0"
                onClick={() => setProductSearch('')}
              >
                Limpar busca
              </Button>
            </div>
          )}
          {items.map((item, idx) => {
            const product = products.find((p: any) => p.id === item.product_id);
            const stockQty = Number(product?.quantity || 0);
            const overStock = item.quantity > stockQty;
            return (
              <div key={item._key} className="rounded-md border p-3 space-y-2 bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Item {idx + 1}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => removeItem(item._key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr] gap-2">
                  <div>
                    <Label className="text-xs">Produto *</Label>
                    <Select
                      value={item.product_id}
                      onValueChange={v => {
                        const p = products.find((pp: any) => pp.id === v);
                        updateItem(item._key, {
                          product_id: v,
                          color: item.color || (p as any)?.color || '',
                          unit_price: item.unit_price || Number(p?.unit_price || 0),
                        });
                      }}
                    >
                      <SelectTrigger className="mt-1 h-9 text-sm">
                        <SelectValue placeholder="Selecionar..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {filteredProducts.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum produto com estoque</div>
                        ) : (
                          filteredProducts.map((p: any) => (
                            <SelectItem key={p.id} value={p.id}>
                              <span>{p.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground font-mono">
                                {p.sku} · {Number(p.quantity).toLocaleString('pt-BR')} {p.unit}
                              </span>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {product && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Estoque: <span className={overStock ? 'text-destructive font-semibold' : 'text-foreground'}>{stockQty.toLocaleString('pt-BR')}</span> {product.unit}
                        {!product.ncm && <Badge variant="outline" className="ml-2 text-amber-600 border-amber-300 text-xs">Sem NCM</Badge>}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="text-xs">Cor</Label>
                    <Input
                      value={item.color}
                      onChange={e => updateItem(item._key, { color: e.target.value })}
                      placeholder="Ex: Preto"
                      className="mt-1 h-9 text-sm"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Qtd (pares) *</Label>
                    <NumberInput
                      value={item.quantity}
                      onChange={v => updateItem(item._key, { quantity: v })}
                      min={0}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Preço un. *</Label>
                    <CurrencyInput
                      value={item.unit_price}
                      onChange={v => updateItem(item._key, { unit_price: v || 0 })}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Grade (numeração:quantidade, opcional)</Label>
                  <Input
                    defaultValue={gradeToText(item.grade)}
                    onBlur={e => updateItem(item._key, { grade: parseGrade(e.target.value) })}
                    placeholder="Ex: 35:3, 36:5, 37:4, 38:3"
                    className="mt-1 h-8 text-xs font-mono"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Detalhamento informativo (vai pra "Informações Complementares" da NF). Se preenchido, soma deve bater com Qtd.
                  </p>
                </div>

                <div className="flex justify-end text-xs">
                  <span className="text-muted-foreground">
                    Subtotal: <strong className="text-foreground">
                      {(item.quantity * item.unit_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </strong>
                  </span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Observações e Resumo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Observações (vai para "Informações Complementares" da NF)</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Opcional"
              rows={2}
              className="mt-1 text-sm"
            />
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-sm">
              <span className="text-muted-foreground">Total:</span>{' '}
              <strong className="text-lg">
                {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </strong>
            </div>
            <Button onClick={handleCreateDraft} disabled={createDraft.isPending || !canCreateDraft} className="gap-2">
              {createDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Salvar rascunho
            </Button>
          </div>
          {!canCreateDraft && (
            <p className="text-xs text-muted-foreground">
              Você não tem permissão para criar o rascunho. Solicite ao administrador um papel
              Comercial, Gerência ou <code className="mx-1">nfe_operator</code>.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
