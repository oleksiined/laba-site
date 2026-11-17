// Vercel Serverless Function — /api/blog-article
// GET    ?slug=...        — read one article (all fields incl. content), admin only
// GET    ?list=1          — list all articles (no content), admin only
// POST   body={...}       — upsert article (create or update by slug)
// DELETE body={slug}      — delete article by slug
// PATCH  body={slug,status} — toggle status only

const https = require('https');

function sbReq(path, method, key, body = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'apikey':        key,
      'Authorization': `Bearer ${key}`,
      'Accept':        'application/json',
      'Prefer':        method === 'POST' ? 'return=representation,resolution=merge-duplicates' : 'return=minimal',
    };
    if (body) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request({
      hostname: 'lczccbminjzefmmehntq.supabase.co',
      path,
      method,
      headers
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'No service key' });

  const { method } = req;

  // --- GET: list or single article ---
  if (method === 'GET') {
    const { slug, list } = req.query;
    if (list) {
      const r = await sbReq(
        '/rest/v1/blog_articles?select=id,slug,title,category,status,published_at,sort_order,read_time&order=sort_order.desc.nullslast,published_at.desc',
        'GET', key
      );
      const data = r.status < 300 ? JSON.parse(r.body) : [];
      return res.status(200).json({ ok: true, articles: data });
    }
    if (slug) {
      const r = await sbReq(
        `/rest/v1/blog_articles?slug=eq.${encodeURIComponent(slug)}&limit=1`,
        'GET', key
      );
      const data = r.status < 300 ? JSON.parse(r.body) : [];
      return res.status(200).json({ ok: true, article: data[0] || null });
    }
    return res.status(400).json({ ok: false, error: 'slug or list required' });
  }

  // --- PATCH: update status or sort_order ---
  if (method === 'PATCH') {
    const body = req.body || {};
    const { slug, status, sort_order } = body;
    if (!slug) return res.status(400).json({ ok: false, error: 'slug required' });
    const update = {};
    if (status !== undefined) update.status = status;
    if (sort_order !== undefined) update.sort_order = sort_order;
    update.updated_at = new Date().toISOString();
    const r = await sbReq(
      `/rest/v1/blog_articles?slug=eq.${encodeURIComponent(slug)}`,
      'PATCH', key, JSON.stringify(update)
    );
    if (r.status >= 300) return res.status(r.status).json({ ok: false, error: r.body });
    return res.status(200).json({ ok: true });
  }

  // --- POST: upsert full article ---
  if (method === 'POST') {
    const body = req.body || {};
    if (!body.slug) return res.status(400).json({ ok: false, error: 'slug required' });
    const now = new Date().toISOString();
    const payload = {
      slug:        body.slug,
      title:       body.title       || '',
      status:      body.status      || 'draft',
      category:    body.category    || null,
      cat_color:   body.cat_color   || null,
      cat_filter:  body.cat_filter  || null,
      read_time:   body.read_time   || null,
      published_at: body.published_at || (body.status === 'published' ? now : null),
      cover_url:   body.cover_url   || null,
      gradient:    body.gradient    || null,
      seo_title:   body.seo_title   || null,
      meta_desc:   body.meta_desc   || null,
      author_name: body.author_name || null,
      author_role: body.author_role || null,
      author_avatar: body.author_avatar || null,
      related:     body.related     || null,
      content:     body.content     || null,
      sort_order:  body.sort_order  || null,
      updated_at:  now,
    };
    // If new article (no id), set created_at
    if (!body.id) payload.created_at = now;
    const r = await sbReq(
      '/rest/v1/blog_articles?on_conflict=slug',
      'POST', key, JSON.stringify(payload)
    );
    if (r.status >= 300) return res.status(r.status).json({ ok: false, error: r.body });
    const result = r.body ? JSON.parse(r.body) : [];
    return res.status(200).json({ ok: true, article: Array.isArray(result) ? result[0] : result });
  }

  // --- DELETE ---
  if (method === 'DELETE') {
    const body = req.body || {};
    const { slug } = body;
    if (!slug) return res.status(400).json({ ok: false, error: 'slug required' });
    const r = await sbReq(
      `/rest/v1/blog_articles?slug=eq.${encodeURIComponent(slug)}`,
      'DELETE', key
    );
    if (r.status >= 300) return res.status(r.status).json({ ok: false, error: r.body });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
