import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Edge function exige Authorization: Bearer <jwt>. Antes contava só com
      // o auto-injection de supabase.functions.invoke, que falhava em sessões
      // recém-recarregadas (token ainda não propagado) — gerava 401 "Não
      // autorizado". Passa o token explicitamente pra eliminar a flakiness.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');
      const res = await supabase.functions.invoke('create-user', {
        body: { email, password, full_name: fullName },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      // Ordem importa: res.data.error tem a mensagem específica do servidor
      // ("Senha deve ter ao menos 8 caracteres", "Email already exists", etc).
      // res.error.message do supabase-js é só "Edge Function returned a non-2xx
      // status code" (genérico). Checa o específico ANTES — sem isso o user
      // via mensagem genérica e não sabia o que estava errado.
      if (res.data?.error) throw new Error(res.data.error);
      if (res.error) throw new Error(res.error.message);

      toast.success('Usuário criado com sucesso!');
      qc.invalidateQueries({ queryKey: ['profiles'] });
      setEmail('');
      setPassword('');
      setFullName('');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar usuário');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Criar Novo Usuário</DialogTitle>
          <DialogDescription>Preencha os dados para criar uma nova conta de acesso ao sistema.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="create-name">Nome completo</Label>
            <Input
              id="create-name"
              placeholder="Nome do usuário"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-email">E-mail</Label>
            <Input
              id="create-email"
              type="email"
              placeholder="usuario@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-password">Senha</Label>
            <Input
              id="create-password"
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar Usuário
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
