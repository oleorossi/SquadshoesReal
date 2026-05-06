import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface InlineEditProps {
  value: string | number;
  productId: string;
  column: string;
  table?: string;
}

export function InlineEdit({ value, productId, column, table = 'products' }: InlineEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [currentValue, setCurrentValue] = useState(value);
  const queryClient = useQueryClient();

  useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  const handleSave = async () => {
    if (currentValue === value) {
      setIsEditing(false);
      return;
    }

    const { error } = await supabase
      .from(table as any)
      .update({ [column]: currentValue })
      .eq('id', productId);

    if (error) {
      console.error("Error updating field:", error);
      toast.error("Erro ao salvar alteração.");
      setCurrentValue(value);
    } else {
      toast.success("Atualizado!");
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['paginated-products'] });
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <Input
        autoFocus
        value={currentValue}
        onChange={(e) => setCurrentValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        className="h-8 w-full min-w-[80px]"
      />
    );
  }

  return (
    <div 
      onClick={() => setIsEditing(true)} 
      className="cursor-pointer hover:bg-muted/70 p-1 rounded transition-colors"
    >
      {column === 'unit_price' ? `R$ ${Number(currentValue).toFixed(2)}` : currentValue}
    </div>
  );
}
