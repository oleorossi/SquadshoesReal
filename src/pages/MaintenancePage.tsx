import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wrench, Plus, AlertTriangle, CheckCircle2, Clock, Settings2, History, ClipboardList, Download, FileText } from "lucide-react";
import { format, differenceInDays, isPast, isWithinInterval, startOfDay, endOfDay, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  useEquipment, useUpsertEquipment, useDeleteEquipment,
  useMaintenancePlans, useUpsertMaintenancePlan,
  useMaintenanceLogs, useCreateMaintenanceLog,
  type Equipment, type MaintenancePlan,
} from "@/hooks/useMaintenance";
import { exportCSV, exportPDF } from "@/lib/exportUtils";

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    ativo: { label: "Ativo", cls: "bg-green-500/10 text-green-600" },
    inativo: { label: "Inativo", cls: "bg-muted text-muted-foreground" },
    em_manutencao: { label: "Em Manutenção", cls: "bg-amber-500/10 text-amber-600" },
  };
  const s = map[status] || map.ativo;
  return <Badge className={s.cls}>{s.label}</Badge>;
}

function dueBadge(nextDue: string | null) {
  if (!nextDue) return <Badge variant="outline">Sem prazo</Badge>;
  const d = new Date(nextDue);
  const diff = differenceInDays(d, new Date());
  if (isPast(d)) return <Badge className="bg-red-500/10 text-red-600">Atrasado ({Math.abs(diff)}d)</Badge>;
  if (diff <= 7) return <Badge className="bg-amber-500/10 text-amber-600">Em {diff}d</Badge>;
  return <Badge className="bg-green-500/10 text-green-600">Em {diff}d</Badge>;
}

// ─── Equipment Form Dialog ───
function EquipmentFormDialog({ equipment, children }: { equipment?: Equipment; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const upsert = useUpsertEquipment();
  const [form, setForm] = useState({
    name: equipment?.name || "",
    code: equipment?.code || "",
    sector: equipment?.sector || "",
    manufacturer: equipment?.manufacturer || "",
    model: equipment?.model || "",
    serial_number: equipment?.serial_number || "",
    status: equipment?.status || "ativo",
  });

  const handleSave = () => {
    upsert.mutate({ ...form, id: equipment?.id } as any, { onSuccess: () => setOpen(false) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o && equipment) setForm({ name: equipment.name, code: equipment.code || "", sector: equipment.sector || "", manufacturer: equipment.manufacturer || "", model: equipment.model || "", serial_number: equipment.serial_number || "", status: equipment.status }); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{equipment ? "Editar" : "Novo"} Equipamento</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Código</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Setor</Label><Input value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))} /></div>
            <div><Label>Fabricante</Label><Input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Modelo</Label><Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} /></div>
            <div><Label>Nº Série</Label><Input value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} /></div>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
                <SelectItem value="em_manutencao">Em Manutenção</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={!form.name || upsert.isPending}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Plan Form Dialog ───
function PlanFormDialog({ plan, equipmentList, children }: { plan?: MaintenancePlan; equipmentList: Equipment[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const upsert = useUpsertMaintenancePlan();
  const [form, setForm] = useState({
    equipment_id: plan?.equipment_id || "",
    description: plan?.description || "",
    frequency_days: plan?.frequency_days || 30,
    responsible: plan?.responsible || "",
    is_active: plan?.is_active ?? true,
  });

  const handleSave = () => {
    upsert.mutate({ ...form, id: plan?.id } as any, { onSuccess: () => setOpen(false) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o && plan) setForm({ equipment_id: plan.equipment_id, description: plan.description, frequency_days: plan.frequency_days, responsible: plan.responsible || "", is_active: plan.is_active }); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{plan ? "Editar" : "Novo"} Plano de Manutenção</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Equipamento *</Label>
            <Select value={form.equipment_id} onValueChange={v => setForm(f => ({ ...f, equipment_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                {equipmentList.map(eq => (
                  <SelectItem key={eq.id} value={eq.id}>{eq.name} {eq.code ? `(${eq.code})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Descrição *</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Frequência (dias)</Label><Input type="number" value={form.frequency_days} onChange={e => setForm(f => ({ ...f, frequency_days: Number(e.target.value) }))} /></div>
            <div><Label>Responsável</Label><Input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} /></div>
          </div>
          <Button onClick={handleSave} disabled={!form.equipment_id || !form.description || upsert.isPending}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Log Form Dialog ───
function LogFormDialog({ equipmentList, plans, children }: { equipmentList: Equipment[]; plans: MaintenancePlan[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const create = useCreateMaintenanceLog();
  const [form, setForm] = useState({
    equipment_id: "",
    plan_id: "",
    type: "preventiva",
    description: "",
    cost: 0,
    performed_by: "",
    notes: "",
  });

  const filteredPlans = plans.filter(p => p.equipment_id === form.equipment_id);

  const handleSave = () => {
    create.mutate(
      { ...form, plan_id: form.plan_id || null, cost: form.cost || 0 } as any,
      { onSuccess: () => { setOpen(false); setForm({ equipment_id: "", plan_id: "", type: "preventiva", description: "", cost: 0, performed_by: "", notes: "" }); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar Manutenção</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Equipamento *</Label>
            <Select value={form.equipment_id} onValueChange={v => setForm(f => ({ ...f, equipment_id: v, plan_id: "" }))}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                {equipmentList.map(eq => (
                  <SelectItem key={eq.id} value={eq.id}>{eq.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filteredPlans.length > 0 && (
            <div>
              <Label>Plano (opcional)</Label>
              <Select value={form.plan_id} onValueChange={v => setForm(f => ({ ...f, plan_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Sem plano" /></SelectTrigger>
                <SelectContent>
                  {filteredPlans.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.description}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="preventiva">Preventiva</SelectItem>
                  <SelectItem value="corretiva">Corretiva</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Custo (R$)</Label><Input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: Number(e.target.value) }))} /></div>
          </div>
          <div><Label>Descrição *</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div><Label>Executado por</Label><Input value={form.performed_by} onChange={e => setForm(f => ({ ...f, performed_by: e.target.value }))} /></div>
          <Button onClick={handleSave} disabled={!form.equipment_id || !form.description || create.isPending}>Registrar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───
export default function MaintenancePage() {
  const { data: equipment = [], isLoading: loadingEq } = useEquipment();
  const { data: plans = [], isLoading: loadingPlans } = useMaintenancePlans();
  const { data: logs = [], isLoading: loadingLogs } = useMaintenanceLogs();
  const deleteEq = useDeleteEquipment();
  // Filters for Histórico
  const [dateFrom, setDateFrom] = useState(() => format(subMonths(new Date(), 3), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [typeFilter, setTypeFilter] = useState("todos");

  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      const d = new Date(l.performed_at);
      const inRange = isWithinInterval(d, { start: startOfDay(new Date(dateFrom)), end: endOfDay(new Date(dateTo)) });
      const matchType = typeFilter === "todos" || l.type === typeFilter;
      return inRange && matchType;
    });
  }, [logs, dateFrom, dateTo, typeFilter]);

  const logHeaders = ["Data", "Equipamento", "Tipo", "Descrição", "Custo (R$)", "Executor"];
  const logRows = filteredLogs.map(l => [
    format(new Date(l.performed_at), "dd/MM/yyyy", { locale: ptBR }),
    (l.equipment as any)?.name || "",
    l.type === "corretiva" ? "Corretiva" : "Preventiva",
    l.description,
    Number(l.cost).toFixed(2),
    l.performed_by || "",
  ]);

  const overdueCount = plans.filter(p => p.is_active && p.next_due_at && isPast(new Date(p.next_due_at))).length;
  const upcomingCount = plans.filter(p => p.is_active && p.next_due_at && !isPast(new Date(p.next_due_at)) && differenceInDays(new Date(p.next_due_at), new Date()) <= 7).length;

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6" /> Manutenção Preventiva
          </h1>
          <p className="text-sm text-muted-foreground">Controle de equipamentos e planos de manutenção</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 text-center">
          <Settings2 className="h-5 w-5 mx-auto text-muted-foreground" />
          <p className="text-2xl font-bold mt-1">{equipment.length}</p>
          <p className="text-xs text-muted-foreground">Equipamentos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <ClipboardList className="h-5 w-5 mx-auto text-muted-foreground" />
          <p className="text-2xl font-bold mt-1">{plans.filter(p => p.is_active).length}</p>
          <p className="text-xs text-muted-foreground">Planos Ativos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <AlertTriangle className="h-5 w-5 mx-auto text-red-500" />
          <p className="text-2xl font-bold mt-1 text-red-600">{overdueCount}</p>
          <p className="text-xs text-muted-foreground">Atrasados</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Clock className="h-5 w-5 mx-auto text-amber-500" />
          <p className="text-2xl font-bold mt-1 text-amber-600">{upcomingCount}</p>
          <p className="text-xs text-muted-foreground">Próximos 7 dias</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="equipamentos">
        <TabsList>
          <TabsTrigger value="equipamentos"><Settings2 className="h-3.5 w-3.5 mr-1" />Equipamentos</TabsTrigger>
          <TabsTrigger value="planos"><ClipboardList className="h-3.5 w-3.5 mr-1" />Planos</TabsTrigger>
          <TabsTrigger value="historico"><History className="h-3.5 w-3.5 mr-1" />Histórico</TabsTrigger>
        </TabsList>

        {/* ─── Equipamentos ─── */}
        <TabsContent value="equipamentos">
          <Card>
            <CardHeader className="flex-row items-center justify-between py-3">
              <CardTitle className="text-base">Equipamentos</CardTitle>
              <EquipmentFormDialog><Button size="sm"><Plus className="h-4 w-4 mr-1" />Novo</Button></EquipmentFormDialog>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.map(eq => (
                    <TableRow key={eq.id}>
                      <TableCell className="font-medium">{eq.name}</TableCell>
                      <TableCell>{eq.code || "—"}</TableCell>
                      <TableCell>{eq.sector || "—"}</TableCell>
                      <TableCell>{statusBadge(eq.status)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <EquipmentFormDialog equipment={eq}><Button variant="ghost" size="sm">Editar</Button></EquipmentFormDialog>
                        <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteEq.mutate(eq.id)}>Excluir</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {equipment.length === 0 && !loadingEq && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum equipamento cadastrado</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Planos ─── */}
        <TabsContent value="planos">
          <Card>
            <CardHeader className="flex-row items-center justify-between py-3">
              <CardTitle className="text-base">Planos de Manutenção</CardTitle>
              <div className="flex gap-2">
                <LogFormDialog equipmentList={equipment} plans={plans}><Button size="sm" variant="outline"><CheckCircle2 className="h-4 w-4 mr-1" />Registrar Manutenção</Button></LogFormDialog>
                <PlanFormDialog equipmentList={equipment}><Button size="sm"><Plus className="h-4 w-4 mr-1" />Novo Plano</Button></PlanFormDialog>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipamento</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Frequência</TableHead>
                    <TableHead>Próxima</TableHead>
                    <TableHead>Responsável</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map(p => (
                    <TableRow key={p.id} className={p.next_due_at && isPast(new Date(p.next_due_at)) ? "bg-red-500/5" : ""}>
                      <TableCell className="font-medium">{(p.equipment as any)?.name || "—"}</TableCell>
                      <TableCell>{p.description}</TableCell>
                      <TableCell>{p.frequency_days}d</TableCell>
                      <TableCell>{dueBadge(p.next_due_at)}</TableCell>
                      <TableCell>{p.responsible || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {plans.length === 0 && !loadingPlans && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum plano cadastrado</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Histórico ─── */}
        <TabsContent value="historico">
          <Card>
            <CardHeader className="py-3 space-y-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Histórico de Manutenções</CardTitle>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => exportCSV(logHeaders, logRows, `manutencao_${dateFrom}_${dateTo}.csv`)}>
                    <Download className="h-3.5 w-3.5 mr-1" />CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportPDF("Relatório de Manutenção", logHeaders, logRows, "manutencao.pdf")}>
                    <FileText className="h-3.5 w-3.5 mr-1" />PDF
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap items-end">
                <div>
                  <Label className="text-xs">De</Label>
                  <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 w-36 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Até</Label>
                  <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 w-36 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="preventiva">Preventiva</SelectItem>
                      <SelectItem value="corretiva">Corretiva</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span className="text-xs text-muted-foreground pb-1">{filteredLogs.length} registros</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Equipamento</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Custo</TableHead>
                    <TableHead>Executor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map(l => (
                    <TableRow key={l.id}>
                      <TableCell>{format(new Date(l.performed_at), "dd/MM/yy", { locale: ptBR })}</TableCell>
                      <TableCell className="font-medium">{(l.equipment as any)?.name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={l.type === "corretiva" ? "destructive" : "default"}>
                          {l.type === "corretiva" ? "Corretiva" : "Preventiva"}
                        </Badge>
                      </TableCell>
                      <TableCell>{l.description}</TableCell>
                      <TableCell>R$ {Number(l.cost).toFixed(2)}</TableCell>
                      <TableCell>{l.performed_by || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {filteredLogs.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma manutenção no período</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}