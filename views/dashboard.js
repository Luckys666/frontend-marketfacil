/**
 * View: Dashboard
 * Description: Main landing page dashboard.
 */
(function () {
    console.log('View loaded: Dashboard');

    function renderDashboard() {
        const appRoot = document.getElementById('app-root');
        if (!appRoot) {
            console.error('App root element #app-root not found!');
            return;
        }

        // Use Core util if available, else default
        const config = window.MarketFacilCore ? window.MarketFacilCore.getConfig() : (window.appConfig || {});
        const userName = config.userName || 'Visitante';

        const html = `
            <header class="dashboard-header">
                <h1>MarketFácil</h1>
                <p>Painel de Controle</p>
            </header>

            <main class="card-grid">
                <div class="card">
                    <h2>Olá, ${userName}</h2>
                    <p>Bem-vindo ao dashboard principal.</p>
                    <button class="btn" onclick="window.MarketFacilCore.checkApiStatus('api-status-display')">Verificar API</button>
                </div>

                <div class="card">
                    <h2>Status do Sistema</h2>
                    <div id="api-status-display">
                        <p>Aguardando verificação...</p>
                    </div>
                </div>

                <div class="card">
                    <h2>Info da Sessão</h2>
                    <p>Token presente: ${config.token ? 'Sim' : 'Não'}</p>
                    <p>Role: ${config.role || 'User'}</p>
                </div>
            </main>
        `;

        appRoot.innerHTML = html;
        console.log('Dashboard rendered.');
    }

    // Auto-render when this script is loaded (Consumer strategy)
    // We wait for DOMContentLoaded just in case, or run immediately if ready.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderDashboard);
    } else {
        renderDashboard();
    }
})();
