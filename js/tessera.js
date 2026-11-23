/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
/*
  Embeddings TESSERA (Université de Cambridge) lus par petits blocs depuis le dépôt Zarr public
  ----------------------------------------------------------------------------------------------
  pfTessera.read(bbox WGS84, année, { signal }) -> grille de 128 dimensions par pixel de 10 m
  Dépôt : https://data.source.coop/tessera/tessera/zarr/v1.1-dclimate/ (Zarr v3, un groupe par zone UTM).
  Les tableaux « embeddings » (int8, [année, bande, y, x]) et « scales » (float32, [année, y, x]) sont rangés
  en gros fichiers (shards) découpés en blocs de 32 × 32 pixels ; l'index des blocs est à la fin de chaque
  fichier. On lit l'index, puis seulement les blocs qui touchent l'emprise, par requêtes partielles.
  Valeur réelle = int8 × scale du pixel ; scale = NaN : pixel sans donnée.
  Dépend de pfBlosc (js/blosc.js) et de fzstd (fzstd.min.js).
*/
const pfTessera = {
  BASE: "https://data.source.coop/tessera/tessera/zarr/v1.1-dclimate/",
  FIRST_YEAR: 2017, LAST_YEAR: 2025, MAX_PIXELS: 250000, // 25 km² au plus par lecture
  _meta: new Map(), _index: new Map(),
  stats: { requests: 0, bytes: 0 },

  utmZone(lng) { return Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1)); },
  utmDef(zone, south) { return `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`; },
  async _fetch(url, range, signal, wantSize) {
    const headers = range ? { Range: range } : {};
    let resp = await fetch(url, { headers, signal });
    if (resp.status === 429 || resp.status >= 500) { await new Promise((r) => setTimeout(r, 600)); resp = await fetch(url, { headers, signal }); }
    if (!resp.ok) { const e = new Error("HTTP " + resp.status); e.status = resp.status; throw e; }
    const buf = await resp.arrayBuffer();
    this.stats.requests++; this.stats.bytes += buf.byteLength;
    if (wantSize) { const m = /\/(\d+)\s*$/.exec(resp.headers.get("content-range") || ""); return m ? parseInt(m[1], 10) : NaN; }
    return buf;
  },
  // Métadonnées d'une zone : origine et pas de la grille, découpage des deux tableaux
  meta(zone, signal) {
    const key = "utm" + String(zone).padStart(2, "0");
    if (!this._meta.has(key)) {
      const dec = (b) => JSON.parse(new TextDecoder().decode(b));
      const p = Promise.all(["zarr.json", "embeddings/zarr.json", "scales/zarr.json"].map((f) => this._fetch(`${this.BASE}${key}/${f}`, null, signal).then(dec))).then(([g, e, s]) => {
        const t = g.attributes["spatial:transform"], shard = (m) => m.codecs.find((c) => c.name === "sharding_indexed");
        const es = shard(e), ss = shard(s);
        if (!t || !es || !ss) throw new Error("structure du dépôt inattendue");
        return { key, x0: t[2], y0: t[5], res: t[0], epsg: g.attributes["proj:code"], rows: e.shape[2], cols: e.shape[3], years: e.shape[0], dims: e.shape[1],
          shard: e.chunk_grid.configuration.chunk_shape[2], inner: es.configuration.chunk_shape[2],
          sShard: s.chunk_grid.configuration.chunk_shape[1], sInner: ss.configuration.chunk_shape[1] };
      });
      p.catch(() => this._meta.delete(key));
      this._meta.set(key, p);
    }
    return this._meta.get(key);
  },
  // Index d'un fichier : pour chaque bloc, position et longueur (16 octets par bloc, à la fin du fichier, suivis
  // de 4 octets de contrôle). L'index complet pèse 262 Ko : on n'en lit que les entrées utiles, rangée par rangée,
  // après avoir demandé la taille du fichier. -> { entry(k) -> Promise<[position, longueur] | null> } ou null
  index(url, n, signal) {
    if (!this._index.has(url)) {
      const idxBytes = n * 16 + 4, MISSING = 0xffffffff;
      const p = this._fetch(url, "bytes=-4", signal, true).then((size) => {
        const rows = new Map(), view = (dv, o) => (dv.getUint32(o, true) === MISSING && dv.getUint32(o + 4, true) === MISSING ? null : [dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296, dv.getUint32(o + 8, true)]);
        if (!Number.isFinite(size)) { // taille inconnue (en-tête non exposé) : index complet en une requête
          const full = this._fetch(url, "bytes=-" + idxBytes, signal).then((b) => new DataView(b));
          return { range: (k0, k1) => full.then((dv) => { const out = []; for (let k = k0; k <= k1; k++) out.push(view(dv, k * 16)); return out; }) };
        }
        const start = size - idxBytes;
        return { range: (k0, k1) => { // entrées k0..k1 (une rangée de blocs voisins)
          const key = k0 + "-" + k1;
          if (!rows.has(key)) rows.set(key, this._fetch(url, `bytes=${start + k0 * 16}-${start + k1 * 16 + 15}`, signal).then((b) => { const dv = new DataView(b), out = []; for (let k = 0; k <= k1 - k0; k++) out.push(view(dv, k * 16)); return out; }));
          return rows.get(key);
        } };
      }, (e) => { if (e.status === 404) return null; throw e; });
      p.catch(() => this._index.delete(url));
      if (this._index.size > 40) this._index.delete(this._index.keys().next().value);
      this._index.set(url, p);
    }
    return this._index.get(url);
  },
  /*
    -> { width, height, dims, res, def, zone, bbox: [xmin, ymin, xmax, ymax] (m), data: Int8Array [dim][y][x],
         scales: Float32Array [y][x], value(d, i), valid, requests, bytes, ms }
  */
  async read(bboxWgs, year, opts) {
    opts = opts || {};
    const p4 = opts.proj4 || (typeof window !== "undefined" && (window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4)));
    const zstd = opts.zstd || (typeof window !== "undefined" && window.fzstd && window.fzstd.decompress);
    const blosc = opts.blosc || (typeof window !== "undefined" && window.pfBlosc) || (typeof pfBlosc !== "undefined" ? pfBlosc : null);
    if (!p4 || !zstd || !blosc) throw new Error("modules de lecture indisponibles");
    if (!(year >= this.FIRST_YEAR && year <= this.LAST_YEAR)) throw new Error(`année hors de la période ${this.FIRST_YEAR}–${this.LAST_YEAR}`);
    const t0 = Date.now(), r0 = this.stats.requests, b0 = this.stats.bytes, signal = opts.signal;
    const lng = (bboxWgs[0] + bboxWgs[2]) / 2, lat = (bboxWgs[1] + bboxWgs[3]) / 2, zone = this.utmZone(lng);
    // le dépôt range les deux hémisphères d'une zone dans la même grille, en coordonnées « nord » (négatives au sud)
    const def = this.utmDef(zone, false), m = await this.meta(zone, signal);
    const pts = [[bboxWgs[0], bboxWgs[1]], [bboxWgs[0], bboxWgs[3]], [bboxWgs[2], bboxWgs[1]], [bboxWgs[2], bboxWgs[3]]].map((c) => p4("EPSG:4326", def, c));
    const xmin = Math.min(...pts.map((p) => p[0])), xmax = Math.max(...pts.map((p) => p[0])), ymin = Math.min(...pts.map((p) => p[1])), ymax = Math.max(...pts.map((p) => p[1]));
    const c0 = Math.max(0, Math.floor((xmin - m.x0) / m.res)), c1 = Math.min(m.cols, Math.ceil((xmax - m.x0) / m.res));
    const rw0 = Math.max(0, Math.floor((m.y0 - ymax) / m.res)), rw1 = Math.min(m.rows, Math.ceil((m.y0 - ymin) / m.res));
    const W = c1 - c0, H = rw1 - rw0;
    if (W <= 0 || H <= 0) throw new Error("emprise hors de la couverture");
    if (W * H > this.MAX_PIXELS) throw new Error("emprise trop grande pour une lecture par blocs");
    const D = m.dims, t = year - this.FIRST_YEAR, data = new Int8Array(D * W * H), scales = new Float32Array(W * H).fill(NaN);
    // blocs d'un tableau qui touchent la fenêtre : lecture, décompression, recopie dans la grille
    const readArray = async (name, shardSize, inner, perPix, write) => {
      const per = shardSize / inner, jobs = [];
      for (let sy = Math.floor(rw0 / shardSize); sy <= Math.floor((rw1 - 1) / shardSize); sy++) for (let sx = Math.floor(c0 / shardSize); sx <= Math.floor((c1 - 1) / shardSize); sx++) {
        const url = `${this.BASE}${m.key}/${name}/c/${t}/${name === "embeddings" ? "0/" : ""}${sy}/${sx}`;
        jobs.push(this.index(url, per * per, signal).then((idx) => {
          if (!idx) return null; // fichier absent : zone sans donnée
          const top = sy * shardSize, left = sx * shardSize, inner0 = [];
          const ixa = Math.max(0, Math.floor((c0 - left) / inner)), ixb = Math.min(per - 1, Math.floor((c1 - 1 - left) / inner));
          for (let iy = Math.max(0, Math.floor((rw0 - top) / inner)); iy <= Math.min(per - 1, Math.floor((rw1 - 1 - top) / inner)); iy++)
            inner0.push(idx.range(iy * per + ixa, iy * per + ixb).then((entries) => Promise.all(entries.map((en, q) => {
              if (!en) return null; // bloc vide
              // un bloc arrive parfois incomplet : on le redemande (jusqu'à trois essais) avant d'abandonner la lecture
              const get = (attempt) => this._fetch(url, `bytes=${en[0]}-${en[0] + en[1] - 1}`, signal).then((buf) => {
                const raw = blosc.decode(new Uint8Array(buf), zstd);
                if (raw.length !== perPix * inner * inner) throw new Error("bloc de taille inattendue");
                return raw;
              }).catch((e) => {
                if (attempt >= 2 || (signal && signal.aborted) || (e && e.status === 404)) throw e;
                return new Promise((ok) => setTimeout(ok, 400 * (attempt + 1))).then(() => get(attempt + 1));
              });
              return get(0).then((raw) => write(raw, top + iy * inner, left + (ixa + q) * inner));
            }))));
          return Promise.all(inner0);
        }));
      }
      await Promise.all(jobs);
    };
    const copy = (r, c, inner, fn) => { // parcourt la partie du bloc (r, c) qui tombe dans la fenêtre
      const ya = Math.max(r, rw0), yb = Math.min(r + inner, rw1), xa = Math.max(c, c0), xb = Math.min(c + inner, c1);
      for (let y = ya; y < yb; y++) fn(y - r, xa - c, (y - rw0) * W + (xa - c0), xb - xa);
    };
    await Promise.all([
      readArray("embeddings", m.shard, m.inner, D, (raw, r, c) => {
        const n2 = m.inner * m.inner, src = new Int8Array(raw.buffer, raw.byteOffset, raw.length);
        copy(r, c, m.inner, (by, bx, o, n) => { for (let d = 0; d < D; d++) data.set(src.subarray(d * n2 + by * m.inner + bx, d * n2 + by * m.inner + bx + n), d * W * H + o); });
      }),
      readArray("scales", m.sShard, m.sInner, 4, (raw, r, c) => {
        const dv = new DataView(raw.buffer, raw.byteOffset, raw.length);
        copy(r, c, m.sInner, (by, bx, o, n) => { for (let i = 0; i < n; i++) scales[o + i] = dv.getFloat32((by * m.sInner + bx + i) * 4, true); });
      })
    ]);
    let valid = 0; for (let i = 0; i < scales.length; i++) if (Number.isFinite(scales[i])) valid++;
    return { width: W, height: H, dims: D, res: m.res, zone, def, year, bbox: [m.x0 + c0 * m.res, m.y0 - rw1 * m.res, m.x0 + c1 * m.res, m.y0 - rw0 * m.res],
      data, scales, valid, value: (d, i) => data[d * W * H + i] * scales[i],
      requests: this.stats.requests - r0, bytes: this.stats.bytes - b0, ms: Date.now() - t0 };
  },
  /*
    Plusieurs années sur la même emprise, quelques-unes à la fois. Une année illisible est écartée, pas fatale.
    -> { reads: [lecture, …] (années lues, en ordre), failed: [année, …] }
  */
  async readYears(bboxWgs, years, opts) {
    opts = opts || {};
    const reads = [], failed = [], queue = years.slice(); let done = 0;
    const worker = async () => {
      while (queue.length) {
        const y = queue.shift();
        try {
          let r; try { r = await this.read(bboxWgs, y, opts); } catch (e) { if (opts.signal && opts.signal.aborted) throw e; r = await this.read(bboxWgs, y, opts); }
          if (r.valid > 0) reads.push(r); else failed.push(y);
        } catch (e) { if (opts.signal && opts.signal.aborted) throw e; failed.push(y); }
        done++; if (opts.onProgress) opts.onProgress(done, years.length);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency || 3, years.length)) }, worker));
    reads.sort((a, b) => a.year - b.year); failed.sort((a, b) => a - b);
    return { reads, failed };
  },
  /*
    Résume les 128 dimensions de chaque année en quelques axes (analyse en composantes principales sur
    l'ensemble années × dimensions). Les axes sont ajustés sur un échantillon de pixels du masque (la parcelle),
    puis calculés pour tous les pixels valides.
    reads : lectures de même emprise ; mask : Uint8Array [y][x] facultatif ; opts : { max: 6, target: 0.8, sample: 2500 }
    -> { width, height, comps: [Float32Array, …] (NaN hors données), shares: [part de variance par axe], explained,
         years, used (pixels de l'échantillon), covered (part du masque avec données) }
  */
  reduce(reads, mask, opts) {
    opts = opts || {};
    if (!reads || !reads.length) throw new Error("aucune année lisible");
    const W = reads[0].width, H = reads[0].height, P = W * H, Y = reads.length, D0 = reads[0].dims, D = D0 * Y;
    if (reads.some((r) => r.width !== W || r.height !== H || r.dims !== D0)) throw new Error("lectures d'emprises différentes");
    const ok = new Uint8Array(P); let inMask = 0, inMaskOk = 0; const pool = [];
    for (let i = 0; i < P; i++) {
      let v = 1; for (let y = 0; y < Y; y++) if (!Number.isFinite(reads[y].scales[i])) { v = 0; break; }
      ok[i] = v;
      if (!mask || mask[i]) { inMask++; if (v) { inMaskOk++; pool.push(i); } }
    }
    if (pool.length < 20) throw new Error("trop peu de pixels avec données");
    const maxN = opts.sample || 2500, step = Math.max(1, pool.length / maxN), idx = [];
    for (let k = 0; k < pool.length && idx.length < maxN; k = Math.floor((idx.length + 1) * step)) idx.push(pool[k]);
    const n = idx.length, X = new Float32Array(n * D), mean = new Float64Array(D);
    const fill = (i, out, o) => { for (let y = 0; y < Y; y++) { const r = reads[y], sc = r.scales[i], base = y * D0; for (let d = 0; d < D0; d++) out[o + base + d] = r.data[d * P + i] * sc; } };
    for (let j = 0; j < n; j++) fill(idx[j], X, j * D);
    for (let j = 0; j < n; j++) for (let d = 0; d < D; d++) mean[d] += X[j * D + d];
    for (let d = 0; d < D; d++) mean[d] /= n;
    let total = 0; for (let j = 0; j < n; j++) for (let d = 0; d < D; d++) { const v = X[j * D + d] - mean[d]; X[j * D + d] = v; total += v * v; }
    if (!(total > 0)) throw new Error("valeurs constantes sur la parcelle");
    // itération orthogonale : K vecteurs propres dominants de XᵀX sans former la matrice
    const K = Math.max(1, Math.min(opts.max || 6, D, n - 1)), Q = new Float64Array(D * K), Z = new Float64Array(n * K);
    let seed = 20261123; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; };
    for (let i = 0; i < Q.length; i++) Q[i] = rnd();
    const ortho = () => { for (let k = 0; k < K; k++) { for (let p = 0; p < k; p++) { let dot = 0; for (let d = 0; d < D; d++) dot += Q[d * K + k] * Q[d * K + p]; for (let d = 0; d < D; d++) Q[d * K + k] -= dot * Q[d * K + p]; } let nr = 0; for (let d = 0; d < D; d++) nr += Q[d * K + k] * Q[d * K + k]; nr = Math.sqrt(nr) || 1; for (let d = 0; d < D; d++) Q[d * K + k] /= nr; } };
    const project = () => { Z.fill(0); for (let j = 0; j < n; j++) { const o = j * D; for (let d = 0; d < D; d++) { const x = X[o + d]; if (x !== 0) { const q = d * K; for (let k = 0; k < K; k++) Z[j * K + k] += x * Q[q + k]; } } } };
    ortho();
    for (let it = 0; it < (opts.iterations || 24); it++) {
      project(); Q.fill(0);
      for (let j = 0; j < n; j++) { const o = j * D; for (let d = 0; d < D; d++) { const x = X[o + d]; if (x !== 0) { const q = d * K; for (let k = 0; k < K; k++) Q[q + k] += x * Z[j * K + k]; } } }
      ortho();
    }
    project();
    const lam = new Float64Array(K); for (let j = 0; j < n; j++) for (let k = 0; k < K; k++) lam[k] += Z[j * K + k] * Z[j * K + k];
    const order = Array.from({ length: K }, (_, k) => k).sort((a, b) => lam[b] - lam[a]);
    // on garde les axes jusqu'à la part de variance visée (au moins deux)
    const target = opts.target || 0.8, keep = []; let cum = 0;
    for (const k of order) { if (keep.length >= 2 && cum >= target) break; if (lam[k] / total < 1e-4 && keep.length) break; keep.push(k); cum += lam[k] / total; }
    const comps = keep.map(() => new Float32Array(P).fill(NaN)), row = new Float32Array(D);
    for (let i = 0; i < P; i++) {
      if (!ok[i]) continue;
      fill(i, row, 0);
      for (let c = 0; c < keep.length; c++) { const k = keep[c]; let s = 0; for (let d = 0; d < D; d++) s += (row[d] - mean[d]) * Q[d * K + k]; comps[c][i] = s; }
    }
    return { width: W, height: H, comps, shares: keep.map((k) => lam[k] / total), explained: cum, years: reads.map((r) => r.year), used: n, covered: inMask ? inMaskOk / inMask : 0 };
  }
};
if (typeof module !== "undefined" && module.exports) module.exports = { pfTessera };
if (typeof window !== "undefined") window.pfTessera = pfTessera;
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["tessera"] = "53800260";
