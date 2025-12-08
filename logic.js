/**
 * Core Logic Library
 * Description: Shared utilities and state management.
 * Usage: Available globally as window.MarketFacilCore
 */
(function () {
    const API_BASE_URL = "https://mlb-proxy-fdb71524fd60.herokuapp.com";

    const Core = {
        _sellerId: null,

        getConfig: function () {
            return window.appConfig || {};
        },

        apiFetch: async function (endpoint, options = {}) {
            const config = this.getConfig();
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };

            if (config.token) {
                headers['Authorization'] = `Bearer ${config.token}`;
            }

            try {
                const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                    ...options,
                    headers
                });
                return response;
            } catch (error) {
                console.error('Core Fetch Error:', error);
                throw error;
            }
        },

        checkApiStatus: async function (targetElementId) {
            const statusDisplay = document.getElementById(targetElementId);
            if (statusDisplay) statusDisplay.innerHTML = '<span class="status-indicator" style="background-color: #e0f2fe; color: #0284c7;">Verificando...</span>';

            try {
                const response = await this.apiFetch('/');
                if (response.ok) {
                    if (statusDisplay) {
                        statusDisplay.innerHTML = `
                            <span class="status-indicator">Online</span>
                            <p style="margin-top: 8px; font-size: 0.9rem;">Status: ${response.status}</p>
                        `;
                    }
                } else {
                    throw new Error(response.statusText);
                }
            } catch (error) {
                if (statusDisplay) {
                    statusDisplay.innerHTML = `
                        <span class="status-indicator" style="background-color: #fef2f2; color: #dc2626;">Offline</span>
                        <p style="margin-top: 8px; font-size: 0.9rem;">${error.message}</p>
                    `;
                }
            }
        },

        /**
         * Normalize ID (MLB or MLBU)
         */
        normalizeMlbId: function (input) {
            if (!input || typeof input !== 'string') {
                return null;
            }
            // Matches MLB-123, MLB123, MLBU-123, MLBU123
            const regex = /(MLBU?-?\d+)/i;
            const match = input.match(regex);
            if (match) {
                return match[1].replace('-', '').toUpperCase();
            }
            return null;
        },

        /**
         * Get Seller ID (for User Product queries)
         */
        getSellerId: async function () {
            if (this._sellerId) return this._sellerId;

            // Try from Config
            const config = this.getConfig();
            if (config.seller_id || config.user_id) {
                this._sellerId = config.seller_id || config.user_id;
                return this._sellerId;
            }

            // Try API
            try {
                const response = await this.apiFetch('/api/users/me'); // Proxies to /users/me
                if (response.ok) {
                    const data = await response.json();
                    this._sellerId = data.id;
                    return data.id;
                }
            } catch (e) {
                console.warn('Failed to fetch seller_id', e);
            }
            return null;
        },

        /**
         * Resolve MLBU (User Product) to list of MLB IDs
         */
        resolveUserProduct: async function (mlbuId) {
            // 1. Fetch User Product Details to get the correct Owner (seller_id)
            const detailsResponse = await this.apiFetch(`/api/user-products/${mlbuId}`);
            if (!detailsResponse.ok) {
                throw new Error('Falha ao buscar detalhes do Produto de Catálogo (MLBU).');
            }
            const details = await detailsResponse.json();

            const sellerId = details.user_id;
            if (!sellerId) {
                throw new Error('Dono do produto não identificado.');
            }

            // 2. Fetch Items linked to this User Product using the correct seller_id
            const itemsResponse = await this.apiFetch(`/api/user-products/${mlbuId}/items?seller_id=${sellerId}`);
            if (!itemsResponse.ok) {
                throw new Error('Falha ao buscar itens do Produto de Catálogo.');
            }

            const data = await itemsResponse.json();
            // API returns { results: ["MLB1", "MLB2"] }
            return data.results || [];
        },

        getVisits: async function (itemId, lastDays) {
            let token = this.getConfig().token;

            // Fallback: Fetch token if not in config
            if (!token) {
                try {
                    const tokenResponse = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
                    const tokenData = await tokenResponse.json();
                    if (tokenData?.response?.access_token) {
                        token = tokenData.response.access_token;

                        // FIX: Persist to global config so other Core methods (like getSellerId) can use it
                        if (!window.appConfig) window.appConfig = {};
                        window.appConfig.token = token;
                    }
                } catch (err) {
                    console.warn('Core: Failed to fetch fallback token', err);
                }
            }

            if (!token) throw new Error('Usuário não autenticado.');

            // --- USER PRODUCT HANDLING ---
            if (itemId.startsWith('MLBU')) {
                const childIds = await this.resolveUserProduct(itemId);
                if (!childIds || childIds.length === 0) {
                    throw new Error('Nenhum item encontrado para este produto de catálogo.');
                }

                // Fetch all in parallel
                const promises = childIds.map(id => this.getVisits(id, lastDays));
                const results = await Promise.all(promises);

                return this.aggregateVisits(results);
            }

            // --- STANDARD ITEM HANDLING ---
            const query = new URLSearchParams({
                item_id: itemId,
                last: lastDays,
                unit: 'day'
            });

            const options = { headers: { 'Authorization': `Bearer ${token}` } };
            const response = await this.apiFetch(`/api/fetch-visits?${query.toString()}`, options);

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || errData.error || response.statusText);
            }

            return response.json();
        },

        /**
         * Aggregate multiple visit results into one (Sum by Date)
         */
        aggregateVisits: function (resultsList) {
            const dateMap = {};

            resultsList.forEach(data => {
                if (data.results) {
                    data.results.forEach(point => {
                        const date = point.date.split('T')[0]; // Ensure simplistic date key
                        if (!dateMap[date]) {
                            dateMap[date] = { date: point.date, total: 0 };
                        }
                        dateMap[date].total += point.total;
                    });
                }
            });

            // Convert back to array
            const aggregatedResults = Object.values(dateMap).sort((a, b) => new Date(a.date) - new Date(b.date));

            return {
                item_id: 'AGGREGATED_MLBU',
                results: aggregatedResults
            };
        }
    };

    window.MarketFacilCore = Core;
    console.log('MarketFacil Core Initialized (v12 - MLBU Logic Fixed)');
})();
