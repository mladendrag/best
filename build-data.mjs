// Lê o cache do MCP e gera um data.json enxuto para o site estático.
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.resolve('../mcp-investidor10/.cache.json');
const OUT = path.resolve('./data.json');

const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

const tickers = Object.keys(cache)
  .filter((k) => k.startsWith('text:/acoes/'))
  .map((k) => k.replace('text:/acoes/', '').toUpperCase())
  .sort();

// Parser robusto para formato brasileiro:
// "319.462.104.000" -> 319462104000 (inteiro com pontos = milhares)
// "31,62 %" -> 31.62 (vírgula = decimal)
// "R$ 23,41" -> 23.41
// Arrays [display, raw] usam o raw.
function parseBR(value) {
  if (value == null || value === '-' || value === '') return null;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) {
    return parseBR(value[1] ?? value[0]);
  }
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(/[R$\s%]/g, '');
  if (s === '' || s === '-') return null;
  const hasComma = s.includes(',');
  if (hasComma) {
    // comma = decimal, dot = thousands
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // no comma: dots are thousands separators
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Extrai tabela (array de arrays). Primeira linha = header com years.
function extractTable(table, yearPattern = /^\d{4}$/) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) return null;
  const header = table[0];
  const years = [];
  const yearIdx = [];
  for (let i = 0; i < header.length; i++) {
    const v = typeof header[i] === 'string' ? header[i] : '';
    if (yearPattern.test(v)) {
      years.push(v);
      yearIdx.push(i);
    }
  }
  const rows = {};
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!Array.isArray(row)) continue;
    const name = String(row[0] || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s*-\s*\(R\$\)\s*$/, '')
      .replace(/\s*-\s*\(%\)\s*$/, '')
      .trim();
    if (!name || name === '#') continue;
    rows[name] = yearIdx.map((i) => parseBR(row[i]));
  }
  return { years, rows };
}

function extractIndicators(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [name, series] of Object.entries(raw)) {
    if (!Array.isArray(series)) continue;
    out[name] = series
      .filter((s) => s.year && s.year !== 'Atual')
      .map((s) => ({
        year: String(s.year),
        value: typeof s.value === 'number' ? s.value : null,
      }))
      .reverse();
  }
  return out;
}

function extractStockInfo(html) {
  // <div class="name-ticker"><h1>TICKER</h1><h2>Nome da empresa</h2></div>
  const block = html.match(
    /<div[^>]*class=["']?name-ticker["']?[^>]*>([\s\S]*?)<\/div>/,
  );
  let name = '';
  if (block) {
    const h2 = block[1].match(/<h2[^>]*>([^<]+)<\/h2>/);
    name = h2?.[1]?.trim() || '';
  }
  const priceMatch = html.match(/cotacao[^>]*>[^R]*R\$\s*([\d.,]+)/);
  const price = priceMatch ? parseBR(priceMatch[1]) : null;
  return { name, price };
}

function findCacheKey(prefix) {
  return Object.keys(cache).find((k) => k.startsWith(prefix));
}

const result = { generatedAt: new Date().toISOString(), tickers: {} };

for (const ticker of tickers) {
  const lower = ticker.toLowerCase();
  const htmlEntry = cache[`text:/acoes/${lower}`];
  const html = htmlEntry?.data;
  if (!html) continue;

  const m = html.match(/\/api\/balancos\/receitaliquida\/chart\/(\d+)/);
  const companyId = m?.[1];

  const tMatch = html.match(/historico-indicadores\/(\d+)\/(\d+)/);
  const tickerId = tMatch?.[1];
  const typeId = tMatch?.[2];

  const hist =
    tickerId &&
    cache[`json:/api/historico-indicadores/${tickerId}/${typeId}?v=2`]?.data;

  // Endpoints de balanço
  const dreKey = findCacheKey(
    `json:/api/balancos/balancoresultados/chart/${companyId}/`,
  );
  const dreTable = dreKey ? cache[dreKey]?.data : null;

  const bpKey = findCacheKey(
    `json:/api/balancos/balancopatrimonial/chart/${companyId}/`,
  );
  const bpTable = bpKey ? cache[bpKey]?.data : null;

  const receitaQuarterly =
    cache[`json:/api/balancos/receitaliquida/chart/${companyId}/`]?.data ||
    null;

  const ativosPassivos =
    cache[`json:/api/balancos/ativospassivos/chart/${companyId}/`]?.data ||
    null;

  result.tickers[ticker] = {
    ticker,
    info: extractStockInfo(html),
    indicators: extractIndicators(hist),
    dreAnual: extractTable(dreTable),
    balancoPatrimonial: extractTable(bpTable, /^\d[TQ]\d{4}$/),
    receitaQuarterly: Array.isArray(receitaQuarterly)
      ? receitaQuarterly.map((r) => ({
          year: r.year,
          quarter: r.quarter,
          net_revenue: r.net_revenue,
          cost: r.cost,
          net_profit: r.net_profit,
        }))
      : null,
    ativosPassivos: Array.isArray(ativosPassivos) ? ativosPassivos : null,
  };
}

fs.writeFileSync(OUT, JSON.stringify(result));
const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`✓ ${OUT}`);
console.log(`  ${Object.keys(result.tickers).length} tickers, ${size} KB`);
