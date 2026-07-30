import { useState } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Plus, PencilSimple as Pencil, Trash as Trash2, Bank as Landmark, Buildings as Building2, Wallet } from '@phosphor-icons/react';
import {
  useChartOfAccounts, useCreateChartAccount, useUpdateChartAccount, useDeleteChartAccount,
  useCostCenters, useCreateCostCenter, useUpdateCostCenter, useDeleteCostCenter,
  useBankAccounts, useCreateBankAccount, useUpdateBankAccount,
} from '@/hooks/useFinanceAdvanced';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function FinanceConfigPanel() {
  // Painel renderizado DENTRO de um hub que já é dono de `tab` — usa `subtab`
  // pra não disputar o mesmo parâmetro com a tela hospedeira.
  const { value: abaUrl, setValue: setAbaUrl } = useUrlTabState({
    values: ['banks', 'chart', 'centers'] as const,
    defaultValue: 'banks',
    param: 'subtab',
  });
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Configurações Financeiras</h3>
        <p className="text-xs text-muted-foreground">Cadastros base: plano de contas, centros de custo e bancos</p>
      </div>
      <Tabs value={abaUrl} onValueChange={setAbaUrl}>
        <TabsList>
          <TabsTrigger value="banks" className="gap-1.5"><Wallet className="h-3.5 w-3.5" /> Bancos</TabsTrigger>
          <TabsTrigger value="chart" className="gap-1.5"><Landmark className="h-3.5 w-3.5" /> Plano de Contas</TabsTrigger>
          <TabsTrigger value="centers" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Centros de Custo</TabsTrigger>
        </TabsList>

        <TabsContent value="banks" className="mt-4"><BanksTab /></TabsContent>
        <TabsContent value="chart" className="mt-4"><ChartOfAccountsTab /></TabsContent>
        <TabsContent value="centers" className="mt-4"><CostCentersTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function BanksTab() {
  const { data: banks = [], isLoading } = useBankAccounts();
  const create = useCreateBankAccount();
  const update = useUpdateBankAccount();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    name: '', bank_name: '', account_number: '', agency: '',
    account_type: 'corrente', initial_balance: 0, current_balance: 0, active: true,
  });

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', bank_name: '', account_number: '', agency: '', account_type: 'corrente', initial_balance: 0, current_balance: 0, active: true });
    setOpen(true);
  };
  const openEdit = (b: any) => {
    setEditing(b);
    setForm({
      name: b.name || '', bank_name: b.bank_name || '', account_number: b.account_number || '',
      agency: b.agency || '', account_type: b.account_type || 'corrente',
      initial_balance: b.initial_balance || 0, current_balance: b.current_balance || 0, active: b.active,
    });
    setOpen(true);
  };
  const handleSave = () => {
    if (editing) update.mutate({ id: editing.id, ...form });
    else create.mutate(form);
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Contas Bancárias</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nova Conta</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Banco</TableHead>
              <TableHead>Agência/Conta</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Saldo Atual</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Carregando...</TableCell></TableRow>
            ) : banks.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Nenhuma conta cadastrada</TableCell></TableRow>
            ) : banks.map((b: any) => (
              <TableRow key={b.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openEdit(b)}>
                <TableCell className="font-medium">{b.name}</TableCell>
                <TableCell>{b.bank_name}</TableCell>
                <TableCell className="text-xs font-mono">{b.agency || '—'} / {b.account_number || '—'}</TableCell>
                <TableCell><Badge variant="outline">{b.account_type}</Badge></TableCell>
                <TableCell className={`text-right font-mono font-bold ${b.current_balance >= 0 ? 'text-success' : 'text-destructive'}`}>{fmt(b.current_balance)}</TableCell>
                <TableCell>
                  <Badge variant={b.active ? 'default' : 'secondary'}>{b.active ? 'Ativa' : 'Inativa'}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(b); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? 'Editar' : 'Nova'} Conta Bancária</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Nome (apelido)</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label>Banco</Label><Input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} /></div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.account_type} onValueChange={v => setForm(f => ({ ...f, account_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corrente">Conta Corrente</SelectItem>
                    <SelectItem value="poupanca">Poupança</SelectItem>
                    <SelectItem value="caixa">Caixa</SelectItem>
                    <SelectItem value="investimento">Investimento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Agência</Label><Input value={form.agency} onChange={e => setForm(f => ({ ...f, agency: e.target.value }))} /></div>
              <div><Label>Conta</Label><Input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} /></div>
              <div><Label>Saldo Inicial</Label><CurrencyInput value={form.initial_balance} onChange={v => setForm(f => ({ ...f, initial_balance: v, current_balance: editing ? f.current_balance : v }))} /></div>
              <div><Label>Saldo Atual</Label><CurrencyInput value={form.current_balance} onChange={v => setForm(f => ({ ...f, current_balance: v }))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function ChartOfAccountsTab() {
  const { data: accounts = [], isLoading } = useChartOfAccounts();
  const create = useCreateChartAccount();
  const update = useUpdateChartAccount();
  const del = useDeleteChartAccount();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ code: '', name: '', type: 'despesa', level: 1, active: true });

  const openNew = () => {
    setEditing(null);
    setForm({ code: '', name: '', type: 'despesa', level: 1, active: true });
    setOpen(true);
  };
  const openEdit = (a: any) => {
    setEditing(a);
    setForm({ code: a.code || '', name: a.name || '', type: a.type || 'despesa', level: a.level || 1, active: a.active });
    setOpen(true);
  };
  const handleSave = () => {
    if (editing) update.mutate({ id: editing.id, ...form });
    else create.mutate(form);
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Plano de Contas</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nova Conta</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Nível</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Carregando...</TableCell></TableRow>
            ) : accounts.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nenhuma conta cadastrada</TableCell></TableRow>
            ) : accounts.map((a: any) => (
              <TableRow key={a.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openEdit(a)}>
                <TableCell className="font-mono text-xs">{a.code}</TableCell>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell><Badge variant="outline">{a.type}</Badge></TableCell>
                <TableCell>{a.level}</TableCell>
                <TableCell>
                  <Badge variant={a.active ? 'default' : 'secondary'}>{a.active ? 'Ativa' : 'Inativa'}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(a); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => e.stopPropagation()}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Excluir conta?</AlertDialogTitle></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => del.mutate(a.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? 'Editar' : 'Nova'} Conta</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Código</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receita">Receita</SelectItem>
                    <SelectItem value="despesa">Despesa</SelectItem>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="passivo">Passivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label>Nome</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label>Nível</Label><Input type="number" min={1} max={5} value={form.level} onChange={e => setForm(f => ({ ...f, level: +e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function CostCentersTab() {
  const { data: centers = [], isLoading } = useCostCenters();
  const create = useCreateCostCenter();
  const update = useUpdateCostCenter();
  const del = useDeleteCostCenter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ code: '', name: '', type: 'operacional', description: '', active: true });

  const openNew = () => {
    setEditing(null);
    setForm({ code: '', name: '', type: 'operacional', description: '', active: true });
    setOpen(true);
  };
  const openEdit = (c: any) => {
    setEditing(c);
    setForm({ code: c.code || '', name: c.name || '', type: c.type || 'operacional', description: c.description || '', active: c.active });
    setOpen(true);
  };
  const handleSave = () => {
    if (editing) update.mutate({ id: editing.id, ...form });
    else create.mutate(form);
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Centros de Custo</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Novo Centro</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Carregando...</TableCell></TableRow>
            ) : centers.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhum centro cadastrado</TableCell></TableRow>
            ) : centers.map((c: any) => (
              <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openEdit(c)}>
                <TableCell className="font-mono text-xs">{c.code}</TableCell>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="outline">{c.type}</Badge></TableCell>
                <TableCell>
                  <Badge variant={c.active ? 'default' : 'secondary'}>{c.active ? 'Ativo' : 'Inativo'}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(c); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => e.stopPropagation()}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Excluir centro?</AlertDialogTitle></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => del.mutate(c.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? 'Editar' : 'Novo'} Centro de Custo</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Código</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operacional">Operacional</SelectItem>
                    <SelectItem value="administrativo">Administrativo</SelectItem>
                    <SelectItem value="comercial">Comercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label>Nome</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="col-span-2"><Label>Descrição</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
