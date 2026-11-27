// ==UserScript==
// @name         Yungas - Auto Primeiro Contato Seguro
// @namespace    https://app.yungas.com.br/
// @version      2.5.0
// @description  Envio automático de primeiro contato, régua de inatividade por marcadores e badges visuais na tabela (Seg-Sex 08h-18h | Sáb 08h-12h)
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

        // Configurações da Régua de Inatividade por Marcador
        INACTIVITY_MARKER_ID: 3504, // ID oficial do marcador no Yungas
        INACTIVITY_INTERVAL_MINUTES: 15, // 15 minutos entre os lembretes (1 a 4)
        INACTIVITY_MAX_ATTEMPTS: 4, // 4 lembretes de inatividade
        INACTIVITY_FINAL_DELAY_MINUTES: 1, // 1 minuto após o 4º disparo para enviar o encerramento

        INACTIVITY_MESSAGE: "Oi! Tudo bem por aí? Nossa conversa ficou em silêncio, só queria checar se você ainda precisa de ajuda.",
        INACTIVITY_CLOSING_MESSAGE: "Olá! Seu atendimento foi finalizado por inatividade. Qualquer dúvida pode entrar em contato novamente. Seu feedback é muito importante para que possamos melhorar cada vez mais. Tenha um ótimo dia!😊",

        SCHEDULE: {
            ENABLED: true,
            WEEKDAY_START: 8,  // 08:00
            WEEKDAY_END: 18,   // 18:00
            SATURDAY_START: 8, // 08:00
            SATURDAY_END: 12   // 12:00
        }
    };

    const PROCESSED_KEY = 'yungas_processed_tickets_v2';
    const FOLLOWUP_TRACKER_KEY = 'yungas_inactivity_v1';
    const LOCK_PREFIX = 'yungas_lock_ticket_';
    const pendingTimers = new Map();
    let currentOperator = null;

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    // GERENCIAMENTO VISUAL DE RÓTULOS (BADGES NA TABELA)
    const BADGES_STORAGE_KEY = 'yungas_ticket_badges_v1';

    function getTicketBadges() {
        try {
            const raw = localStorage.getItem(BADGES_STORAGE_KEY);
            if (!raw) return {};
            const badges = JSON.parse(raw);
            const now = Date.now();
            let changed = false;
            for (const k of Object.keys(badges)) {
                // Expira badges com mais de 24 horas para manter o storage limpo
                // 24 x 60 x 60 x 1000
                if (now - (badges[k].updatedAt || 0) > 86400000) {
                    delete badges[k];
                    changed = true;
                }
            }
            if (changed) localStorage.setItem(BADGES_STORAGE_KEY, JSON.stringify(badges));
            return badges;
            // Sobrescreve o localstorage com os itens ativos
        } catch {
            return {};
        }
    }

    function setTicketBadge(ticketCode, label) {
        if (!ticketCode) return;
        const badges = getTicketBadges();
        badges[ticketCode] = { label, updatedAt: Date.now() };
        localStorage.setItem(BADGES_STORAGE_KEY, JSON.stringify(badges));
        renderTicketBadges();
    }

    function clearTicketBadge(ticketCode) {
        if (!ticketCode) return;
        const badges = getTicketBadges();
        if (badges[ticketCode]) {
            delete badges[ticketCode];
            localStorage.setItem(BADGES_STORAGE_KEY, JSON.stringify(badges));
            renderTicketBadges();
        }
    }

    /**
     * Atualiza os elementos visuais do Yungas:
     * - "Ticket" -> "NOVO" (quando respondido primeiro contato)
     * - "Ticket" -> "INATIVIDADE - 1", "INATIVIDADE - 2", etc. (lembretes de inatividade)
     * - "Ticket" -> "FINALIZAR" (mensagem de encerramento enviada)
     */
    function renderTicketBadges() {
        const badges = getTicketBadges();
        const containers = document.querySelectorAll('.item-code--container, [class*="item-code--container"]'); // A "," seria equivalente a OU, elementos cujo atributo class contenha o texto item-code--container em qualquer posição

        containers.forEach((container) => {
            // Localiza o span que contém o código do ticket (ex: "24-11-2026-JBQR")
            const idElem = container.querySelector('.item-code--id span, [class*="item-code--id"] span');
            if (!idElem) return;

            const code = idElem.textContent.trim();
            const badge = badges[code]; // Pega a badge do ticket especifico
            const labelP = container.querySelector('p');
            if (!labelP) return;

            // Identifica (span) e o wrapper de CSS (--pill-background)
            const pillSpan = labelP.closest('span') || labelP.parentElement;
            const pillWrapper = container.querySelector('div[style*="--pill-background"]') || (pillSpan ? pillSpan.closest('div[style*="--pill"]') : null);

            if (badge) {
                if (labelP.textContent !== badge.label) {
                    labelP.textContent = badge.label;
                    labelP.setAttribute('data-yungas-bot', 'true');
                }
                labelP.style.fontWeight = 'bold';
                labelP.style.letterSpacing = '0.5px';
                labelP.style.backgroundColor = 'transparent'; // Remove qualquer fundo direto no texto

                let bgColor = '';
                let textColor = '#ffffff';

                if (badge.label === 'NOVO') {
                    bgColor = '#67E64A';
                    textColor = '#111827';
                } else if (badge.label === 'EM ANDAMENTO') {
                    bgColor = '#2563EB'; // Azul para atendimento em andamento
                    textColor = '#ffffff';
                } else if (badge.label.startsWith('INATIVIDADE') || badge.label.startsWith('/INA')) {
                    bgColor = '#F3F63C';
                    textColor = '#111827';
                } else if (badge.label === 'FINALIZAR') {
                    bgColor = '#3F3CF6';
                    textColor = '#ffffff';
                }

                labelP.style.color = textColor;

                // Aplica a cor no background
                if (pillSpan) {
                    pillSpan.style.setProperty('background-color', bgColor, 'important');
                    pillSpan.setAttribute('data-yungas-bot', 'true');
                }
                if (pillWrapper) {
                    pillWrapper.style.setProperty('--pill-background', bgColor);
                    pillWrapper.style.setProperty('--pill-color', textColor);
                }
            } else if (labelP.getAttribute('data-yungas-bot') === 'true') {
                labelP.textContent = 'Ticket';
                labelP.style.color = '';
                labelP.style.backgroundColor = '';
                labelP.style.borderRadius = '';
                labelP.style.padding = '';
                labelP.style.fontWeight = '';
                labelP.removeAttribute('data-yungas-bot');

                if (pillSpan) {
                    pillSpan.style.removeProperty('background-color');
                    pillSpan.removeAttribute('data-yungas-bot');
                }
                if (pillWrapper) {
                    pillWrapper.style.setProperty('--pill-background', 'var(--yungas-red)');
                    pillWrapper.style.setProperty('--pill-color', 'var(--yungas-white)');
                }
            } // Zera os atributos quando o ticket não tiver mais badge
        });
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

    async function sendFirstContact(ticketId, ticketCode = '') {
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
                if (ticketCode) setTicketBadge(ticketCode, 'NOVO');
                await markUnread(ticketId); // Marca como nao lido
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
     * Rota de remoção de marcadores: DELETE /api/v2/ticket/{id}/marks
     * Requer no body: { "marker_id": ID }
     */
    async function removeTicketMarks(ticketId, markerId = CONFIG.INACTIVITY_MARKER_ID) {
        if (!markerId) {
            console.warn(`[Yungas-Bot] ⚠️ Tentativa de remover marcador do ticket #${ticketId} sem marker_id.`);
            return false;
        }

        try {
            const res = await fetch(`/api/v2/ticket/${ticketId}/marks`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ marker_id: Number(markerId) }),
                credentials: 'include'
            });
            if (res.ok) {
                console.log(`[Yungas-Bot] 🏷️ Marcador #${markerId} removido com sucesso do ticket #${ticketId}.`);
                return true;
            } else {
                const errorData = await res.text();
                console.error(`[Yungas-Bot] ❌ Erro ${res.status} ao remover marcador #${markerId} do ticket #${ticketId}. Resposta da API:`, errorData);
            }
        } catch (err) {
            console.error(`[Yungas-Bot] Erro de rede ao remover marcador do ticket #${ticketId}:`, err);
        }
        return false;
    }

    /**
     * Dispara as mensagens da régua de inatividade:
     * - Disparos 1 a 4: Mensagem de lembrete (CONFIG.INACTIVITY_MESSAGE)
     * - Disparo Final (após o 4º disparo sem resposta): Mensagem de encerramento por inatividade (CONFIG.INACTIVITY_CLOSING_MESSAGE),
     *   remoção do marcador #3504 e marcação de não lido.
     */
    async function sendInactivityReminder(ticketId, currentAttempts, ticketCode = '') {
        if (window.location.href.includes(String(ticketId))) {
            console.log(`[Yungas-Bot] 🛑 Operador em tela no ticket #${ticketId}. Envio de inatividade suspenso.`);
            releaseLock(ticketId);
            return;
        }

        const isClosing = currentAttempts >= CONFIG.INACTIVITY_MAX_ATTEMPTS;
        const msgText = isClosing ? CONFIG.INACTIVITY_CLOSING_MESSAGE : CONFIG.INACTIVITY_MESSAGE;

        const formData = new FormData();
        formData.append('ticketId', String(ticketId));
        formData.append('msgText', `<p>${msgText}</p>`);

        try {
            const res = await fetch('/helpdesk/new-msg', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            if (res.ok) {
                const nextAttempts = currentAttempts + 1;
                const tracker = getFollowupTracker();

                if (!isClosing) {
                    console.log(`[Yungas-Bot] ⏰ Lembrete de inatividade (${nextAttempts}/${CONFIG.INACTIVITY_MAX_ATTEMPTS}) enviado no ticket #${ticketId}.`);
                    tracker[ticketId] = {
                        ticketCode: ticketCode,
                        attempts: nextAttempts,
                        lastSentAt: Date.now()
                    };
                    saveFollowupTracker(tracker);
                    if (ticketCode) setTicketBadge(ticketCode, `INATIVIDADE - ${nextAttempts}`);
                } else {
                    console.log(`[Yungas-Bot] 🛑 Mensagem de encerramento por inatividade enviada no ticket #${ticketId}. Removendo marcador #${CONFIG.INACTIVITY_MARKER_ID}.`);
                    await removeTicketMarks(ticketId);
                    await markUnread(ticketId);
                    delete tracker[ticketId];
                    saveFollowupTracker(tracker);
                    if (ticketCode) setTicketBadge(ticketCode, 'FINALIZAR');
                }
            } else {
                console.error(`[Yungas-Bot] ❌ Erro HTTP ${res.status} no envio de inatividade do ticket #${ticketId}`);
            }
        } catch (err) {
            console.error(`[Yungas-Bot] ❌ Erro de rede no envio de inatividade do ticket #${ticketId}:`, err);
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
                const tname = t.ticket_id;
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
                        console.log('[Yungas-Bot] 🎯 Ticket #' + tid + ' / ' + tname + ' para ' + operator.name + '. Disparo em ' + delaySec + 's.');

                        const timerId = setTimeout(() => sendFirstContact(tid, tname), delaySec * 1000);
                        pendingTimers.set(tid, timerId);
                    }
                }

                // 2. INATIVIDADE POR MARCADOR (15 MIN / MAX 4)
                // t.markers.some() volta o primeiro resultado Early true
                if (CONFIG.INACTIVITY_MARKER_ID) {
                    const hasMarker = Array.isArray(t.markers) && t.markers.some(m => Number(m.id) === Number(CONFIG.INACTIVITY_MARKER_ID));

                    if (hasMarker) {
                        // A: Cliente respondeu -> Remove marcador e reseta o tracking
                        if (t.franchisor_last_replied === false) {
                            console.log(`[Yungas-Bot] 💬 Cliente respondeu no ticket #${tid} / ${tname}. Removendo marcador e resetando régua.`);
                            await removeTicketMarks(tid);
                            delete followupTracker[tid];
                            saveFollowupTracker(followupTracker);
                            setTicketBadge(tname, 'EM ANDAMENTO');
                            continue;
                        }

                        // B: Ultima mensagem foi do operador -> Avalia intervalo de 15 minutos
                        if (t.franchisor_last_replied === true && !t.solved) {
                            let entry = followupTracker[tid] || { attempts: 0, lastSentAt: null, ticketCode: tname };
                            const lastMsgTime = parseApiDate(t.last_msg_on);

                            // Se o atendente enviou uma nova mensagem manual após o último lembrete do bot, reinicia a régua
                            if (entry.lastSentAt && lastMsgTime > entry.lastSentAt + 3000) {
                                console.log(`[Yungas-Bot] 🔄 Nova mensagem do operador detectada no ticket #${tid} / ${tname}. Reiniciando régua.`);
                                entry.attempts = 0;
                                entry.lastSentAt = lastMsgTime;
                                followupTracker[tid] = entry;
                                saveFollowupTracker(followupTracker);
                            }

                            // Enquanto não houver disparos de inatividade (attempts === 0), o ticket está EM ANDAMENTO (a menos que já esteja FINALIZAR)!
                            if (entry.attempts === 0) {
                                const currentBadges = getTicketBadges();
                                const currentBadge = currentBadges[tname]?.label;
                                if (currentBadge !== 'EM ANDAMENTO' && currentBadge !== 'FINALIZAR') {
                                    setTicketBadge(tname, 'EM ANDAMENTO');
                                }
                            } else if (entry.attempts > 0 && entry.attempts < CONFIG.INACTIVITY_MAX_ATTEMPTS) {
                                setTicketBadge(tname, `INATIVIDADE - ${entry.attempts}`);
                            }

                            // Se o atendente enviou mensagem manual mais recente, recalcula a partir dela
                            const baseTime = (entry.lastSentAt && entry.lastSentAt > lastMsgTime) ? entry.lastSentAt : lastMsgTime;
                            const elapsedMinutes = (now - baseTime) / (1000 * 60);

                            // Intervalo dinâmico: 15 min para lembretes (1 a 4) e apenas 1 min após o 4º para encerrar
                            const requiredInterval = (entry.attempts >= CONFIG.INACTIVITY_MAX_ATTEMPTS)
                                ? CONFIG.INACTIVITY_FINAL_DELAY_MINUTES
                                : CONFIG.INACTIVITY_INTERVAL_MINUTES;

                            if (elapsedMinutes >= requiredInterval && entry.attempts <= CONFIG.INACTIVITY_MAX_ATTEMPTS) {
                                if (acquireLock(tid)) {
                                    if (entry.attempts < CONFIG.INACTIVITY_MAX_ATTEMPTS) {
                                        console.log(`[Yungas-Bot] ⏳ Ticket #${tid} / ${tname} com inatividade de ${Math.round(elapsedMinutes)} min. Disparando lembrete (${entry.attempts + 1}/${CONFIG.INACTIVITY_MAX_ATTEMPTS}).`);
                                    } else {
                                        console.log(`[Yungas-Bot] ⏳ Ticket #${tid} / ${tname} sem retorno após 1 min do ${CONFIG.INACTIVITY_MAX_ATTEMPTS}º lembrete. Enviando encerramento por inatividade.`);
                                    }
                                    await sendInactivityReminder(tid, entry.attempts, tname);
                                }
                            }
                        }
                    } else if (followupTracker[tid]) {
                        // Se o operador removeu o marcador manualmente no painel, limpa o tracking local
                        delete followupTracker[tid];
                        saveFollowupTracker(followupTracker);
                        const currentBadges = getTicketBadges();
                        if (currentBadges[tname]?.label !== 'FINALIZAR') {
                            setTicketBadge(tname, 'EM ANDAMENTO');
                        }
                    }
                }

                // 3. STATUS VISUAL: "EM ANDAMENTO" (Fluxo regular e tickets sem marcador de inatividade)
                if (!t.solved) {
                    const firstReplyTime = parseApiDate(t.first_replied_at);
                    const lastMsgTime = parseApiDate(t.last_msg_on);
                    const isOperatorFollowup = t.first_replied_at !== null && (lastMsgTime - firstReplyTime > 3000);

                    if (isOperatorFollowup) {
                        const currentBadges = getTicketBadges();
                        const currentBadge = currentBadges[tname]?.label;

                        // Se o ticket já foi enviado para FINALIZAR, só sai dele se o cliente responder!
                        if (currentBadge === 'FINALIZAR') {
                            if (t.franchisor_last_replied === false) {
                                console.log(`[Yungas-Bot] 💬 Cliente respondeu no ticket #${tid} / ${tname} após encerramento. Retornando para 'EM ANDAMENTO'.`);
                                setTicketBadge(tname, 'EM ANDAMENTO');
                            }
                            continue;
                        }

                        const isShowingInactivity = currentBadge && currentBadge.startsWith('INATIVIDADE');

                        if (!isShowingInactivity) {
                            if (t.franchisor_last_replied === true || currentBadge === 'EM ANDAMENTO') {
                                if (currentBadge !== 'EM ANDAMENTO') {
                                    console.log(`[Yungas-Bot] 💬 Atendimento em andamento no ticket #${tid} / ${tname}. Atualizando badge para 'EM ANDAMENTO'.`);
                                    setTicketBadge(tname, 'EM ANDAMENTO');
                                }
                            }
                        }
                    }
                } else if (t.solved) {
                    clearTicketBadge(tname);
                }
            }

            // 4. LIMPEZA SEGURA DE TICKET FINALIZADO PELO OPERADOR
            // Safe contra falso positivo de paginação (pagina 2+) e oscilações de rede voltando []
            if (ticketList.length > 0) {
                for (const trackedIdStr of Object.keys(followupTracker)) {
                    const trackedId = Number(trackedIdStr);
                    const trackedCode = followupTracker[trackedIdStr]?.ticketCode;
                    if (!activeTicketIds.has(trackedId)) {
                        // Verifica o ticket sem carregar as mensagens
                        try {
                            const detailRes = await fetch(`/api/v2/ticket/${trackedId}/detail/?messages=false`, {
                                headers: { 'Accept': 'application/json' },
                                credentials: 'include'
                            });
                            if (detailRes.ok) {
                                const detail = await detailRes.json();
                                const isSolved = detail.solved === true || detail.status === 'closed';
                                const isTransferred = Number(detail.assignee_id || detail.assignee?.id) !== operator.id;

                                if (isSolved || isTransferred) {
                                    console.log(`[Yungas-Bot] 🧹 Ticket #${trackedId} confirmado como finalizado/transferido. Higienizando marcador.`);
                                    await removeTicketMarks(trackedId);
                                    delete followupTracker[trackedId];
                                    saveFollowupTracker(followupTracker);
                                    clearTicketBadge(detail.ticket_id || trackedCode);
                                }
                            }
                        } catch (err) {
                            console.warn(`[Yungas-Bot] Falha ao verificar status pontual do ticket #${trackedId}:`, err);
                        }
                    }
                }
            }

        } catch (e) {
            console.warn('[Yungas-Bot] Erro no scan de tickets:', e);
        }
    }

    let lastLocation = window.location.href;
    getOperatorProfile().then((op) => {
        console.log('[Yungas-Bot] Monitor v2.5 ativo para ' + op.name + ' (#' + op.id + ')');
        setInterval(scanTickets, CONFIG.POLL_INTERVAL_MS);
        setInterval(renderTicketBadges, 1000); // Re-renderiza os badges na tela a cada 1s contra re-renders do Svelte
        setTimeout(scanTickets, 2000);
        setTimeout(renderTicketBadges, 1000);

        // Monitor de navegação: dispara varredura imediatamente em qualquer mudança de tela
        setInterval(() => {
            if (window.location.href !== lastLocation) {
                lastLocation = window.location.href;
                scanTickets();
            }
        }, 800);
    });
})();
