const jsonInput = document.getElementById('jsonInput');
const toonOutput = document.getElementById('toonOutput');
const convertBtn = document.getElementById('convertBtn');
const copyBtn = document.getElementById('copyBtn');
const sampleBtn = document.getElementById('sampleBtn');
const beautyBtn = document.getElementById('beautyBtn');
const beautyPanel = document.getElementById('beautyPanel');
const beautifiedView = document.getElementById('beautifiedView');
const beautyMeta = document.getElementById('beautyMeta');
const toast = document.getElementById('toast');
const statNodes = document.querySelector('[data-stat="nodes"]');
const statTables = document.querySelector('[data-stat="tables"]');
const statTokens = document.querySelector('[data-stat="tokens"]');
const statSessions = document.querySelector('[data-stat="sessions"]');
const inputTokensLabel = document.getElementById('inputTokens');
const outputTokensLabel = document.getElementById('outputTokens');
const futureButtons = document.querySelectorAll('[data-future]');

const sampleData = {
  items: [
    { sku: 'A1', name: 'Widget', qty: 2, price: 9.99 },
    { sku: 'B2', name: 'Gadget', qty: 1, price: 14.5 },
  ],
  warehouse: {
    city: 'Madrid',
    capacity: 4200,
    active: true,
  },
  notes: ['stock audit due', 'priorizar envíos UE'],
  meta: { generatedAt: '2025-11-14T10:00:00Z' },
};

let sessionCount = 0;
let tokenSeries = [12, 18, 11, 15, 21, 17, 23];
let chartInstance = null;
let lastBeautified = '';
let lastStandardLength = 0;
let beautyVisible = false;

function indent(level) {
  return ' '.repeat(level * 2);
}

function isPrimitive(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isPrimitiveArray(arr) {
  return arr.every(isPrimitive);
}

function isUniformObjectArray(arr) {
  if (!arr.length || !isPlainObject(arr[0])) return false;
  const firstKeys = Object.keys(arr[0]);
  if (!firstKeys.length) return false;

  return arr.every((item) => {
    if (!isPlainObject(item)) return false;
    const keys = Object.keys(item);
    if (keys.length !== firstKeys.length) return false;
    if (keys.join('|') !== firstKeys.join('|')) return false;
    return keys.every((key) => isPrimitive(item[key]));
  });
}

function formatString(value) {
  if (/^[A-Za-z0-9._-]+$/.test(value)) {
    return value;
  }
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function formatPrimitive(value) {
  if (typeof value === 'string') return formatString(value);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return `"${value}"`;
  }
  return String(value);
}

function renderObject(obj, level) {
  const entries = Object.entries(obj);
  if (!entries.length) return [];
  const lines = [];

  for (const [key, value] of entries) {
    lines.push(...renderEntry(key, value, level));
  }

  return lines;
}

function renderEntry(key, value, level) {
  const base = indent(level);

  if (isPrimitive(value)) {
    return [`${base}${key}: ${formatPrimitive(value)}`];
  }

  if (Array.isArray(value)) {
    return renderArray(value, level, key);
  }

  if (isPlainObject(value)) {
    const childEntries = renderObject(value, level + 1);
    if (!Object.keys(value).length) {
      return [`${base}${key}: {}`];
    }

    return [`${base}${key}:`, ...childEntries];
  }

  return [`${base}${key}: ${formatPrimitive(value)}`];
}

function renderAnonymous(value, level) {
  if (Array.isArray(value)) return renderArray(value, level, null);
  if (isPlainObject(value)) {
    const lines = renderObject(value, level);
    return lines.length ? lines : [`${indent(level)}{}`];
  }
  return [`${indent(level)}${formatPrimitive(value)}`];
}

function renderArray(arr, level, key) {
  const base = indent(level);
  const headerKey = key ? `${key}[${arr.length}]` : `[${arr.length}]`;

  if (!arr.length) {
    return [`${base}${headerKey}:`];
  }

  if (isPrimitiveArray(arr)) {
    const values = arr.map(formatPrimitive).join(',');
    return [`${base}${headerKey}: ${values}`];
  }

  if (isUniformObjectArray(arr)) {
    const keys = Object.keys(arr[0]);
    const header = `${base}${headerKey}{${keys.join(',')}}:`;
    const rowIndent = indent(level + 1);
    const rows = arr.map((item) =>
      `${rowIndent}${keys.map((k) => formatPrimitive(item[k])).join(',')}`
    );
    return [header, ...rows];
  }

  const lines = [`${base}${headerKey}:`];
  const childLevel = level + 1;
  const childIndent = indent(childLevel);

  arr.forEach((item) => {
    const itemLines = renderAnonymous(item, childLevel);

    if (!itemLines.length) {
      lines.push(`${childIndent}-`);
      return;
    }

    const normalized = itemLines.map((line) =>
      line.startsWith(childIndent) ? line.slice(childIndent.length) : line.trim()
    );

    lines.push(`${childIndent}- ${normalized[0]}`);

    for (let i = 1; i < normalized.length; i += 1) {
      lines.push(`${childIndent}  ${normalized[i]}`);
    }
  });

  return lines;
}

function encodeToToon(value) {
  if (Array.isArray(value)) {
    return renderArray(value, 0, null).join('\n');
  }
  if (isPlainObject(value)) {
    return renderObject(value, 0).join('\n');
  }
  return formatPrimitive(value);
}

function estimateTokens(str) {
  if (!str) return 0;
  const charBased = Math.ceil(str.length / 4);
  const wordBased = str.trim() ? str.trim().split(/\s+/).length : 0;
  return Math.max(charBased, wordBased);
}

function sanitizeJsonInput(raw) {
  if (!raw) return '';
  let cleaned = raw.replace(/\r\n/g, '\n');
  // Remove BOM if present
  if (cleaned.charCodeAt(0) === 0xfeff) {
    cleaned = cleaned.slice(1);
  }
  return cleaned.trim();
}

function analyzeStructure(value) {
  const summary = {
    nodes: 0,
    tables: 0,
  };

  function visit(node) {
    summary.nodes += 1;
    if (Array.isArray(node)) {
      if (isUniformObjectArray(node)) summary.tables += 1;
      node.forEach(visit);
    } else if (isPlainObject(node)) {
      Object.values(node).forEach(visit);
    }
  }

  visit(value);
  return summary;
}

function updateStats(summary, tokensSaved) {
  if (statNodes) statNodes.textContent = summary.nodes.toLocaleString('es-ES');
  if (statTables) statTables.textContent = summary.tables.toLocaleString('es-ES');
  if (statTokens) {
    const safe = Math.max(tokensSaved, 0);
    statTokens.textContent = safe.toLocaleString('es-ES');
  }
  if (statSessions) {
    sessionCount += 1;
    statSessions.textContent = sessionCount.toLocaleString('es-ES');
  }
  updateChart(tokensSaved);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.style.background = isError
    ? 'rgba(239, 68, 68, 0.95)'
    : 'rgba(21, 179, 125, 0.95)';
  toast.classList.add('visible');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2500);
}

function handleConvert() {
  const raw = jsonInput.value.trim();
  if (!raw) {
    toonOutput.value = '';
    showToast('Ingresa JSON para convertir', true);
    return;
  }

  try {
    const sanitized = sanitizeJsonInput(raw);
    const parsed = JSON.parse(sanitized);
    lastBeautified = JSON.stringify(parsed, null, 2);
    lastStandardLength = lastBeautified.length;
    if (beautifiedView) {
      beautifiedView.textContent = lastBeautified;
    }
    if (beautyMeta) {
      beautyMeta.textContent = beautyVisible ? 'Mostrando' : 'Listo';
    }
    const toon = encodeToToon(parsed);
    toonOutput.value = toon || '(salida vacía)';
    showToast('Conversión completada');
    const summary = analyzeStructure(parsed);
    const tokensSaved = lastStandardLength - toon.length;
    updateStats(summary, tokensSaved);
    if (inputTokensLabel) {
      inputTokensLabel.textContent = `Tokens estimados: ${estimateTokens(
        lastBeautified
      ).toLocaleString('es-ES')}`;
    }
    if (outputTokensLabel) {
      outputTokensLabel.textContent = `Tokens estimados: ${estimateTokens(
        toon
      ).toLocaleString('es-ES')}`;
    }
  } catch (error) {
    toonOutput.value = '';
    lastBeautified = '';
    lastStandardLength = 0;
    if (beautifiedView) {
      beautifiedView.textContent = '';
    }
    if (beautyMeta) {
      beautyMeta.textContent = 'Error';
    }
    if (inputTokensLabel) inputTokensLabel.textContent = 'Tokens estimados: 0';
    if (outputTokensLabel) outputTokensLabel.textContent = 'Tokens estimados: 0';
    showToast('JSON inválido o no soportado', true);
    console.error(error);
  }
}

async function handleCopy() {
  const text = toonOutput.value.trim();
  if (!text) {
    showToast('No hay salida para copiar', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('TOON copiado');
  } catch (error) {
    showToast('No se pudo copiar', true);
  }
}

function handleSample() {
  jsonInput.value = JSON.stringify(sampleData, null, 2);
  toonOutput.value = '';
  showToast('Ejemplo cargado');
  if (beautyPanel) {
    beautyPanel.classList.add('hidden');
    beautyVisible = false;
    if (beautyMeta) beautyMeta.textContent = 'Oculto';
  }
  lastBeautified = '';
  lastStandardLength = 0;
  if (inputTokensLabel) inputTokensLabel.textContent = 'Tokens estimados: 0';
  if (outputTokensLabel) outputTokensLabel.textContent = 'Tokens estimados: 0';
}

function toggleBeautified() {
  if (!lastBeautified) {
    showToast('Convierte primero para generar el JSON limpio', true);
    return;
  }
  beautyVisible = !beautyVisible;
  if (beautyPanel) {
    beautyPanel.classList.toggle('hidden', !beautyVisible);
  }
  if (beautyMeta) {
    beautyMeta.textContent = beautyVisible ? 'Mostrando' : 'Oculto';
  }
  if (beautyBtn) {
    beautyBtn.innerHTML = beautyVisible
      ? '<i data-feather="eye-off"></i> Ocultar JSON'
      : '<i data-feather="eye"></i> Ver JSON limpio';
    if (window.feather) {
      window.feather.replace();
    }
  }
}

function initChart() {
  const chartEl = document.getElementById('tokenChart');
  if (!chartEl || !window.ApexCharts) return;
  const options = {
    chart: {
      type: 'area',
      height: 260,
      toolbar: { show: false },
      fontFamily: 'Plus Jakarta Sans, sans-serif',
    },
    colors: ['#7c3aed'],
    dataLabels: { enabled: false },
    stroke: {
      curve: 'smooth',
      width: 3,
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.35,
        opacityTo: 0.05,
      },
    },
    series: [{ name: 'Tokens ahorrados', data: tokenSeries }],
    xaxis: {
      categories: tokenSeries.map((_, idx) => `Run ${idx + 1}`),
      labels: { style: { colors: '#94a3b8' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: '#94a3b8' } },
    },
    grid: {
      borderColor: '#eaeef5',
      strokeDashArray: 6,
    },
    tooltip: {
      theme: 'light',
    },
  };

  chartInstance = new ApexCharts(chartEl, options);
  chartInstance.render();
}

function updateChart(value) {
  if (!chartInstance || typeof value !== 'number') return;
  tokenSeries = [...tokenSeries.slice(-7), Math.max(value, 0)];
  chartInstance.updateSeries([{ name: 'Tokens ahorrados', data: tokenSeries }]);
  chartInstance.updateOptions({
    xaxis: {
      categories: tokenSeries.map((_, idx) => `Run ${idx + 1}`),
    },
  });
}

convertBtn.addEventListener('click', handleConvert);
copyBtn.addEventListener('click', handleCopy);
sampleBtn.addEventListener('click', handleSample);
if (beautyBtn) {
  beautyBtn.addEventListener('click', toggleBeautified);
}

futureButtons.forEach((btn) => {
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    showToast('Próximamente', false);
  });
});

jsonInput.value = JSON.stringify(sampleData, null, 2);

window.addEventListener('DOMContentLoaded', () => {
  if (window.feather) {
    window.feather.replace();
  }
  initChart();
  handleConvert();
});

