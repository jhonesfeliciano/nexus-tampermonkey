(() => {
    'use strict';

    const CONFIG = {
        firebaseBase: 'https://acompanhamentos-reta-final-default-rtdb.firebaseio.com',
        mainDataPath: 'Ciclo-semanas-setores/teresina',
        ecosystemKey: 'teresina',
        ecosystemName: 'TERESINA',
        integrationPath: 'Ciclo-semanas-integracao',
        pageId: '297',
        filterButtonId: 'B339887272933488317',
        distributorStatusItem: 'P297_STREPRESENTANTE',
        distributorItem: 'P297_IDREPRESENTANTE',
        noteTypeItem: 'P297_TIPONOTAS',
        reportTypeItem: 'P297_TIPORELATORIO',
        noteTypeValue: 'N',       // Não Atendidas
        reportTypeValue: 'D',     // Detalhada
        detailedRegionId: 'R340593524422423101',
        summarizedRegionId: 'R340232076211860292',
        pendingStorageKey: 'ciclosNotasPerdidasPendingCapture_teresina_V1',
        panelId: 'ciclos-tm-panel-teresina',
        requestPollMs: 10000,
        reportReadyTimeoutMs: 90000,
        paginationTimeoutMs: 30000,
        reportStableMs: 900,
        maxPaginationPages: 250
    };

    let panel = null;
    let profileSelect = null;
    let actionButton = null;
    let statusBox = null;
    let matchBox = null;
    let currentRequest = null;
    let availableProfiles = [];
    let pollingTimer = null;
    let isBusy = false;
    let initialized = false;

    try {
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('Abrir painel CICLOS TERESINA', () => {
                if (!isTargetPage()) {
                    window.alert('Esta não parece ser a página Notas Perdidas (página 297). Abra essa página e tente novamente.');
                    return;
                }
                startIntegration(true).catch(console.error);
            });
        }
    } catch (error) {
        console.debug('[CICLOS/TERESINA] Menu não disponível:', error);
    }

    waitForTargetPage(120000)
        .then(found => {
            if (!found) {
                console.info('[CICLOS/TERESINA] Página 297 não detectada. O script permaneceu inativo nesta aba.');
                return;
            }
            return startIntegration(false);
        })
        .catch(error => {
            console.error('[CICLOS/TERESINA] Falha na inicialização:', error);
            if (isTargetPage()) {
                ensurePanel();
                setStatus(`Erro ao iniciar: ${error.message}`, 'error');
            }
        });

    async function startIntegration(forceOpen = false) {
        if (initialized) {
            ensurePanel();
            if (forceOpen && panel) panel.classList.remove('ciclos-min');
            return;
        }
        initialized = true;
        ensurePanel();
        if (forceOpen && panel) panel.classList.remove('ciclos-min');
        await init();
    }

    async function init() {
        const pendingCapture = GM_getValue(CONFIG.pendingStorageKey, null);
        if (pendingCapture) {
            isBusy = true;
            lockPanel('Capturando os dados filtrados...');
            await resumeCapture(pendingCapture);
            return;
        }

        await refreshContext();
        pollingTimer = window.setInterval(() => {
            if (!isBusy) refreshContext(true).catch(error => {
                console.error('[CICLOS/TERESINA] Erro ao consultar solicitações:', error);
                setStatus(`Falha ao consultar o Firebase: ${error.message}`, 'error');
            });
        }, CONFIG.requestPollMs);
    }

    function isTargetPage() {
        const markerIds = [
            CONFIG.distributorStatusItem,
            CONFIG.distributorItem,
            CONFIG.noteTypeItem,
            CONFIG.reportTypeItem,
            CONFIG.filterButtonId
        ];
        const markerCount = markerIds.reduce((total, id) => total + (document.getElementById(id) ? 1 : 0), 0);
        if (markerCount >= 2) return true;

        const hiddenPageId = document.getElementById('pFlowStepId')?.value;
        if (String(hiddenPageId || '') === CONFIG.pageId) return true;
        if (document.body?.classList.contains(`page-${CONFIG.pageId}`)) return true;

        const context = String(document.getElementById('pContext')?.value || '');
        if (new RegExp(`(?:^|:)${CONFIG.pageId}(?::|$)`).test(context)) return true;

        let decodedUrl = location.href;
        try { decodedUrl = decodeURIComponent(location.href); } catch {}
        return new RegExp(`(?:f\?p=[^#]*?:${CONFIG.pageId}(?::|$)|/page[-_]?${CONFIG.pageId}(?:[/?#]|$)|/${CONFIG.pageId}(?:[/?#]|$))`, 'i').test(decodedUrl);
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

    function ensurePanel() {
        if (document.getElementById(CONFIG.panelId)) {
            panel = document.getElementById(CONFIG.panelId);
            profileSelect = panel.querySelector('#ciclos-tm-profile');
            actionButton = panel.querySelector('#ciclos-tm-action');
            statusBox = panel.querySelector('#ciclos-tm-status');
            matchBox = panel.querySelector('#ciclos-tm-match');
            return;
        }

        const style = document.createElement('style');
        style.textContent = `
            #${CONFIG.panelId}{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(390px,calc(100vw - 28px));font-family:Arial,sans-serif;background:#fff;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 18px 50px rgba(15,23,42,.25);overflow:hidden;color:#0f172a}
            #${CONFIG.panelId} *{box-sizing:border-box}
            #${CONFIG.panelId} .ciclos-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;background:linear-gradient(135deg,#0f766e,#0d9488);color:#fff}
            #${CONFIG.panelId} .ciclos-title{font-weight:800;font-size:14px;letter-spacing:.2px}
            #${CONFIG.panelId} .ciclos-sub{font-size:11px;opacity:.85;margin-top:2px}
            #${CONFIG.panelId} .ciclos-body{padding:14px}
            #${CONFIG.panelId} label{display:block;font-size:11px;font-weight:800;text-transform:uppercase;color:#475569;margin:0 0 5px}
            #${CONFIG.panelId} select{width:100%;height:42px;border:1px solid #cbd5e1;border-radius:10px;padding:0 10px;background:#fff;color:#0f172a;font-weight:700}
            #${CONFIG.panelId} button{width:100%;height:44px;border:0;border-radius:11px;margin-top:10px;background:#059669;color:#fff;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 8px 18px rgba(5,150,105,.22)}
            #${CONFIG.panelId} button:hover{background:#047857}
            #${CONFIG.panelId} button:disabled{cursor:not-allowed;opacity:.55;box-shadow:none}
            #${CONFIG.panelId} .ciclos-status,#${CONFIG.panelId} .ciclos-match{margin-top:9px;padding:9px 10px;border-radius:9px;font-size:12px;line-height:1.45;background:#f8fafc;border:1px solid #e2e8f0;color:#475569}
            #${CONFIG.panelId} .ciclos-status[data-kind="success"]{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
            #${CONFIG.panelId} .ciclos-status[data-kind="warning"]{background:#fffbeb;border-color:#fde68a;color:#92400e}
            #${CONFIG.panelId} .ciclos-status[data-kind="error"]{background:#fff1f2;border-color:#fecdd3;color:#be123c}
            #${CONFIG.panelId} .ciclos-close{width:30px;height:30px;margin:0;background:rgba(255,255,255,.15);box-shadow:none;border-radius:8px;font-size:18px;line-height:1}
            #${CONFIG.panelId}.ciclos-min .ciclos-body{display:none}
        `;
        document.head.appendChild(style);

        panel = document.createElement('section');
        panel.id = CONFIG.panelId;
        panel.innerHTML = `
            <div class="ciclos-head">
                <div>
                    <div class="ciclos-title">TERESINA • Atualização <span style="font-size:10px;opacity:.8">v1.9</span></div>
                    <div class="ciclos-sub">Notas Perdidas → Nexus TERESINA</div>
                </div>
                <button type="button" class="ciclos-close" title="Minimizar">−</button>
            </div>
            <div class="ciclos-body">
                <label for="ciclos-tm-profile">Distribuidor • TERESINA</label>
                <select id="ciclos-tm-profile"><option value="">Carregando distribuidores...</option></select>
                <button type="button" id="ciclos-tm-action">Filtrar e enviar dados</button>
                <div id="ciclos-tm-match" class="ciclos-match">Selecione um distribuidor de TERESINA.</div>
                <div id="ciclos-tm-status" class="ciclos-status">Carregando distribuidores de TERESINA...</div>
            </div>
        `;
        (document.body || document.documentElement).appendChild(panel);

        profileSelect = panel.querySelector('#ciclos-tm-profile');
        actionButton = panel.querySelector('#ciclos-tm-action');
        statusBox = panel.querySelector('#ciclos-tm-status');
        matchBox = panel.querySelector('#ciclos-tm-match');

        panel.querySelector('.ciclos-close').addEventListener('click', () => {
            panel.classList.toggle('ciclos-min');
            panel.querySelector('.ciclos-close').textContent = panel.classList.contains('ciclos-min') ? '+' : '−';
        });
        profileSelect.addEventListener('change', previewMatch);
        actionButton.addEventListener('click', startFilterAndSend);
    }

    function extractDistributorNames(raw) {
        const names = toArray(raw).map(item => {
            if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
            if (item && typeof item === 'object') {
                return String(item.name || item.nome || item.profile || item.value || '').trim();
            }
            return '';
        }).filter(Boolean);
        return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
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

    function localDistributorName(name) {
        const target = normalizePersonName(name);
        return availableProfiles.find(item => normalizePersonName(item) === target) || '';
    }

    function requestBelongsHere(request) {
        if (!request || request.status !== 'pending' || !request.profile) return false;
        const explicitKey = normalizeKey(request.ecosystemKey || request.workspaceKey || request.dataKey || '');
        if (explicitKey && explicitKey !== CONFIG.ecosystemKey) return false;
        return Boolean(localDistributorName(request.profile));
    }

    async function refreshContext(silent = false) {
        const [profilesRaw, requestsRaw] = await Promise.all([
            firebaseRequest('GET', `${CONFIG.mainDataPath}/profiles.json`),
            firebaseRequest('GET', `${CONFIG.integrationPath}/requests.json`)
        ]);

        availableProfiles = extractDistributorNames(profilesRaw);
        const requests = flattenIntegrationRequests(requestsRaw);
        const newestPending = requests
            .filter(requestBelongsHere)
            .sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0))[0] || null;

        const oldSelected = profileSelect.value;
        profileSelect.innerHTML = '<option value="">Selecione o distribuidor...</option>';
        availableProfiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile;
            option.textContent = profile;
            profileSelect.appendChild(option);
        });

        currentRequest = newestPending;
        if (newestPending) {
            const exactName = localDistributorName(newestPending.profile);
            if (exactName) profileSelect.value = exactName;
            setStatus(`Solicitação de TERESINA recebida para “${newestPending.profile}”. Clique para atender.`, 'warning');
            actionButton.textContent = 'Atender solicitação e enviar';
            panel.classList.remove('ciclos-min');
        } else if (oldSelected && localDistributorName(oldSelected)) {
            profileSelect.value = localDistributorName(oldSelected);
            if (!silent) setStatus(`TERESINA: selecione o distribuidor e clique para filtrar e enviar.`, 'info');
            actionButton.textContent = 'Filtrar e enviar dados';
        } else {
            if (!silent) {
                const qtd = availableProfiles.length;
                setStatus(`${qtd} distribuidor${qtd === 1 ? '' : 'es'} carregado${qtd === 1 ? '' : 's'} exclusivamente de TERESINA.`, qtd ? 'success' : 'warning');
            }
            actionButton.textContent = 'Filtrar e enviar dados';
        }

        previewMatch();
    }

    function previewMatch() {
        const profile = profileSelect?.value;
        if (!profile) {
            matchBox.textContent = 'Selecione um distribuidor de TERESINA.';
            return;
        }
        const match = findBestDistributor(profile);
        if (!match) {
            matchBox.textContent = `Ainda não encontrei um distribuidor parecido com “${profile}”.`;
            return;
        }
        matchBox.textContent = `Correspondência: ${match.text} (${Math.round(match.score * 100)}%)`;
    }

    async function startFilterAndSend() {
        if (isBusy) return;
        const profile = profileSelect.value;
        if (!profile) {
            setStatus('Selecione um distribuidor de TERESINA antes de continuar.', 'warning');
            return;
        }

        isBusy = true;
        lockPanel('Preparando os filtros da página...');

        try {
            setApexItem(CONFIG.distributorStatusItem, 'A');
            await wait(350);

            const match = await waitForDistributorMatch(profile, 8000);
            if (!match || match.score < 0.42) {
                throw new Error(`Não foi possível localizar um distribuidor compatível com “${profile}”.`);
            }

            setApexItem(CONFIG.distributorItem, match.value);
            setApexItem(CONFIG.noteTypeItem, CONFIG.noteTypeValue);
            setApexItem(CONFIG.reportTypeItem, CONFIG.reportTypeValue);

            const requestForProfile = currentRequest
                && normalizeText(currentRequest.profile) === normalizeText(profile)
                && (!currentRequest.ecosystemKey || normalizeKey(currentRequest.ecosystemKey) === CONFIG.ecosystemKey)
                ? currentRequest
                : null;

            const pendingCapture = {
                version: 3,
                profile,
                ecosystemKey: CONFIG.ecosystemKey,
                ecosystemName: CONFIG.ecosystemName,
                profileKey: requestForProfile?.profileKey || makeProfileKey(profile),
                requestKey: requestForProfile?.key || requestForProfile?.profileKey || makeProfileKey(profile),
                requestId: requestForProfile?.requestId || `manual-${Date.now()}`,
                requestedAt: Number(requestForProfile?.requestedAt || Date.now()),
                startedAt: Date.now(),
                matchedDistributor: match.text,
                distributorId: match.value
            };

            GM_setValue(CONFIG.pendingStorageKey, pendingCapture);
            setStatus(`TERESINA → “${match.text}”. A página será filtrada agora.`, 'success');

            await wait(250);
            const filterButton = document.getElementById(CONFIG.filterButtonId)
                || [...document.querySelectorAll('button')].find(button => normalizeText(button.textContent) === 'filtrar');
            if (filterButton) {
                filterButton.click();
                return;
            }
            if (window.apex?.submit) {
                window.apex.submit({ request: 'FITLRAR', validate: true });
                return;
            }
            throw new Error('O botão Filtrar não foi encontrado nesta página.');
        } catch (error) {
            GM_deleteValue(CONFIG.pendingStorageKey);
            isBusy = false;
            unlockPanel();
            setStatus(error.message, 'error');
        }
    }

    async function resumeCapture(pendingCapture) {
        try {
            setStatus(`Filtro concluído para “${pendingCapture.profile}”. Aguardando o Oracle APEX finalizar...`, 'warning');
            await waitForDocumentAndApexReady(CONFIG.reportReadyTimeoutMs);
            const collection = await collectAllReportRows();
            const payload = buildPayload(collection.rows, collection.headers, pendingCapture);

            setStatus(`Enviando ${payload.validRowCount} registros ao Firebase...`, 'warning');
            const firebaseSafePayload = encodeFirebaseObjectKeys(payload);
            await firebaseRequest(
                'PUT',
                `${CONFIG.integrationPath}/results/${pendingCapture.profileKey}.json`,
                firebaseSafePayload
            );

            if (pendingCapture.requestKey) {
                await firebaseRequest(
                    'PATCH',
                    `${CONFIG.integrationPath}/requests/${pendingCapture.requestKey}.json`,
                    {
                        status: 'done',
                        ecosystemKey: CONFIG.ecosystemKey,
                        ecosystemName: CONFIG.ecosystemName,
                        completedAt: Date.now(),
                        resultCreatedAt: payload.createdAt,
                        matchedDistributor: pendingCapture.matchedDistributor,
                        validRowCount: payload.validRowCount,
                        totalAtrasadas: payload.totals.atrasadas,
                        totalEmDia: payload.totals.emDia
                    }
                );
            }

            GM_deleteValue(CONFIG.pendingStorageKey);
            setStatus(
                `Envio concluído: ${payload.validRowCount} registros, ${payload.totals.atrasadas} atrasadas e ${payload.totals.emDia} em dia.`,
                'success'
            );
            matchBox.textContent = `Dados enviados para ${pendingCapture.ecosystemName || CONFIG.ecosystemName} → “${pendingCapture.profile}”.`;
            actionButton.disabled = false;
            profileSelect.disabled = false;
            actionButton.textContent = 'Enviar novamente';
            isBusy = false;
            await refreshContext(true);
        } catch (error) {
            console.error('[CICLOS/TERESINA] Erro na captura:', error);
            GM_deleteValue(CONFIG.pendingStorageKey);
            setStatus(`Falha na captura: ${error.message}`, 'error');
            matchBox.textContent = 'Revise os filtros ou a estrutura das colunas do relatório.';
            actionButton.disabled = false;
            profileSelect.disabled = false;
            actionButton.textContent = 'Tentar novamente';
            isBusy = false;
        }
    }

    async function collectAllReportRows() {
        let region = await waitForReportRegion(CONFIG.reportReadyTimeoutMs);
        await waitForReportReady(region, CONFIG.reportReadyTimeoutMs);

        const allRows = [];
        const seen = new Set();
        let masterHeaders = [];
        let previousSignature = '';

        for (let page = 1; page <= CONFIG.maxPaginationPages; page++) {
            // O APEX pode reconstruir internamente a região após a paginação.
            region = findReportRegion() || region;
            await waitForReportReady(region, CONFIG.paginationTimeoutMs);

            const current = extractCurrentPage(region);
            if (!masterHeaders.length && current.headers.length) masterHeaders = current.headers;

            current.rows.forEach(row => {
                const signature = JSON.stringify(row);
                if (!seen.has(signature)) {
                    seen.add(signature);
                    allRows.push(row);
                }
            });

            setStatus(`Capturando o relatório: página ${page}, ${allRows.length} registros encontrados...`, 'warning');

            const nextButton = findNextPaginationButton(region);
            if (!nextButton) break;

            const currentSignature = reportSignature(region);
            if (currentSignature && currentSignature === previousSignature) break;
            previousSignature = currentSignature;

            nextButton.click();
            const changed = await waitForReportChange(currentSignature, CONFIG.paginationTimeoutMs);
            if (!changed) {
                console.warn('[CICLOS/TERESINA] A paginação não alterou o relatório; a captura foi encerrada na página atual.');
                break;
            }
        }

        return { rows: allRows, headers: masterHeaders };
    }

    async function waitForDocumentAndApexReady(timeoutMs) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const domReady = document.readyState === 'interactive' || document.readyState === 'complete';
            const apexReady = !window.apex || Boolean(window.apex.jQuery);
            if (domReady && apexReady) {
                // Pequena estabilização: o document-idle pode ocorrer antes dos últimos
                // componentes do Interactive Report terminarem a montagem.
                await wait(450);
                return;
            }
            await wait(200);
        }
        throw new Error('A página não terminou de inicializar dentro do tempo esperado.');
    }

    async function waitForReportRegion(timeoutMs) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const region = findReportRegion();
            if (region) return region;
            await wait(250);
        }
        throw new Error('A região do relatório “Notas Perdidas” não foi encontrada.');
    }

    function findReportRegion() {
        const candidates = [];
        const add = element => {
            if (element && !candidates.includes(element)) candidates.push(element);
        };

        // O relatório detalhado filtrado usa uma região diferente do relatório resumido.
        // A versão anterior priorizava apenas o ID do resumido e podia ler a região errada.
        add(document.getElementById(CONFIG.detailedRegionId));
        add(document.getElementById(`${CONFIG.detailedRegionId}_ir`));
        add(document.getElementById(CONFIG.summarizedRegionId));
        add(document.getElementById(`${CONFIG.summarizedRegionId}_ir`));
        document.querySelectorAll('[role="region"][aria-label*="Notas Perdidas"], [role="region"][aria-label*="notas perdidas"], .t-Region').forEach(add);
        document.querySelectorAll('.a-IRR').forEach(element => add(element.closest('.t-Region') || element));

        const scored = candidates
            .map(element => {
                const text = normalizeText([
                    element.getAttribute?.('aria-label'),
                    element.querySelector?.('.t-Region-title')?.textContent,
                    element.id
                ].filter(Boolean).join(' '));
                const hasIrr = Boolean(element.matches?.('.a-IRR, .a-IRR-container') || element.querySelector?.('.a-IRR, .a-IRR-container'));
                const hasReportContent = Boolean(findReportTable(element) || findVisibleNoData(element));
                let score = 0;
                if (text.includes('notas perdidas')) score += 8;
                if (text.includes('detalhad')) score += 8;
                if (hasIrr) score += 4;
                if (hasReportContent) score += 5;
                if (isElementVisible(element)) score += 6;
                if (element.id === CONFIG.detailedRegionId || element.id === `${CONFIG.detailedRegionId}_ir`) score += 15;
                if (element.id === CONFIG.summarizedRegionId || element.id === `${CONFIG.summarizedRegionId}_ir`) score += 2;
                return { element, score };
            })
            .filter(item => item.score >= 5)
            .sort((a, b) => b.score - a.score);

        return scored[0]?.element || null;
    }

    async function waitForReportReady(region, timeoutMs) {
        const startedAt = Date.now();
        let stableSince = 0;
        let lastSignature = '';

        while (Date.now() - startedAt < timeoutMs) {
            const currentRegion = findReportRegion() || region;
            const table = findReportTable(currentRegion);
            const noData = findVisibleNoData(currentRegion);
            const busy = hasVisibleProcessing(currentRegion);
            const signature = reportSignature(currentRegion);
            const hasUsableResult = Boolean(table || noData);

            if (hasUsableResult) {
                if (signature !== lastSignature) {
                    lastSignature = signature;
                    stableSince = Date.now();
                } else if (!stableSince) {
                    stableSince = Date.now();
                }

                const stableFor = Date.now() - stableSince;
                // Normalmente aguardamos o indicador desaparecer. Se algum plugin do
                // APEX deixar um spinner preso na tela, uma tabela estável por 4s já
                // é considerada segura para leitura e o processo não fica travado.
                if (stableFor >= CONFIG.reportStableMs && (!busy || stableFor >= 4000)) return;
            } else {
                stableSince = 0;
                lastSignature = signature;
            }

            await wait(250);
        }

        const diagnosticRegion = findReportRegion() || region;
        const diagnostic = [
            `região=${diagnosticRegion ? 'encontrada' : 'não encontrada'}`,
            `tabela=${findReportTable(diagnosticRegion) ? 'sim' : 'não'}`,
            `mensagem=${findVisibleNoData(diagnosticRegion) ? 'sim' : 'não'}`,
            `processando=${hasVisibleProcessing(diagnosticRegion) ? 'sim' : 'não'}`
        ].join(', ');
        throw new Error(`O relatório não ficou pronto para leitura (${diagnostic}).`);
    }

    function findReportTable(region) {
        if (!region) return null;
        const preferred = [
            ...region.querySelectorAll('.a-IRR-reportView table.a-IRR-table, .a-IRR-reportView table, table.a-IRR-table')
        ];
        const candidates = preferred.length ? preferred : [...region.querySelectorAll('table')];
        return candidates.find(table => {
            const hasHeaders = Boolean(table.querySelector('tr th'));
            const hasRows = Boolean(table.querySelector('tr'));
            return hasHeaders && hasRows && isElementVisible(table);
        }) || candidates.find(table => table.querySelector('tr th') && table.querySelector('tr')) || null;
    }

    function findVisibleNoData(region) {
        if (!region) return null;
        const selectors = [
            '.a-IRR-noDataMsg',
            '.a-IRR-noDataMsg-text',
            '.nodatafound',
            '.t-Alert--defaultIcons.t-Alert--warning',
            '[role="region"][aria-label="Mensagem"]'
        ];
        const candidates = [...region.querySelectorAll(selectors.join(','))];
        return candidates.find(element => {
            const text = normalizeText(element.textContent);
            return isElementVisible(element) && /nenhum|nenhuma|nao encontr|sem dados|no data/.test(text);
        }) || null;
    }

    function hasVisibleProcessing(region) {
        const selectors = [
            '.u-Processing',
            '.a-LoadingSpinner',
            '.apex-item-option--loading',
            '.a-IRR-busyIndicator',
            '.a-IRR-loading',
            '.a-GV-w-scroll .u-Processing',
            '[aria-busy="true"]'
        ];
        const roots = [document, region].filter(Boolean);
        for (const root of roots) {
            for (const element of root.querySelectorAll(selectors.join(','))) {
                if (isElementVisible(element)) return true;
            }
        }
        return false;
    }

    function isElementVisible(element) {
        if (!element || !element.isConnected) return false;
        if (element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function extractCurrentPage(region) {
        const table = findReportTable(region);
        if (!table) return { headers: [], rows: [] };

        const tableRows = [...table.querySelectorAll('tr')];

        // No HTML real do APEX não existe <thead>. O primeiro <tr> é o cabeçalho
        // agrupado "Distribuidor: ..., Região: ..." e o segundo contém as 19 colunas.
        const columnHeaderRow = tableRows
            .map(tr => ({
                tr,
                ths: [...tr.children].filter(cell => cell.tagName === 'TH')
            }))
            .filter(item => item.ths.length > 1)
            .sort((a, b) => {
                const score = cells => cells.reduce((total, th) => total
                    + (th.id ? 2 : 0)
                    + (th.querySelector('.a-IRR-headerLink') ? 3 : 0)
                    + (th.querySelector('[data-column]') ? 1 : 0), 0);
                return score(b.ths) - score(a.ths) || b.ths.length - a.ths.length;
            })[0] || null;

        const headerCells = columnHeaderRow?.ths || [];
        const headerById = new Map();
        const headers = headerCells.map((th, index) => {
            const label = cleanCellText(th) || `coluna_${index + 1}`;
            if (th.id) headerById.set(th.id, label);
            return label;
        });

        const rows = [];
        let controlDistributor = '';
        let controlRegion = '';

        tableRows.forEach(tr => {
            if (columnHeaderRow && tr === columnHeaderRow.tr) return;

            const cells = [...tr.children].filter(cell => cell.tagName === 'TH' || cell.tagName === 'TD');
            if (!cells.length) return;

            const rowText = cleanCellText(tr);
            const colspan = Number(cells[0].getAttribute('colspan') || 1);
            const isControlBreak = tr.classList.contains('a-IRR-controlBreak')
                || String(tr.className || '').includes('controlBreak')
                || (cells.length === 1 && colspan > 1);

            if (isControlBreak) {
                const group = parseApexControlBreak(rowText);
                if (group.distributor) controlDistributor = group.distributor;
                if (group.region) controlRegion = group.region;
                return;
            }

            // Linhas de dados do relatório possuem TD. Isso impede que cabeçalhos
            // auxiliares do APEX sejam interpretados como notas.
            const dataCells = cells.filter(cell => cell.tagName === 'TD');
            if (!dataCells.length) return;
            // O APEX adiciona uma linha de totalização após cada Região. Essas células
            // usam a classe a-IRR-aggregate e não representam notas reais.
            if (dataCells.some(cell => cell.classList.contains('a-IRR-aggregate'))) return;

            const row = {};
            dataCells.forEach((cell, index) => {
                let key = '';
                const headersAttr = cell.getAttribute('headers');
                if (headersAttr) {
                    for (const id of headersAttr.split(/\s+/)) {
                        if (headerById.has(id)) {
                            key = headerById.get(id);
                            break;
                        }
                    }
                }
                if (!key) key = headers[index] || `coluna_${index + 1}`;
                row[key] = cleanCellText(cell);
            });

            if (controlDistributor) row.__controlDistributor = controlDistributor;
            if (controlRegion) row.__controlRegion = controlRegion;
            if (rowText) row.__sourceRowText = rowText;

            const meaningfulValues = Object.entries(row)
                .filter(([key]) => !key.startsWith('__'))
                .map(([, value]) => value)
                .filter(Boolean);
            if (meaningfulValues.length) rows.push(row);
        });

        return { headers, rows };
    }

    function parseApexControlBreak(text) {
        const source = String(text || '').replace(/\s+/g, ' ').trim();
        const distributorMatch = source.match(/(?:^|[,;]\s*)distribuidor\s*:\s*(.*?)(?=\s*[,;]\s*regi(?:ã|a)o\s*:|$)/i);
        const regionMatch = source.match(/(?:^|[,;]\s*)regi(?:ã|a)o\s*:\s*(.*?)(?=\s*[,;]\s*[A-Za-zÀ-ÿ][^:]{0,40}\s*:|$)/i);

        return {
            distributor: String(distributorMatch?.[1] || '').trim(),
            region: String(regionMatch?.[1] || '').trim()
        };
    }

    function findNextPaginationButton(region) {
        const candidates = [...region.querySelectorAll('.a-IRR-pagination button, .a-IRR-pagination a, button.a-IRR-button--pagination, a.a-IRR-button--pagination')];
        const enabled = candidates.filter(element => {
            const disabled = element.disabled
                || element.getAttribute('aria-disabled') === 'true'
                || element.classList.contains('is-disabled')
                || element.closest('li')?.classList.contains('is-disabled');
            return !disabled && isElementVisible(element);
        });

        return enabled.find(element => {
            const label = normalizeText([
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                element.textContent
            ].filter(Boolean).join(' '));
            return /proxim|seguinte|next/.test(label)
                || Boolean(element.querySelector('.icon-right-chevron, .icon-next, .fa-chevron-right, .fa-angle-right'));
        }) || null;
    }

    async function waitForReportChange(oldSignature, timeoutMs) {
        const startedAt = Date.now();
        let sawBusy = false;
        while (Date.now() - startedAt < timeoutMs) {
            await wait(250);
            const region = findReportRegion();
            const busy = hasVisibleProcessing(region);
            if (busy) sawBusy = true;
            const signature = reportSignature(region);
            if (signature && signature !== oldSignature) {
                await wait(CONFIG.reportStableMs);
                // Mesmo que um indicador visual fique preso, a mudança real da tabela
                // confirma que a paginação terminou.
                return true;
            }
            // Alguns relatórios atualizam tão rápido que o indicador não chega a aparecer.
            if (!busy && sawBusy && signature) return signature !== oldSignature;
        }
        return false;
    }

    function reportSignature(region) {
        if (!region) return '';
        const table = findReportTable(region);
        if (!table) return cleanCellText(findVisibleNoData(region) || '');
        const rows = [...table.querySelectorAll('tr')];
        const pagination = cleanCellText(region.querySelector('.a-IRR-pagination, .a-IRR-pagination-label') || '');
        return `${pagination}|${rows.length}|${cleanCellText(rows[0] || '')}|${cleanCellText(rows.at(-1) || '')}`;
    }

    function buildPayload(rows, fallbackHeaders, pendingCapture) {
        const allHeaders = [...new Set([
            ...fallbackHeaders,
            ...rows.flatMap(row => Object.keys(row).filter(key => !key.startsWith('__')))
        ])];

        const fields = detectFields(allHeaders);
        if (!rows.length) {
            return {
                version: 5,
                firebaseKeyEncoding: FIREBASE_KEY_ENCODING,
                weekGrouping: 'reference-distribution-plus-6',
                source: 'tampermonkey-notas-perdidas',
                requestId: pendingCapture.requestId,
                requestedAt: pendingCapture.requestedAt,
                createdAt: Date.now(),
                profile: pendingCapture.profile,
                profileKey: pendingCapture.profileKey,
                ecosystemKey: pendingCapture.ecosystemKey || CONFIG.ecosystemKey,
                ecosystemName: pendingCapture.ecosystemName || CONFIG.ecosystemName,
                matchedDistributor: pendingCapture.matchedDistributor,
                distributorId: pendingCapture.distributorId,
                noteType: CONFIG.noteTypeValue,
                reportType: CONFIG.reportTypeValue,
                rawRowCount: 0,
                validRowCount: 0,
                totals: { atrasadas: 0, emDia: 0, total: 0 },
                regions: {},
                regionsByWeek: {},
                regionsByCollectionWeek: {},
                regionsByDistributionWeek: {},
                regionsByReferenceWeek: {},
                regionsByReferenceWeekFull: {},
                totalsByWeek: {},
                totalsByCollectionWeek: {},
                totalsByDistributionWeek: {},
                totalsByReferenceWeek: {},
                clientsByCity: {},
                rows: [],
                headersDetected: allHeaders,
                fieldMapping: fields,
                noData: true,
                pageUrl: location.href
            };
        }
        const hasGroupedRegion = rows.some(row => String(row.__controlRegion || '').trim());
        if (!fields.city || !fields.qtdRemarcada || (!fields.region && !hasGroupedRegion)) {
            const regionDiagnostic = hasGroupedRegion
                ? 'Região localizada no cabeçalho agrupado do APEX'
                : 'Região não localizada nem nas colunas nem no cabeçalho agrupado';
            throw new Error(
                `Estrutura necessária não encontrada. Esperado: Cidade, Qtd Remarcada e Região (coluna ou grupo). `
                + `${regionDiagnostic}. Colunas detectadas: ${allHeaders.join(', ') || 'nenhuma coluna'}.`
            );
        }

        const regions = {};
        const regionsByCollectionWeek = {};
        const regionsByDistributionWeek = {};
        // Semana de referência do Nexus = Semana Distribuição + 6 semanas.
        // Isso evita jogar notas remarcadas para a nova Semana Cobrança.
        const regionsByReferenceWeek = {};
        const regionsByReferenceWeekFull = {};
        const totalsByCollectionWeek = {};
        const totalsByDistributionWeek = {};
        const totalsByReferenceWeek = {};
        const clientsByCity = {};
        const canonicalRows = [];
        let totalAtrasadas = 0;
        let totalEmDia = 0;

        rows.forEach(row => {
            const regionOriginal = valueOf(row, fields.region) || String(row.__controlRegion || '').trim();
            const city = valueOf(row, fields.city);
            if (!regionOriginal || !city) return;

            const qtdRemarcada = parseInteger(valueOf(row, fields.qtdRemarcada));
            const distributor = valueOf(row, fields.distributor)
                || row.__controlDistributor
                || pendingCapture.matchedDistributor;
            const clientName = valueOf(row, fields.client) || '—';
            const cpf = valueOf(row, fields.cpf) || '—';
            const saldo = valueOf(row, fields.saldo) || '—';

            const regionKey = normalizeKey(regionOriginal) || 'sem_regiao';
            const noteNumber = valueOf(row, fields.noteNumber) || '—';
            const distributionWeek = valueOf(row, fields.distributionWeek) || '—';
            const collectionWeek = valueOf(row, fields.collectionWeek) || '—';
            const distributionWeekInfo = parseWeekIdentity(distributionWeek);
            const collectionWeekInfo = parseWeekIdentity(collectionWeek);
            const distributionWeekNumber = distributionWeekInfo.week;
            const collectionWeekNumber = collectionWeekInfo.week;
            // Regra operacional do Nexus: a cobrança original acontece 6 semanas após a distribuição.
            // Se a nota foi remarcada, a coluna Cobrança pode mudar; a referência NÃO deve mudar.
            const referenceWeekInfo = distributionWeekInfo.week > 0
                ? addWeeks52(distributionWeekInfo, 6)
                : collectionWeekInfo;
            const referenceWeekNumber = referenceWeekInfo.week;
            const referenceWeekYear = referenceWeekInfo.year;
            const referenceWeekLabel = referenceWeekNumber > 0
                ? `${String(referenceWeekNumber).padStart(2, '0')}${referenceWeekYear ? '/' + referenceWeekYear : ''}`
                : '—';
            const statusCiclo = qtdRemarcada > 0 ? 'atrasadas' : 'emdia';

            // Agregado geral mantido para compatibilidade com versões anteriores do Nexus.
            if (!regions[regionKey]) {
                regions[regionKey] = { nomeOriginal: regionOriginal, atrasadas: {}, emDia: {} };
            }
            const aggregateBucket = qtdRemarcada > 0 ? regions[regionKey].atrasadas : regions[regionKey].emDia;
            aggregateBucket[city] = (aggregateBucket[city] || 0) + 1;

            // V1.9: mantém os dois calendários separados.
            // O Detalhamento do Nexus usa Semana Cobrança; Semana Distribuição fica disponível
            // para auditoria/compatibilidade e para a regra de defasagem de 6 semanas.
            if (collectionWeekNumber > 0) {
                const weekKey = String(collectionWeekNumber);
                if (!regionsByCollectionWeek[weekKey]) regionsByCollectionWeek[weekKey] = {};
                if (!regionsByCollectionWeek[weekKey][regionKey]) {
                    regionsByCollectionWeek[weekKey][regionKey] = { nomeOriginal: regionOriginal, atrasadas: {}, emDia: {} };
                }
                const weekBucket = qtdRemarcada > 0
                    ? regionsByCollectionWeek[weekKey][regionKey].atrasadas
                    : regionsByCollectionWeek[weekKey][regionKey].emDia;
                weekBucket[city] = (weekBucket[city] || 0) + 1;

                if (!totalsByCollectionWeek[weekKey]) totalsByCollectionWeek[weekKey] = { atrasadas: 0, emDia: 0, total: 0 };
                if (qtdRemarcada > 0) totalsByCollectionWeek[weekKey].atrasadas++;
                else totalsByCollectionWeek[weekKey].emDia++;
                totalsByCollectionWeek[weekKey].total++;
            }

            if (referenceWeekNumber > 0) {
                const weekKey = String(referenceWeekNumber);
                if (!regionsByReferenceWeek[weekKey]) regionsByReferenceWeek[weekKey] = {};
                if (!regionsByReferenceWeek[weekKey][regionKey]) {
                    regionsByReferenceWeek[weekKey][regionKey] = { nomeOriginal: regionOriginal, atrasadas: {}, emDia: {} };
                }
                const referenceBucket = qtdRemarcada > 0
                    ? regionsByReferenceWeek[weekKey][regionKey].atrasadas
                    : regionsByReferenceWeek[weekKey][regionKey].emDia;
                referenceBucket[city] = (referenceBucket[city] || 0) + 1;

                if (!totalsByReferenceWeek[weekKey]) totalsByReferenceWeek[weekKey] = { atrasadas: 0, emDia: 0, total: 0 };
                if (qtdRemarcada > 0) totalsByReferenceWeek[weekKey].atrasadas++;
                else totalsByReferenceWeek[weekKey].emDia++;
                totalsByReferenceWeek[weekKey].total++;

                if (referenceWeekYear) {
                    const fullKey = `${referenceWeekNumber}/${referenceWeekYear}`;
                    if (!regionsByReferenceWeekFull[fullKey]) regionsByReferenceWeekFull[fullKey] = {};
                    if (!regionsByReferenceWeekFull[fullKey][regionKey]) {
                        regionsByReferenceWeekFull[fullKey][regionKey] = { nomeOriginal: regionOriginal, atrasadas: {}, emDia: {} };
                    }
                    const fullBucket = qtdRemarcada > 0
                        ? regionsByReferenceWeekFull[fullKey][regionKey].atrasadas
                        : regionsByReferenceWeekFull[fullKey][regionKey].emDia;
                    fullBucket[city] = (fullBucket[city] || 0) + 1;
                }
            }

            if (distributionWeekNumber > 0) {
                const weekKey = String(distributionWeekNumber);
                if (!regionsByDistributionWeek[weekKey]) regionsByDistributionWeek[weekKey] = {};
                if (!regionsByDistributionWeek[weekKey][regionKey]) {
                    regionsByDistributionWeek[weekKey][regionKey] = { nomeOriginal: regionOriginal, atrasadas: {}, emDia: {} };
                }
                const weekBucket = qtdRemarcada > 0
                    ? regionsByDistributionWeek[weekKey][regionKey].atrasadas
                    : regionsByDistributionWeek[weekKey][regionKey].emDia;
                weekBucket[city] = (weekBucket[city] || 0) + 1;

                if (!totalsByDistributionWeek[weekKey]) totalsByDistributionWeek[weekKey] = { atrasadas: 0, emDia: 0, total: 0 };
                if (qtdRemarcada > 0) totalsByDistributionWeek[weekKey].atrasadas++;
                else totalsByDistributionWeek[weekKey].emDia++;
                totalsByDistributionWeek[weekKey].total++;
            }

            if (qtdRemarcada > 0) totalAtrasadas++;
            else totalEmDia++;

            const cityKey = normalizeText(city);
            if (!clientsByCity[cityKey]) clientsByCity[cityKey] = [];
            const situation = valueOf(row, fields.situation) || '—';
            const address = valueOf(row, fields.address) || '—';
            const phones = valueOf(row, fields.phones) || '—';
            const distributorAttends = valueOf(row, fields.distributorAttends) || '—';

            clientsByCity[cityKey].push({
                nome: clientName,
                cpf,
                saldo,
                regiao: regionOriginal,
                cidade: city,
                qtdRemarcada,
                statusCiclo,
                nrNota: noteNumber,
                distribuicao: distributionWeek,
                semanaDistribuicaoNumero: distributionWeekNumber,
                cobranca: collectionWeek,
                semanaCobrancaNumero: collectionWeekNumber,
                semanaReferencia: referenceWeekLabel,
                semanaReferenciaNumero: referenceWeekNumber,
                semanaReferenciaAno: referenceWeekYear || 0,
                situacao: situation,
                endereco: address,
                telefones: phones,
                distribuidorAtende: distributorAttends
            });

            canonicalRows.push({
                distribuidor: distributor,
                regiao: regionOriginal,
                cidade: city,
                qtdRemarcada,
                statusCiclo,
                cliente: clientName,
                cpf,
                saldo,
                nrNota: noteNumber,
                distribuicao: distributionWeek,
                semanaDistribuicaoNumero: distributionWeekNumber,
                cobranca: collectionWeek,
                semanaCobrancaNumero: collectionWeekNumber,
                semanaReferencia: referenceWeekLabel,
                semanaReferenciaNumero: referenceWeekNumber,
                semanaReferenciaAno: referenceWeekYear || 0,
                situacao: situation,
                endereco: address,
                telefones: phones,
                distribuidorAtende: distributorAttends
            });
        });

        const regionsByWeek = Object.keys(regionsByReferenceWeek).length
            ? regionsByReferenceWeek
            : (Object.keys(regionsByCollectionWeek).length ? regionsByCollectionWeek : regionsByDistributionWeek);
        const totalsByWeek = Object.keys(totalsByReferenceWeek).length
            ? totalsByReferenceWeek
            : (Object.keys(totalsByCollectionWeek).length ? totalsByCollectionWeek : totalsByDistributionWeek);

        return {
            version: 5,
            firebaseKeyEncoding: FIREBASE_KEY_ENCODING,
            weekGrouping: Object.keys(regionsByReferenceWeek).length ? 'reference-distribution-plus-6' : (Object.keys(regionsByCollectionWeek).length ? 'collection' : 'distribution'),
            source: 'tampermonkey-notas-perdidas',
            requestId: pendingCapture.requestId,
            requestedAt: pendingCapture.requestedAt,
            createdAt: Date.now(),
            profile: pendingCapture.profile,
            profileKey: pendingCapture.profileKey,
            ecosystemKey: pendingCapture.ecosystemKey || CONFIG.ecosystemKey,
            ecosystemName: pendingCapture.ecosystemName || CONFIG.ecosystemName,
            matchedDistributor: pendingCapture.matchedDistributor,
            distributorId: pendingCapture.distributorId,
            noteType: CONFIG.noteTypeValue,
            reportType: CONFIG.reportTypeValue,
            rawRowCount: rows.length,
            validRowCount: canonicalRows.length,
            totals: { atrasadas: totalAtrasadas, emDia: totalEmDia, total: totalAtrasadas + totalEmDia },
            regions,
            regionsByWeek,
            regionsByCollectionWeek,
            regionsByDistributionWeek,
            regionsByReferenceWeek,
            regionsByReferenceWeekFull,
            totalsByWeek,
            totalsByCollectionWeek,
            totalsByDistributionWeek,
            totalsByReferenceWeek,
            clientsByCity,
            rows: canonicalRows,
            headersDetected: allHeaders,
            fieldMapping: {
                ...fields,
                regionSource: fields.region || '__controlRegion',
                distributorSource: fields.distributor || '__controlDistributor'
            },
            pageUrl: location.href
        };
    }

    function detectFields(headers) {
        return {
            // "Distribuidor Atende" não é o distribuidor selecionado. O nome correto
            // vem do cabeçalho agrupado "Distribuidor: ...".
            distributor: findHeader(headers, [
                /(^| )distribuidor( |$)/,
                /(^| )representante( |$)/
            ], [/atende/, /atendimento/]),
            region: findHeader(headers, [
                /(^| )regiao( |$)/,
                /(^| )setor( |$)/,
                /(^| )rota( |$)/
            ]),
            city: findHeader(headers, [
                /(^| )cidade( |$)/,
                /(^| )municipio( |$)/,
                /(^| )localidade( |$)/
            ]),
            qtdRemarcada: findHeader(headers, [
                /qtd.*remarc/,
                /qtde.*remarc/,
                /quantidade.*remarc/,
                /remarcad/
            ]),
            client: findHeader(headers, [
                /(^| )vendedora( |$)/,
                /(^| )vendedor( |$)/,
                /(^| )nome.*cliente( |$)/,
                /(^| )cliente( |$)/,
                /(^| )pessoa( |$)/
            ], [/cidade/]),
            cpf: findHeader(headers, [/(^| )cpf( |$)/, /documento/]),
            saldo: findHeader(headers, [/(^| )saldo( |$)/, /valor.*saldo/, /debito/]),
            noteNumber: findHeader(headers, [/nr.*nota/, /numero.*nota/, /(^| )nota( |$)/]),
            distributionWeek: findHeader(headers, [/distribuicao/]),
            collectionWeek: findHeader(headers, [/cobranca/]),
            situation: findHeader(headers, [/situacao/, /status/]),
            address: findHeader(headers, [/endereco/]),
            phones: findHeader(headers, [/telefone/]),
            distributorAttends: findHeader(headers, [/distribuidor.*atende/])
        };
    }

    function findHeader(headers, patterns, exclusions = []) {
        return headers.find(header => {
            const normalized = normalizeText(header);
            return patterns.some(pattern => pattern.test(normalized))
                && !exclusions.some(pattern => pattern.test(normalized));
        }) || '';
    }

    function valueOf(row, key) {
        return key ? String(row[key] ?? '').trim() : '';
    }

    function parseWeekIdentity(value) {
        const source = String(value || '').trim();
        if (!source || source === '—') return { week: 0, year: 0 };
        const match = source.match(/(?:sem(?:ana)?\.?\s*)?(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/i);
        let week = Number(match?.[1] || 0);
        let year = Number(match?.[2] || 0);
        if (year > 0 && year < 100) year += 2000;
        if (!Number.isFinite(week) || week < 1 || week > 53) week = 0;
        return { week, year: Number.isFinite(year) ? year : 0 };
    }

    function addWeeks52(info, amount) {
        let week = Number(info?.week || 0);
        let year = Number(info?.year || 0);
        if (!week) return { week: 0, year: 0 };
        let total = week + Number(amount || 0);
        // O ciclo operacional do Nexus trabalha com 52 semanas.
        while (total > 52) {
            total -= 52;
            if (year) year += 1;
        }
        while (total < 1) {
            total += 52;
            if (year) year -= 1;
        }
        return { week: total, year };
    }

    function extractWeekNumber(value) {
        const source = String(value || '').trim();
        if (!source || source === '—') return 0;
        const labeled = source.match(/(?:sem(?:ana)?\.?\s*)?(\d{1,2})(?:\s*\/\s*\d{2,4})?/i);
        const n = Number(labeled?.[1] || 0);
        return Number.isFinite(n) && n >= 1 && n <= 53 ? n : 0;
    }

    function parseInteger(value) {
        const matches = String(value || '').match(/-?\d+/g);
        if (!matches) return 0;
        return Number.parseInt(matches.join(''), 10) || 0;
    }

    async function waitForDistributorMatch(profile, timeoutMs) {
        const started = Date.now();
        let best = null;
        while (Date.now() - started < timeoutMs) {
            best = findBestDistributor(profile);
            if (best && best.score >= 0.72) return best;
            await wait(250);
        }
        return best;
    }

    function findBestDistributor(profile) {
        const select = document.getElementById(CONFIG.distributorItem);
        if (!select) return null;

        const options = [...select.options]
            .filter(option => option.value && option.textContent.trim())
            .map(option => ({
                value: option.value,
                text: option.textContent.trim(),
                score: similarityScore(profile, option.textContent)
            }))
            .sort((a, b) => b.score - a.score);

        return options[0] || null;
    }

    function similarityScore(profile, optionText) {
        const profileNorm = normalizePersonName(profile);
        const optionNorm = normalizePersonName(optionText);
        if (!profileNorm || !optionNorm) return 0;
        if (profileNorm === optionNorm) return 1;
        if (optionNorm.includes(profileNorm)) return 0.98;

        const profileTokens = personTokens(profileNorm);
        const optionTokens = personTokens(optionNorm);
        if (!profileTokens.length || !optionTokens.length) return 0;

        const intersection = profileTokens.filter(token => optionTokens.includes(token));
        const coverage = intersection.length / profileTokens.length;
        const precision = intersection.length / optionTokens.length;
        const firstNameBonus = profileTokens[0] === optionTokens[0] ? 0.08 : 0;
        const firstTwoBonus = profileTokens.slice(0, 2).every((token, index) => optionTokens[index] === token) ? 0.10 : 0;
        return Math.min(1, coverage * 0.74 + precision * 0.08 + firstNameBonus + firstTwoBonus);
    }

    function normalizePersonName(value) {
        return normalizeText(value)
            .replace(/\b(inativa?|ativo|inativo)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function personTokens(value) {
        const stopWords = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
        return value.split(' ').filter(token => token.length > 1 && !stopWords.has(token));
    }

    function setApexItem(id, value) {
        const element = document.getElementById(id);
        if (!element) return;

        try {
            if (window.apex?.item) {
                window.apex.item(id).setValue(value, null, false);
            }
        } catch (error) {
            console.debug('[CICLOS/TERESINA] apex.item.setValue indisponível:', error);
        }

        if (element.matches('select, input:not([type="radio"])')) {
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }

        const radio = document.querySelector(`input[name="${CSS.escape(id)}"][value="${CSS.escape(String(value))}"]`)
            || document.getElementById(`${id}_${value}`);
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function lockPanel(message) {
        actionButton.disabled = true;
        profileSelect.disabled = true;
        actionButton.textContent = 'Processando...';
        setStatus(message, 'warning');
    }

    function unlockPanel() {
        actionButton.disabled = false;
        profileSelect.disabled = false;
        actionButton.textContent = 'Filtrar e enviar dados';
    }

    function setStatus(message, kind = 'info') {
        if (!statusBox) return;
        statusBox.textContent = message;
        statusBox.dataset.kind = kind;
    }

    function toArray(value) {
        if (Array.isArray(value)) return value.filter(item => item != null);
        if (value && typeof value === 'object') return Object.values(value).filter(item => item != null);
        return [];
    }

    function makeProfileKey(profile) {
        const normalized = normalizeKey(profile) || 'perfil';
        let hash = 2166136261;
        for (const char of String(profile || '')) {
            hash ^= char.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return `${normalized}_${(hash >>> 0).toString(36)}`;
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

    function cleanCellText(element) {
        if (!element) return '';
        return String(element.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const FIREBASE_KEY_ENCODING = 'percent-v1';

    function encodeFirebaseKey(key) {
        const text = String(key ?? '');
        if (!text) return '%00EMPTY%';
        return text
            .replace(/%/g, '%25')
            .replace(/[.#$\[\]\/\u0000-\u001F\u007F]/g, char =>
                `%${char.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`
            );
    }

    function encodeFirebaseObjectKeys(value) {
        if (Array.isArray(value)) return value.map(encodeFirebaseObjectKeys);
        if (!value || typeof value !== 'object') return value;

        const output = {};
        for (const [key, item] of Object.entries(value)) {
            output[encodeFirebaseKey(key)] = encodeFirebaseObjectKeys(item);
        }
        return output;
    }

    function firebaseRequest(method, path, body) {
        const url = `${CONFIG.firebaseBase}/${path.replace(/^\/+/, '')}`;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
                data: body === undefined ? undefined : JSON.stringify(body),
                timeout: 30000,
                onload: response => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`Firebase respondeu ${response.status}: ${response.responseText || 'erro desconhecido'}`));
                        return;
                    }
                    if (!response.responseText) {
                        resolve(null);
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch {
                        resolve(response.responseText);
                    }
                },
                onerror: () => reject(new Error('Falha de rede ao acessar o Firebase.')),
                ontimeout: () => reject(new Error('Tempo esgotado ao acessar o Firebase.'))
            });
        });
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }
})();