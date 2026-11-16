# SPBIM — Landing page de diagnóstico para escritórios de interiores

- **`/interiores`** — landing page com formulário em 2 etapas e aviso de privacidade (LGPD) na própria página.
  A raiz `/` e os endereços antigos (`/servicos/...`, `/politica-privacidade`) redirecionam para ela.
- **`/admin`** — painel da equipe: funil de leads, login individual, origem dos leads e exportação CSV.
- **API** em `src/api.js` (Cloudflare Workers + banco D1) e aviso de lead novo no Telegram (opcional).

## Hospedagem gratuita: Cloudflare Workers + D1
Plano gratuito com uso comercial permitido, HTTPS automático e site sempre ativo (não "dorme").
Toda a configuração fica em `wrangler.jsonc`; cada `git push` na `main` publica sozinho.

### Publicar (uma vez só)
1. **Armazenamento e bancos de dados → D1 → Criar banco de dados** → nome `spbim-leads`.
   Copie o **ID do banco** e cole em `wrangler.jsonc` no campo `database_id`.
2. **Trabalhadores e Páginas → Criar → Importar repositório** → `spbim-prospeccao`
   (nome do projeto: `spbim-prospeccao`; comando de implantação: `npx wrangler deploy`).
3. No projeto: **Configurações → Variáveis e segredos → Adicionar → Segredo**
   → nome `ADMIN_PASSWORD`, valor: senha forte do painel.
4. Pronto: `https://spbim-prospeccao.<sua-conta>.workers.dev` (painel em `/admin`).
   A tabela do banco é criada automaticamente no primeiro acesso.

### Acesso ao painel (login individual)
- **Primeiro acesso:** em `/admin`, deixe o e-mail em branco e use a **senha mestra** (segredo `ADMIN_PASSWORD`).
- Em **Equipe**, cadastre cada pessoa (nome, e-mail, senha inicial, acesso *Comercial* ou *Administrador*).
- Cada alteração e anotação fica registrada com o nome de quem fez. Pessoa desativada sai do painel na hora.
- A senha mestra fica guardada para recuperação; troque-a na Cloudflare se alguém da equipe a conhecer e sair da empresa.

### Aviso de lead novo no Telegram (opcional, gratuito)
1. No Telegram, fale com **@BotFather** → `/newbot` → escolha um nome. Ele envia o **token** do robô.
2. Crie um grupo (ex.: "Leads SPBIM"), adicione a equipe e o robô.
3. Envie qualquer mensagem no grupo e abra `https://api.telegram.org/bot<TOKEN>/getUpdates` no navegador:
   o número em `"chat":{"id":-100...}` é o **chat ID**.
4. Na Cloudflare, em **Configurações → Variáveis e segredos** (fora da parte de build), adicione dois **Segredos**:
   `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` → Implantar.

### Domínio próprio (opcional)
**Configurações → Domínios e rotas → Adicionar → Domínio personalizado** → ex.: `bim.spbim.com.br` e crie o CNAME indicado no DNS.

Cada `git push` na branch `main` publica o site automaticamente.

### Rodar localmente
```bash
npm install
echo "ADMIN_PASSWORD=senha-local-123" > .dev.vars
npm run dev
```
Site: http://localhost:8788 · Painel: http://localhost:8788/admin

### Limites do plano gratuito (folgados para captação de leads)
- Workers: arquivos do site ilimitados; 100 mil chamadas/dia à API
- D1: 5 GB de armazenamento, 5 milhões de leituras/dia


## Personalizar
- Textos, promessa e WhatsApp: `public/interiores.html`
- Cores da landing page: variáveis no topo de `public/interiores.html` (o painel usa `public/styles.css`)
- Segmentos AEC, maturidade BIM e pontuação: `src/api.js`

## Antes de divulgar
- [ ] Confirmar os compromissos da promessa: prazo de 5 dias úteis, reunião de 30 minutos e sigilo dos arquivos
- [ ] Configurar o aviso de lead novo no Telegram
- [ ] Exportar o CSV pelo painel periodicamente como backup
