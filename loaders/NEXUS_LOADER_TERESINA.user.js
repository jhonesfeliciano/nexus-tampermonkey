// ==UserScript==
// @name         NEXUS Loader Dinâmico - TERESINA
// @namespace    https://acompanhamentos-reta-final.firebaseapp.com/
// @version      1.0.0
// @description  Carrega do GitHub a versão aprovada do CICLOS TERESINA e usa cache local se o GitHub ficar indisponível.
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
        channel: 'teresina',
        label: 'TERESINA',
        branch: 'main',
        defaultRepo: 'jhonesfeliciano/nexus-tampermonkey', // repositório já configurado
        repoStorageKey: 'nexusLoaderRepo_teresina',
        cacheStorageKey: 'nexusLoaderCache_teresina',
        timeoutMs: 30000,
        minCodeBytes: 2000
    };

    let loaded = false;

    registerMenus();
    bootstrap().catch(error => {
        console.error(`[NEXUS Loader/${CONFIG.label}]`, error);
    });

    async function bootstrap() {
        if (loaded) return;
        loaded = true;

        const repo = await getRepository();
        if (!repo) {
            loaded = false;
            return;
        }

        const previousCache = GM_getValue(CONFIG.cacheStorageKey, null);
        try {
            const base = `https://raw.githubusercontent.com/${repo}/${CONFIG.branch}`;
            const manifest = await requestJson(`${base}/manifest.json?ts=${Date.now()}`);
            const release = manifest?.channels?.[CONFIG.channel];
            validateRelease(release);

            const sourceUrl = `${base}/${String(release.path).replace(/^\/+/, '')}?ts=${Date.now()}`;
            const code = await requestText(sourceUrl);
            validateCode(code, release);

            const expectedHash = String(release.sha256 || '').toLowerCase();
            if (expectedHash) {
                const actualHash = await sha256(code);
                if (actualHash && actualHash !== expectedHash) {
                    throw new Error(`Hash diferente do manifesto. Esperado ${expectedHash.slice(0, 12)}…, recebido ${actualHash.slice(0, 12)}…`);
                }
            }

            executeCode(code, `nexus-${CONFIG.channel}-${release.version}-github.js`);
            GM_setValue(CONFIG.cacheStorageKey, {
                version: String(release.version || ''),
                path: String(release.path || ''),
                sha256: String(release.sha256 || ''),
                code,
                repo,
                savedAt: Date.now()
            });
            console.info(`[NEXUS Loader/${CONFIG.label}] Versão ${release.version} carregada do GitHub e salva no cache.`);
        } catch (remoteError) {
            console.warn(`[NEXUS Loader/${CONFIG.label}] GitHub indisponível ou versão inválida. Tentando cache local.`, remoteError);
            if (previousCache?.code) {
                try {
                    validateCode(previousCache.code, previousCache);
                    executeCode(previousCache.code, `nexus-${CONFIG.channel}-${previousCache.version || 'cache'}-offline.js`);
                    console.info(`[NEXUS Loader/${CONFIG.label}] Cache local ${previousCache.version || ''} executado com sucesso.`);
                    return;
                } catch (cacheError) {
                    console.error(`[NEXUS Loader/${CONFIG.label}] Cache local também falhou.`, cacheError);
                }
            }
            window.alert(`NEXUS ${CONFIG.label}: não foi possível carregar o script pelo GitHub e não existe um cache funcional neste navegador.\n\n${remoteError.message || remoteError}`);
        }
    }

    async function getRepository() {
        let repo = normalizeRepo(GM_getValue(CONFIG.repoStorageKey, '') || CONFIG.defaultRepo);
        if (repo) return repo;

        const value = window.prompt(
            `Configuração inicial do NEXUS ${CONFIG.label}.\n\nInforme o repositório GitHub no formato:\nusuario/nexus-tampermonkey\n\nVocê também pode colar a URL completa do repositório.`,
            ''
        );
        repo = normalizeRepo(value);
        if (!repo) {
            window.alert(`NEXUS ${CONFIG.label}: repositório não configurado. Use o menu do Tampermonkey → “Configurar repositório GitHub”.`);
            return '';
        }
        GM_setValue(CONFIG.repoStorageKey, repo);
        return repo;
    }

    function normalizeRepo(value) {
        let text = String(value || '').trim();
        if (!text) return '';
        text = text.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
        const parts = text.split('/').filter(Boolean);
        if (parts.length < 2) return '';
        return `${parts[0]}/${parts[1]}`;
    }

    function validateRelease(release) {
        if (!release || typeof release !== 'object') throw new Error(`Canal ${CONFIG.channel} não encontrado no manifest.json.`);
        if (!release.version || !release.path) throw new Error(`Manifesto do canal ${CONFIG.channel} está incompleto.`);
    }

    function validateCode(code, release = {}) {
        if (typeof code !== 'string' || code.length < CONFIG.minCodeBytes) throw new Error('Código remoto vazio ou muito pequeno.');
        if (!code.includes("'use strict'") && !code.includes('"use strict"')) console.warn(`[NEXUS Loader/${CONFIG.label}] Código sem marca use strict.`);
        // Compila antes de executar para detectar erro de sintaxe sem substituir o cache bom.
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
            console.warn(`[NEXUS Loader/${CONFIG.label}] Não foi possível validar SHA-256; continuando com validação de sintaxe.`, error);
            return '';
        }
    }

    function requestText(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: CONFIG.timeoutMs,
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

    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand(`Configurar repositório GitHub - ${CONFIG.label}`, () => {
            const atual = GM_getValue(CONFIG.repoStorageKey, '') || CONFIG.defaultRepo || '';
            const value = window.prompt('Informe usuario/repositorio ou a URL do repositório GitHub:', atual);
            if (value === null) return;
            const repo = normalizeRepo(value);
            if (!repo) return window.alert('Repositório inválido. Use, por exemplo: joao/nexus-tampermonkey');
            GM_setValue(CONFIG.repoStorageKey, repo);
            window.alert(`Repositório salvo: ${repo}\nRecarregue a página para aplicar.`);
        });
        GM_registerMenuCommand(`Ver versão/cache - ${CONFIG.label}`, () => {
            const repo = GM_getValue(CONFIG.repoStorageKey, '') || CONFIG.defaultRepo || '(não configurado)';
            const cache = GM_getValue(CONFIG.cacheStorageKey, null);
            const data = cache?.savedAt ? new Date(cache.savedAt).toLocaleString('pt-BR') : '—';
            window.alert(`NEXUS ${CONFIG.label}\nRepositório: ${repo}\nCache: ${cache?.version || 'nenhum'}\nSalvo em: ${data}`);
        });
        GM_registerMenuCommand(`Limpar cache - ${CONFIG.label}`, () => {
            if (!window.confirm(`Limpar o cache local do NEXUS ${CONFIG.label}?`)) return;
            GM_deleteValue(CONFIG.cacheStorageKey);
            window.alert('Cache removido. Na próxima abertura o GitHub será obrigatório.');
        });
        GM_registerMenuCommand(`Trocar repositório - ${CONFIG.label}`, () => {
            GM_deleteValue(CONFIG.repoStorageKey);
            window.alert('Configuração removida. Recarregue a página e informe o novo repositório.');
        });
    }
})();
