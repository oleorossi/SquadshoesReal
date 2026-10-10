import { Input } from '@/components/ui/input';
import { DELETE_CONFIRM_WORD } from '@/lib/deleteConfirmWord';

interface DeleteConfirmWordFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter no campo — o chamador decide se a palavra confere */
  onSubmit?: () => void;
  id?: string;
  disabled?: boolean;
}

/** Campo "Pra confirmar, digite excluir" — o mesmo em toda exclusão. */
export function DeleteConfirmWordField({
  value, onChange, onSubmit, id = 'delete-confirm-word', disabled,
}: DeleteConfirmWordFieldProps) {
  return (
    <div className="space-y-2 pt-2">
      <label htmlFor={id} className="text-sm font-medium">
        Pra confirmar, digite <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{DELETE_CONFIRM_WORD}</code> abaixo:
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit?.(); } }}
        placeholder={DELETE_CONFIRM_WORD}
        autoFocus
        autoComplete="off"
        disabled={disabled}
      />
    </div>
  );
}
