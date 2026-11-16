# SPBIM — Landing page de diagnóstico para escritórios de interiores

- **`/interiores`**: landing page com formulário em 2 etapas e aviso de privacidade (LGPD) na própria página.
  A raiz `/` e os endereços antigos (`/admin`, `/servicos/...`, `/politica-privacidade`) redirecionam para ela.
- **API** (`src/api.js`): recebe o formulário, grava o lead no banco D1 e avisa a equipe no Telegram.

Hospedagem gratuita na Cloudflare (Workers + D1): uso comercial permitido, HTTPS automático e site sempre ativo.
Toda a configuração fica em `wrangler.jsonc`; cada `git push` na `main` publica sozinho.

## Aviso de lead novo no Telegram (essencial: é assim que a equipe fica sabendo)
1. No Telegram, fale com **@BotFather** → `/newbot` → escolha um nome. Ele envia o **token** do robô.
2. Crie um grupo (ex.: "Leads SPBIM"), adicione a equipe e o robô.
3. Envie qualquer mensagem no grupo e abra `https://api.telegram.org/bot<TOKEN>/getUpdates` no navegador:
   o número em `"chat":{"id":-100...}` é o **chat ID**.
4. Na Cloudflare, no Worker `spbim-prospeccao` → **Configurações → Variáveis e segredos** (fora da parte de build),
   adicione dois **Segredos**: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` → Implantar.

Cada pedido chega no grupo com nome, escritório, tipo e fase do projeto, contato e um link para responder no WhatsApp.

## Ver todos os leads (sem painel)
Na Cloudflare: **Armazenamento e bancos de dados → D1 → `spbim-leads` → Console**, e execute:

```sql
SELECT criado_em,
       json_extract(data, '$.nome')     AS nome,
       json_extract(data, '$.empresa')  AS escritorio,
       json_extract(data, '$.telefone') AS whatsapp,
       email,
       json_extract(data, '$.mensagem') AS projeto,
       json_extract(data, '$.origem')   AS origem
FROM leads
ORDER BY criado_em DESC;
```

Para excluir um lead a pedido do titular (LGPD): `DELETE FROM leads WHERE email = 'email@do.lead';`

## Publicar do zero (se precisar recriar)
1. **Armazenamento e bancos de dados → D1 → Criar banco de dados** → `spbim-leads`; cole o ID em `wrangler.jsonc` (`database_id`).
2. **Trabalhadores e Páginas → Criar → Importar repositório** → `spbim-prospeccao` (comando de implantação: `npx wrangler deploy`).
3. Configure os segredos do Telegram (acima).

### Domínio próprio
No Worker: **Configurações → Domínios e rotas → Adicionar → Domínio personalizado** → ex.: `bim.spbim.com.br`
(o `spbim.com.br` já usa o DNS da Cloudflare). Depois, atualize os endereços em `public/interiores.html`
(canonical e og:url), `public/sitemap.xml` e `public/robots.txt`.

## Rodar localmente
```bash
npm install
npm run dev
```
Landing page: http://localhost:8788/interiores

## Personalizar
- Textos, promessa, cores e WhatsApp: `public/interiores.html`

## Antes de divulgar
- [ ] Confirmar os compromissos da promessa: prazo de 5 dias úteis, reunião de 30 minutos e sigilo dos arquivos
- [ ] Configurar o aviso de lead novo no Telegram
