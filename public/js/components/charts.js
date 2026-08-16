// components/charts.js — dependency-free SVG charts
// All charts are responsive (viewBox) and inherit accent color via currentColor.

function el(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

// Line / area chart
export function lineChart(container, { labels = [], series = [], height = 220, area = true } = {}) {
  container.innerHTML = '';
  const W = 600, H = height, pad = 36;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', preserveAspectRatio: 'none' });
  const all = series.flatMap((s) => s.data);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const n = Math.max(1, labels.length - 1);
  const x = (i) => pad + (i / n) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);

  // gridlines
  for (let g = 0; g <= 4; g++) {
    const gy = pad + (g / 4) * (H - pad * 2);
    svg.appendChild(el('line', { x1: pad, y1: gy, x2: W - pad, y2: gy, class: 'chart-grid' }));
    const val = max - (g / 4) * (max - min);
    const t = el('text', { x: pad - 6, y: gy + 3, class: 'chart-axis', 'text-anchor': 'end' });
    t.textContent = fmt(Math.round(val));
    svg.appendChild(t);
  }

  series.forEach((s, si) => {
    const color = s.color || (si === 0 ? 'var(--accent)' : 'var(--muted)');
    const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    if (area) {
      const areaPts = `${pad},${H - pad} ${pts} ${W - pad},${H - pad}`;
      svg.appendChild(el('polygon', { points: areaPts, fill: color, class: 'chart-area' }));
    }
    svg.appendChild(el('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2, class: 'chart-line' }));
    s.data.forEach((v, i) => {
      svg.appendChild(el('circle', { cx: x(i), cy: y(v), r: 3, fill: color, class: 'chart-dot' }));
    });
  });

  // x labels (sparse)
  const step = Math.ceil(labels.length / 6);
  labels.forEach((l, i) => {
    if (i % step === 0) {
      const t = el('text', { x: x(i), y: H - 10, class: 'chart-axis', 'text-anchor': 'middle' });
      t.textContent = l;
      svg.appendChild(t);
    }
  });
  container.appendChild(svg);
}

// Donut chart
export function donutChart(container, { segments = [], size = 180, thickness = 26 } = {}) {
  container.innerHTML = '';
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'chart-donut' });
  const r = (size - thickness) / 2, cx = size / 2, cy = size / 2;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let angle = -Math.PI / 2;
  segments.forEach((s) => {
    const frac = s.value / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    svg.appendChild(el('path', {
      d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      fill: 'none', stroke: s.color || 'var(--accent)', 'stroke-width': thickness, class: 'chart-seg',
    }));
    angle = a2;
  });
  container.appendChild(svg);
}

// Bar chart (horizontal)
export function barChart(container, { items = [], max = null } = {}) {
  container.innerHTML = '';
  const maxV = max || Math.max(1, ...items.map((i) => i.value));
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const pct = Math.round((it.value / maxV) * 100);
    row.innerHTML = `
      <div class="bar-label" title="${escapeHtml(String(it.label))}">${escapeHtml(String(it.label))}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-val">${escapeHtml(String(it.value))}</div>`;
    container.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
