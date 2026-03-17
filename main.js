
// ==========================================
// STATE & CONFIG
// ==========================================
let currentCategory = '';
let charts = {};
let rawRows = [];
let aggregatedData = [];

// ==========================================
// PARSING & AGGREGATION
// ==========================================
function parseCSV(str) {
    if (!window.Papa) {
        console.error('PapaParse no está disponible en window.Papa');
        return [];
    }

    const result = window.Papa.parse(str, {
        header: true,
        delimiter: ';',
        skipEmptyLines: 'greedy',
        quoteChar: '"',
        escapeChar: '"',
        transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
        transform: (value) => typeof value === 'string' ? value.trim() : value
    });

    if (result.errors && result.errors.length > 0) {
        console.warn('PapaParse reportó errores de análisis:', result.errors);
    }

    return result.data.filter(row => row && row.brand && String(row.brand).trim() !== '');
}

function aggregateData(rows, category) {
    const normalizedCategory = normalizeCategory(category);
    const filtered = rows.filter(r => normalizeCategory(r.producto) === normalizedCategory);

    const brandsMap = {};

    filtered.forEach(row => {
        const b = row.brand;
        const reviews = parseInt(row.count_user_review) || 0;
        const rating = parseFloat(row.rating) || 0;

        if (!brandsMap[b]) {
            brandsMap[b] = {
                name: b,
                category: row.producto,
                count_user_review: 0,
                rating_sum_weighted: 0,
                products: 0,
                distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }
            };
        }

        brandsMap[b].count_user_review += reviews;
        brandsMap[b].rating_sum_weighted += (rating * reviews);
        brandsMap[b].products += 1;

        try {
            const countsRaw = row.rating_counts;
            // Handle double quotes escaping from CSV if necessary
            const countsJson = countsRaw.replace(/""/g, '"');
            const counts = JSON.parse(countsJson);

            for (let i = 1; i <= 5; i++) {
                brandsMap[b].distribution[i] += (counts[i] || 0);
            }
        } catch (e) {
            console.warn("Error al analizar rating_counts para la fila", row.brand, e);
        }
    });

    const result = Object.values(brandsMap).map(b => {
        const avgRating = b.count_user_review > 0
            ? b.rating_sum_weighted / b.count_user_review
            : 0;

        const distArr = [
            b.distribution["1"],
            b.distribution["2"],
            b.distribution["3"],
            b.distribution["4"],
            b.distribution["5"]
        ];

        return {
            name: b.name,
            count_user_review: b.count_user_review,
            rating: avgRating,
            products: b.products,
            distribution: distArr,
            category: normalizeCategory(b.category)
        };
    });

    const totalReviews = result.reduce((sum, brand) => sum + brand.count_user_review, 0);
    const globalAvgRating = totalReviews > 0
        ? result.reduce((sum, brand) => sum + (brand.rating * brand.count_user_review), 0) / totalReviews
        : 0;

    const sortedReviews = result
        .map(brand => brand.count_user_review)
        .sort((a, b) => a - b);
    const medianIndex = Math.floor(sortedReviews.length / 2);
    const m = sortedReviews.length > 0 ? sortedReviews[medianIndex] : 0;

    result.forEach(brand => {
        const v = brand.count_user_review;
        const R = brand.rating;

        if (m <= 0) {
            brand.weightedScore = R;
            return;
        }

        brand.weightedScore = ((v / (v + m)) * R) + ((m / (v + m)) * globalAvgRating);
    });

    return result;
}

// ==========================================
// CHARTING FUNCTIONS
// ==========================================

function formatNumber(num) {
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function normalizeCategory(value) {
    return String(value ?? '').trim();
}

function getQuadrantColor(rating, reviewCount, medR, medRev) {
    if (rating >= medR && reviewCount >= medRev) return '#00d4aa'; // Leader
    if (rating >= medR && reviewCount < medRev) return '#f59e0b'; // Vulnerable
    if (rating < medR && reviewCount >= medRev) return '#ef4444'; // Crisis
    return '#4a5a6c'; // Irrelevant
}

function initQuadrantChart(data) {
    const ctx = document.getElementById('quadrantChart').getContext('2d');
    if (charts.quadrant) charts.quadrant.destroy();

    if (data.length === 0) return;

    const ratings = data.map(d => d.rating).sort((a, b) => a - b);
    const reviews = data.map(d => d.count_user_review).sort((a, b) => a - b);
    const medR = ratings[Math.floor(ratings.length / 2)] || 0;
    const medRev = reviews[Math.floor(reviews.length / 2)] || 0;

    const datasets = [{
        data: data.map(b => ({ x: b.count_user_review, y: b.rating, ...b })),
        backgroundColor: data.map(b => getQuadrantColor(b.rating, b.count_user_review, medR, medRev)),
        pointRadius: data.map(b => Math.max(8, Math.min(25, Math.sqrt(b.products) * 4))),
        pointHoverRadius: 12,
        borderColor: 'rgba(255,255,255,0.2)',
        borderWidth: 2
    }];

    charts.quadrant = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#161d27',
                    callbacks: {
                        title: (i) => i[0].raw.name,
                        label: (i) => `Reseñas: ${formatNumber(i.raw.x)} | Valoración: ${i.raw.y.toFixed(2)}`
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Volumen de reseñas', color: '#7a8a9c' },
                    grid: { color: 'rgba(30, 42, 56, 0.5)' },
                    ticks: { color: '#4a5a6c' }
                },
                y: {
                    title: { display: true, text: 'Valoración media', color: '#7a8a9c' },
                    grid: { color: 'rgba(30, 42, 56, 0.5)' },
                    ticks: { color: '#4a5a6c' },
                    suggestedMin: Math.min(...data.map(d => d.rating)) - 0.5,
                    suggestedMax: 5.1
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) showBrandModal(data[elements[0].index]);
            }
        }
    });
}

function initVoiceChart(data) {
    const ctx = document.getElementById('voiceChart').getContext('2d');
    if (charts.voice) charts.voice.destroy();
    if (data.length === 0) return;

    const totalReviews = data.reduce((s, b) => s + b.count_user_review, 0);
    const sorted = [...data].sort((a, b) => b.count_user_review - a.count_user_review);

    charts.voice = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(b => b.name),
            datasets: [
                {
                    label: 'Cuota de reseñas (%)',
                    data: sorted.map(b => totalReviews > 0 ? ((b.count_user_review / totalReviews) * 100).toFixed(1) : 0),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                },
                {
                    label: 'Valoración normalizada (%)',
                    data: sorted.map(b => (b.rating / 5) * 100),
                    backgroundColor: '#00d4aa',
                    borderRadius: 4
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: '#7a8a9c' } } },
            scales: {
                x: { grid: { color: 'rgba(30, 42, 56, 0.5)' }, ticks: { color: '#4a5a6c' } },
                y: { grid: { display: false }, ticks: { color: '#e8edf4' } }
            }
        }
    });
}

function initSentimentChart(data) {
    const ctx = document.getElementById('sentimentChart').getContext('2d');
    if (charts.sentiment) charts.sentiment.destroy();
    if (data.length === 0) return;

    const sorted = [...data].sort((a, b) => b.rating - a.rating);

    const getDist = (distArr) => {
        const sum = distArr.reduce((a, b) => a + b, 0);
        if (sum === 0) return [0, 0, 0, 0, 0];
        return distArr.map(v => (v / sum) * 100);
    };

    charts.sentiment = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(b => b.name),
            datasets: [
                { label: '1★', data: sorted.map(b => getDist(b.distribution)[0]), backgroundColor: '#ef4444' },
                { label: '2★', data: sorted.map(b => getDist(b.distribution)[1]), backgroundColor: '#f97316' },
                { label: '3★', data: sorted.map(b => getDist(b.distribution)[2]), backgroundColor: '#f59e0b' },
                { label: '4★', data: sorted.map(b => getDist(b.distribution)[3]), backgroundColor: '#84cc16' },
                { label: '5★', data: sorted.map(b => getDist(b.distribution)[4]), backgroundColor: '#00d4aa' }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: '#7a8a9c', boxWidth: 12 } } },
            scales: {
                x: { stacked: true, max: 100, grid: { display: false }, ticks: { display: false } },
                y: { stacked: true, grid: { display: false }, ticks: { color: '#e8edf4' } }
            }
        }
    });
}

function initTreemap(data) {
    const container = document.getElementById('treemapContainer');
    container.innerHTML = '';
    if (data.length === 0) return;

    const sorted = [...data].sort((a, b) => b.products - a.products);
    const total = sorted.reduce((s, b) => s + b.products, 0);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    const width = container.offsetWidth;
    const height = container.offsetHeight;

    let x = 0, y = 0;
    const padding = 4;
    const rowHeight = height / Math.ceil(sorted.length / 3);

    sorted.forEach((b, i) => {
        const w = Math.max((b.products / total) * width * 2.5, 60);
        const h = rowHeight - padding;

        if (x + w > width) {
            x = 0;
            y += rowHeight;
        }

        const hue = b.rating >= 4.8 ? 160 : b.rating >= 4.5 ? 120 : b.rating >= 4.0 ? 60 : 0;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', Math.min(w - padding, width - x));
        rect.setAttribute('height', h);
        rect.setAttribute('fill', `hsl(${hue}, 70%, 35%)`);
        rect.setAttribute('rx', 4);
        rect.setAttribute('class', 'treemap-rect');

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + 8);
        text.setAttribute('y', y + 18);
        text.setAttribute('fill', '#e8edf4');
        text.setAttribute('font-size', '12');
        text.setAttribute('font-weight', '600');
        text.textContent = b.name;

        const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        sub.setAttribute('x', x + 8);
        sub.setAttribute('y', y + 32);
        sub.setAttribute('fill', '#e8edf4');
        sub.setAttribute('font-size', '10');
        sub.textContent = `${b.products} productos | ${b.rating.toFixed(2)}`;

        svg.appendChild(rect);
        svg.appendChild(text);
        svg.appendChild(sub);

        x += w;
    });

    container.appendChild(svg);
}

function renderRanking(data) {
    const table = document.getElementById("rankingTable");

    const sorted = [...data].sort((a, b) => {
        if (b.weightedScore !== a.weightedScore) return b.weightedScore - a.weightedScore;
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.count_user_review - a.count_user_review;
    });

    table.innerHTML = sorted.map((b, i) => `
          <tr class="border-b border-[var(--border)] hover:bg-[var(--bg-secondary)]">
            <td class="py-2 mono">${i + 1}</td>
            <td class="font-medium">${b.name}</td>
            <td class="text-[var(--accent-primary)] mono">${b.rating.toFixed(2)}</td>
            <td class="mono">${formatNumber(b.count_user_review)}</td>
            <td class="mono">${b.products}</td>
          </tr>
        `).join("");
}

// ==========================================
// UI UPDATES
// ==========================================

function updateKPIs(rows, data) {
    const totalProd = rows.length;
    const totalRev = data.reduce((s, b) => s + b.count_user_review, 0);
    const avgR = data.length > 0 ? data.reduce((s, b) => s + b.rating, 0) / data.length : 0;

    document.getElementById('totalProductos').textContent = totalProd;
    document.getElementById('totalReviews').textContent = formatNumber(totalRev);
    document.getElementById('avgRating').textContent = avgR.toFixed(2);
    document.getElementById('totalMarcas').textContent = data.length;
}

function showBrandModal(brand) {
    document.getElementById('modalTitle').textContent = brand.name;
    document.getElementById('modalSubtitle').textContent = `${brand.products} productos | ${brand.category}`;

    const totalRev = brand.count_user_review;
    const totalStars = brand.distribution.reduce((a, b) => a + b, 0);

    const html = `
            <div class="grid grid-cols-2 gap-4">
                <div class="bg-[var(--bg-secondary)] p-4 rounded-lg">
                    <p class="text-xs text-[var(--text-muted)]">Reseñas</p>
                    <p class="text-xl font-bold">${formatNumber(totalRev)}</p>
                </div>
                <div class="bg-[var(--bg-secondary)] p-4 rounded-lg">
                    <p class="text-xs text-[var(--text-muted)]">Valoración</p>
                    <p class="text-xl font-bold text-[var(--accent-primary)]">${brand.rating.toFixed(2)}</p>
                </div>
            </div>
            <div class="bg-[var(--bg-secondary)] p-4 rounded-lg">
                <p class="text-xs text-[var(--text-muted)] mb-2">Distribución por estrellas</p>
                <div class="flex h-4 rounded overflow-hidden">
                    <div class="bg-[#ef4444]" style="width: ${totalStars > 0 ? (brand.distribution[0] / totalStars) * 100 : 0}%"></div>
                    <div class="bg-[#f97316]" style="width: ${totalStars > 0 ? (brand.distribution[1] / totalStars) * 100 : 0}%"></div>
                    <div class="bg-[#f59e0b]" style="width: ${totalStars > 0 ? (brand.distribution[2] / totalStars) * 100 : 0}%"></div>
                    <div class="bg-[#84cc16]" style="width: ${totalStars > 0 ? (brand.distribution[3] / totalStars) * 100 : 0}%"></div>
                    <div class="bg-[#00d4aa]" style="width: ${totalStars > 0 ? (brand.distribution[4] / totalStars) * 100 : 0}%"></div>
                </div>
            </div>
        `;
    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('brandModal').classList.remove('hidden');
}

function showDashboard() {
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('dashboardView').classList.remove('hidden');

    // Trigger scroll reveal manually if needed
    setTimeout(() => {
        document.querySelectorAll('.scroll-reveal').forEach(el => el.classList.add('visible'));
    }, 100);
}

// ==========================================
// DATA LOADING LOGIC
// ==========================================

function processCSVData(csvText) {
    rawRows = parseCSV(csvText);

    // Generate Category Buttons
    const categories = [...new Set(rawRows.map(r => normalizeCategory(r.producto)).filter(Boolean))];
    const filterContainer = document.getElementById('categoryFilters');

    if (categories.length === 0) {
        filterContainer.innerHTML = '';
        return;
    }

    currentCategory = categories[0];

    let btnHtml = '';
    categories.forEach(cat => {
        const count = rawRows.filter(r => normalizeCategory(r.producto) === cat).length;
        if (currentCategory === cat) {
            btnHtml += `<button class="category-btn active px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text-secondary)]" data-category="${cat}">${cat} (${count})</button>`;
        } else {
            btnHtml += `<button class="category-btn px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text-secondary)]" data-category="${cat}">${cat} (${count})</button>`;
        }
    });
    filterContainer.innerHTML = btnHtml;

    showDashboard();
    requestAnimationFrame(() => updateDashboard(currentCategory));

    // Update header date
    const dates = rawRows.map(r => r.datetime_created).sort();
    const lastUpdateElement = document.getElementById('lastUpdate');
    if (dates.length > 0 && lastUpdateElement) {
        lastUpdateElement.textContent = dates[dates.length - 1].split(' ')[0];
    }
}

function updateDashboard(cat) {
    if (!cat) return;

    aggregatedData = aggregateData(rawRows, cat);
    const rowsForKPI = rawRows.filter(r => normalizeCategory(r.producto) === normalizeCategory(cat));
    updateKPIs(rowsForKPI, aggregatedData);
    initQuadrantChart(aggregatedData);
    initVoiceChart(aggregatedData);
    initSentimentChart(aggregatedData);
    initTreemap(aggregatedData);

    renderRanking(aggregatedData);
}

// ==========================================
// EVENT LISTENERS
// ==========================================

async function loadCSVFromFolder() {
    try {
        const response = await fetch("./viviendea.csv");
        const text = await response.text();
        processCSVData(text);
    } catch (err) {
        console.error("No se pudo cargar el archivo CSV predeterminado", err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadCSVFromFolder();

    const fileInput = document.getElementById('csvFileInput');
    const dropZone = document.getElementById('dropZone');
    const uploadBtn = document.getElementById('uploadBtn');
    const loadSampleBtn = document.getElementById('loadSampleBtn');

    // 1. Click Upload Button
    uploadBtn.addEventListener('click', () => fileInput.click());

    // 2. File Input Change
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });

    // 3. Load Sample Data
    // loadSampleBtn.addEventListener('click', () => {
    //     processCSVData(sampleCsvData);
    // });

    // 4. Drag & Drop Logic
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const file = dt.files[0];
        if (file) handleFile(file);
    }, false);

    function handleFile(file) {
        if (!file.name.endsWith('.csv')) {
            alert('Por favor, cargue un archivo .csv');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => processCSVData(e.target.result);
        reader.readAsText(file);
    }

    // Category Filter Clicks (Delegated)
    document.getElementById('categoryFilters').addEventListener('click', (e) => {
        if (e.target.matches('.category-btn')) {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.dataset.category;
            updateDashboard(currentCategory);
        }
    });

    // Modal Close
    document.getElementById('closeModal').addEventListener('click', () => {
        document.getElementById('brandModal').classList.add('hidden');
    });

    document.getElementById('brandModal').addEventListener('click', (e) => {
        if (e.target.id === 'brandModal') e.target.classList.add('hidden');
    });
});