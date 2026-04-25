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

const app = express();
app.use(express.json({ limit: '1mb' }));

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== ACTION_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

async function callUpstream(url, options = {}) {
  const r = await fetch(url, options);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const body = await r.text();
    throw Object.assign(new Error(`Respuesta no-JSON (HTTP ${r.status}): ${body.slice(0, 200)}`), { status: 502 });
  }
  const data = await r.json();
  if (!r.ok || data.error) {
    throw Object.assign(new Error(data.error || `Upstream HTTP ${r.status}`), { status: r.status || 502 });
  }
  return data;
}

app.get('/health', (_req, res) => res.json({ ok: true, upstream: UPSTREAM }));

app.post('/search', requireAuth, async (req, res) => {
  const { query, organo, limit } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Falta el parámetro "query".' });
  }
  const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

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
  if (!filePath) {
    return res.status(400).json({ error: 'Falta el parámetro "file_path".' });
  }
  try {
    const data = await callUpstream(
      `${UPSTREAM}/api/document/text?path=${encodeURIComponent(filePath)}`
    );
    res.json({
      filename: data.filename,
      file_path: data.file_path,
      organo: data.organo,
      num_pages: data.num_pages,
      num_chars: data.num_chars,
      full_text: data.full_text,
    });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy Action escuchando en http://localhost:${PORT} → ${UPSTREAM}`);
});
