import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CircleNotch as Loader2, ArrowRight } from '@phosphor-icons/react';
import { toast } from 'sonner';
import logoImg from '@/assets/logo-squad-shoes.jpg';

const MODULES = ['Produção', 'Estoque', 'Financeiro', 'Qualidade'];
const EYEBROW = 'text-[10px] font-semibold uppercase tracking-[0.16em]';

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
    <div className="min-h-screen flex bg-background">
      {/* ───────────── Esquerda — painel de marca editorial ───────────── */}
      <div className="hidden lg:flex lg:w-[48%] relative overflow-hidden bg-sidebar text-white flex-col justify-between p-12 xl:p-16">
        {/* fio vermelho no topo */}
        <div className="absolute top-0 inset-x-0 h-1 bg-primary z-20" />
        {/* textura dot-grid */}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(hsl(0 0% 100% / 0.06) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        />
        {/* glow vermelho */}
        <div
          className="absolute -top-1/4 -right-1/3 w-[640px] h-[640px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.20), transparent 62%)' }}
        />

        {/* topo — logo + eyebrow */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg overflow-hidden bg-card ring-1 ring-white/15">
            <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
          </div>
          <span className={`${EYEBROW} text-white/45`}>Gestão Industrial</span>
        </div>

        {/* centro — wordmark Anton */}
        <div className="relative z-10">
          <h1 className="display text-white" style={{ fontSize: 'clamp(3.5rem, 7vw, 5.5rem)', lineHeight: 0.84 }}>
            Squad<br /><span className="text-primary">Shoes</span>
          </h1>
          <p className="mt-7 text-white/55 text-[15px] leading-relaxed max-w-sm">
            Sistema de gestão industrial completo para a sua fábrica de calçados — produção, estoque,
            financeiro e qualidade num só lugar.
          </p>
        </div>

        {/* base — módulos numerados */}
        <div className="relative z-10 grid grid-cols-2 gap-x-10 gap-y-4 max-w-md">
          {MODULES.map((m, i) => (
            <div key={m} className="flex items-baseline gap-3 border-t border-white/10 pt-2.5">
              <span className="mono text-primary text-xs">{String(i + 1).padStart(2, '0')}</span>
              <span className="text-white/85 text-sm font-medium tracking-wide">{m}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ───────────── Direita — formulário ───────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 relative">
        <span className="mono hidden lg:block absolute top-6 right-7 text-[11px] text-muted-foreground/50">v.2026</span>

        <div className="w-full max-w-sm space-y-9">
          {/* logo mobile */}
          <div className="lg:hidden flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl overflow-hidden ring-1 ring-primary/20 bg-card">
              <img src={logoImg} alt="Squad Shoes" className="h-full w-full object-contain" />
            </div>
            <span className="display text-foreground text-2xl">Squad Shoes</span>
          </div>

          <div className="space-y-3">
            <span className={`${EYEBROW} text-primary block`}>Acesso ao sistema</span>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">Bem-vindo de volta</h2>
            <div className="h-0.5 w-10 bg-primary" />
            <p className="text-muted-foreground text-sm">Entre na sua conta para continuar.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className={`${EYEBROW} text-muted-foreground`}>E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className={`${EYEBROW} text-muted-foreground`}>Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-11"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="group w-full h-12 font-bold text-sm gap-2 mt-1 transition-transform hover:-translate-y-0.5"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>Entrar <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></>
              )}
            </Button>
          </form>

          <p className="mono text-[11px] text-muted-foreground/70">
            Squad Shoes © {new Date().getFullYear()} — Gestão Industrial
          </p>
        </div>
      </div>
    </div>
  );
}
