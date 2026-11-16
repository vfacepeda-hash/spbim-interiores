// SPBIM — ponto de entrada do Worker.
// Arquivos de /public (site e painel) são servidos automaticamente pela Cloudflare;
// o Worker só é chamado para o que não é arquivo estático, ou seja, a API em /api/*.
import { handleApi } from './api.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
