// ==UserScript==
// @name         Yungas - Auto Primeiro Contato Seguro
// @namespace    https://app.yungas.com.br/
// @version      2.4.0
// @description  Envio automático de primeiro contato e régua de inatividade por marcadores (Seg-Sex 08h-18h | Sáb 08h-12h)
// @match        https://app.yungas.com.br/*
// @updateURL    https://yungas-bot.brunoa2ccount.workers.dev/firstMsg.meta.js
// @downloadURL  https://yungas-bot.brunoa2ccount.workers.dev/firstMsg.user.js
// @grant        none
// ==/UserScript==

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

        INACTIVITY_MARKER_ID: null, // Preencher com o ID numérico do marcador
        INACTIVITY_INTERVAL_MINUTES: 15,
        INACTIVITY_MAX_ATTEMPTS: 4,

        INACTIVITY_MESSAGE: "Oi! Tudo bem por aí? Nossa conversa ficou em silêncio, só queria checar se você ainda precisa de ajuda.",

        SCHEDULE: {
            ENABLED: true,
            WEEKDAY_START: 8,  // 08:00
            WEEKDAY_END: 18,   // 18:00
            SATURDAY_START: 8, // 08:00
            SATURDAY_END: 12   // 12:00
        }
    };

    const PROCESSED_KEY='yungas_processed_tickets_v2';
    const FOLLOWUP_TRACKER_KEY = 'yungas_inactivity_v1';
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

    /**
     * Estrutura interna: { [ticketId]: { attempts: number, lastSentAt: number } }
     */
    function getFollowupTracker() {
        try {
            const raw = localStorage.getItem(FOLLOWUP_TRACKER_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    /**
     * Persiste o estado atualizado dos tickets sob régua de inatividade
     */
    function saveFollowupTracker(tracker) {
        localStorage.setItem(FOLLOWUP_TRACKER_KEY, JSON.stringify(tracker));
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

                await markUnread(ticketId);
            } else {
                console.error('[Yungas-Bot] ❌ Falha HTTP ' + res.status + ' no ticket #' + ticketId);
                releaseLock(ticketId);
            }
        } catch (err) {
            console.error('[Yungas-Bot] ❌ Erro de rede no ticket #' + ticketId, err);
            releaseLock(ticketId);
        }
    }

    async function markUnread(ticketId) {
        const url = `/api/v2/ticket/non-read/${ticketId}`;

        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            })

            if (res.ok) {
                console.log('[Yungas-Bot] Ticket #' + ticketId + ' marcado como não lido.');
            }
        } catch (err) {
            console.error('[Yungas-Bot] Erro ao marcar o ticket #' + ticketId + ' como não lido:', err);
        }
    } 

    /**
     * Rota descoberta via Burp Suite: DELETE /api/v2/ticket/{id}/marks
     */
    async function removeTicketMarks(ticketId) {
        try {
            const res = await fetch(`/api/v2/ticket/${ticketId}/marks`, {
                method: 'DELETE',
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });
            if (res.ok) {
                console.log(`[Yungas-Bot] Marcador removido com sucesso do ticket #${ticketId}.`);
                return true;
            }
        } catch (err) {
            console.error(`[Yungas-Bot] Erro ao remover marcador do ticket #${ticketId}:`, err);
        }
        return false;
    }

    /**
     * Dispara a mensagem de inatividade e gerencia o ciclo do marcador
     * - Checa se o operador está na tela do ticket
     * - Dispara POST /helpdesk/new-msg com mensagem padrão
     * - Incrementa contagem e atualiza timestamp no storage
     * - Marca como não lido para atenção do operador
     * - Ao atingir o 4º envio (CONFIG.INACTIVITY_MAX_ATTEMPTS), remove o marcador
     */
    async function sendInactivityReminder(ticketId, currentAttempts) {
        if (window.location.href.includes(String(ticketId))) {
            console.log(`[Yungas-Bot] 🛑 Operador em tela no ticket #${ticketId}. Envio de inatividade suspenso.`);
            releaseLock(ticketId);
            return;
        }

        const formData = new FormData();
        formData.append('ticketId', String(ticketId));
        formData.append('msgText', `<p>${CONFIG.INACTIVITY_MESSAGE}</p>`);

        try {
            const res = await fetch('/helpdesk/new-msg', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            if (res.ok) {
                const nextAttempts = currentAttempts + 1;
                console.log(`[Yungas-Bot] Lembrete de inatividade (${nextAttempts}/${CONFIG.INACTIVITY_MAX_ATTEMPTS}) enviado no ticket #${ticketId}.`);

                const tracker = getFollowupTracker();
                tracker[ticketId] = {
                    attempts: nextAttempts,
                    lastSentAt: Date.now()
                };
                saveFollowupTracker(tracker);

                // Marca como não lido para alertar o operador
                await markUnread(ticketId);

                // Se completou o 4 disparo, remove o marcador e encerra o ciclo de inatividade
                if (nextAttempts >= CONFIG.INACTIVITY_MAX_ATTEMPTS) {
                    console.log(`[Yungas-Bot] 🛑 Limite de ${CONFIG.INACTIVITY_MAX_ATTEMPTS} envios atingido no ticket #${ticketId}. Removendo marcador.`);
                    await removeTicketMarks(ticketId);
                    delete tracker[ticketId];
                    saveFollowupTracker(tracker);
                }
            } else {
                console.error(`[Yungas-Bot] ❌ Erro HTTP ${res.status} no lembrete de inatividade do ticket #${ticketId}`);
            }
        } catch (err) {
            console.error(`[Yungas-Bot] ❌ Erro de rede no lembrete do ticket #${ticketId}:`, err);
        } finally {
            releaseLock(ticketId);
        }
    } 

    async function scanTickets() {
        if (!isWithinWorkingHours()) return;

        const operator = await getOperatorProfile();
        const processed = getProcessedSet();
        const followupTracker = getFollowupTracker();
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
            const activeTicketIds = new Set();
            const now = Date.now(); // Tempo em milissegundos

            for (const t of ticketList) {
                const tid = Number(t.id);
                activeTicketIds.add(tid);

                const respId = Number(t.assignee_id || t.assignee?.id);
                const isMine = respId === operator.id;

                if (!isMine) continue;

                // 1. PRIMEIRO CONTATO AUTOMATICO
                const createdAt = parseApiDate(t.created_on);
                const ageMinutes = (now - createdAt) / (1000 * 60); // Gera o tempo do ticket em minutos

                const isUnanswered = t.first_replied_at === null && !t.solved; 
                const isRecent = ageMinutes <= CONFIG.MAX_TICKET_AGE_MINUTES;

                if (isUnanswered && isRecent && !processed.has(tid) && !pendingTimers.has(tid)) {
                    if (acquireLock(tid)) {
                        const delaySec = Math.floor(Math.random() * (CONFIG.MAX_DELAY_SEC - CONFIG.MIN_DELAY_SEC + 1) + CONFIG.MIN_DELAY_SEC);
                        console.log('[Yungas-Bot] 🎯 Ticket #' + tid + ' para ' + operator.name + '. Disparo em ' + delaySec + 's.');

                        const timerId = setTimeout(() => sendFirstContact(tid), delaySec * 1000);
                        pendingTimers.set(tid, timerId);
                    }
                }

                // 2. INATIVIDADE POR MARCADOR (15 MIN / MAX 4)
                if (CONFIG.INACTIVITY_MARKER_ID) {
                    const hasMarker = Array.isArray(t.markers) && t.markers.some(m => Number(m.id) === Number(CONFIG.INACTIVITY_MARKER_ID));

                    if (hasMarker) {
                        // A: Cliente respondeu -> Remove marcador e reseta o tracking
                        if (t.franchisor_last_replied === false) {
                            console.log(`[Yungas-Bot] 💬 Cliente respondeu no ticket #${tid}. Removendo marcador e resetando régua.`);
                            await removeTicketMarks(tid);
                            delete followupTracker[tid];
                            saveFollowupTracker(followupTracker);
                            continue;
                        }

                        // B: Ultima mensagem foi do operador -> Avalia intervalo de 15 minutos
                        if (t.franchisor_last_replied === true && !t.solved) {
                            const entry = followupTracker[tid] || { attempts: 0, lastSentAt: null };
                            const lastMsgTime = parseApiDate(t.last_msg_on);

                            // Se o atendente enviou mensagem manual mais recente, recalcula a partir dela
                            const baseTime = (entry.lastSentAt && entry.lastSentAt > lastMsgTime) ? entry.lastSentAt : lastMsgTime;
                            const elapsedMinutes = (now - baseTime) / (1000 * 60);

                            if (elapsedMinutes >= CONFIG.INACTIVITY_INTERVAL_MINUTES && entry.attempts < CONFIG.INACTIVITY_MAX_ATTEMPTS) {
                                if (acquireLock(tid)) {
                                    console.log(`[Yungas-Bot] ⏳ Ticket #${tid} com inatividade de ${Math.round(elapsedMinutes)} min. Disparando lembrete.`);
                                    await sendInactivityReminder(tid, entry.attempts);
                                }
                            }
                        }
                    } else if (followupTracker[tid]) {
                        // Se o operador removeu o marcador manualmente no painel, limpa o tracking local
                        delete followupTracker[tid];
                        saveFollowupTracker(followupTracker);
                    }
                }
            }

            // 3. LIMPEZA AUTOMATICA DE TICKET FINALIZADO PELO OPERADOR
            for (const trackedIdStr of Object.keys(followupTracker)) {
                const trackedId = Number(trackedIdStr);
                if (!activeTicketIds.has(trackedId)) {
                    console.log(`[Yungas-Bot] Ticket #${trackedId} finalizado pelo operador. Higienizando marcador e estado.`);
                    await removeTicketMarks(trackedId);
                    delete followupTracker[trackedId];
                    saveFollowupTracker(followupTracker);
                }
            }

        } catch (e) {
            console.warn('[Yungas-Bot] Erro no scan de tickets:', e);
        }
    }

    getOperatorProfile().then((op) => {
        console.log('[Yungas-Bot] Monitor v2.4 ativo para ' + op.name + ' (#' + op.id + ')');
        setInterval(scanTickets, CONFIG.POLL_INTERVAL_MS);
        setTimeout(scanTickets, 2000);
    });
})();
