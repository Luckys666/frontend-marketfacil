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
        }
    };

    // Expose Global
    window.MarketFacilCore = Core;
    console.log('MarketFacil Core Initialized');
})();
