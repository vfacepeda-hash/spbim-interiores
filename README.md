# SPBIM — Site de Prospecção de Clientes

Landing page para captar empresas de Arquitetura, Engenharia e Construção (AEC) que usam ou querem adotar BIM, + painel de gestão (funil kanban).

## Qualificação AEC/BIM
- Segmento obrigatório: arquitetura, engenharia, construtora, incorporadora, gerenciadora ou infraestrutura (lista em `SEGMENTOS`, `server.js`)
- Maturidade BIM obrigatória: não usa / em implantação / parcial / consolidado
- Softwares usados (Revit, ArchiCAD, Navisworks, Tekla, Civil 3D...)
- O servidor recusa cadastros sem segmento AEC ou sem maturidade BIM

## Como rodar
```bash
npm install
ADMIN_PASSWORD="sua-senha-forte" npm start
```
- Site: http://localhost:3000
- Painel: http://localhost:3000/admin.html

## Funcionalidades
- Formulário de captura com validação, anti-spam (honeypot + limite por IP) e consentimento LGPD
- Rastreio de origem (UTM / referência)
- Lead scoring automático (e-mail corporativo, cargo, porte, prazo)
- Funil kanban: Novo → Contatado → Qualificado → Proposta → Ganho / Perdido (arrastar e soltar)
- Indicadores: total, novos na semana, conversão, valor do pipeline
- Histórico de anotações, próximo contato, atalhos de WhatsApp e e-mail
- Exportação CSV (compatível com Excel)

## Personalizar
- Textos, marca e número do WhatsApp: `public/index.html`
- Cores: variáveis no topo de `public/styles.css`
- Regras de pontuação: função `scoreLead` em `server.js`

Os dados ficam em `data/leads.json`. Para alto volume, troque por um banco (PostgreSQL/MySQL).

## Publicação (produção)

### Opção A — Render (recomendado)
1. Suba esta pasta para um repositório no GitHub.
2. No Render: **New → Blueprint** e selecione o repositório (usa o `render.yaml`).
3. Informe `ADMIN_PASSWORD` (mínimo 10 caracteres).
4. Plano **Starter** com disco persistente de 1 GB em `/var/data` (os leads não se perdem em novos deploys).
5. Em **Settings → Custom Domains** adicione, por ex., `bim.spbim.com.br` e crie o CNAME indicado no DNS do domínio. O HTTPS é automático.

### Opção B — Servidor próprio / VPS (Docker)
```bash
docker build -t spbim-prospeccao .
docker run -d -p 80:3000 -e ADMIN_PASSWORD="senha-forte-aqui" -v spbim-dados:/data --restart unless-stopped spbim-prospeccao
```

### Checklist antes de divulgar
- [ ] Números reais na seção "Resultados" (estão como `XX`)
- [ ] Depoimentos reais
- [ ] WhatsApp comercial (hoje `5511900000000`)
- [ ] Link da Política de Privacidade (LGPD)
- [ ] Backup periódico de `leads.json` (ou exportar CSV pelo painel)
