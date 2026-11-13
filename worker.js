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

    return new Response(`
    <!DOCTYPE html>
    <html lang="pt-BR">

    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Yungas • Auto Resposta</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link
            href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap"
            rel="stylesheet">
        <style>
            :root {
                --bg: #090a0c;
                --surface: #121418;
                --text-main: #f4f4f5;
                --text-muted: #8e95a5;
                --border: rgba(255, 255, 255, 0.08);
                --ease: cubic-bezier(0.16, 1, 0.3, 1);
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                background-color: var(--bg);
                background-image: radial-gradient(circle at 50% -10%, rgba(255, 255, 255, 0.04) 0%, transparent 70%);
                color: var(--text-main);
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1.5rem;
                -webkit-font-smoothing: antialiased;
            }

            .container {
                max-width: 480px;
                width: 100%;
                text-align: center;
                padding: 3rem 2rem;
                border-radius: 24px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, rgba(255, 255, 255, 0.005) 100%);
                border: 1px solid var(--border);
                backdrop-filter: blur(12px);
                animation: containerIn 0.9s var(--ease) both;
            }

            .badge {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.35rem 0.85rem;
                border-radius: 9999px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.06);
                font-size: 0.75rem;
                font-weight: 500;
                color: var(--text-muted);
                letter-spacing: 0.04em;
                text-transform: uppercase;
                margin-bottom: 2rem;
                animation: fadeIn 0.8s var(--ease) 0.1s both;
            }

            h1 {
                font-family: 'Instrument Serif', Georgia, serif;
                font-size: clamp(2.6rem, 7vw, 3.4rem);
                font-weight: 400;
                line-height: 1.05;
                letter-spacing: -0.02em;
                color: #ffffff;
                margin-bottom: 1.1rem;
                animation: titleReveal 1s var(--ease) 0.15s both;
            }

            h1 em {
                font-style: italic;
                color: #cbd5e1;
            }

            p {
                font-size: 0.95rem;
                line-height: 1.6;
                color: var(--text-muted);
                max-width: 360px;
                margin: 0 auto 2.5rem;
                animation: fadeIn 0.8s var(--ease) 0.25s both;
            }

            .btn-wrap {
                animation: fadeIn 0.8s var(--ease) 0.35s both;
            }

            .btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.6rem;
                background: #ffffff;
                color: #090a0c;
                padding: 0.9rem 2rem;
                border-radius: 9999px;
                font-size: 0.9rem;
                font-weight: 500;
                letter-spacing: -0.01em;
                text-decoration: none;
                transition: all 0.25s var(--ease);
                box-shadow: 0 4px 20px -2px rgba(255, 255, 255, 0.15);
            }

            .btn:hover {
                background: #e4e4e7;
                transform: translateY(-2px);
                box-shadow: 0 8px 25px -2px rgba(255, 255, 255, 0.22);
            }

            .btn:active {
                transform: translateY(0);
            }

            .btn svg {
                width: 14px;
                height: 14px;
                transition: transform 0.2s var(--ease);
            }

            .btn:hover svg {
                transform: translateX(2px);
            }

            @keyframes containerIn {
                from {
                    opacity: 0;
                    transform: translateY(16px);
                }

                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @keyframes titleReveal {
                from {
                    opacity: 0;
                    transform: translateY(12px);
                }

                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(6px);
                }

                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        </style>
    </head>

    <body>
        <main class="container">
            <div class="badge">
                Yungas Helpdesk
            </div>

            <h1>Primeira mensagem, <em>imediata</em>.</h1>

            <p>
                Resposta ágil para chamados na fila, mantendo o SLA da equipe.
            </p>

            <div class="btn-wrap">
                <a class="btn" href="/firstMsg.user.js">
                    <span>Instalar no Tampermonkey</span>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                        stroke-linejoin="round">
                        <path d="M3 8h10M9 4l4 4-4 4" />
                    </svg>
                </a>
            </div>
        </main>
    </body>

    </html>
    `, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};
