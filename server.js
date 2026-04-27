import 'dotenv/config';
import express from 'express';

const BUSCADOR_API_URL = process.env.BUSCADOR_API_URL;
const ACTION_API_KEY = process.env.ACTION_API_KEY;
const PORT = process.env.PORT || 8080;

if (!BUSCADOR_API_URL) {
  console.error('Falta BUSCADOR_API_URL en el entorno.');
  process.exit(1);
}
if (!ACTION_API_KEY) {
  console.error('Falta ACTION_API_KEY en el entorno.');
  process.exit(1);
}

const UPSTREAM = BUSCADOR_API_URL.replace(/\/+$/, '');
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DEFAULT_MAX_CHARS = 60000;
const MAX_MAX_CHARS = 80000;

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== ACTION_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

async function callUpstream(url, options = {}) {
  const start = Date.now();
  console.log(`  → upstream ${options.method || 'GET'} ${url}`);
  let r;
  try {
    r = await fetch(url, options);
  } catch (e) {
    console.error(`  ✗ upstream error tras ${Date.now() - start}ms: ${e.message}`);
    throw Object.assign(new Error(`Upstream inalcanzable: ${e.message}`), { status: 502 });
  }
  const elapsed = Date.now() - start;
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const body = await r.text();
    console.error(`  ✗ upstream non-JSON HTTP ${r.status} tras ${elapsed}ms`);
    throw Object.assign(new Error(`Respuesta no-JSON (HTTP ${r.status}): ${body.slice(0, 200)}`), { status: 502 });
  }
  const data = await r.json();
  if (!r.ok || data.error) {
    console.error(`  ✗ upstream HTTP ${r.status} tras ${elapsed}ms: ${data.error || ''}`);
    throw Object.assign(new Error(data.error || `Upstream HTTP ${r.status}`), { status: r.status || 502 });
  }
  console.log(`  ✓ upstream HTTP ${r.status} tras ${elapsed}ms`);
  return data;
}

app.get('/health', (_req, res) => res.json({ ok: true, upstream: UPSTREAM }));

app.get('/search', requireAuth, async (req, res) => {
  const query = (req.query.query || '').toString().trim();
  const organo = (req.query.organo || '').toString().trim();
  if (!query) {
    return res.status(400).json({ error: 'Falta el parámetro "query".' });
  }
  const cappedLimit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  try {
    const data = await callUpstream(`${UPSTREAM}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        organo: organo || undefined,
        limit: cappedLimit,
        advanced: false,
        rerank: false,
      }),
    });

    const results = (data.results || []).map((r, i) => ({
      rank: i + 1,
      filename: r.filename,
      organo: r.organo,
      file_path: r.file_path,
      score: typeof r.score === 'number' ? Number(r.score.toFixed(4)) : null,
      text_excerpt: r.text || '',
    }));

    res.json({
      query,
      organo_filter: organo || null,
      total_results: results.length,
      note: 'Los text_excerpt están truncados (≤1200 chars). Para leer el texto completo de una sentencia, llamá a /document con su file_path.',
      results,
    });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.get('/document', requireAuth, async (req, res) => {
  const filePath = (req.query.file_path || '').toString().trim();
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const maxChars = Math.min(Math.max(Number(req.query.max_chars) || DEFAULT_MAX_CHARS, 1000), MAX_MAX_CHARS);
  if (!filePath) {
    return res.status(400).json({ error: 'Falta el parámetro "file_path".' });
  }
  try {
    const data = await callUpstream(
      `${UPSTREAM}/api/document/text?path=${encodeURIComponent(filePath)}`
    );
    const fullText = data.full_text || '';
    const totalChars = fullText.length;
    const slice = fullText.slice(offset, offset + maxChars);
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < totalChars;
    res.json({
      filename: data.filename,
      file_path: data.file_path,
      organo: data.organo,
      num_pages: data.num_pages,
      total_chars: totalChars,
      offset,
      returned_chars: slice.length,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
      text: slice,
    });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy Action escuchando en http://localhost:${PORT} → ${UPSTREAM}`);
});
