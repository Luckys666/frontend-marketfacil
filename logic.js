/**
 * Core Logic Library
 * Description: Shared utilities and state management.
 * Usage: Available globally as window.MarketFacilCore
 */
(function () {
    const API_BASE_URL = "https://mlb-proxy-fdb71524fd60.herokuapp.com";

    const Core = {
        getConfig: function () {
            return window.appConfig || {};
        },

        /**
         * Generic API fetch wrapper
         */
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

        /**
         * Test Status Logic (Shared)
         */
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
         * Normalize MLB ID
         * Extracts MLB ID from URL or string
         */
        normalizeMlbId: function (input) {
            if (!input || typeof input !== 'string') {
                console.error('Core: Invalid input for MLB ID normalization');
                return null;
            }
            const regex = /(MLB-?\d+)/i;
            const match = input.match(regex);
            if (match) {
                return match[1].replace('-', '').toUpperCase();
            }
            return null;
        },

        /**
         * Fetch Visits Data using Proxy
         */
        getVisits: async function (itemId, lastDays) {
            let token = this.getConfig().token;

            // Fallback: Fetch token if not in config
            if (!token) {
                try {
                    const tokenResponse = await fetch('https://app.marketfacil.com.br/api/1.1/wf/getAccessToken2');
                    const tokenData = await tokenResponse.json();
                    if (tokenData && tokenData.response && tokenData.response.access_token) {
                        token = tokenData.response.access_token;
                    }
                } catch (err) {
                    console.warn('Core: Failed to fetch fallback token', err);
                }
            }

            if (!token) {
                throw new Error('Usuário não autenticado (Token não encontrado).');
            }

            // Construct Query
            const query = new URLSearchParams({
                item_id: itemId,
                last: lastDays,
                unit: 'day'
            });

            // Call API
            // Note: apiFetch automatically handles content-type, but we need to ensure Auth header helps if token was just fetched manually
            const options = {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            };

            const response = await this.apiFetch(`/api/fetch-visits?${query.toString()}`, options);

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || errData.error || response.statusText);
            }

            return response.json();
        }
    };

    // Expose Global
    window.MarketFacilCore = Core;
    console.log('MarketFacil Core Initialized');
})();
