/**
 * View: Visits Analytics
 * Description: Displays visit statistics. Self-contained module that loads its own dependencies.
 */

console.log('View loaded: Visits Analytics');

// --- Expose Global Immediately (No IIFE to prevent scope issues) ---
window.renderVisitsApp = initVisitsView;
console.log('Global exposed: window.renderVisitsApp');

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

    // 1. Show Loading State
    container.innerHTML = `
        <div class="flex items-center justify-center h-64 bg-white rounded-lg border border-gray-200">
            <div class="text-center">
                <div class="inline-block animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mb-2"></div>
                <p class="text-gray-500 font-medium">Carregando módulos...</p>
            </div>
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
            <div class="p-6 bg-red-50 text-red-700 rounded-lg text-center">
                <p class="font-bold">Erro ao carregar dependências</p>
                <p class="text-sm">${error.message}</p>
            </div>
        `;
    }
}

function renderVisitsTemplate(container) {
    container.innerHTML = `
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 font-sans">
            <div class="border-b border-gray-100 pb-4 mb-6">
                <h2 class="text-2xl font-bold text-gray-800">Visitas do Anúncio</h2>
                <p class="text-gray-500 text-sm mt-1">Acompanhe a evolução de acessos.</p>
            </div>

            <!-- Controls -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
                <div class="md:col-span-2">
                    <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Link ou ID (MLB)</label>
                    <input type="text" id="inputAnuncio" placeholder="Ex: MLB12345..." 
                        class="w-full h-10 px-3 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Período</label>
                    <select id="periodoSelect" class="w-full h-10 px-3 border border-gray-300 rounded-lg bg-white focus:border-blue-500 outline-none">
                        <option value="7">Últimos 7 dias</option>
                        <option value="15">Últimos 15 dias</option>
                        <option value="30">Últimos 30 dias</option>
                        <option value="60" selected>Últimos 60 dias</option>
                        <option value="90">Últimos 90 dias</option>
                    </select>
                </div>
                <button id="buscarVisitasBtn" 
                    class="h-10 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition shadow-sm flex items-center justify-center focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                    Buscar
                </button>
            </div>

            <!-- Feedback Area -->
            <div id="resultadoVisitas" class="hidden mb-4 p-3 rounded-lg text-sm text-center"></div>

            <!-- Chart Area -->
            <div class="relative w-full h-[350px] bg-gray-50 rounded-xl border border-gray-100 p-4">
                <canvas id="visitasChart"></canvas>
            </div>
        </div>
    `;

    attachVisitsListeners();
}

function attachVisitsListeners() {
    const btn = document.getElementById('buscarVisitasBtn');

    btn.addEventListener('click', async () => {
        const input = document.getElementById('inputAnuncio').value;
        const days = document.getElementById('periodoSelect').value;
        const feedback = document.getElementById('resultadoVisitas');

        // Reset UI
        feedback.className = 'hidden mb-4 p-3 rounded-lg text-sm text-center';
        btn.disabled = true;
        btn.innerHTML = '<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';

        try {
            // Ensure Core is loaded
            if (!window.MarketFacilCore || !window.MarketFacilCore.getVisits) {
                throw new Error('Core logic not loaded. Check connection.');
            }

            const itemId = window.MarketFacilCore.normalizeMlbId(input);
            if (!itemId) throw new Error('ID do anúncio inválido.');

            const data = await window.MarketFacilCore.getVisits(itemId, days);

            if (!data.results || !data.results.length) {
                throw new Error('Nenhum dado encontrado para este período.');
            }

            renderVisitsChart(data.results);

            feedback.textContent = 'Dados carregados com sucesso!';
            feedback.className = 'mb-4 p-3 rounded-lg text-sm text-center bg-green-50 text-green-700 border border-green-200 block';

        } catch (err) {
            console.error(err);
            feedback.textContent = err.message;
            feedback.className = 'mb-4 p-3 rounded-lg text-sm text-center bg-red-50 text-red-700 border border-red-200 block';
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

    const ctx = document.getElementById('visitasChart').getContext('2d');

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
                borderColor: '#2563eb',
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.2)');
                    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)');
                    return gradient;
                },
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#2563eb',
                pointRadius: 4,
                pointHoverRadius: 6
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
                    titleFont: { size: 13 },
                    bodyFont: { size: 13 },
                    displayColors: false
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
                    ticks: { font: { size: 11 }, color: '#6b7280' }
                },
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [4, 4], color: '#f3f4f6' },
                    ticks: { font: { size: 11 }, color: '#6b7280' }
                }
            }
        }
    });
}
