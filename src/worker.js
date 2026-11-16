// SPBIM — ponto de entrada do Worker.
// Arquivos de /public (landing page de interiores) são servidos automaticamente pela Cloudflare;
// o Worker só é chamado para o que não é arquivo estático: a API em /api/* e os endereços antigos.
import { handleApi } from './api.js';

// Páginas removidas: quem tiver um link antigo cai na landing page de interiores
const REDIRECIONAR = /^\/(index(\.html)?|admin(\.html)?|politica-privacidade(\.html)?|servicos(\/.*)?)?\/?$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, ctx);
    if (REDIRECIONAR.test(url.pathname)) return Response.redirect(new URL('/interiores' + url.search, url).href, 301);
    return env.ASSETS.fetch(request);
  },
};
