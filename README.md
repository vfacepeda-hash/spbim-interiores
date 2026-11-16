# SPBIM — Site de Prospecção de Clientes

Landing page para captar empresas de Arquitetura, Engenharia e Construção (AEC) que usam ou querem adotar BIM, + painel de gestão (funil kanban).

## Qualificação AEC/BIM
- Segmento obrigatório: arquitetura, engenharia, construtora, incorporadora, gerenciadora ou infraestrutura (lista em `SEGMENTOS`, `server.js`)
- Maturidade BIM obrigatória: não usa / em implantação / parcial / consolidado
- Softwares usados (Revit, ArchiCAD, Navisworks, Tekla, Civil 3D...)
- O servidor recusa cadastros sem segmento AEC ou sem maturidade BIM

## Hospedagem gratuita: Cloudflare Pages + D1
Plano gratuito com uso comercial permitido, HTTPS automático e site sempre ativo (não "dorme").

### Publicar (uma vez só)
1. Crie uma conta em https://dash.cloudflare.com (gratuita).
2. **Storage & Databases → D1 → Create database** → nome `spbim-leads`.
3. **Workers & Pages → Create → Pages → Connect to Git** → escolha `spbim-prospeccao`.
   - Framework preset: **None**
   - Build command: *(deixe vazio)*
   - Build output directory: `public`
   - Clique em **Save and Deploy**.
4. No projeto criado: **Settings → Bindings → Add → D1 database**
   - Variable name: `DB` → Database: `spbim-leads` → Save.
5. **Settings → Variables and Secrets → Add** → tipo **Secret**
   - Nome: `ADMIN_PASSWORD` → valor: senha forte do painel → Save.
6. **Deployments → (último deploy) → ⋯ → Retry deployment** para aplicar os passos 4 e 5.
7. Pronto: `https://spbim-prospeccao.pages.dev` (painel em `/admin.html`).
   A tabela do banco é criada automaticamente no primeiro acesso.

### Domínio próprio (opcional)
**Custom domains → Set up a custom domain** → ex.: `bim.spbim.com.br` e crie o CNAME indicado no DNS.

Cada `git push` na branch `main` publica o site automaticamente.

### Rodar localmente
```bash
npm install
echo "ADMIN_PASSWORD=senha-local-123" > .dev.vars
npm run dev
```
Site: http://localhost:8788 · Painel: http://localhost:8788/admin.html

### Limites do plano gratuito (folgados para captação de leads)
- Pages: requisições ilimitadas ao site; 100 mil chamadas/dia à API
- D1: 5 GB de armazenamento, 5 milhões de leituras/dia

## Funcionalidades
- Formulário de captura com validação, anti-spam (honeypot + limite por IP) e consentimento LGPD
- Rastreio de origem (UTM / referência)
- Lead scoring automático (e-mail corporativo, cargo, porte, prazo)
- Funil kanban: Novo → Contatado → Qualificado → Proposta → Ganho / Perdido (arrastar e soltar)
- Indicadores: total, novos na semana, conversão, valor do pipeline
- Histórico de anotações, próximo contato, atalhos de WhatsApp e e-mail
- Exportação CSV (compatível com Excel)

## Personalizar
- Textos, marca e WhatsApp: `public/index.html`
- Cores: variáveis no topo de `public/styles.css`
- Segmentos AEC, maturidade BIM e pontuação: `functions/api/[[route]].js`

## Checklist antes de divulgar
- [ ] Números reais na seção "Resultados" (estão como `XX`)
- [ ] Depoimentos reais
- [ ] WhatsApp comercial (hoje `5511900000000`)
- [ ] Link da Política de Privacidade (LGPD)
- [ ] Exportar CSV pelo painel periodicamente como backup
