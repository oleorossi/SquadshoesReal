# Deploy do projeto

Este documento explica como rodar o projeto localmente, sincronizar com o Supabase e colocar a aplicação online.

## Tudo que você precisa fazer (em ordem)

### 1. Sincronizar tudo com o Supabase

Rode este comando uma vez no Terminal do Mac:

```bash
bash ~/Downloads/setup_supabase.sh
```

Esse script:

1. Instala o Supabase CLI (via Homebrew, se ainda não estiver instalado)
2. Faz login na sua conta Supabase
3. Conecta o repo ao seu projeto (`ssvxfoybzmjlypnipqzn`)
4. Aplica as 652 migrations no banco
5. Faz deploy das 11 Edge Functions

Quando ele pedir a senha do banco, copie do dashboard: https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/settings/database

### 2. Configurar segredos das Edge Functions

Algumas functions precisam de variáveis de ambiente que NÃO estão no código. Configure no dashboard do Supabase:

https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/settings/functions

Variáveis a definir (verifique quais a sua aplicação usa):

- `GEMINI_API_KEY` - usada diretamente pelas funções `suggest-ncm`, `extract-clients`, `generate-catalog-photo` e `recolor-image`. Crie-a na sua conta Google em https://aistudio.google.com/app/apikey
- `GEMINI_IMAGE_MODEL` - opcional; modelo de imagem usado por `generate-catalog-photo` e `recolor-image` (padrão: `gemini-3.1-flash-image`)
- `SUPABASE_SERVICE_ROLE_KEY` - já é injetado automaticamente em todas as functions
- `SUPABASE_URL` - já é injetado automaticamente
- `SUPABASE_ANON_KEY` - já é injetado automaticamente
- Outras chaves usadas por `emit-nfe`, `nfe-status`, etc. (NFe, OpenAI, etc.) - depende dos seus integradores

### 3. Rodar o frontend localmente

Na primeira vez:

```bash
cd ~/Downloads/CODE
bun install        # ou: npm install
bun run dev        # ou: npm run dev
```

Abrir http://localhost:5173 no navegador. Já vai estar conectado ao seu Supabase.

### 4. Colocar online (deploy do frontend)

O Supabase **não hospeda frontend**. Pra deixar o app acessível na internet, escolha uma dessas plataformas (todas têm plano gratuito):

#### Opção A: Vercel (mais comum, recomendado)

1. Acesse https://vercel.com e faça login com GitHub
2. Clique em "Add New" → "Project"
3. Selecione o repositório `oleorossi/SquadshoesReal`
4. Em "Environment Variables" adicione:
   - `VITE_SUPABASE_URL` = `https://ssvxfoybzmjlypnipqzn.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_IByk2Kk3oIWEGCO5wAUQwQ_JLQ2zP4h`
   - `VITE_SUPABASE_PROJECT_ID` = `ssvxfoybzmjlypnipqzn`
5. Clique "Deploy"

A cada `git push origin main`, a Vercel rebuilda automaticamente.

#### Opção B: Netlify

1. Acesse https://app.netlify.com e faça login com GitHub
2. "Add new site" → "Import an existing project" → GitHub
3. Selecione `oleorossi/SquadshoesReal`
4. Build command: `bun run build` (ou `npm run build`)
5. Publish directory: `dist`
6. Adicione as mesmas variáveis de ambiente do passo Vercel

#### Opção C: Cloudflare Pages

1. https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git
2. Selecione o repo
3. Build command: `bun run build`
4. Build output: `dist`
5. Adicione as mesmas variáveis de ambiente

### 5. CORS - IMPORTANTE

Quando seu frontend estiver hospedado, precisa atualizar o **Allowed Origin** das Edge Functions pro domínio do site (ex: `https://squad-shoes.vercel.app`):

https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/settings/functions

Defina a variável `ALLOWED_ORIGIN` com a URL do seu site (sem barra no final).

## Workflow do dia a dia

### Editar código

- Abra o VS Code: `open -a "Visual Studio Code" ~/Downloads/CODE`
- Use o Claude Code dentro do VS Code pra fazer mudanças
- `bun run dev` em outro terminal pra ver as mudanças ao vivo

### Salvar mudanças no GitHub

```bash
cd ~/Downloads/CODE
git add .
git commit -m "descrição da mudança"
git push
```

A Vercel/Netlify vai fazer o redeploy automaticamente.

### Criar nova migration no Supabase

Sempre que mudar o schema do banco:

```bash
cd ~/Downloads/CODE
supabase migration new nome_da_mudanca
# edita o arquivo gerado em supabase/migrations/
supabase db push
```

### Atualizar uma Edge Function

```bash
cd ~/Downloads/CODE
# edita o arquivo supabase/functions/<nome>/index.ts
supabase functions deploy <nome> --project-ref ssvxfoybzmjlypnipqzn
```

## Links úteis

| Recurso | URL |
|---|---|
| Repositório | https://github.com/oleorossi/SquadshoesReal |
| Dashboard Supabase | https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn |
| Banco (Table Editor) | https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/editor |
| Edge Functions | https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/functions |
| Logs | https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/logs/postgres-logs |
| Auth | https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/auth/users |
