// Cloudflare Worker para hospedar e auto-atualizar o Userscript do Yungas
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint de metadados: o Tampermonkey consulta aqui para checar versão (leve, poucos bytes)
    if (url.pathname === '/firstMsg.meta.js') {
      return new Response(USER_SCRIPT_META, {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // Endpoint de download/instalação: entrega o código completo
    if (url.pathname === '/firstMsg.user.js' || url.pathname === '/install') {
      return new Response(USER_SCRIPT_CODE, {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // Página inicial simples com instruções e botão de instalação
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
          .btn { display: inline-block; background: #0284c7; color: white; padding: 0.8rem 1.8rem; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 1rem; transition: background 0.2s; }
          .btn:hover { background: #0369a1; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🤖 Yungas - Auto Primeiro Contato</h1>
          <p>Instalação do script oficial para resposta rápida de chamados no Yungas.</p>
          <a class="btn" href="/firstMsg.user.js">Instalar no Tampermonkey</a>
        </div>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};

// =========================================================================
// 1. APENAS OS METADADOS (O que o Tampermonkey lê para saber se mudou de versão)
// =========================================================================
const USER_SCRIPT_META = `// ==UserScript==
// @name         Yungas - Auto Primeiro Contato Seguro
// @namespace    https://app.yungas.com.br/
// @version      2.3.0
// @description  Envio automático de primeiro contato individual por operador (Seg-Sex 08h-18h | Sáb 08h-12h)
// @match        https://app.yungas.com.br/*
// @updateURL    https://raw.githubusercontent.com/Mayhemvc/Yungas-Bot/main/firstMsg.user.js
// @downloadURL  https://raw.githubusercontent.com/Mayhemvc/Yungas-Bot/main/firstMsg.user.js
// @grant        none
// ==/UserScript==
`;

// =========================================================================
// 2. O CÓDIGO COMPLETO (Seu script pronto com fuso horário do Brasil blindado)
// =========================================================================
const USER_SCRIPT_CODE = USER_SCRIPT_META + `
(function () {
    'use strict';

    console.warn('[Yungas-Bot] Script carregado e ativo no navegador!');

    const CONFIG = {
        MY_ASSIGNEE_ID: 169539, // Fallback se a auto-detecção falhar
        MIN_DELAY_SEC: 20,
        MAX_DELAY_SEC: 25,
        POLL_INTERVAL_MS: 15000,
        MAX_TICKET_AGE_MINUTES: 30,
        MAX_HISTORY_ITEMS: 500,

        DEFAULT_MESSAGE: "Olá! Recebemos sua solicitação e já estamos iniciando a análise. Em instantes retorno com mais detalhes.",

        SCHEDULE: {
            ENABLED: true,
            WEEKDAY_START: 8,  // 08:00
            WEEKDAY_END: 18,   // 18:00
            SATURDAY_START: 8, // 08:00
            SATURDAY_END: 12   // 12:00
        }
    };

    const PROCESSED_KEY='yungas...s_v2';
    const LOCK_PREFIX = 'yungas_lock_ticket_';
    const pendingTimers = new Map();
    let currentOperator = null;

    /**
     * Validação com Fuso Horário Oficial de Brasília (America/Sao_Paulo)
     */
    function isWithinWorkingHours() {
        if (!CONFIG.SCHEDULE.ENABLED) return true;

        const spDateStr = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
        const now = new Date(spDateStr);
        const dayOfWeek = now.getDay(); // 0 = Domingo, 1 = Seg, ..., 6 = Sáb
        const hour = now.getHours();

        if (dayOfWeek === 0) return false; // Domingo fechado

        if (dayOfWeek === 6) { // Sábado: 08h às 12h
            return hour >= CONFIG.SCHEDULE.SATURDAY_START && hour < CONFIG.SCHEDULE.SATURDAY_END;
        }

        if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Seg a Sex: 08h às 18h
            return hour >= CONFIG.SCHEDULE.WEEKDAY_START && hour < CONFIG.SCHEDULE.WEEKDAY_END;
        }

        return false;
    }

    async function getOperatorProfile() {
        if (currentOperator) return currentOperator;

        try {
            const res = await fetch('/api/v2/users/me', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data && data.id) {
                    currentOperator = {
                        id: Number(data.id),
                        name: data.name || 'Operador'
                    };
                    console.log('[Yungas-Bot] Operador detectado:', currentOperator.name, '#' + currentOperator.id);
                    return currentOperator;
                }
            }
        } catch (e) {
            console.warn('[Yungas-Bot] Erro ao consultar perfil /api/v2/users/me:', e);
        }

        currentOperator = { id: CONFIG.MY_ASSIGNEE_ID, name: 'Operador Padrão' };
        return currentOperator;
    }

    function getProcessedSet() {
        try {
            const raw = localStorage.getItem(PROCESSED_KEY);
            return new Set(raw ? JSON.parse(raw) : []);
        } catch {
            return new Set();
        }
    }

    function markAsProcessed(ticketId) {
        const id = Number(ticketId);
        const set = getProcessedSet();
        set.add(id);

        const trimmed = Array.from(set).slice(-CONFIG.MAX_HISTORY_ITEMS);
        localStorage.setItem(PROCESSED_KEY, JSON.stringify(trimmed));
        localStorage.removeItem(LOCK_PREFIX + id);
    }

    function acquireLock(ticketId) {
        const key = LOCK_PREFIX + ticketId;
        const existingLock = localStorage.getItem(key);
        const now = Date.now();

        if (existingLock && (now - Number(existingLock)) < 120000) {
            return false;
        }
        localStorage.setItem(key, String(now));
        return true;
    }

    function releaseLock(ticketId) {
        localStorage.removeItem(LOCK_PREFIX + ticketId);
    }

    function parseApiDate(dateStr) {
        if (!dateStr) return Date.now();
        const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
        const parsed = Date.parse(iso);
        return Number.isNaN(parsed) ? Date.now() : parsed;
    }

    async function sendFirstContact(ticketId) {
        pendingTimers.delete(ticketId);

        if (window.location.href.includes(String(ticketId))) {
            console.log('[Yungas-Bot] 🛑 Operador visualizando ticket #' + ticketId + '. Envio cancelado.');
            markAsProcessed(ticketId);
            return;
        }

        const formData = new FormData();
        formData.append('ticketId', String(ticketId));
        formData.append('msgText', '<p>' + CONFIG.DEFAULT_MESSAGE + '</p>');

        try {
            const res = await fetch('/helpdesk/new-msg', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            if (res.ok) {
                console.log('[Yungas-Bot] ✅ Resposta de primeiro contato enviada no ticket #' + ticketId);
                markAsProcessed(ticketId);
            } else {
                console.error('[Yungas-Bot] ❌ Falha HTTP ' + res.status + ' no ticket #' + ticketId);
                releaseLock(ticketId);
            }
        } catch (err) {
            console.error('[Yungas-Bot] ❌ Erro de rede no ticket #' + ticketId, err);
            releaseLock(ticketId);
        }
    }

    async function scanTickets() {
        if (!isWithinWorkingHours()) return;

        const operator = await getOperatorProfile();
        const processed = getProcessedSet();
        const listUrl = '/api/v2/ticket/list/?status=open&assignees=' + operator.id + '&mentioned=false&include_fields=markers&ordering=desc_last_message&page=1&usersPage=1';

        try {
            const res = await fetch(listUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });

            if (!res.ok) return;

            const json = await res.json();
            const ticketList = Array.isArray(json.data) ? json.data : [];
            const now = Date.now();

            for (const t of ticketList) {
                const tid = Number(t.id);
                const respId = Number(t.assignee_id || t.assignee?.id);

                const createdAt = parseApiDate(t.created_on);
                const ageMinutes = (now - createdAt) / (1000 * 60);

                const isMine = respId === operator.id;
                const isUnanswered = t.first_replied_at === null && !t.solved;
                const isRecent = ageMinutes <= CONFIG.MAX_TICKET_AGE_MINUTES;

                if (!isMine || !isUnanswered || !isRecent || processed.has(tid) || pendingTimers.has(tid)) {
                    continue;
                }

                if (!acquireLock(tid)) continue;

                const delaySec = Math.floor(Math.random() * (CONFIG.MAX_DELAY_SEC - CONFIG.MIN_DELAY_SEC + 1) + CONFIG.MIN_DELAY_SEC);
                console.log('[Yungas-Bot] 🎯 Ticket #' + tid + ' para ' + operator.name + '. Disparo em ' + delaySec + 's.');

                const timerId = setTimeout(() => sendFirstContact(tid), delaySec * 1000);
                pendingTimers.set(tid, timerId);
            }
        } catch (e) {
            console.warn('[Yungas-Bot] Erro no scan de tickets:', e);
        }
    }

    getOperatorProfile().then((op) => {
        console.log('[Yungas-Bot] Monitor v2.3 ativo para ' + op.name + ' (#' + op.id + ')');
        setInterval(scanTickets, CONFIG.POLL_INTERVAL_MS);
        setTimeout(scanTickets, 2000);
    });
})();
`;