/**
 * View: Visits Analytics
 * Description: Displays visit statistics with premium UI. Self-contained module.
 */

console.log('View loaded: Visits Analytics (Premium)');

// --- Expose Global Immediately ---
window.renderVisitsApp = initVisitsView;

// --- UTILS: Dynamic Script Loader ---
function loadVisitsDependency(url, globalName) {
    return new Promise((resolve, reject) => {
        if (globalName && window[globalName]) {
            return resolve();
        }
        console.log(`[VisitsApp] Loading dependency: ${url}`);
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${url}`));
        document.head.appendChild(script);
    });
}

// --- MAIN RENDERER ---
async function initVisitsView(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Visits View: Container #${containerId} not found.`);
        return;
    }

    // Add namespace class for isolated styles
    container.classList.add('mf-widget');

    // 1. Show Loading State
    container.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Carregando Módulos...</p>
        </div>
    `;

    try {
        // 2. Load Dependencies (if missing)
        await loadVisitsDependency('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', 'Chart');
        if (!window.moment) {
            await loadVisitsDependency('https://cdn.jsdelivr.net/npm/moment@2.29.4/moment.min.js', 'moment');
        }
        await loadVisitsDependency('https://cdn.jsdelivr.net/npm/chartjs-adapter-moment@1.0.1/dist/chartjs-adapter-moment.min.js');

        // 3. Render Template
        renderVisitsTemplate(container);

    } catch (error) {
        console.error(error);
        container.innerHTML = `
            <div class="feedback-msg feedback-error" style="display:block">
                Erro crítico ao carregar dependências: ${error.message}
            </div>
        `;
    }
}

function renderVisitsTemplate(container) {
    container.innerHTML = `
        <div class="widget-header">
            <h2 class="widget-title">Panorama de Visitas</h2>
            <p class="widget-subtitle">Cole o link completo do anúncio (MLB ou MLBU com wid).</p>
        </div>

        <div class="controls-grid">
            <div class="input-group">
                <label>Link do Anúncio</label>
                <input type="text" id="iptAnuncio" class="status-input" placeholder="Cole o link aqui...">
            </div>
            
            <div class="input-group">
                <label>Período</label>
                <select id="selPeriodo" class="status-input">
                    <option value="15">15 dias</option>
                    <option value="30">30 dias</option>
                    <option value="60" selected>60 dias</option>
                    <option value="90">90 dias</option>
                </select>
            </div>

            <div class="input-group" style="display:flex; align-items:flex-end;">
                <button id="btnBuscar" class="btn-search">
                    Buscar
                </button>
            </div>
        </div>

        <!-- Feedback Area -->
        <div id="feedbackApp" class="feedback-msg"></div>

        <!-- Chart Area -->
        <div class="chart-wrapper">
            <canvas id="chartCanvas"></canvas>
        </div>
    `;

    attachVisitsListeners();
}

function attachVisitsListeners() {
    const btn = document.getElementById('btnBuscar');

    btn.addEventListener('click', async () => {
        const input = document.getElementById('iptAnuncio').value;
        const days = document.getElementById('selPeriodo').value;
        const feedback = document.getElementById('feedbackApp');

        // Reset UI
        feedback.style.display = 'none';
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:20px; height:20px; border-width:2px; margin:0; border-top-color:white;"></div>';

        try {
            // Ensure Core is loaded
            if (!window.MarketFacilCore || !window.MarketFacilCore.getVisits) {
                throw new Error('Core logic not loaded. Check connection.');
            }

            const itemId = window.MarketFacilCore.normalizeMlbId(input);
            if (!itemId) throw new Error('ID ou WID não encontrado. Cole o link completo.');

            const data = await window.MarketFacilCore.getVisits(itemId, days);

            if (!data.results || !data.results.length) {
                throw new Error('Nenhuma visita encontrada para este período.');
            }

            renderVisitsChart(data.results);

            feedback.textContent = `Sucesso! Exibindo dados: ${itemId}`;
            feedback.className = 'feedback-msg feedback-success';
            feedback.style.display = 'block';

        } catch (err) {
            console.error(err);
            feedback.textContent = err.message || 'Erro desconhecido';
            feedback.className = 'feedback-msg feedback-error';
            feedback.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Buscar';
        }
    });
}

let visitsChartInstance = null;

function renderVisitsChart(results) {
    // Sort by date
    results.sort((a, b) => new Date(a.date) - new Date(b.date));

    const ctx = document.getElementById('chartCanvas').getContext('2d');

    // Gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    if (visitsChartInstance) {
        visitsChartInstance.destroy();
    }

    visitsChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: results.map(r => r.date),
            datasets: [{
                label: 'Visitas',
                data: results.map(r => r.total),
                borderColor: '#3B82F6',
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.35,

                // Interaction Improvements
                pointRadius: 4,
                pointHoverRadius: 7,
                pointBackgroundColor: '#FFFFFF',
                pointBorderColor: '#3B82F6',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.9)',
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: { family: 'Inter', size: 13 },
                    bodyFont: { family: 'Inter', size: 14, weight: 'bold' },
                    displayColors: false,
                    callbacks: {
                        label: (ctx) => `${ctx.formattedValue} acessos`
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        tooltipFormat: 'DD/MM/YYYY',
                        displayFormats: { day: 'DD/MM' }
                    },
                    grid: { display: false, drawBorder: false },
                    ticks: { font: { family: 'Inter', size: 11 }, color: '#6b7280' }
                },
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [4, 4], color: '#f3f4f6' },
                    ticks: { font: { family: 'Inter', size: 11 }, color: '#6b7280' }
                }
            }
        }
    });
}
