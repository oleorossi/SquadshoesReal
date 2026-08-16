import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Buildings, CheckCircle, CircleNotch as Loader2, Clock, Handshake, MapPin } from '@phosphor-icons/react';
import type { Contractor } from '@/hooks/useContractors';

/** Formulário vazio de prestador — mora aqui porque é o valor inicial DESTE form. */
export const emptyContractor: Partial<Contractor> = {
  name: '', trade_name: '', cnpj_cpf: '', phone: '', email: '', address: '',
  city: '', state: '', service_type: '', notes: '', active: true, payment_days: 15,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Partial<Contractor>;
  onChange: React.Dispatch<React.SetStateAction<Partial<Contractor>>>;
  isEditing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: () => void;
  saving: boolean;
}

/**
 * Cadastro de prestador — dados e prazo de pagamento.
 *
 * Extraído de `src/pages/Contractors.tsx` em 10/08/2026. A página tem ~3.100
 * linhas e ZERO componentes internos: tudo é JSX inline numa função só, com
 * ~40 `useState` no mesmo escopo.
 *
 * ⚠ Este diálogo veio porque a fronteira dele é sã: 8 props. Medido no mesmo
 * dia, os outros blocos da página exigiriam **34 a 55 props** cada — um
 * componente de 40 props é pior que o monólito (ilegível, intestável, e com o
 * TS loose do projeto uma prop trocada por outra do mesmo tipo passa em
 * silêncio). Quebrar o resto exige primeiro extrair o estado da página para um
 * hook; é decisão de fronteira, não de recorte.
 */
export function ContractorFormDialog({
  open, onOpenChange, value, onChange, isEditing, onEditingChange, onSave, saving,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) { onChange({ ...emptyContractor }); onEditingChange(false); }
      }}
    >
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-5 pb-4 pt-5 pr-14 sm:px-6 sm:pt-6">
          <p className="eyebrow">TERCEIRIZAÇÃO · FICHA DO PRESTADOR</p>
          <DialogTitle>{isEditing ? 'Editar prestador' : 'Novo prestador'}</DialogTitle>
          <DialogDescription>Identificação, contato, capacidade contratada e condição de pagamento.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <div className="section-label flex items-center gap-2 border-b border-border pb-2 sm:col-span-2"><Buildings className="h-3.5 w-3.5" /> 01 · Identificação</div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nome / razão social *</Label>
            <Input value={value.name || ''} onChange={e => onChange(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Nome fantasia</Label>
            <Input value={value.trade_name || ''} onChange={e => onChange(p => ({ ...p, trade_name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>CPF/CNPJ</Label>
            <Input value={value.cnpj_cpf || ''} onChange={e => onChange(p => ({ ...p, cnpj_cpf: e.target.value }))} className="font-mono text-sm" />
          </div>

          <div className="section-label mt-2 flex items-center gap-2 border-b border-border pb-2 sm:col-span-2"><MapPin className="h-3.5 w-3.5" /> 02 · Contato e localização</div>
          <div className="space-y-1.5">
            <Label>Telefone</Label>
            <Input value={value.phone || ''} onChange={e => onChange(p => ({ ...p, phone: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input type="email" value={value.email || ''} onChange={e => onChange(p => ({ ...p, email: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Endereço</Label>
            <Input value={value.address || ''} onChange={e => onChange(p => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Cidade</Label>
            <Input value={value.city || ''} onChange={e => onChange(p => ({ ...p, city: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>UF</Label>
            <Input value={value.state || ''} onChange={e => onChange(p => ({ ...p, state: e.target.value }))} maxLength={2} className="uppercase" />
          </div>

          <div className="section-label mt-2 flex items-center gap-2 border-b border-border pb-2 sm:col-span-2"><Handshake className="h-3.5 w-3.5" /> 03 · Operação e pagamento</div>
          <div className="space-y-1.5">
            <Label>Tipo de serviço</Label>
            <Input value={value.service_type || ''} onChange={e => onChange(p => ({ ...p, service_type: e.target.value }))} placeholder="Ex.: Costura, corte, bordado" />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Prazo de pagamento</Label>
            <div className="relative">
              <Input
                type="number"
                min={0}
                value={value.payment_days ?? 15}
                onChange={e => onChange(p => ({ ...p, payment_days: Number(e.target.value) }))}
                className="pr-12 font-mono"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">dias</span>
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Situação do cadastro</Label>
            <Select value={value.active ? 'true' : 'false'} onValueChange={v => onChange(p => ({ ...p, active: v === 'true' }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Ativo — disponível para novas OS</SelectItem>
                <SelectItem value="false">Inativo — somente histórico</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Inativar preserva OS, tarifas e pagamentos anteriores.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea value={value.notes || ''} onChange={e => onChange(p => ({ ...p, notes: e.target.value }))} rows={3} className="resize-none" />
          </div>

          {value.active && value.name && (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-success sm:col-span-2">
              <CheckCircle className="h-4 w-4 shrink-0" weight="fill" /> O prestador ficará disponível para planejamento e emissão de OS.
            </div>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 gap-2 border-t border-border bg-background px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSave} disabled={saving || !value.name?.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar prestador
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ContractorFormDialog;
