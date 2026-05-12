import { MagnifyingGlass as Search, X } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export default function OrderSearchBar({ value, onChange, placeholder }: Props) {
  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Buscar por nº pedido, PV ou OP...'}
        className="pl-8 pr-8 h-9 text-xs"
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
          onClick={() => onChange('')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
