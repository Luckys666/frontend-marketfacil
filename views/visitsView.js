/**
 * View: Visits Analytics
 * Description: Displays visit statistics for a specific MLB item.
 * Dependencies: MarketFacilCore, Chart.js, Chart.js Date Adapter (e.g. luxon/date-fns)
 */
(function () {
    console.log('View loaded: Visits Analytics');

    // HTML Template
    const template = `
    <div id="visitas-internal-container" class="container mx-auto p-4 sm:p-6 lg:p-8 max-w-4xl">
        <div class="bg-white p-6 rounded-2xl shadow-lg">
            <h1 class="text-2xl sm:text-3xl font-bold text-gray-800 mb-4">Visitas do Anúncio</h1>
            <p class="text-gray-600 mb-6">Insira o link ou ID do anúncio (MLB) e selecione o período para visualizar o gráfico de visitas diárias.</p>

            <!-- Controls -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 items-end">
                <div class="md:col-span-2">
                    <label for="inputAnuncio" class="block text-sm font-medium text-gray-700 mb-1">Link ou ID do Anúncio</label>
                    <input type="text" id="inputAnuncio" placeholder="Ex: MLB1234567890" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition">
                </div>
                <div>
                    <label for="periodoSelect" class="block text-sm font-medium text-gray-700 mb-1">Período</label>
                    <select id="periodoSelect" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition">
                        <option value="7">Últimos 7 dias</option>
                        <option value="15">Últimos 15 dias</option>
                        <option value="30">Últimos 30 dias</option>
                        <option value="60" selected>Últimos 60 dias</option>
                        <option value="90">Últimos 90 dias</option>
                    </select>
                </div>
            </div>
            <button id="buscarVisitasBtn" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 transition duration-300 ease-in-out">
                Buscar Visitas
            </button>

            <!-- Results -->
            <div class="mt-6">
                <div id="loader" class="loader hidden" style="text-align: center; margin-bottom: 10px;">Carregando...</div>
                <p id="resultadoTexto" class="text-center text-gray-700 font-medium"></p>
                <div class="mt-4">
                    <canvas id="visitasChart"></canvas>
                </div>
            </div>
        </div>
    </div>
    `;

    let visitsChartInstance = null;

    // Render Function
    function renderVisitsView(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Visits View: Container #${containerId} not found.`);
            return;
        }

        container.innerHTML = template;
        attachListeners();
    }

    // Attach Listeners
    function attachListeners() {
        const btn = document.getElementById('buscarVisitasBtn');
        if (btn) {
            btn.addEventListener('click', handleFetchVisitas);
        }
    }

    // Chart Renderer
    function renderChart(labels, data) {
        if (typeof Chart === 'undefined') {
            const msg = 'Erro: Chart.js não carregado no ambiente.';
            console.error(msg);
            document.getElementById('resultadoTexto').textContent = msg;
            return;
        }

        const ctx = document.getElementById('visitasChart').getContext('2d');
        if (visitsChartInstance) {
            visitsChartInstance.destroy();
        }

        visitsChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Visitas Diárias',
                    data: data,
                    borderColor: 'rgba(59, 130, 246, 1)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.1,
                    pointBackgroundColor: 'rgba(59, 130, 246, 1)',
                    pointBorderColor: '#fff',
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'day',
                            displayFormats: { day: 'DD/MM' },
                            tooltipFormat: 'DD/MM/YYYY'
                        },
                        title: { display: true, text: 'Data' }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Visitas' }
                    }
                }
            }
        });
    }

    // Main Handler
    async function handleFetchVisitas() {
        const inputAnuncio = document.getElementById("inputAnuncio").value;
        const lastDays = document.getElementById("periodoSelect").value;
        const resultadoTexto = document.getElementById("resultadoTexto");
        const loader = document.getElementById("loader");

        // UI Reset
        resultadoTexto.className = '';
        resultadoTexto.textContent = '';
        if (visitsChartInstance) {
            visitsChartInstance.destroy();
            visitsChartInstance = null;
        }

        // Validation
        if (!window.MarketFacilCore || !window.MarketFacilCore.normalizeMlbId) {
            resultadoTexto.textContent = 'Erro: MarketFacilCore.normalizeMlbId não encontrado.';
            return;
        }

        const itemId = window.MarketFacilCore.normalizeMlbId(inputAnuncio);
        if (!itemId) {
            resultadoTexto.textContent = 'Erro: ID do anúncio (MLB) inválido ou não encontrado na URL.';
            resultadoTexto.className = 'text-center text-red-600 font-medium';
            return;
        }

        loader.classList.remove('hidden');
        resultadoTexto.textContent = 'Buscando dados de visitas...';
        resultadoTexto.className = 'text-center text-gray-700 font-medium';

        try {
            // Use Core Logic
            const data = await window.MarketFacilCore.getVisits(itemId, lastDays);

            if (!data.results || !Array.isArray(data.results)) {
                throw new Error('Nenhum dado de visita foi retornado para este anúncio no período selecionado.');
            }

            if (data.results.length === 0) {
                throw new Error('Lista de visitas vazia.');
            }

            // Process Data
            data.results.sort((a, b) => new Date(a.date) - new Date(b.date));
            const labels = data.results.map(r => r.date.split('T')[0]);
            const visits = data.results.map(r => r.total);

            renderChart(labels, visits);
            resultadoTexto.textContent = `Gráfico carregado com sucesso!`;
            resultadoTexto.className = 'text-center text-green-600 font-medium';

        } catch (error) {
            console.error(error);
            resultadoTexto.textContent = `Erro: ${error.message}`;
            resultadoTexto.className = 'text-center text-red-600 font-medium';
        } finally {
            loader.classList.add('hidden');
        }
    }

    // Expose Global
    window.renderVisitsView = renderVisitsView;
})();
