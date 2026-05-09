import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import logoImg from '@/assets/logo-squad-shoes.jpg';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success('Login realizado com sucesso!');
      navigate('/');
    } catch (err: any) {
      toast.error(err.message || 'Erro na autenticação');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding (handoff Novidade: preto editorial + acento vermelho Squad) */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden items-center justify-center bg-sidebar-background">
        {/* slash decorativo no topo */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-transparent z-20" />
        {/* Decorative circles */}
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-card/5" />
        <div className="absolute bottom-[-15%] left-[-8%] w-[400px] h-[400px] rounded-full bg-card/5" />
        <div className="absolute top-[40%] left-[20%] w-[200px] h-[200px] rounded-full bg-card/5" />

        <div className="relative z-10 text-center px-12 space-y-8">
          <div className="mx-auto w-28 h-28 rounded-2xl overflow-hidden ring-4 ring-white/20 bg-card"
            style={{ boxShadow: '0 20px 40px -10px rgba(0,0,0,0.3)' }}>
            <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
          </div>
          <div>
            <h1 className="text-4xl font-extrabold text-white tracking-tight">Squad Shoes</h1>
            <p className="text-white/70 text-lg mt-3 font-medium max-w-md mx-auto leading-relaxed">
              Sistema de Gestão Industrial completo para sua fábrica de calçados.
            </p>
          </div>
          <div className="flex items-center justify-center gap-6 text-white/50 text-xs font-medium">
            <span>Produção</span>
            <div className="w-1 h-1 rounded-full bg-card/30" />
            <span>Estoque</span>
            <div className="w-1 h-1 rounded-full bg-card/30" />
            <span>Financeiro</span>
            <div className="w-1 h-1 rounded-full bg-card/30" />
            <span>Qualidade</span>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center space-y-3">
            <div className="mx-auto w-16 h-16 rounded-xl overflow-hidden ring-2 ring-primary/20 bg-card"
              style={{ boxShadow: '0 8px 20px -6px rgba(0,0,0,0.15)' }}>
              <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
            </div>
            <h1 className="text-2xl font-extrabold text-foreground">Squad Shoes</h1>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground tracking-tight">Bem-vindo de volta</h2>
            <p className="text-muted-foreground text-sm">Entre na sua conta para acessar o sistema</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 bg-muted/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-semibold">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-11 bg-muted/50"
              />
            </div>
            <Button type="submit" className="w-full h-11 font-bold text-sm gap-2" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Entrar <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Squad Shoes &copy; {new Date().getFullYear()} — Gestão Industrial
          </p>
        </div>
      </div>
    </div>
  );
}
