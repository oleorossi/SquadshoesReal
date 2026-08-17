import { SearchInput } from '@/components/ui/search-input';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export default function OrderSearchBar({ value, onChange, placeholder }: Props) {
  return (
    <SearchInput
      className="w-full max-w-sm"
      inputClassName="h-9 text-xs"
      value={value}
      onChange={onChange}
      placeholder={placeholder || 'Buscar por nº pedido, PV ou OP…'}
    />
  );
}
