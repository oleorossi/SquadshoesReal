import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Handshake } from '@phosphor-icons/react';
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-5 w-5 text-primary" /> {isEditing ? 'Editar' : 'Novo'} Prestador
          </DialogTitle>
          <DialogDescription>Dados cadastrais e prazo de pagamento do prestador.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Nome / Razão Social *</Label>
            <Input value={value.name || ''} onChange={e => onChange(p => ({ ...p, name: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Nome Fantasia</Label>
            <Input value={value.trade_name || ''} onChange={e => onChange(p => ({ ...p, trade_name: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">CPF/CNPJ</Label>
            <Input value={value.cnpj_cpf || ''} onChange={e => onChange(p => ({ ...p, cnpj_cpf: e.target.value }))} className="h-9 font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Telefone</Label>
            <Input value={value.phone || ''} onChange={e => onChange(p => ({ ...p, phone: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">E-mail</Label>
            <Input type="email" value={value.email || ''} onChange={e => onChange(p => ({ ...p, email: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Tipo de Serviço</Label>
            <Input value={value.service_type || ''} onChange={e => onChange(p => ({ ...p, service_type: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Status</Label>
            <Select value={value.active ? 'true' : 'false'} onValueChange={v => onChange(p => ({ ...p, active: v === 'true' }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Ativo</SelectItem>
                <SelectItem value="false">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Prazo de Pagamento (dias)</Label>
            <Input
              type="number"
              value={value.payment_days ?? 15}
              onChange={e => onChange(p => ({ ...p, payment_days: Number(e.target.value) }))}
              className="h-9"
            />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Endereço</Label>
            <Input value={value.address || ''} onChange={e => onChange(p => ({ ...p, address: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Cidade</Label>
            <Input value={value.city || ''} onChange={e => onChange(p => ({ ...p, city: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">UF</Label>
            <Input value={value.state || ''} onChange={e => onChange(p => ({ ...p, state: e.target.value }))} maxLength={2} className="h-9 uppercase" />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Observações</Label>
            <Textarea value={value.notes || ''} onChange={e => onChange(p => ({ ...p, notes: e.target.value }))} rows={2} className="resize-none" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-9">Cancelar</Button>
          <Button onClick={onSave} disabled={saving} className="h-9">Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ContractorFormDialog;
