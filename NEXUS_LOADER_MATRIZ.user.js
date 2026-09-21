// ==UserScript==
// @name         NEXUS Loader Dinâmico - MATRIZ
// @namespace    https://acompanhamentos-reta-final.firebaseapp.com/
// @version      1.0.0
// @description  Loader universal da Matriz: identifica solicitações de TERESINA/PALMAS e carrega automaticamente o canal correto do GitHub, com seleção manual e cache por perfil.
// @author       LM Confecções
// @match        *://sistema.romancemoda.com.br/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @connect      acompanhamentos-reta-final-default-rtdb.firebaseio.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const CONFIG = {
        branch: 'main',
        repo: 'jhonesfeliciano/nexus-tampermonkey',
        firebaseBase: 'https://acompanhamentos-reta-final-default-rtdb.firebaseio.com',
        mainDataPath: 'Ciclo-semanas-setores',
        integrationPath: 'Ciclo-semanas-integracao',
        pageId: '297',
        timeoutMs: 30000,
        minCodeBytes: 2000,
        chooserId: 'nexus-matriz-loader-chooser',
        chooserStyleId: 'nexus-matriz-loader-chooser-style',
        lastChannelKey: 'nexusLoaderMatrizLastChannel',
        channels: {
            teresina: {
                label: 'TERESINA',
                pendingKey: 'ciclosNotasPerdidasPendingCapture_teresina_V1',
                cacheKey: 'nexusLoaderCache_matriz_teresina'
            },
            palmas: {
                label: 'PALMAS',
                pendingKey: 'ciclosNotasPerdidasPendingCapture_palmas_V1',
                cacheKey: 'nexusLoaderCache_matriz_palmas'
            }
        }
    };

    let channelLoaded = '';
    let bootstrapping = false;

    registerMenus();
    waitForTargetPage(120000)
        .then(found => {
            if (!found) {
                console.info('[NEXUS Loader/MATRIZ] Página 297 não detectada; loader permaneceu inativo nesta aba.');
                return;
            }
            return bootstrap();
        })
        .catch(error => {
            console.error('[NEXUS Loader/MATRIZ]', error);
            showChooser(`Falha ao iniciar: ${error.message || error}`, 'error');
        });

    async function bootstrap() {
        if (bootstrapping || channelLoaded) return;
        bootstrapping = true;
        try {
            // 1) Se houve reload durante uma captura, retoma obrigatoriamente o mesmo canal.
            const resumed = findPendingLocalCapture();
            if (resumed) {
                console.info(`[NEXUS Loader/MATRIZ] Retomando captura local de ${labelOf(resumed)}.`);
                await loadChannel(resumed, 'captura local pendente');
                return;
            }

            // 2) Procura uma solicitação pendente no Firebase e tenta descobrir o ecossistema.
            const detection = await detectPendingRequestChannel();
            if (detection.channel) {
                console.info(`[NEXUS Loader/MATRIZ] Solicitação detectada para ${labelOf(detection.channel)}.`, detection.request || '');
                await loadChannel(detection.channel, 'solicitação pendente no Firebase');
                return;
            }

            // 3) Se não houver solicitação, ou se houver ambiguidade, a Matriz escolhe manualmente.
            const message = detection.ambiguous
                ? `Existe uma solicitação para “${detection.request?.profile || 'distribuidor'}”, mas esse nome foi encontrado em mais de um perfil. Escolha TERESINA ou PALMAS.`
                : 'Nenhuma solicitação pendente foi identificada. Escolha qual perfil a Matriz deve operar nesta página.';
            showChooser(message, detection.ambiguous ? 'warning' : 'info');
        } finally {
            bootstrapping = false;
        }
    }

    function findPendingLocalCapture() {
        const candidates = Object.entries(CONFIG.channels)
            .map(([channel, cfg]) => ({ channel, capture: GM_getValue(cfg.pendingKey, null) }))
            .filter(item => item.capture && typeof item.capture === 'object')
            .sort((a, b) => Number(b.capture?.startedAt || 0) - Number(a.capture?.startedAt || 0));
        return candidates[0]?.channel || '';
    }

    async function detectPendingRequestChannel() {
        const [requestsRaw, teresinaRaw, palmasRaw] = await Promise.all([
            firebaseRequest('GET', `${CONFIG.integrationPath}/requests.json`),
            firebaseRequest('GET', `${CONFIG.mainDataPath}/teresina/profiles.json`),
            firebaseRequest('GET', `${CONFIG.mainDataPath}/palmas/profiles.json`)
        ]);

        const namesByChannel = {
            teresina: extractDistributorNames(teresinaRaw),
            palmas: extractDistributorNames(palmasRaw)
        };
        const requests = flattenIntegrationRequests(requestsRaw)
            .filter(r => r && r.status === 'pending' && r.profile)
            .sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));

        if (!requests.length) return { channel: '', request: null, ambiguous: false };

        for (const request of requests) {
            const explicit = normalizeChannel(request.ecosystemKey || request.workspaceKey || request.dataKey || '');
            if (explicit) return { channel: explicit, request, ambiguous: false };

            const profileNorm = normalizePersonName(request.profile);
            const matches = Object.entries(namesByChannel)
                .filter(([, names]) => names.some(name => normalizePersonName(name) === profileNorm))
                .map(([channel]) => channel);

            if (matches.length === 1) return { channel: matches[0], request, ambiguous: false };
            if (matches.length > 1) return { channel: '', request, ambiguous: true };
        }

        return { channel: '', request: requests[0], ambiguous: false };
    }

    async function loadChannel(channel, reason = 'seleção manual') {
        channel = normalizeChannel(channel);
        if (!channel || !CONFIG.channels[channel]) throw new Error('Canal inválido.');
        if (channelLoaded) return;

        removeChooser();
        channelLoaded = channel;
        GM_setValue(CONFIG.lastChannelKey, channel);

        const cfg = CONFIG.channels[channel];
        const previousCache = GM_getValue(cfg.cacheKey, null);
        try {
            const base = `https://raw.githubusercontent.com/${CONFIG.repo}/${CONFIG.branch}`;
            const manifest = await requestJson(`${base}/manifest.json?ts=${Date.now()}`);
            const release = manifest?.channels?.[channel];
            validateRelease(channel, release);

            const sourceUrl = `${base}/${String(release.path).replace(/^\/+/, '')}?ts=${Date.now()}`;
            const code = await requestText(sourceUrl);
            validateCode(channel, code);

            const expectedHash = String(release.sha256 || '').toLowerCase();
            if (expectedHash) {
                const actualHash = await sha256(code);
                if (actualHash && actualHash !== expectedHash) {
                    throw new Error(`Hash diferente do manifesto para ${cfg.label}.`);
                }
            }

            executeCode(code, `nexus-${channel}-${release.version}-matriz-github.js`);
            GM_setValue(cfg.cacheKey, {
                version: String(release.version || ''),
                path: String(release.path || ''),
                sha256: String(release.sha256 || ''),
                code,
                repo: CONFIG.repo,
                savedAt: Date.now()
            });
            console.info(`[NEXUS Loader/MATRIZ] ${cfg.label} ${release.version} carregado do GitHub (${reason}) e salvo no cache.`);
        } catch (remoteError) {
            console.warn(`[NEXUS Loader/MATRIZ] Falha remota em ${cfg.label}; tentando cache.`, remoteError);
            if (previousCache?.code) {
                try {
                    validateCode(channel, previousCache.code);
                    executeCode(previousCache.code, `nexus-${channel}-${previousCache.version || 'cache'}-matriz-offline.js`);
                    console.info(`[NEXUS Loader/MATRIZ] Cache ${cfg.label} ${previousCache.version || ''} executado.`);
                    return;
                } catch (cacheError) {
                    console.error(`[NEXUS Loader/MATRIZ] Cache ${cfg.label} também falhou.`, cacheError);
                }
            }
            channelLoaded = '';
            showChooser(`Não foi possível carregar ${cfg.label} pelo GitHub e não existe cache funcional neste navegador.\n${remoteError.message || remoteError}`, 'error');
        }
    }

    function showChooser(message, kind = 'info') {
        if (!isTargetPage()) return;
        removeChooser();
        ensureChooserStyle();

        const last = normalizeChannel(GM_getValue(CONFIG.lastChannelKey, ''));
        const box = document.createElement('section');
        box.id = CONFIG.chooserId;
        box.innerHTML = `
            <div class="nml-head">
                <div>
                    <div class="nml-title">NEXUS MATRIZ</div>
                    <div class="nml-sub">Loader universal • GitHub</div>
                </div>
                <button type="button" class="nml-min" title="Minimizar">−</button>
            </div>
            <div class="nml-body">
                <div class="nml-status" data-kind="${escapeHtml(kind)}">${escapeHtml(message)}</div>
                <label for="nml-channel">Perfil que será operado</label>
                <select id="nml-channel">
                    <option value="">Selecione...</option>
                    <option value="teresina" ${last === 'teresina' ? 'selected' : ''}>TERESINA</option>
                    <option value="palmas" ${last === 'palmas' ? 'selected' : ''}>PALMAS</option>
                </select>
                <button type="button" id="nml-load">Abrir perfil selecionado</button>
                <div class="nml-note">Apenas um canal é carregado por vez. Solicitações identificadas sem ambiguidade são abertas automaticamente.</div>
            </div>`;
        (document.body || document.documentElement).appendChild(box);

        box.querySelector('.nml-min')?.addEventListener('click', () => {
            box.classList.toggle('nml-collapsed');
            const button = box.querySelector('.nml-min');
            if (button) button.textContent = box.classList.contains('nml-collapsed') ? '+' : '−';
        });
        box.querySelector('#nml-load')?.addEventListener('click', async () => {
            const channel = box.querySelector('#nml-channel')?.value || '';
            if (!channel) {
                const status = box.querySelector('.nml-status');
                if (status) {
                    status.dataset.kind = 'warning';
                    status.textContent = 'Selecione TERESINA ou PALMAS antes de continuar.';
                }
                return;
            }
            const button = box.querySelector('#nml-load');
            if (button) {
                button.disabled = true;
                button.textContent = `Carregando ${labelOf(channel)}...`;
            }
            try { await loadChannel(channel, 'seleção manual da Matriz'); }
            catch (error) {
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Abrir perfil selecionado';
                }
                const status = box.querySelector('.nml-status');
                if (status) {
                    status.dataset.kind = 'error';
                    status.textContent = error.message || String(error);
                }
            }
        });
    }

    function ensureChooserStyle() {
        if (document.getElementById(CONFIG.chooserStyleId)) return;
        const style = document.createElement('style');
        style.id = CONFIG.chooserStyleId;
        style.textContent = `
            #${CONFIG.chooserId}{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(400px,calc(100vw - 28px));font-family:Arial,sans-serif;background:#fff;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 18px 50px rgba(15,23,42,.28);overflow:hidden;color:#0f172a}
            #${CONFIG.chooserId} *{box-sizing:border-box}
            #${CONFIG.chooserId} .nml-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;background:linear-gradient(135deg,#334155,#0f172a);color:#fff}
            #${CONFIG.chooserId} .nml-title{font-weight:900;font-size:14px;letter-spacing:.35px}
            #${CONFIG.chooserId} .nml-sub{font-size:11px;opacity:.82;margin-top:2px}
            #${CONFIG.chooserId} .nml-min{width:30px;height:30px;border:0;border-radius:8px;background:rgba(255,255,255,.14);color:#fff;font-size:18px;cursor:pointer}
            #${CONFIG.chooserId} .nml-body{padding:14px}
            #${CONFIG.chooserId}.nml-collapsed .nml-body{display:none}
            #${CONFIG.chooserId} label{display:block;font-size:11px;font-weight:800;text-transform:uppercase;color:#475569;margin:11px 0 5px}
            #${CONFIG.chooserId} select{width:100%;height:42px;border:1px solid #cbd5e1;border-radius:10px;padding:0 10px;background:#fff;color:#0f172a;font-weight:800}
            #${CONFIG.chooserId} #nml-load{width:100%;height:44px;border:0;border-radius:11px;margin-top:10px;background:#2563eb;color:#fff;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 8px 18px rgba(37,99,235,.22)}
            #${CONFIG.chooserId} #nml-load:hover{background:#1d4ed8}
            #${CONFIG.chooserId} #nml-load:disabled{opacity:.55;cursor:wait;box-shadow:none}
            #${CONFIG.chooserId} .nml-status{padding:9px 10px;border-radius:9px;font-size:12px;line-height:1.45;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;white-space:pre-line}
            #${CONFIG.chooserId} .nml-status[data-kind="warning"]{background:#fffbeb;border-color:#fde68a;color:#92400e}
            #${CONFIG.chooserId} .nml-status[data-kind="error"]{background:#fff1f2;border-color:#fecdd3;color:#be123c}
            #${CONFIG.chooserId} .nml-note{margin-top:9px;font-size:11px;line-height:1.45;color:#64748b}
        `;
        document.head.appendChild(style);
    }

    function removeChooser() {
        document.getElementById(CONFIG.chooserId)?.remove();
    }

    function isTargetPage() {
        const markerIds = ['P297_STREPRESENTANTE', 'P297_IDREPRESENTANTE', 'P297_TIPONOTAS', 'P297_TIPORELATORIO', 'B339887272933488317'];
        const markerCount = markerIds.reduce((total, id) => total + (document.getElementById(id) ? 1 : 0), 0);
        if (markerCount >= 2) return true;
        const hiddenPageId = document.getElementById('pFlowStepId')?.value;
        if (String(hiddenPageId || '') === CONFIG.pageId) return true;
        if (document.body?.classList.contains(`page-${CONFIG.pageId}`)) return true;
        const context = String(document.getElementById('pContext')?.value || '');
        if (new RegExp(`(?:^|:)${CONFIG.pageId}(?::|$)`).test(context)) return true;
        let decodedUrl = location.href;
        try { decodedUrl = decodeURIComponent(location.href); } catch {}
        return new RegExp(`(?:f\\?p=[^#]*?:${CONFIG.pageId}(?::|$)|/page[-_]?${CONFIG.pageId}(?:[/?#]|$)|/${CONFIG.pageId}(?:[/?#]|$))`, 'i').test(decodedUrl);
    }

    function waitForTargetPage(timeoutMs) {
        if (isTargetPage()) return Promise.resolve(true);
        return new Promise(resolve => {
            const startedAt = Date.now();
            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                window.clearInterval(timer);
                resolve(value);
            };
            const check = () => {
                if (isTargetPage()) finish(true);
                else if (Date.now() - startedAt >= timeoutMs) finish(false);
            };
            const observer = new MutationObserver(check);
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
            const timer = window.setInterval(check, 500);
            check();
        });
    }

    function extractDistributorNames(raw) {
        const names = toArray(raw).map(item => {
            if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
            if (item && typeof item === 'object') return String(item.name || item.nome || item.profile || item.value || '').trim();
            return '';
        }).filter(Boolean);
        return [...new Set(names)];
    }

    function flattenIntegrationRequests(raw, prefix = '') {
        if (!raw || typeof raw !== 'object') return [];
        const output = [];
        Object.entries(raw).forEach(([key, value]) => {
            if (!value || typeof value !== 'object') return;
            const path = prefix ? `${prefix}/${key}` : key;
            const looksLikeRequest = Object.prototype.hasOwnProperty.call(value, 'requestId')
                || Object.prototype.hasOwnProperty.call(value, 'profile')
                || Object.prototype.hasOwnProperty.call(value, 'status');
            if (looksLikeRequest) output.push({ key: path, ...(value || {}) });
            else output.push(...flattenIntegrationRequests(value, path));
        });
        return output;
    }

    function normalizeChannel(value) {
        const key = normalizeKey(value);
        if (key === 'teresina') return 'teresina';
        if (key === 'palmas') return 'palmas';
        return '';
    }

    function labelOf(channel) {
        return CONFIG.channels[normalizeChannel(channel)]?.label || String(channel || '').toUpperCase();
    }

    function normalizePersonName(value) {
        return normalizeText(value)
            .replace(/\b(inativa?|ativo|inativo)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeKey(value) {
        return normalizeText(value)
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[()\[\]{}.,;:/\\|_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function toArray(value) {
        if (Array.isArray(value)) return value.filter(item => item != null);
        if (value && typeof value === 'object') return Object.values(value).filter(item => item != null);
        return [];
    }

    function validateRelease(channel, release) {
        if (!release || typeof release !== 'object') throw new Error(`Canal ${channel} não encontrado no manifest.json.`);
        if (!release.version || !release.path) throw new Error(`Manifesto do canal ${channel} está incompleto.`);
        const declaredChannel = normalizeChannel(release.ecosystemKey || release.ecosystemName || channel);
        if (declaredChannel && declaredChannel !== channel) throw new Error(`Manifesto aponta ${channel} para outro ecossistema.`);
    }

    function validateCode(channel, code) {
        if (typeof code !== 'string' || code.length < CONFIG.minCodeBytes) throw new Error(`Código remoto de ${labelOf(channel)} vazio ou muito pequeno.`);
        new Function('GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_xmlhttpRequest', 'GM_registerMenuCommand', code);
        return true;
    }

    function executeCode(code, sourceName) {
        const runner = new Function(
            'GM_getValue',
            'GM_setValue',
            'GM_deleteValue',
            'GM_xmlhttpRequest',
            'GM_registerMenuCommand',
            `${code}\n//# sourceURL=${sourceName}`
        );
        runner(GM_getValue, GM_setValue, GM_deleteValue, GM_xmlhttpRequest, GM_registerMenuCommand);
    }

    async function sha256(text) {
        try {
            const bytes = new TextEncoder().encode(text);
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            console.warn('[NEXUS Loader/MATRIZ] Não foi possível validar SHA-256; será mantida a validação de sintaxe.', error);
            return '';
        }
    }

    function firebaseRequest(method, path, body) {
        const url = `${CONFIG.firebaseBase}/${String(path || '').replace(/^\/+/, '')}`;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
                data: body === undefined ? undefined : JSON.stringify(body),
                timeout: CONFIG.timeoutMs,
                onload: response => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`Firebase respondeu HTTP ${response.status}.`));
                        return;
                    }
                    if (!response.responseText) return resolve(null);
                    try { resolve(JSON.parse(response.responseText)); }
                    catch { resolve(response.responseText); }
                },
                onerror: () => reject(new Error('Falha de rede ao consultar o Firebase.')),
                ontimeout: () => reject(new Error('Tempo esgotado ao consultar o Firebase.'))
            });
        });
    }

    function requestText(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: CONFIG.timeoutMs,
                headers: { 'Cache-Control': 'no-cache' },
                onload: response => {
                    if (response.status < 200 || response.status >= 300) return reject(new Error(`GitHub respondeu HTTP ${response.status}.`));
                    resolve(String(response.responseText || ''));
                },
                onerror: () => reject(new Error('Falha de rede ao acessar raw.githubusercontent.com.')),
                ontimeout: () => reject(new Error('Tempo esgotado ao acessar o GitHub.'))
            });
        });
    }

    async function requestJson(url) {
        const text = await requestText(url);
        try { return JSON.parse(text); }
        catch { throw new Error('manifest.json inválido ou não é JSON.'); }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand('MATRIZ → Abrir TERESINA', () => {
            if (channelLoaded) return window.alert(`Já existe um canal carregado nesta página: ${labelOf(channelLoaded)}. Recarregue a página para trocar.`);
            loadChannel('teresina', 'menu da Matriz').catch(error => window.alert(error.message || error));
        });
        GM_registerMenuCommand('MATRIZ → Abrir PALMAS', () => {
            if (channelLoaded) return window.alert(`Já existe um canal carregado nesta página: ${labelOf(channelLoaded)}. Recarregue a página para trocar.`);
            loadChannel('palmas', 'menu da Matriz').catch(error => window.alert(error.message || error));
        });
        GM_registerMenuCommand('MATRIZ → Ver configuração/cache', () => {
            const lines = [`Repositório: ${CONFIG.repo}`, `Branch: ${CONFIG.branch}`];
            Object.entries(CONFIG.channels).forEach(([channel, cfg]) => {
                const cache = GM_getValue(cfg.cacheKey, null);
                const date = cache?.savedAt ? new Date(cache.savedAt).toLocaleString('pt-BR') : '—';
                lines.push(`${cfg.label}: cache ${cache?.version || 'nenhum'} • ${date}`);
            });
            window.alert(`NEXUS Loader MATRIZ\n\n${lines.join('\n')}`);
        });
        GM_registerMenuCommand('MATRIZ → Limpar caches', () => {
            if (!window.confirm('Limpar os caches locais de TERESINA e PALMAS deste loader da Matriz?')) return;
            Object.values(CONFIG.channels).forEach(cfg => GM_deleteValue(cfg.cacheKey));
            window.alert('Caches da Matriz removidos.');
        });
    }
})();
