// Lê o cache do MCP e gera um data.json enxuto para o site estático.
// Uso: node build-data.mjs
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.resolve('../mcp-investidor10/.cache.json');
const OUT = path.resolve('./data.json');

const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

// Descobre tickers a partir das páginas HTML cacheadas
const tickers = Object.keys(cache)
  .filter((k) => k.startsWith('text:/acoes/'))
  .map((k) => k.replace('text:/acoes/', '').toUpperCase())
  .sort();

function parseNumberCell(cell) {
  if (!cell) return null;
  if (Array.isArray(cell)) {
    const n = parseFloat(String(cell[1]).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? null : n;
  }
  if (typeof cell === 'string') {
    const n = parseFloat(cell.replace(/[^\d.-]/g, ''));
    return isNaN(n) ? null : n;
  }
  return null;
}

function extractDRE(dreTable) {
  if (!Array.isArray(dreTable) || !Array.isArray(dreTable[0])) return null;
  const header = dreTable[0];
  const years = [];
  const yearIdx = [];
  for (let i = 2; i < header.length; i++) {
    if (typeof header[i] === 'string' && /^\d{4}$/.test(header[i])) {
      years.push(header[i]);
      yearIdx.push(i);
    }
  }
  function row(name) {
    const r = dreTable.find((x) => String(x[0]).startsWith(name));
    if (!r) return [];
    return yearIdx.map((i) => parseNumberCell(r[i]));
  }
  return {
    years: years.reverse(),
    receitaLiquida: row('Receita Líquida').reverse(),
    lucroLiquido: row('Lucro Líquido').reverse(),
    ebit: row('EBIT').reverse(),
    lucroBruto: row('Lucro Bruto').reverse(),
  };
}

function extractIndicators(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [name, series] of Object.entries(raw)) {
    if (!Array.isArray(series)) continue;
    out[name] = series
      .filter((s) => s.year && s.year !== 'Atual')
      .map((s) => ({ year: String(s.year), value: s.value }))
      .reverse();
  }
  return out;
}

function extractStockInfo(html) {
  // Extrai preço e nome simples por regex
  const name = (html.match(/<h2[^>]*>([^<]+)<\/h2>/) || [])[1]?.trim() || '';
  const price = parseFloat(
    (html.match(/cotacao[^>]*>[^R]*R\$\s*([\d.,]+)/) || [])[1]
      ?.replace('.', '')
      .replace(',', '.') || '0',
  );
  return { name, price: isNaN(price) ? null : price };
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

  // Procura qualquer entrada de histórico-indicadores / balanços
  const histKey = tickerId
    ? `json:/api/historico-indicadores/${tickerId}/${typeId}?v=2`
    : null;
  const hist = histKey ? cache[histKey]?.data : null;

  // Balanços com years variável — procura a chave que começa com o prefixo
  const dreKeyPrefix = `json:/api/balancos/balancoresultados/chart/${companyId}/`;
  const dreKey = Object.keys(cache).find((k) => k.startsWith(dreKeyPrefix));
  const dre = dreKey ? cache[dreKey]?.data : null;

  result.tickers[ticker] = {
    ticker,
    info: extractStockInfo(html),
    indicators: extractIndicators(hist),
    dre: extractDRE(dre),
  };
}

fs.writeFileSync(OUT, JSON.stringify(result));
const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`✓ ${OUT}`);
console.log(`  ${Object.keys(result.tickers).length} tickers, ${size} KB`);
