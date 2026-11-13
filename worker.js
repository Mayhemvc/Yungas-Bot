export default {
  async fetch(request) {
    const url = new URL(request.url);
    const scriptUrl = 'https://raw.githubusercontent.com/Mayhemvc/Yungas-Bot/main/Yungas%20-%20Auto%20Primeiro%20Contato%20Seguro.js';

    // Endpoint para o Tampermonkey baixar o script e verificar updates
    if (url.pathname === '/firstMsg.user.js' || url.pathname === '/firstMsg.meta.js' || url.pathname === '/install') {
      const res = await fetch(scriptUrl);
      const code = await res.text();
      return new Response(code, {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // Página inicial amigável com botão de instalação
    return new Response(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>Yungas Auto-Reply Bot</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; color: #f8fafc; margin: 0; }
          .card { background: #1e293b; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); text-align: center; max-width: 480px; }
          h1 { margin-top: 0; font-size: 1.5rem; color: #38bdf8; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          .btn { display: inline-block; background: #0284c7; color: white; padding: 0.8rem 1.8rem; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 1rem; }
          .btn:hover { background: #0369a1; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🤖 Yungas - Auto Primeiro Contato</h1>
          <p>Instalação oficial do script para resposta rápida de chamados no Yungas.</p>
          <a class="btn" href="/firstMsg.user.js">Instalar no Tampermonkey</a>
        </div>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};
