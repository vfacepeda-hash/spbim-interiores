# SPBIM — Site de Prospecção de Clientes

Landing page para captar empresas de Arquitetura, Engenharia e Construção (AEC) que usam ou querem adotar BIM, + painel de gestão (funil kanban).

## Qualificação AEC/BIM
- Segmento obrigatório: arquitetura, engenharia, construtora, incorporadora, gerenciadora ou infraestrutura (lista em `SEGMENTOS`, `server.js`)
- Maturidade BIM obrigatória: não usa / em implantação / parcial / consolidado
- Softwares usados (Revit, ArchiCAD, Navisworks, Tekla, Civil 3D...)
- O servidor recusa cadastros sem segmento AEC ou sem maturidade BIM

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
- Segmentos AEC, maturidade BIM e pontuação: `src/api.js`

## Checklist antes de divulgar
- [ ] Números reais na seção "Resultados" (estão como `XX`)
- [ ] Depoimentos reais
- [ ] WhatsApp comercial (hoje `5511900000000`)
- [ ] Link da Política de Privacidade (LGPD)
- [ ] Exportar CSV pelo painel periodicamente como backup
