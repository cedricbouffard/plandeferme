/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
/*
  Zones de gestion par régionalisation spatialement contiguë (SKATER)
  ------------------------------------------------------------------
  Méthode : Assunção et al. (2006), décrite par Anselin (An Introduction to Spatial Data
  Science with GeoDa, vol. 2, chap. 10). Chaque cellule de la grille LiDAR de la parcelle est
  une unité ; la contiguïté est celle des 4 voisins (tour). On construit l'arbre couvrant
  minimal du graphe de contiguïté (poids = dissimilarité des couches centrées-réduites), puis
  on retire une à une les arêtes qui réduisent le plus la somme des carrés intra-zones, sous
  contraintes de superficie minimale et maximale.

  Tout le calcul se fait dans le navigateur (Web Worker), sans serveur.
  - pfZonesCore()  : algorithmes purs (dérivés du MNT, SKATER, lissage, vectorisation)
  - pfZonesGeom    : assemblage des polygones et découpage au contour de la parcelle
  - ManagementZonesManager : interface (tiroir de résultats, couches de carte, export)
*/

function pfZonesCore() {
  "use strict";

  // ---------------------------------------------------------------------------
  // Tas binaire minimal (clé Float64, valeur Int32)
  // ---------------------------------------------------------------------------
  function Heap(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  Heap.prototype.push = function (key, val) {
    const K = this.k, V = this.v; let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  };
  Heap.prototype.pop = function () {
    const K = this.k, V = this.v, top = V[0], n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n]; let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return top;
  };

  // ---------------------------------------------------------------------------
  // Dérivés du MNT (grille W x H, ligne 0 au nord, pas `res` en mètres)
  // ---------------------------------------------------------------------------
  // Comble les cellules sans donnée par la valeur valide la plus proche
  function fillNaN(z, W, H) {
    const n = W * H, out = new Float64Array(n), valid = new Uint8Array(n), seen = new Uint8Array(n), q = new Int32Array(n);
    let qt = 0;
    for (let i = 0; i < n; i++) { const v = z[i]; if (v === v && v > -900 && v < 9000) { out[i] = v; valid[i] = 1; seen[i] = 1; q[qt++] = i; } }
    if (qt === 0) return null;
    for (let qh = 0; qh < qt; qh++) {
      const i = q[qh], x = i % W, y = (i - x) / W, v = out[i];
      if (x > 0 && !seen[i - 1]) { seen[i - 1] = 1; out[i - 1] = v; q[qt++] = i - 1; }
      if (x < W - 1 && !seen[i + 1]) { seen[i + 1] = 1; out[i + 1] = v; q[qt++] = i + 1; }
      if (y > 0 && !seen[i - W]) { seen[i - W] = 1; out[i - W] = v; q[qt++] = i - W; }
      if (y < H - 1 && !seen[i + W]) { seen[i + W] = 1; out[i + W] = v; q[qt++] = i + W; }
    }
    return { z: out, valid };
  }

  // Flou gaussien séparable, bords prolongés
  function gaussian(src, W, H, sigma) {
    if (!(sigma > 0.05)) return src;
    const r = Math.max(1, Math.ceil(sigma * 3)), ker = new Float64Array(2 * r + 1);
    let s = 0;
    for (let i = -r; i <= r; i++) { ker[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += ker[i + r]; }
    for (let i = 0; i < ker.length; i++) ker[i] /= s;
    const tmp = new Float64Array(W * H), out = new Float64Array(W * H);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) {
        let a = 0;
        for (let t = -r; t <= r; t++) { let xx = x + t; if (xx < 0) xx = 0; else if (xx >= W) xx = W - 1; a += src[o + xx] * ker[t + r]; }
        tmp[o + x] = a;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let a = 0;
        for (let t = -r; t <= r; t++) { let yy = y + t; if (yy < 0) yy = 0; else if (yy >= H) yy = H - 1; a += tmp[yy * W + x] * ker[t + r]; }
        out[y * W + x] = a;
      }
    }
    return out;
  }

  // Pente (tangente) selon Horn, fenêtre 3 x 3
  function slopeTan(z, W, H, res) {
    const out = new Float64Array(W * H);
    for (let y = 0; y < H; y++) {
      const ym = y > 0 ? y - 1 : y, yp = y < H - 1 ? y + 1 : y;
      for (let x = 0; x < W; x++) {
        const xm = x > 0 ? x - 1 : x, xp = x < W - 1 ? x + 1 : x;
        const a = z[ym * W + xm], b = z[ym * W + x], c = z[ym * W + xp];
        const d = z[y * W + xm], f = z[y * W + xp];
        const g = z[yp * W + xm], h = z[yp * W + x], i = z[yp * W + xp];
        const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * res);
        const dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * res);
        out[y * W + x] = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      }
    }
    return out;
  }

  // Comblement des dépressions (Priority-Flood + epsilon, Barnes et al. 2014)
  function fillDepressions(z, W, H) {
    const n = W * H, out = Float64Array.from(z), closed = new Uint8Array(n), heap = new Heap(n), pit = new Int32Array(n);
    let ph = 0, pt = 0;
    const EPS = 1e-5;
    for (let x = 0; x < W; x++) { for (const i of [x, (H - 1) * W + x]) if (!closed[i]) { closed[i] = 1; heap.push(out[i], i); } }
    for (let y = 0; y < H; y++) { for (const i of [y * W, y * W + W - 1]) if (!closed[i]) { closed[i] = 1; heap.push(out[i], i); } }
    while (heap.n > 0 || ph < pt) {
      const c = ph < pt ? pit[ph++] : heap.pop();
      const cx = c % W, cy = (c - cx) / W, zc = out[c];
      for (let dy = -1; dy <= 1; dy++) {
        const yy = cy + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx; if (xx < 0 || xx >= W || (dx === 0 && dy === 0)) continue;
          const j = yy * W + xx; if (closed[j]) continue;
          closed[j] = 1;
          if (out[j] <= zc) { out[j] = zc + EPS; pit[pt++] = j; } else heap.push(out[j], j);
        }
      }
    }
    return out;
  }

  // Accumulation d'écoulement à directions multiples (Freeman 1991, exposant 1,1), en nombre de cellules
  function flowAccumulation(zf, W, H) {
    const n = W * H, order = new Uint32Array(n), acc = new Float64Array(n).fill(1);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => zf[b] - zf[a]);
    const w = new Float64Array(8), idx = new Int32Array(8), SQ = Math.SQRT1_2;
    for (let o = 0; o < n; o++) {
      const i = order[o], x = i % W, y = (i - x) / W, zi = zf[i];
      let m = 0, sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W || (dx === 0 && dy === 0)) continue;
          const j = yy * W + xx, dz = zi - zf[j];
          if (dz <= 0) continue;
          const s = Math.pow(dx !== 0 && dy !== 0 ? dz * SQ : dz, 1.1);
          w[m] = s; idx[m] = j; sum += s; m++;
        }
      }
      if (sum > 0) { const a = acc[i] / sum; for (let t = 0; t < m; t++) acc[idx[t]] += a * w[t]; }
    }
    return acc;
  }

  // Position topographique : altitude moins altitude moyenne dans un carré de rayon R cellules
  function topoPosition(z, W, H, R) {
    const W1 = W + 1, I = new Float64Array(W1 * (H + 1)), out = new Float64Array(W * H);
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += z[y * W + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; } }
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
        const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
        out[y * W + x] = z[y * W + x] - s / ((x1 - x0) * (y1 - y0));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // SKATER : arbre couvrant minimal puis élagage
  //   F : Float64Array(n * D) des variables centrées-réduites ; id : grille -> noeud (ou -1)
  // ---------------------------------------------------------------------------
  function skater(F, D, n, id, W, H, k, minC, maxC) {
    // 1. arêtes de contiguïté (tour) et poids = distance euclidienne au carré
    let m = 0;
    const ea = new Int32Array(2 * n), eb = new Int32Array(2 * n), ew = new Float64Array(2 * n);
    const dist = (a, b) => { let s = 0; for (let d = 0; d < D; d++) { const t = F[a * D + d] - F[b * D + d]; s += t * t; } return s; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = id[y * W + x]; if (a < 0) continue;
      if (x + 1 < W) { const b = id[y * W + x + 1]; if (b >= 0) { ea[m] = a; eb[m] = b; ew[m] = dist(a, b); m++; } }
      if (y + 1 < H) { const b = id[(y + 1) * W + x]; if (b >= 0) { ea[m] = a; eb[m] = b; ew[m] = dist(a, b); m++; } }
    }
    // 2. arbre couvrant minimal (Kruskal) ; une forêt si la parcelle est en plusieurs morceaux
    const ord = new Uint32Array(m); for (let i = 0; i < m; i++) ord[i] = i;
    ord.sort((p, q) => ew[p] - ew[q]);
    const uf = new Int32Array(n); for (let i = 0; i < n; i++) uf[i] = i;
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const ta = new Int32Array(n), tb = new Int32Array(n), deg = new Int32Array(n + 1);
    let te = 0;
    for (let o = 0; o < m; o++) {
      const e = ord[o], ra = find(ea[e]), rb = find(eb[e]);
      if (ra !== rb) { uf[ra] = rb; ta[te] = ea[e]; tb[te] = eb[e]; deg[ea[e]]++; deg[eb[e]]++; te++; }
    }
    const start = new Int32Array(n + 1); for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
    const fillPos = start.slice(0, n), adjN = new Int32Array(2 * te), adjE = new Int32Array(2 * te);
    for (let e = 0; e < te; e++) {
      adjN[fillPos[ta[e]]] = tb[e]; adjE[fillPos[ta[e]]++] = e;
      adjN[fillPos[tb[e]]] = ta[e]; adjE[fillPos[tb[e]]++] = e;
    }
    const removed = new Uint8Array(te);
    // 3. composantes initiales (arbres de la forêt)
    const comps = [], compOf = new Int32Array(n).fill(-1);
    const order = new Int32Array(n), par = new Int32Array(n), parE = new Int32Array(n);
    const cs = new Float64Array(n * D), cq = new Float64Array(n), cn = new Int32Array(n), S = new Float64Array(D);
    const need = (size) => (maxC > 0 && isFinite(maxC) ? Math.ceil(size / maxC) : 1);

    // Évalue toutes les coupes possibles d'une composante en O(taille) grâce aux sommes de sous-arbres
    function evalComp(c) {
      const root = c.root; let len = 0;
      order[len++] = root; par[root] = -1; parE[root] = -1;
      for (let h = 0; h < len; h++) {
        const u = order[h];
        for (let p = start[u]; p < start[u + 1]; p++) {
          const v = adjN[p]; if (v === par[u] || removed[adjE[p]]) continue;
          par[v] = u; parE[v] = adjE[p]; order[len++] = v;
        }
      }
      for (let h = 0; h < len; h++) {
        const u = order[h]; let q = 0; cn[u] = 1;
        for (let d = 0; d < D; d++) { const x = F[u * D + d]; cs[u * D + d] = x; q += x * x; }
        cq[u] = q;
      }
      for (let h = len - 1; h > 0; h--) {
        const u = order[h], p = par[u]; cn[p] += cn[u]; cq[p] += cq[u];
        for (let d = 0; d < D; d++) cs[p * D + d] += cs[u * D + d];
      }
      const Q = cq[root]; let tot = Q;
      for (let d = 0; d < D; d++) { S[d] = cs[root * D + d]; tot -= S[d] * S[d] / len; }
      const needS = need(len);
      c.size = len; c.ssd = tot;
      c.anyGain = -1; c.anyNode = -1; c.anyEdge = -1; c.admGain = -1; c.admNode = -1; c.admEdge = -1;
      for (let h = 1; h < len; h++) {
        const u = order[h], a = cn[u], b = len - a;
        if (a < minC || b < minC) continue;
        let sa = cq[u], sb = Q - cq[u];
        for (let d = 0; d < D; d++) { const t = cs[u * D + d], r = S[d] - t; sa -= t * t / a; sb -= r * r / b; }
        const g = tot - sa - sb;
        if (g > c.anyGain) { c.anyGain = g; c.anyNode = u; c.anyEdge = parE[u]; }
        if (g > c.admGain && need(a) + need(b) === needS) { c.admGain = g; c.admNode = u; c.admEdge = parE[u]; }
      }
    }
    for (let i = 0; i < n; i++) {
      if (compOf[i] >= 0) continue;
      const c = { root: i }; evalComp(c);
      for (let h = 0; h < c.size; h++) compOf[order[h]] = comps.length;
      comps.push(c);
    }
    const initial = comps.length;
    // 4. élagage : on retire l'arête qui réduit le plus la variance intra-zones
    let blocked = false;
    while (comps.length < k) {
      let needSplits = 0;
      for (const c of comps) needSplits += need(c.size) - 1;
      const remaining = k - comps.length, tight = needSplits > 0 && needSplits >= remaining - 1; // une coupe libre peut coûter une coupe de plus
      let best = null, bestGain = -1, node = -1, edge = -1;
      if (tight) { // les coupes restantes doivent servir à ramener les zones trop grandes sous le maximum
        for (const c of comps) {
          if (need(c.size) < 2) continue;
          const useAdm = c.admNode >= 0, g = useAdm ? c.admGain + 1e12 : c.anyGain;
          if ((useAdm || c.anyNode >= 0) && g > bestGain) { bestGain = g; best = c; node = useAdm ? c.admNode : c.anyNode; edge = useAdm ? c.admEdge : c.anyEdge; }
        }
      }
      if (!best) for (const c of comps) if (c.anyNode >= 0 && c.anyGain > bestGain) { bestGain = c.anyGain; best = c; node = c.anyNode; edge = c.anyEdge; }
      if (!best) { blocked = true; break; }
      removed[edge] = 1;
      const nc = { root: node };
      evalComp(best); evalComp(nc);
      comps.push(nc);
    }
    // 5. étiquettes finales
    const lab = new Int32Array(n);
    for (let ci = 0; ci < comps.length; ci++) { evalComp(comps[ci]); for (let h = 0; h < comps[ci].size; h++) lab[order[h]] = ci; }
    let ssd = 0; for (const c of comps) ssd += c.ssd;
    return { lab, count: comps.length, initial, blocked, ssd };
  }

  // ---------------------------------------------------------------------------
  // Nettoyage des étiquettes : filtre majoritaire puis retour à des zones d'un seul tenant
  // ---------------------------------------------------------------------------
  function modeFilter(L, W, H, K, radius, passes) {
    const offs = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius + 0.5) offs.push(dx, dy);
    const cnt = new Int32Array(K);
    let cur = L;
    for (let p = 0; p < passes; p++) {
      const out = new Int32Array(cur);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, own = cur[i]; if (own < 0) continue;
        cnt.fill(0);
        for (let o = 0; o < offs.length; o += 2) {
          const xx = x + offs[o], yy = y + offs[o + 1];
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const l = cur[yy * W + xx]; if (l >= 0) cnt[l]++;
        }
        let best = own, bc = cnt[own];
        for (let l = 0; l < K; l++) if (cnt[l] > bc) { bc = cnt[l]; best = l; }
        out[i] = best;
      }
      cur = out;
    }
    return cur;
  }

  // Chaque zone ne garde que son plus grand morceau ; les autres rejoignent la zone voisine la plus en contact
  // minPatch (facultatif) : un morceau d'au moins cette taille est aussi conservé (zones non contiguës)
  function enforceContiguity(L, W, H, K, minPatch) {
    if (!(minPatch > 0)) minPatch = Infinity;
    const n = W * H, comp = new Int32Array(n), q = new Int32Array(n);
    for (let iter = 0; iter < 40; iter++) {
      comp.fill(-1);
      const cLab = [], cSize = [], cStart = [];
      let qt = 0;
      for (let s = 0; s < n; s++) {
        if (L[s] < 0 || comp[s] >= 0) continue;
        const c = cLab.length, l = L[s], from = qt; comp[s] = c; q[qt++] = s;
        for (let qh = from; qh < qt; qh++) {
          const i = q[qh], x = i % W, y = (i - x) / W;
          if (x > 0 && comp[i - 1] < 0 && L[i - 1] === l) { comp[i - 1] = c; q[qt++] = i - 1; }
          if (x < W - 1 && comp[i + 1] < 0 && L[i + 1] === l) { comp[i + 1] = c; q[qt++] = i + 1; }
          if (y > 0 && comp[i - W] < 0 && L[i - W] === l) { comp[i - W] = c; q[qt++] = i - W; }
          if (y < H - 1 && comp[i + W] < 0 && L[i + W] === l) { comp[i + W] = c; q[qt++] = i + W; }
        }
        cLab.push(l); cSize.push(qt - from); cStart.push(from);
      }
      const main = new Int32Array(K).fill(-1);
      for (let c = 0; c < cLab.length; c++) { const l = cLab[c]; if (main[l] < 0 || cSize[c] > cSize[main[l]]) main[l] = c; }
      let changed = false;
      const border = new Int32Array(K), snapshot = new Int32Array(L);
      for (let c = 0; c < cLab.length; c++) {
        if (main[cLab[c]] === c || cSize[c] >= minPatch) continue;
        border.fill(0);
        const own = cLab[c];
        for (let p = cStart[c]; p < cStart[c] + cSize[c]; p++) {
          const i = q[p], x = i % W, y = (i - x) / W;
          let l;
          if (x > 0 && (l = snapshot[i - 1]) >= 0 && l !== own) border[l]++;
          if (x < W - 1 && (l = snapshot[i + 1]) >= 0 && l !== own) border[l]++;
          if (y > 0 && (l = snapshot[i - W]) >= 0 && l !== own) border[l]++;
          if (y < H - 1 && (l = snapshot[i + W]) >= 0 && l !== own) border[l]++;
        }
        let best = -1, bc = 0;
        for (let l = 0; l < K; l++) if (border[l] > bc) { bc = border[l]; best = l; }
        if (best < 0) continue; // morceau isolé (parcelle en plusieurs parties) : on le laisse
        for (let p = cStart[c]; p < cStart[c] + cSize[c]; p++) L[q[p]] = best;
        changed = true;
      }
      if (!changed) break;
    }
    return L;
  }

  // ---------------------------------------------------------------------------
  // K-means : classes de cellules semblables, sans contrainte de voisinage (zones non contiguës)
  //   Départ k-means++ à graine fixe (même résultat à chaque calcul), 4 essais, on garde le meilleur
  // ---------------------------------------------------------------------------
  function kmeans(F, D, n, k) {
    let seed = 24187361;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const dist = (j, C, c) => { let s = 0; for (let d = 0; d < D; d++) { const t = F[j * D + d] - C[c * D + d]; s += t * t; } return s; };
    const near = new Float64Array(n), lab = new Int32Array(n), cnt = new Int32Array(k);
    let best = null, bestInertia = Infinity;
    for (let run = 0; run < 4; run++) {
      const C = new Float64Array(k * D);
      let pick = Math.floor(rnd() * n);
      for (let d = 0; d < D; d++) C[d] = F[pick * D + d];
      near.fill(Infinity);
      for (let c = 1; c < k; c++) {
        let sum = 0;
        for (let j = 0; j < n; j++) { const v = dist(j, C, c - 1); if (v < near[j]) near[j] = v; sum += near[j]; }
        let r = rnd() * sum; pick = n - 1;
        for (let j = 0; j < n; j++) { r -= near[j]; if (r <= 0) { pick = j; break; } }
        for (let d = 0; d < D; d++) C[c * D + d] = F[pick * D + d];
      }
      lab.fill(-1);
      let inertia = 0;
      for (let iter = 0; iter < 60; iter++) {
        let changed = 0; inertia = 0;
        for (let j = 0; j < n; j++) {
          let b = 0, bd = Infinity;
          for (let c = 0; c < k; c++) { const v = dist(j, C, c); if (v < bd) { bd = v; b = c; } }
          if (lab[j] !== b) { lab[j] = b; changed++; }
          near[j] = bd; inertia += bd;
        }
        C.fill(0); cnt.fill(0);
        for (let j = 0; j < n; j++) { const c = lab[j]; cnt[c]++; for (let d = 0; d < D; d++) C[c * D + d] += F[j * D + d]; }
        for (let c = 0; c < k; c++) {
          if (cnt[c] > 0) { for (let d = 0; d < D; d++) C[c * D + d] /= cnt[c]; continue; }
          let far = 0; for (let j = 1; j < n; j++) if (near[j] > near[far]) far = j; // classe vide : repart de la cellule la plus mal classée
          for (let d = 0; d < D; d++) C[c * D + d] = F[far * D + d];
          near[far] = 0; changed++;
        }
        if (changed <= n * 0.0002) break;
      }
      if (inertia < bestInertia) { bestInertia = inertia; best = Int32Array.from(lab); }
    }
    // classes renumérotées sans trou
    const used = new Int32Array(k).fill(-1); let K = 0;
    for (let j = 0; j < n; j++) { if (used[best[j]] < 0) used[best[j]] = K++; best[j] = used[best[j]]; }
    return { lab: best, count: K, inertia: bestInertia };
  }

  function zoneSizes(L, K) { const s = new Int32Array(K); for (let i = 0; i < L.length; i++) if (L[i] >= 0) s[L[i]]++; return s; }

  // Étend les étiquettes de `steps` cellules hors de la parcelle (les zones dépassent le contour, puis sont découpées)
  function dilate(L, W, H, steps) {
    const n = W * H, out = new Int32Array(L), q = new Int32Array(n), dist = new Int32Array(n).fill(-1);
    let qt = 0;
    for (let i = 0; i < n; i++) if (out[i] >= 0) { dist[i] = 0; q[qt++] = i; }
    for (let qh = 0; qh < qt; qh++) {
      const i = q[qh], d = dist[i]; if (d >= steps) continue;
      const x = i % W, y = (i - x) / W, l = out[i];
      if (x > 0 && dist[i - 1] < 0) { dist[i - 1] = d + 1; out[i - 1] = l; q[qt++] = i - 1; }
      if (x < W - 1 && dist[i + 1] < 0) { dist[i + 1] = d + 1; out[i + 1] = l; q[qt++] = i + 1; }
      if (y > 0 && dist[i - W] < 0) { dist[i - W] = d + 1; out[i - W] = l; q[qt++] = i - W; }
      if (y < H - 1 && dist[i + W] < 0) { dist[i + W] = d + 1; out[i + W] = l; q[qt++] = i + W; }
    }
    return out;
  }

  // Cellule la plus éloignée du bord de sa zone (ancrage de l'étiquette sur la carte)
  function labelAnchors(L, W, H, K) {
    const n = W * H, dist = new Int32Array(n).fill(-1), q = new Int32Array(n);
    let qt = 0;
    for (let i = 0; i < n; i++) {
      const l = L[i]; if (l < 0) continue;
      const x = i % W, y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || L[i - 1] !== l || L[i + 1] !== l || L[i - W] !== l || L[i + W] !== l) { dist[i] = 0; q[qt++] = i; }
    }
    const best = new Int32Array(K).fill(-1), bd = new Int32Array(K).fill(-1);
    for (let qh = 0; qh < qt; qh++) {
      const i = q[qh], d = dist[i], l = L[i];
      if (d > bd[l]) { bd[l] = d; best[l] = i; }
      const x = i % W, y = (i - x) / W;
      if (x > 0 && dist[i - 1] < 0 && L[i - 1] === l) { dist[i - 1] = d + 1; q[qt++] = i - 1; }
      if (x < W - 1 && dist[i + 1] < 0 && L[i + 1] === l) { dist[i + 1] = d + 1; q[qt++] = i + 1; }
      if (y > 0 && dist[i - W] < 0 && L[i - W] === l) { dist[i - W] = d + 1; q[qt++] = i - W; }
      if (y < H - 1 && dist[i + W] < 0 && L[i + W] === l) { dist[i + W] = d + 1; q[qt++] = i + W; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Vectorisation : contours des zones sur les sommets de la grille, lissés arc par arc.
  // Le lissage ne dépend que de l'arc partagé (formule symétrique), donc deux zones voisines
  // obtiennent exactement la même frontière : ni trou ni chevauchement.
  // ---------------------------------------------------------------------------
  function traceRings(L, W, H, K, passes) {
    const VW = W + 1, visited = new Uint8Array(VW * (H + 1) * 4);
    const lab = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : L[y * W + x]);
    // cellule à droite de l'arête orientée (vx, vy, d) et cellule en face ; d : 0=E 1=S 2=O 3=N
    const CX = [0, -1, -1, 0], CY = [0, 0, -1, -1], AX = [0, 0, -1, -1], AY = [-1, 0, 0, -1];
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    const edgeLabel = (vx, vy, d) => { const a = lab(vx + CX[d], vy + CY[d]); return a >= 0 && lab(vx + AX[d], vy + AY[d]) !== a ? a : -1; };
    const isJunction = (vx, vy) => {
      const a = lab(vx - 1, vy - 1), b = lab(vx, vy - 1), c = lab(vx - 1, vy), d = lab(vx, vy);
      if (a === d && b === c && a !== b) return true;
      let distinct = 1; if (b !== a) distinct++; if (c !== a && c !== b) distinct++; if (d !== a && d !== b && d !== c) distinct++;
      return distinct >= 3;
    };
    const rings = Array.from({ length: K }, () => []);
    const SX = [0, 1, 1, 0], SY = [0, 0, 1, 1]; // sommet de départ de chacun des 4 côtés d'une cellule
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = L[y * W + x]; if (a < 0) continue;
      for (let side = 0; side < 4; side++) {
        const sx = x + SX[side], sy = y + SY[side];
        if (visited[(sy * VW + sx) * 4 + side] || edgeLabel(sx, sy, side) !== a) continue;
        const xs = [], ys = [], fixed = [];
        let vx = sx, vy = sy, d = side;
        do {
          visited[(vy * VW + vx) * 4 + d] = 1;
          xs.push(vx); ys.push(vy); fixed.push(isJunction(vx, vy) ? 1 : 0);
          vx += DX[d]; vy += DY[d];
          const r = (d + 1) & 3, l = (d + 3) & 3;
          if (edgeLabel(vx, vy, r) === a) d = r; else if (edgeLabel(vx, vy, d) === a) { /* tout droit */ } else d = l;
        } while (vx !== sx || vy !== sy || d !== side);
        rings[a].push(smoothRing(xs, ys, fixed, passes));
      }
    }
    return rings;
  }

  function smoothRing(xs, ys, fixed, passes) {
    const m = xs.length;
    let X = Float64Array.from(xs), Y = Float64Array.from(ys);
    if (passes > 0) {
      let X2 = new Float64Array(m), Y2 = new Float64Array(m);
      for (let p = 0; p < passes; p++) {
        for (let i = 0; i < m; i++) {
          if (fixed[i]) { X2[i] = X[i]; Y2[i] = Y[i]; continue; }
          const a = i === 0 ? m - 1 : i - 1, b = i === m - 1 ? 0 : i + 1;
          X2[i] = 0.5 * X[i] + 0.25 * (X[a] + X[b]);
          Y2[i] = 0.5 * Y[i] + 0.25 * (Y[a] + Y[b]);
        }
        let t = X; X = X2; X2 = t; t = Y; Y = Y2; Y2 = t;
      }
    }
    // retrait des points alignés (inutile après lissage, utile pour des bords en escalier)
    const out = [];
    for (let i = 0; i < m; i++) {
      const a = i === 0 ? m - 1 : i - 1, b = i === m - 1 ? 0 : i + 1;
      const cross = (X[i] - X[a]) * (Y[b] - Y[i]) - (Y[i] - Y[a]) * (X[b] - X[i]);
      if (passes > 0 || cross !== 0 || fixed[i]) out.push(X[i], Y[i]);
    }
    return Float64Array.from(out);
  }

  // ---------------------------------------------------------------------------
  // Calcul complet
  //   input : { dem, W, H, res, inside, layers[], k, minCells, maxCells, smooth (0..3), margin }
  // ---------------------------------------------------------------------------
  const SMOOTH = [
    { sigmaM: 0, modeM: 0, passes: 0 },
    { sigmaM: 3, modeM: 6, passes: 4 },
    { sigmaM: 5, modeM: 10, passes: 8 },
    { sigmaM: 8, modeM: 16, passes: 16 }
  ];
  // Le lissage des couches (sigmaM) reste modéré exprès : sur un relief trop lisse, l'arbre couvrant minimal
  // s'aligne sur la grille et les zones deviennent des bandes ou des rectangles. Le gros du lissage se fait
  // donc après le calcul, sur les étiquettes (modeM) et sur les contours (passes).

  function compute(input, progress) {
    const say = progress || function () {};
    const t0 = Date.now();
    const { W, H, res, inside, layers } = input;
    const k = Math.max(1, input.k | 0), warnings = [];
    const sm = SMOOTH[Math.max(0, Math.min(3, input.smooth | 0))];
    const filled = fillNaN(input.dem, W, H);
    if (!filled) throw new Error("Aucune altitude LiDAR valide sur cette parcelle.");
    const z = filled.z;

    // 1. couches dérivées du MNT
    say("Calcul des couches dérivées du LiDAR…");
    const zs = gaussian(z, W, H, Math.max(0.6, 2 / res)); // lissage léger : retire le micro-relief (sillons, bruit)
    const raw = {};
    raw.elev = z;
    const tanB = slopeTan(zs, W, H, res);
    raw.slope = tanB.map((t) => t * 100);
    if (layers.includes("twi")) {
      const acc = flowAccumulation(fillDepressions(zs, W, H), W, H);
      const twi = new Float64Array(W * H);
      for (let i = 0; i < twi.length; i++) twi[i] = Math.log((acc[i] * res) / Math.max(tanB[i], 0.001));
      raw.twi = twi;
    }
    if (layers.includes("tpi")) raw.tpi = topoPosition(zs, W, H, Math.max(2, Math.round(50 / res)));
    // couches externes (NDVI enregistrés), déjà sur la grille ; les cellules sans donnée prennent la valeur valide la plus proche
    layers.forEach((key) => {
      if (raw[key]) return;
      const ext = input.extra && input.extra[key] ? fillNaN(input.extra[key], W, H) : null;
      if (!ext) throw new Error("Couche sans donnée sur cette parcelle : " + key);
      raw[key] = ext.z;
    });

    // 2. cellules de la parcelle et variables centrées-réduites
    const id = new Int32Array(W * H).fill(-1), cells = [];
    for (let i = 0; i < W * H; i++) if (inside[i] && filled.valid[i]) { id[i] = cells.length; cells.push(i); }
    const n = cells.length, D = layers.length;
    if (n < 2 * k) throw new Error("La parcelle est trop petite à cette résolution pour " + k + " zones.");
    if (D === 0) throw new Error("Choisissez au moins une couche.");
    const F = new Float64Array(n * D), sigmaCells = sm.sigmaM / res;
    for (let d = 0; d < D; d++) {
      const g = gaussian(raw[layers[d]], W, H, sigmaCells), v = new Float64Array(n);
      for (let j = 0; j < n; j++) v[j] = g[cells[j]];
      const sorted = Float64Array.from(v).sort();
      const lo = sorted[Math.floor(0.02 * (n - 1))], hi = sorted[Math.ceil(0.98 * (n - 1))];
      let mean = 0; for (let j = 0; j < n; j++) { if (v[j] < lo) v[j] = lo; else if (v[j] > hi) v[j] = hi; mean += v[j]; }
      mean /= n;
      let sd = 0; for (let j = 0; j < n; j++) sd += (v[j] - mean) * (v[j] - mean);
      sd = Math.sqrt(sd / n);
      if (!(sd > 1e-9)) { warnings.push({ code: "flat", layer: layers[d] }); sd = 1; }
      const wt = input.weights && input.weights[layers[d]] > 0 ? Math.sqrt(input.weights[layers[d]]) : 1;
      for (let j = 0; j < n; j++) F[j * D + d] = ((v[j] - mean) / sd) * wt;
    }

    // 3. zones : SKATER (contiguës) ou K-means (non contiguës)
    const method = input.method === "kmeans" ? "kmeans" : "skater";
    const minC = Math.max(1, input.minCells | 0), maxC = method === "skater" && input.maxCells > 0 ? input.maxCells : Infinity;
    let labels, K;
    if (method === "kmeans") {
      say("Classification K-means sur " + n.toLocaleString("fr-CA") + " cellules…");
      const km = kmeans(F, D, n, k);
      labels = km.lab; K = km.count;
    } else {
      say("Régionalisation SKATER sur " + n.toLocaleString("fr-CA") + " cellules…");
      const sk = skater(F, D, n, id, W, H, k, minC, maxC);
      if (sk.initial > 1) warnings.push({ code: "parts", count: sk.initial });
      labels = sk.lab; K = sk.count;
    }
    if (K < k) warnings.push({ code: "fewer", got: K, asked: k });
    let L = new Int32Array(W * H).fill(-1);
    for (let j = 0; j < n; j++) L[cells[j]] = labels[j];
    const patchMin = method === "kmeans" ? minC : Infinity; // K-means : seuls les îlots plus petits que le minimum sont fusionnés

    // 4. nettoyage des bordures (filtre majoritaire) sans perdre de zone ni passer sous le minimum
    say("Lissage des zones…");
    if (sm.modeM > 0) {
      const before = zoneSizes(L, K);
      for (let radius = Math.max(1, Math.round(sm.modeM / res)); radius >= 1; radius--) {
        const cand = enforceContiguity(modeFilter(L, W, H, K, radius, 2), W, H, K, patchMin), after = zoneSizes(cand, K);
        let ok = true;
        for (let l = 0; l < K; l++) if (after[l] === 0 || (method === "skater" && ((before[l] >= minC && after[l] < minC) || (after[l] > maxC && before[l] <= maxC)))) ok = false;
        if (ok) { L = cand; break; }
      }
    }

    if (method === "kmeans" && minC > 1) L = enforceContiguity(L, W, H, K, patchMin);

    // 5. zones numérotées de la plus basse à la plus haute, statistiques par zone
    const sizes = zoneSizes(L, K), statKeys = Object.keys(raw), sums = statKeys.map(() => new Float64Array(K));
    for (let i = 0; i < W * H; i++) { const l = L[i]; if (l >= 0) for (let s = 0; s < statKeys.length; s++) sums[s][l] += raw[statKeys[s]][i]; }
    const rank = Array.from({ length: K }, (_, l) => l).sort((a, b) => sums[0][a] / sizes[a] - sums[0][b] / sizes[b]);
    const newOf = new Int32Array(K); rank.forEach((old, i) => { newOf[old] = i; });
    for (let i = 0; i < W * H; i++) if (L[i] >= 0) L[i] = newOf[L[i]];
    const anchors = labelAnchors(L, W, H, K);
    const zones = rank.map((old, i) => {
      const means = {}; statKeys.forEach((key, s) => { means[key] = sums[s][old] / sizes[old]; });
      const a = anchors[i];
      return { zone: i + 1, cells: sizes[old], means, anchor: a >= 0 ? [(a % W) + 0.5, Math.floor(a / W) + 0.5] : null };
    });
    if (method === "skater") zones.forEach((zn) => {
      if (zn.cells < minC) warnings.push({ code: "below-min", zone: zn.zone });
      if (zn.cells > maxC) warnings.push({ code: "above-max", zone: zn.zone });
    });
    // part de variance expliquée par les zones (sur les variables centrées-réduites)
    const zs2 = new Float64Array(K * D), zc = new Int32Array(K);
    let tss = 0;
    for (let j = 0; j < n; j++) { const l = L[cells[j]]; zc[l]++; for (let d = 0; d < D; d++) { const v = F[j * D + d]; zs2[l * D + d] += v; tss += v * v; } }
    let bss = 0; for (let l = 0; l < K; l++) for (let d = 0; d < D; d++) if (zc[l]) bss += zs2[l * D + d] * zs2[l * D + d] / zc[l];

    // 6. contours lissés (les zones débordent de la parcelle ; le découpage se fait ensuite)
    say("Tracé des contours…");
    const rings = traceRings(dilate(L, W, H, input.margin | 0), W, H, K, sm.passes);
    return { W, H, res, K, n, method, labels: L, zones, rings, warnings, explained: tss > 0 ? bss / tss : 0, ms: Date.now() - t0 };
  }

  return { compute, skater, kmeans, fillDepressions, flowAccumulation, slopeTan, gaussian, traceRings, dilate, enforceContiguity, modeFilter };
}

// =============================================================================
// Géométrie : anneaux de la grille -> polygones métriques découpés à la parcelle
// =============================================================================
const pfZonesGeom = {
  ringArea(r) { let a = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; },
  polyArea(poly) { let a = Math.abs(this.ringArea(poly[0])); for (let i = 1; i < poly.length; i++) a -= Math.abs(this.ringArea(poly[i])); return a; },
  multiArea(mp) { let a = 0; for (const p of mp) a += this.polyArea(p); return a; },
  inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },
  inMulti(pt, mp) {
    for (const poly of mp) {
      if (!poly.length || !this.inRing(pt, poly[0])) continue;
      let hole = false;
      for (let k = 1; k < poly.length; k++) if (this.inRing(pt, poly[k])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  },
  // Anneaux plats [vx, vy, ...] (sommets de grille, y vers le bas) -> multipolygone métrique
  toMulti(flatRings, minX, maxY, res) {
    const rings = flatRings.map((f) => { const r = []; for (let i = 0; i < f.length; i += 2) r.push([minX + f[i] * res, maxY - f[i + 1] * res]); return r; }).filter((r) => r.length >= 3);
    const ext = [], holes = [];
    // le tracé tourne dans le sens horaire autour de chaque zone : aire négative = contour extérieur, positive = trou
    rings.forEach((r) => { const a = this.ringArea(r); if (a < 0) ext.push({ ring: r.reverse(), area: -a, holes: [] }); else if (a > 0) holes.push(r.reverse()); });
    ext.sort((a, b) => a.area - b.area);
    holes.forEach((h) => { const host = ext.find((e) => this.inRing(h[0], e.ring)); if (host) host.holes.push(h); });
    const close = (r) => r.concat([r[0]]);
    return ext.map((e) => [close(e.ring)].concat(e.holes.map(close)));
  },
  // Découpe au contour de la parcelle ; retire les éclats plus petits qu'une demi-cellule
  clip(multi, parcelMulti, res, pc) {
    let out = multi;
    if (pc && typeof pc.intersection === "function") {
      try { out = pc.intersection(multi, parcelMulti); } catch (e) { out = multi; }
    }
    const kept = out.filter((p) => this.polyArea(p) >= 0.5 * res * res);
    return kept.length ? kept : out;
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { pfZonesCore, pfZonesGeom };

// =============================================================================
// Interface
// =============================================================================
if (typeof window !== "undefined" && typeof document !== "undefined") (function () {
  "use strict";

  const COLORS = ["#4477AB", "#EE6677", "#228833", "#CCBB45", "#66CCEE", "#AA3377", "#EE7733", "#009989", "#332288", "#999932", "#882255", "#BBBBBB"];
  const LAYERS = [
    { key: "elev", label: "Élévation", unit: "m", digits: 2, on: true, title: "Altitude LiDAR du terrain" },
    { key: "slope", label: "Pente", unit: "%", digits: 1, on: true, title: "Pente du terrain (Horn, 3 × 3)" },
    { key: "twi", label: "Humidité topographique", short: "TWI", unit: "", digits: 1, on: true, title: "Indice d'humidité topographique (TWI) : où l'eau tend à s'accumuler" },
    { key: "tpi", label: "Position topographique", short: "TPI", unit: "m", digits: 2, on: false, title: "Altitude par rapport au voisinage de 50 m : buttes (+) et creux (−)" }
  ];
  const MAX_CELLS = 450000;
  const PC_DATA = "https://planetarycomputer.microsoft.com/api/data/v1/item/";
  // Classes SCL de Sentinel-2 écartées : sans donnée, saturé, nuage très probable, neige.
  // Ombre (3), nuage possible (8) et cirrus (10) sont seulement signalés : ces classes se trompent souvent
  // sur un sol nu, clair ou foncé, alors que le NDVI y reste lisible (la tuile affichée ne les masque pas non plus).
  const SCL_BAD = new Set([0, 1, 9, 11]);
  const SCL_DOUBT = { 3: "ombre", 8: "nuage possible", 10: "cirrus" };

  // Lecture d'un tableau NumPy (.npy) de forme (bandes, hauteur, largeur)
  function parseNpy(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (u8[0] !== 0x93 || String.fromCharCode(u8[1], u8[2], u8[3], u8[4], u8[5]) !== "NUMPY") throw new Error("réponse inattendue");
    const v2 = u8[6] >= 2, hl = v2 ? dv.getUint32(8, true) : dv.getUint16(8, true), off = (v2 ? 12 : 10) + hl;
    const head = new TextDecoder("latin1").decode(u8.subarray(v2 ? 12 : 10, off));
    const shape = (/'shape':\s*\(([^)]*)\)/.exec(head) || [])[1], descr = (/'descr':\s*'([^']+)'/.exec(head) || [])[1];
    const dims = String(shape || "").split(",").map((t) => parseInt(t, 10)).filter(Number.isFinite);
    const T = { "<f8": Float64Array, "<f4": Float32Array, "<i2": Int16Array, "<u2": Uint16Array, "<i4": Int32Array, "|u1": Uint8Array, "|i1": Int8Array }[descr];
    if (!T || dims.length !== 3) throw new Error("format non pris en charge (" + descr + ")");
    return { data: new T(buf.slice(off)), bands: dims[0], h: dims[1], w: dims[2] };
  }
  const $ = (id) => document.getElementById(id);
  const fr = (v, d) => (Number.isFinite(v) ? v.toLocaleString("fr-CA", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  // Case à cocher d'une couche et son poids (1 = poids normal)
  const layerItem = (l, text, checked, weight) => `<span class="pf-zn-item"><label class="pf-cf-check" title="${esc(l.title)}"><input type="checkbox" value="${esc(l.key)}"${checked ? " checked" : ""} /><span>${esc(text)}</span></label><input type="number" class="pf-zn-w" data-w="${esc(l.key)}" value="${weight || 1}" min="0.1" max="10" step="0.5" inputmode="decimal" aria-label="Poids de la couche ${esc(l.label)}" title="Poids de cette couche dans le calcul (1 = normal, 2 = compte double)"${checked ? "" : " disabled"} /></span>`;
  // Traduction d'un libellé inséré dans une phrase (le reste de l'interface est traduit par js/i18n.js)
  const tr = (s) => (window.pfI18n && typeof window.pfI18n.t === "function" ? window.pfI18n.t(s) : s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  class ManagementZonesManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.isOpen = false;
      this.currentParcel = null;
      this.result = null;
      this.opacity = 0.6;
      this.worker = null;
      this.runId = 0;
      this.abortController = null;
      this.SRC = "zones-source"; this.SRC_PT = "zones-label-source"; this.SRC_HL = "zones-parcel-hl-source";
      this.LAYER_FILL = "zones-fill-layer"; this.LAYER_LINE = "zones-line-layer"; this.LAYER_LABEL = "zones-label-layer"; this.LAYER_HL = "zones-parcel-hl-line";
      this.initEvents();
    }

    getProj4() { return window.proj4 || (window.GeoLibreContour && window.GeoLibreContour.proj4) || (typeof proj4 !== "undefined" ? proj4 : null); }

    initEvents() {
      const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
      on("btn-close-zones-dock", "click", () => this.closeDock());
      on("btn-zones-run", "click", () => this.run());
      on("btn-zones-save", "click", () => this.saveToLibrary());
      on("btn-zones-export", "click", () => this.exportGeoJson());
      on("btn-zones-export-shp", "click", () => this.exportShapefile());
      on("zones-opacity-slider", "input", (e) => {
        const v = parseInt(e.target.value, 10);
        this.opacity = v / 100;
        const lbl = $("zones-opacity-val"); if (lbl) lbl.textContent = v + " %";
        if (this.map && this.map.getLayer(this.LAYER_FILL)) this.map.setPaintProperty(this.LAYER_FILL, "fill-opacity", this.opacity);
      });
      ["zones-k", "zones-min", "zones-max"].forEach((id) => on(id, "keydown", (e) => { if (e.key === "Enter") this.run(); }));
      on("zones-min", "input", () => { this.minTouched = true; });
      on("zones-k", "change", () => { if (!this.minTouched) this.setDefaultMin(); });
      on("zones-method", "change", () => this.syncMethod());
      document.addEventListener("pf-raster-links-changed", () => { if (this.isOpen) this.renderNdviChoices(); });
      document.addEventListener("pf-lang-changed", () => { this.updateLayersSummary(); if (this.isOpen && this.result) this.renderTable(); });
      const box = $("zones-layers");
      if (box && !box.children.length) {
        box.innerHTML = LAYERS.map((l) => layerItem(l, l.label, l.on, 1)).join("");
      }
      // le poids n'est modifiable que pour une couche cochée ; Entrée relance le calcul
      // fenêtre « Couches et pondération »
      const modal = $("zones-layers-modal");
      on("btn-zones-layers", "click", () => this.openLayersModal());
      on("btn-zones-layers-close", "click", () => this.closeLayersModal());
      on("btn-zones-layers-done", "click", () => this.closeLayersModal());
      on("btn-zones-layers-run", "click", () => { this.closeLayersModal(); this.run(); });
      if (modal) {
        modal.addEventListener("mousedown", (e) => { if (e.target === modal) this.closeLayersModal(); });
        // le poids n'est modifiable que pour une couche cochée
        modal.addEventListener("change", (e) => {
          const t = e.target;
          if (t && t.type === "checkbox" && t.closest(".pf-zn-item")) { const w = t.closest(".pf-zn-item").querySelector(".pf-zn-w"); if (w) w.disabled = !t.checked; }
          this.updateLayersSummary();
        });
        modal.addEventListener("keydown", (e) => {
          if (e.key === "Escape") { e.stopPropagation(); this.closeLayersModal(); }
          else if (e.key === "Enter" && e.target && e.target.classList && e.target.classList.contains("pf-zn-w")) { this.closeLayersModal(); this.run(); }
        });
      }
      this.updateLayersSummary();
    }

    openLayersModal() {
      const modal = $("zones-layers-modal"); if (!modal) return;
      this.renderNdviChoices();
      modal.classList.add("active");
      const first = modal.querySelector("input[type=checkbox]"); if (first) first.focus({ preventScroll: true });
    }

    closeLayersModal() {
      const modal = $("zones-layers-modal"); if (!modal || !modal.classList.contains("active")) return;
      modal.classList.remove("active");
      this.updateLayersSummary();
      const btn = $("btn-zones-layers"); if (btn) btn.focus({ preventScroll: true });
    }

    // Couches cochées et leur poids, lus dans la fenêtre
    readLayers() {
      const layers = Array.from(document.querySelectorAll("#zones-layers input[type=checkbox]:checked, #zones-ndvi-layers input[type=checkbox]:checked")).map((i) => i.value);
      const weights = {};
      document.querySelectorAll("#zones-layers-modal .pf-zn-w").forEach((i) => {
        if (!layers.includes(i.dataset.w)) return;
        const v = parseFloat(String(i.value).replace(",", "."));
        weights[i.dataset.w] = Number.isFinite(v) && v > 0 ? Math.max(0.1, Math.min(10, v)) : 1;
      });
      return { layers, weights };
    }

    // Résumé affiché sur le bouton du menu : « élévation, pente ×2, NDVI 2026-08-14 »
    updateLayersSummary() {
      const el = $("zones-layers-summary"); if (!el) return;
      const { layers, weights } = this.readLayers(), defs = this.layerDefs();
      const parts = defs.filter((l) => layers.includes(l.key)).map((l) => (l.scene ? l.short : tr(l.short || l.label)) + (weights[l.key] !== 1 ? " ×" + fr(weights[l.key], weights[l.key] % 1 ? 1 : 0) : ""));
      el.textContent = parts.length ? parts.join(", ") : "aucune";
      el.title = el.textContent;
    }

    // ---- couches -------------------------------------------------------------------
    // Tuiles NDVI enregistrées dans Mes données (liens vers une scène Sentinel-2) qui couvrent la parcelle
    savedNdvi() {
      const vm = window.vectorManager, b = this.geomBbox, seen = new Set(), out = [];
      if (!vm || !Array.isArray(vm.layers)) return out;
      vm.layers.forEach((l) => {
        const r = l && l.kind === "raster" ? l.raster : null;
        if (!r || !r.legend || r.legend.kind !== "ndvi") return;
        const scene = (r.meta && r.meta.scene) || decodeURIComponent((/[?&]item=([^&]+)/.exec(r.tiles || "") || [])[1] || "");
        if (!/^[A-Za-z0-9_.-]+$/.test(scene) || seen.has(scene)) return; // même scène enregistrée avec deux nuanciers : une seule fois
        if (b && r.bounds && (r.bounds[2] < b[0] || r.bounds[0] > b[2] || r.bounds[3] < b[1] || r.bounds[1] > b[3])) return;
        seen.add(scene);
        // Sentinel-2 : décalage de 1000 par bande depuis le traitement 04.00 (scènes du 25 janvier 2022 et après)
        let tilesTxt = ""; try { tilesTxt = decodeURIComponent(r.tiles || ""); } catch (e) { tilesTxt = r.tiles || ""; }
        const s2Offset = /B08\+B04-2000/.test(tilesTxt) || String((r.meta && r.meta.date) || l.name || "") >= "2022-01-25";
        const landsat = /collection=landsat-c2-l2/.test(r.tiles || "") || /^L[COTEM]\d\d_/.test(scene);
        const date = String((r.meta && r.meta.date) || l.name || "").slice(0, 10);
        const compact = date.replace(/[^0-9]/g, "");
        out.push({ key: "ndvi:" + scene, scene, landsat, s2Offset: !landsat && s2Offset, label: "NDVI " + date, short: "NDVI " + date, unit: "", digits: 2, prop: "nd_" + (compact.slice(2) || scene.slice(-6)), title: `NDVI ${landsat ? "Landsat (30 m)" : "Sentinel-2 (10 m)"} du ${date} (tuile enregistrée dans Mes données)` });
      });
      return out.sort((a, c) => a.label.localeCompare(c.label));
    }

    layerDefs() { return LAYERS.concat(this.ndviDefs || []); }

    renderNdviChoices() {
      const box = $("zones-ndvi-layers"); if (!box) return;
      const checked = new Set(Array.from(box.querySelectorAll("input:checked")).map((i) => i.value));
      const kept = {}; box.querySelectorAll(".pf-zn-w").forEach((i) => { kept[i.dataset.w] = i.value; });
      this.ndviDefs = this.savedNdvi();
      box.innerHTML = this.ndviDefs.length
        ? this.ndviDefs.map((l) => layerItem(l, l.label.replace("NDVI ", "") + (l.landsat ? " · Landsat 30 m" : ""), checked.has(l.key), kept[l.key])).join("")
        : `<span class="pf-zn-empty">Aucune tuile NDVI enregistrée ne couvre cette parcelle. Pour en ajouter : outil NDVI satellite, puis « Enregistrer ».</span>`;
      this.updateLayersSummary();
    }

    // Valeurs NDVI réelles d'une scène sur l'emprise (bandes B08 et B04 à 10 m), nuages et ombres écartés
    async fetchNdvi(def, bboxWgs, widthM, heightM, signal) {
      const px = def.landsat ? 30 : 10; // taille native des pixels
      const w = Math.max(8, Math.min(1024, Math.ceil(widthM / px))), h = Math.max(8, Math.min(1024, Math.ceil(heightM / px)));
      const query = def.landsat
        ? `collection=landsat-c2-l2&item=${encodeURIComponent(def.scene)}&assets=nir08&assets=red&assets=qa_pixel&asset_as_band=True&expression=${encodeURIComponent("(nir08-red)/(nir08+red-14545.4545);qa_pixel")}`
        : `collection=sentinel-2-l2a&item=${encodeURIComponent(def.scene)}&assets=B08&assets=B04&assets=SCL&asset_as_band=True&expression=${encodeURIComponent(def.s2Offset ? "(B08-B04)/(B08+B04-2000);SCL" : "(B08-B04)/(B08+B04);SCL")}`;
      const url = `${PC_DATA}bbox/${bboxWgs.map((v) => v.toFixed(6)).join(",")}/${w}x${h}.npy?${query}`;
      let npy;
      try {
        const resp = await fetch(url, { signal });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        npy = parseNpy(await resp.arrayBuffer());
      } catch (e) {
        if (signal && signal.aborted) throw e;
        throw new Error(`Lecture du ${def.label} impossible (${e.message || e}). Décochez cette date ou réessayez.`);
      }
      const n = npy.w * npy.h, out = new Float32Array(n), cls = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const v = npy.data[i], mask = npy.bands > 2 ? npy.data[2 * n + i] : 255;
        let scl = npy.bands > 1 ? Math.round(npy.data[n + i]) : 4;
        if (def.landsat) { // qa_pixel de Landsat ramené aux classes de Sentinel-2 : 0 sans donnée, 9 nuage, 11 neige, 8 nuage possible, 10 cirrus, 3 ombre, 4 clair
          const q = scl;
          scl = (q & 1) || q === 0 ? 0 : (q & 8) ? 9 : (q & 32) ? 11 : (q & 2) ? 8 : (q & 4) ? 10 : (q & 16) ? 3 : 4;
        }
        cls[i] = scl >= 0 && scl < 255 ? scl : 0;
        out[i] = Number.isFinite(v) && v >= -1 && v <= 1 && mask !== 0 && !SCL_BAD.has(scl) ? v : NaN;
      }
      return { data: out, scl: cls, w: npy.w, h: npy.h, bbox: bboxWgs };
    }

    // ---- ouverture / fermeture -------------------------------------------------
    async openForParcel(parcelFeature) {
      if (!parcelFeature || !parcelFeature.geometry) return;
      let parcel = parcelFeature;
      if (window.terrain3DManager && typeof window.terrain3DManager.assembleParcelFeature === "function") {
        parcel = window.terrain3DManager.assembleParcelFeature(parcelFeature);
      }
      if (!parcel || !parcel.geometry || !/Polygon$/.test(parcel.geometry.type)) return;
      this.cancel();
      this.currentParcel = parcel;
      this.result = null;
      this.removeZoneLayers();
      this.prepareGeometry();
      this.renderNdviChoices();
      this.openDock();
      this.updateHeader();
      this.setAlert("");
      this.showResults(false);
      this.minTouched = false;
      this.syncMethod();
      this.highlightParcel(parcel.geometry);
      const b = this.geomBbox;
      if (b && this.map) this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 60, bottom: 300, left: 60, right: 60 }, duration: 800 });
      this.run();
    }

    openDock() {
      const dock = $("zones-dock");
      if (dock) { dock.style.display = "flex"; dock.classList.add("open"); }
      this.isOpen = true;
    }

    closeDock() {
      this.cancel();
      this.closeLayersModal();
      this.removeZoneLayers();
      if (this.map && this.map.getLayer(this.LAYER_HL)) this.map.setLayoutProperty(this.LAYER_HL, "visibility", "none");
      const dock = $("zones-dock");
      if (dock) { dock.classList.remove("open"); dock.style.display = "none"; }
      this.isOpen = false;
      this.currentParcel = null;
      this.result = null;
    }

    cancel() {
      this.runId++;
      if (this.abortController) { this.abortController.abort(); this.abortController = null; }
      if (this.worker) { this.worker.terminate(); this.worker = null; }
      this.setLoading(false);
    }

    parcelName() {
      const p = (this.currentParcel && this.currentParcel.properties) || {};
      const pid = p.IDPAR || p.idpar || "", lot = p.NO_LOT || p.no_lot || "", nom = p.nom || p.name || "";
      return pid ? `Parcelle nº ${pid}` : lot ? `Lot nº ${lot}` : nom ? String(nom) : "Parcelle";
    }

    updateHeader() {
      const el = $("zones-parcel-name");
      if (el) el.textContent = `${this.parcelName()} (${fr(this.areaM2 / 10000, 1)} ha)`;
    }

    setDefaultMin() {
      const k = this.readK(), el = $("zones-min");
      if (!el || !this.areaM2) return;
      el.value = this.readMethod() === "kmeans" ? "0.1" : Math.max(0.05, Math.round((this.areaM2 / 10000 / (k * 4)) * 10) / 10).toFixed(1);
    }

    readMethod() { const el = $("zones-method"); return el && el.value === "kmeans" ? "kmeans" : "skater"; }

    // K-means : pas de superficie maximale, et le minimum devient la taille du plus petit îlot conservé
    syncMethod() {
      const km = this.readMethod() === "kmeans", min = $("zones-min"), max = $("zones-max");
      if (max) { max.disabled = km; max.parentNode.title = km ? "Sans objet avec K-means" : "Superficie maximale de chaque zone (vide : aucune limite)"; }
      if (min) min.parentNode.title = km ? "Superficie minimale d'un îlot : les îlots plus petits sont fusionnés à la zone qui les entoure" : "Superficie minimale de chaque zone";
      if (!this.minTouched) this.setDefaultMin();
    }

    readK() { const el = $("zones-k"); return Math.max(2, Math.min(12, parseInt(el && el.value, 10) || 4)); }
    readHa(id) { const el = $(id); const v = el ? parseFloat(String(el.value).replace(",", ".")) : NaN; return Number.isFinite(v) && v > 0 ? v : 0; }

    setLoading(on, text) {
      const bar = $("zones-loading-bar"), txt = $("zones-loading-text"), btn = $("btn-zones-run");
      if (bar) bar.style.display = on ? "flex" : "none";
      if (txt && text) txt.textContent = text;
      if (btn) btn.disabled = !!on;
    }

    setAlert(html) {
      const box = $("zones-alert-box");
      if (!box) return;
      box.innerHTML = html || "";
      box.style.display = html ? "block" : "none";
    }

    showResults(on) {
      const el = $("zones-results"); if (el) el.style.display = on ? "" : "none";
      ["btn-zones-save", "btn-zones-export", "btn-zones-export-shp"].forEach((id) => { const b = $(id); if (b) b.disabled = !on; });
      const save = $("btn-zones-save"); if (save) save.textContent = "Enregistrer dans Mes données";
    }

    // ---- géométrie de la parcelle en mètres (UTM de la zone locale) ------------
    prepareGeometry() {
      const p4 = this.getProj4(), geom = this.currentParcel.geometry;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      polys.forEach((poly) => poly.forEach((ring) => ring.forEach((c) => { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; })));
      this.geomBbox = [w, s, e, n];
      const zone = Math.max(1, Math.min(60, Math.floor(((w + e) / 2 + 180) / 6) + 1));
      this.utmDef = `+proj=utm +zone=${zone}${(s + n) / 2 < 0 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
      this.parcelUtm = polys.map((poly) => poly.map((ring) => ring.map((c) => p4("EPSG:4326", this.utmDef, [c[0], c[1]]))));
      this.areaM2 = pfZonesGeom.multiArea(this.parcelUtm);
    }

    // ---- lecture du MNT LiDAR sur l'emprise élargie -----------------------------
    async readDem(bboxWgs, targetSize, signal) {
      let region = null;
      const tm = window.topoManager;
      const custom = tm && tm.selectedProjectId !== "default" && tm.selectedProjectUrl;
      if (custom && typeof readSingleHrdemProjectRegion === "function") {
        try { region = await readSingleHrdemProjectRegion(tm.selectedProjectUrl, bboxWgs, targetSize, signal, "bilinear"); } catch (e) { region = null; }
      }
      if (!region && typeof readMultiHrdemRegion === "function") {
        try { region = await readMultiHrdemRegion(bboxWgs, targetSize, signal, "bilinear"); } catch (e) { region = null; }
      }
      if (!region && window.pfDem && typeof window.pfDem.read === "function") {
        try { region = await window.pfDem.read(bboxWgs, targetSize, signal); } catch (e) { region = null; }
      }
      return region && region.data && region.sourceBBox ? region : null;
    }

    // ---- calcul ------------------------------------------------------------------
    async run() {
      if (!this.currentParcel) return;
      const p4 = this.getProj4();
      if (!p4) { this.setAlert("Bibliothèque de projection indisponible."); return; }
      this.cancel();
      const myRun = this.runId;
      const { layers, weights } = this.readLayers();
      if (!layers.length) { this.setAlert("Choisissez au moins une couche (bouton « Couches »)."); return; }
      const defs = this.layerDefs(), ndviSel = defs.filter((l) => l.scene && layers.includes(l.key));
      const method = this.readMethod(), kmeansMode = method === "kmeans";
      const k = this.readK(), minHa = this.readHa("zones-min"), maxHa = kmeansMode ? 0 : this.readHa("zones-max");
      const smooth = parseInt(($("zones-smooth") || {}).value, 10);
      const areaHa = this.areaM2 / 10000;
      // contraintes impossibles : on le dit avant de calculer
      if (maxHa && minHa && maxHa < minHa) { this.setAlert("La superficie maximale doit dépasser la superficie minimale."); return; }
      if (!kmeansMode && minHa * k > areaHa) { this.setAlert(`Impossible : ${k} zones d'au moins ${fr(minHa, 1)} ha demandent ${fr(minHa * k, 1)} ha, la parcelle en fait ${fr(areaHa, 1)}.`); return; }
      if (maxHa && maxHa * k < areaHa) { this.setAlert(`Impossible : ${k} zones d'au plus ${fr(maxHa, 1)} ha couvrent ${fr(maxHa * k, 1)} ha, la parcelle en fait ${fr(areaHa, 1)}. Augmentez le nombre de zones ou le maximum.`); return; }

      this.setAlert("");
      this.setLoading(true, "Lecture du MNT LiDAR…");
      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      try {
        // grille de calcul
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.parcelUtm.forEach((poly) => poly[0].forEach((c) => { if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0]; if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1]; }));
        const resSel = ($("zones-res") || {}).value || "auto";
        let res = resSel === "auto" ? [2, 3, 5, 10].find((r) => r >= Math.sqrt(this.areaM2 / 60000)) || 10 : parseFloat(resSel);
        let notice = "";
        const marginCells = (r) => Math.max(6 + (smooth > 0 ? 2 * smooth : 0), Math.ceil(30 / r));
        while (res < 50 && ((maxX - minX) / res + 2 * marginCells(res)) * ((maxY - minY) / res + 2 * marginCells(res)) > MAX_CELLS) {
          res = res < 10 ? [3, 5, 10].find((r) => r > res) : res * 2;
          notice = `Parcelle très grande : résolution ramenée à ${res} m.`;
        }
        const mc = marginCells(res);
        minX = Math.floor(minX / res) * res - mc * res; maxY = Math.ceil(maxY / res) * res + mc * res;
        const W = Math.ceil((maxX - minX) / res) + mc, H = Math.ceil((maxY - minY) / res) + mc;
        maxX = minX + W * res; minY = maxY - H * res;

        const corners = [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY], [(minX + maxX) / 2, minY], [(minX + maxX) / 2, maxY]].map((c) => p4(this.utmDef, "EPSG:4326", c));
        const bboxWgs = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))];
        const targetSize = Math.max(64, Math.min(2048, Math.ceil((Math.max(W, H) * res) / Math.max(1, res / 2))));
        const region = await this.readDem(bboxWgs, targetSize, signal);
        if (myRun !== this.runId) return;
        if (!region) throw new Error("Pas de MNT LiDAR lisible pour cette parcelle.");
        // NDVI enregistrés : valeurs réelles lues en parallèle
        if (ndviSel.length) this.setLoading(true, `Lecture de ${ndviSel.length} date${ndviSel.length > 1 ? "s" : ""} NDVI…`);
        const ndviGrids = await Promise.all(ndviSel.map((d) => this.fetchNdvi(d, bboxWgs, maxX - minX, maxY - minY, signal)));
        if (myRun !== this.runId) return;

        // rééchantillonnage bilinéaire du MNT sur la grille et masque de la parcelle
        this.setLoading(true, "Préparation de la grille…");
        await new Promise((r) => setTimeout(r, 0));
        const dem = new Float32Array(W * H), inside = new Uint8Array(W * H);
        const src = region.data, sw = region.width, sh = region.height, sB = region.sourceBBox;
        const projDef = region.projection || (typeof EPSG_3979_DEF !== "undefined" ? EPSG_3979_DEF : null);
        if (!projDef) throw new Error("Projection du MNT inconnue.");
        const fwd = p4(this.utmDef, projDef), toGeo = p4(this.utmDef, "EPSG:4326");
        const extra = {}, ndviStats = ndviSel.map(() => ({ inside: 0, missing: 0, doubt: {} }));
        ndviSel.forEach((d) => { extra[d.key] = new Float32Array(W * H).fill(NaN); });
        const spanX = sB[2] - sB[0], spanY = sB[3] - sB[1];
        for (let r = 0; r < H; r++) {
          const y = maxY - (r + 0.5) * res;
          for (let c = 0; c < W; c++) {
            const x = minX + (c + 0.5) * res, i = r * W + c;
            const m = fwd.forward([x, y]);
            const col = ((m[0] - sB[0]) / spanX) * sw - 0.5, row = ((sB[3] - m[1]) / spanY) * sh - 0.5;
            if (col < -0.5 || row < -0.5 || col > sw - 0.5 || row > sh - 0.5) { dem[i] = NaN; continue; }
            const cc = Math.max(0, Math.min(sw - 1, col)), rr = Math.max(0, Math.min(sh - 1, row));
            const c0 = Math.floor(cc), r0 = Math.floor(rr), c1 = Math.min(sw - 1, c0 + 1), r1 = Math.min(sh - 1, r0 + 1), fc = cc - c0, frr = rr - r0;
            const v = (src[r0 * sw + c0] * (1 - fc) + src[r0 * sw + c1] * fc) * (1 - frr) + (src[r1 * sw + c0] * (1 - fc) + src[r1 * sw + c1] * fc) * frr;
            dem[i] = Number.isFinite(v) && v > -900 && v < 9000 ? v : NaN;
            if (pfZonesGeom.inMulti([x, y], this.parcelUtm)) inside[i] = 1;
            if (ndviGrids.length) { // NDVI : moyenne bilinéaire des pixels valides voisins
              const g = toGeo.forward([x, y]);
              for (let t = 0; t < ndviGrids.length; t++) {
                const N = ndviGrids[t], b = N.bbox;
                const nc = ((g[0] - b[0]) / (b[2] - b[0])) * N.w - 0.5, nr = ((b[3] - g[1]) / (b[3] - b[1])) * N.h - 0.5;
                const a0 = Math.max(0, Math.min(N.w - 1, Math.floor(nc))), b0 = Math.max(0, Math.min(N.h - 1, Math.floor(nr)));
                const a1 = Math.min(N.w - 1, a0 + 1), b1 = Math.min(N.h - 1, b0 + 1);
                const fx = Math.max(0, Math.min(1, nc - a0)), fy = Math.max(0, Math.min(1, nr - b0));
                let sum = 0, wsum = 0;
                const add = (col, row, wt) => { const val = N.data[row * N.w + col]; if (val === val && wt > 0) { sum += val * wt; wsum += wt; } };
                add(a0, b0, (1 - fx) * (1 - fy)); add(a1, b0, fx * (1 - fy)); add(a0, b1, (1 - fx) * fy); add(a1, b1, fx * fy);
                if (wsum > 0.25) extra[ndviSel[t].key][i] = sum / wsum;
                if (inside[i]) {
                  const st = ndviStats[t], c = N.scl[Math.max(0, Math.min(N.h - 1, Math.round(nr))) * N.w + Math.max(0, Math.min(N.w - 1, Math.round(nc)))];
                  st.inside++;
                  if (!(wsum > 0.25)) st.missing++; else if (SCL_DOUBT[c]) st.doubt[c] = (st.doubt[c] || 0) + 1;
                }
              }
            }
          }
        }
        const cloudy = [];
        ndviSel.forEach((d, t) => {
          const part = ndviStats[t].inside ? ndviStats[t].missing / ndviStats[t].inside : 1;
          if (part > 0.5) throw new Error(`${d.label} : ${fr(part * 100, 0)} % de la parcelle est sans donnée (nuage épais, neige ou hors scène). Décochez cette date.`);
          if (part > 0.05) cloudy.push(`${d.label} : ${fr(part * 100, 0)} % de la parcelle écarté (nuage épais, neige ou hors scène) et comblé par les pixels voisins.`);
          const st = ndviStats[t], doubt = Object.keys(st.doubt).map((c) => ({ name: SCL_DOUBT[c], part: st.doubt[c] / st.inside })).filter((x) => x.part > 0.01).sort((a, b) => b.part - a.part);
          if (doubt.reduce((a, x) => a + x.part, 0) > 0.05) cloudy.push(`${d.label} : toutes les valeurs sont utilisées, mais le masque de qualité du satellite classe une partie de la parcelle en ${doubt.map((x) => `${x.name} (${fr(x.part * 100, 0)} %)`).join(", ")}. Ce classement se trompe souvent sur un sol nu ou foncé ; si la tuile montre un vrai nuage ou son ombre, décochez cette date.`);
        });
        const cellHa = (res * res) / 10000;
        const input = { dem, W, H, res, inside, layers, extra, weights, method, k, smooth, margin: mc - 2, minCells: Math.ceil(minHa / cellHa), maxCells: maxHa ? Math.floor(maxHa / cellHa) : 0 };
        const out = await this.computeInWorker(input, (text) => { if (myRun === this.runId) this.setLoading(true, text); });
        if (myRun !== this.runId) return;

        this.setLoading(true, "Découpage au contour de la parcelle…");
        await new Promise((r) => setTimeout(r, 0));
        this.result = this.buildResult(out, { minX, maxY, res, layers, weights, method, defs, cloudy, k, minHa, maxHa, notice, source: region.demLabel || "LiDAR" });
        this.renderZones();
        this.renderTable();
        this.showResults(true);
      } catch (err) {
        if (myRun !== this.runId) return;
        console.error("Zones de gestion :", err);
        this.setAlert(esc(err && err.message ? err.message : "Erreur pendant le calcul des zones."));
        this.showResults(false);
      } finally {
        if (myRun === this.runId) this.setLoading(false);
      }
    }

    // Le calcul tourne dans un Web Worker (créé à partir du code de pfZonesCore) pour ne pas figer la carte
    computeInWorker(input, onProgress) {
      return new Promise((resolve, reject) => {
        let worker = null;
        try {
          const code = `${pfZonesCore.toString()}\nconst core = pfZonesCore();\nself.onmessage = (e) => { try { const out = core.compute(e.data, (t) => self.postMessage({ progress: t })); self.postMessage({ out }); } catch (err) { self.postMessage({ error: String(err && err.message || err) }); } };`;
          const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
          worker = new Worker(url);
          URL.revokeObjectURL(url);
        } catch (e) { worker = null; }
        if (!worker) { // secours : même calcul sur le fil principal
          setTimeout(() => { try { resolve(pfZonesCore().compute(input, onProgress)); } catch (err) { reject(err); } }, 20);
          return;
        }
        this.worker = worker;
        worker.onmessage = (e) => {
          const d = e.data || {};
          if (d.progress) { onProgress(d.progress); return; }
          worker.terminate(); if (this.worker === worker) this.worker = null;
          if (d.error) reject(new Error(d.error)); else resolve(d.out);
        };
        worker.onerror = (e) => { worker.terminate(); if (this.worker === worker) this.worker = null; reject(new Error(e.message || "Erreur du module de calcul.")); };
        worker.postMessage(input);
      });
    }

    // ---- résultat : polygones découpés, superficies, avertissements -------------
    buildResult(out, ctx) {
      const p4 = this.getProj4(), inv = p4(this.utmDef, "EPSG:4326");
      const toWgs = (c) => { const g = inv.forward([c[0], c[1]]); return [Math.round(g[0] * 1e7) / 1e7, Math.round(g[1] * 1e7) / 1e7]; };
      const pc = window.polygonClipping || null;
      const features = [], points = [];
      let total = 0;
      out.zones.forEach((zn, i) => {
        const multi = pfZonesGeom.clip(pfZonesGeom.toMulti(out.rings[i], ctx.minX, ctx.maxY, ctx.res), this.parcelUtm, ctx.res, pc);
        const areaHa = pfZonesGeom.multiArea(multi) / 10000;
        total += areaHa;
        const props = { zone: zn.zone, nom: `Zone ${zn.zone}`, superficie_ha: Math.round(areaHa * 100) / 100, couleur: COLORS[i % COLORS.length] };
        if (ctx.method === "kmeans") props.ilots = multi.length;
        ctx.defs.forEach((l) => { if (zn.means[l.key] !== undefined) props[l.prop || (l.key === "elev" ? "elev_moy_m" : l.key === "slope" ? "pente_moy_pct" : l.key + "_moy")] = Math.round(zn.means[l.key] * 1000) / 1000; });
        const coords = multi.map((poly) => poly.map((ring) => ring.map(toWgs)));
        features.push({ type: "Feature", properties: props, geometry: coords.length === 1 ? { type: "Polygon", coordinates: coords[0] } : { type: "MultiPolygon", coordinates: coords } });
        if (zn.anchor) points.push({ type: "Feature", properties: { label: String(zn.zone) }, geometry: { type: "Point", coordinates: toWgs([ctx.minX + zn.anchor[0] * ctx.res, ctx.maxY - zn.anchor[1] * ctx.res]) } });
      });
      features.forEach((f) => { f.properties.part_pct = total > 0 ? Math.round((f.properties.superficie_ha / total) * 1000) / 10 : 0; });
      return Object.assign({ features, points, zones: out.zones, warnings: out.warnings, explained: out.explained, cells: out.n, ms: out.ms, totalHa: total, clipped: !!pc }, ctx);
    }

    // ---- carte -------------------------------------------------------------------
    highlightParcel(geom) {
      if (!this.map || !geom) return;
      const data = { type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] };
      if (!this.map.getSource(this.SRC_HL)) {
        this.map.addSource(this.SRC_HL, { type: "geojson", data });
        this.map.addLayer({ id: this.LAYER_HL, type: "line", source: this.SRC_HL, paint: { "line-color": "#17211b", "line-width": 2.5, "line-opacity": 0.9 } });
      } else {
        this.map.getSource(this.SRC_HL).setData(data);
        this.map.setLayoutProperty(this.LAYER_HL, "visibility", "visible");
      }
    }

    renderZones() {
      const map = this.map, r = this.result;
      if (!map || !r) return;
      const fc = { type: "FeatureCollection", features: r.features }, pts = { type: "FeatureCollection", features: r.points };
      if (map.getSource(this.SRC)) map.getSource(this.SRC).setData(fc); else map.addSource(this.SRC, { type: "geojson", data: fc });
      if (map.getSource(this.SRC_PT)) map.getSource(this.SRC_PT).setData(pts); else map.addSource(this.SRC_PT, { type: "geojson", data: pts });
      if (!map.getLayer(this.LAYER_FILL)) map.addLayer({ id: this.LAYER_FILL, type: "fill", source: this.SRC, paint: { "fill-color": ["get", "couleur"], "fill-opacity": this.opacity } });
      if (!map.getLayer(this.LAYER_LINE)) map.addLayer({ id: this.LAYER_LINE, type: "line", source: this.SRC, paint: { "line-color": "#ffffff", "line-width": 1.6, "line-opacity": 0.95 } });
      if (!map.getLayer(this.LAYER_LABEL)) {
        try {
          map.addLayer({ id: this.LAYER_LABEL, type: "symbol", source: this.SRC_PT,
            layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 15, "text-allow-overlap": true },
            paint: { "text-color": "#17211b", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
        } catch (e) { /* style sans glyphes : pas d'étiquettes */ }
      }
      if (map.getLayer(this.LAYER_HL)) map.moveLayer(this.LAYER_HL);
      if (map.getLayer(this.LAYER_LABEL)) map.moveLayer(this.LAYER_LABEL);
    }

    removeZoneLayers() {
      const map = this.map; if (!map) return;
      [this.LAYER_LABEL, this.LAYER_LINE, this.LAYER_FILL].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
      [this.SRC, this.SRC_PT].forEach((id) => { if (map.getSource(id)) map.removeSource(id); });
    }

    // ---- tableau et messages -----------------------------------------------------
    renderTable() {
      const r = this.result; if (!r) return;
      const cols = r.defs.filter((l) => r.zones[0] && r.zones[0].means[l.key] !== undefined);
      const head = $("zones-thead"), body = $("zones-tbody"), sum = $("zones-summary");
      const km = r.method === "kmeans";
      if (head) head.innerHTML = `<tr><th>Zone</th><th>Superficie</th><th>Part</th>${km ? `<th title="Nombre d'îlots séparés qui composent la zone">Îlots</th>` : ""}${cols.map((l) => `<th title="${esc(l.title)}">${esc(l.short || l.label)}${l.unit ? ` (${l.unit})` : ""}${r.layers.includes(l.key) ? "" : " *"}</th>`).join("")}</tr>`;
      if (body) body.innerHTML = r.features.map((f, i) => {
        const p = f.properties, zn = r.zones[i];
        return `<tr><td><span class="pf-cf-dot" style="background:${p.couleur}"></span> Zone ${p.zone}</td><td>${fr(p.superficie_ha, 2)} ha</td><td>${fr(p.part_pct, 1)} %</td>${km ? `<td>${p.ilots}</td>` : ""}${cols.map((l) => `<td>${fr(zn.means[l.key], l.digits)}</td>`).join("")}</tr>`;
      }).join("");
      const wsum = r.layers.reduce((a, key) => a + (r.weights[key] || 1), 0);
      const used = r.defs.filter((l) => r.layers.includes(l.key)).map((l) => (l.scene ? l.label : tr(l.label.toLowerCase())) + (r.layers.length > 1 ? ` ${fr(((r.weights[l.key] || 1) / wsum) * 100, 0)} %` : "")).join(", ");
      const star = cols.some((l) => !r.layers.includes(l.key)) ? " · * couche affichée pour information, non utilisée dans le calcul" : "";
      if (sum) { sum.textContent = ""; const b = document.createElement("strong"); b.textContent = km ? "K-means · zones non contiguës" : "SKATER · zones contiguës"; sum.appendChild(b); sum.appendChild(document.createTextNode(" · ")); }
      if (sum) sum.appendChild(document.createTextNode(`${r.features.length} zones · ${fr(r.totalHa, 1)} ha · grille de ${fr(r.res, 0)} m (${r.cells.toLocaleString("fr-CA")} cellules) · couches : ${used} · ${fr(r.explained * 100, 0)} % de la variance expliquée · zones numérotées de la plus basse à la plus haute${star}`));

      const cellHa = (r.res * r.res) / 10000, notes = [];
      if (r.notice) notes.push(esc(r.notice));
      (r.cloudy || []).forEach((c) => notes.push(esc(c)));
      r.warnings.forEach((w) => {
        if (w.code === "fewer" && km) notes.push(`Seulement ${w.got} classes distinctes sur ${w.asked} : les couches choisies ne varient pas assez sur la parcelle.`);
        if (w.code === "fewer" && !km) notes.push(`Seulement ${w.got} zones sur ${w.asked} : aucune autre coupe ne respecte la superficie minimale. Réduisez le minimum ou le nombre de zones.`);
        if (w.code === "parts") notes.push(`La parcelle est en ${w.count} morceaux séparés : chaque morceau forme au moins une zone.`);
        if (w.code === "flat") notes.push(`La couche « ${esc((r.defs.find((l) => l.key === w.layer) || {}).label || w.layer)} » est constante sur la parcelle et n'influence pas les zones.`);
      });
      const tooBig = r.features.filter((f) => !km && r.maxHa && f.properties.superficie_ha > r.maxHa + cellHa).map((f) => f.properties.zone);
      const tooSmall = r.features.filter((f) => !km && r.minHa && f.properties.superficie_ha < r.minHa - cellHa).map((f) => f.properties.zone);
      if (tooBig.length) notes.push(`Zone${tooBig.length > 1 ? "s" : ""} ${tooBig.join(", ")} au-dessus du maximum de ${fr(r.maxHa, 1)} ha : avec ${r.k} zones contiguës, le relief ne permet pas mieux. Augmentez le nombre de zones.`);
      if (tooSmall.length) notes.push(`Zone${tooSmall.length > 1 ? "s" : ""} ${tooSmall.join(", ")} sous le minimum de ${fr(r.minHa, 1)} ha après lissage et découpage au contour.`);
      if (!r.clipped) notes.push("Découpage au contour indisponible : les zones débordent légèrement de la parcelle.");
      this.setAlert(notes.join("<br>"));
    }

    // ---- sorties -------------------------------------------------------------------
    collection() {
      const r = this.result; if (!r) return null;
      return { type: "FeatureCollection", features: r.features.map((f) => ({ type: "Feature", properties: Object.assign({}, f.properties, { methode: r.method === "kmeans" ? "K-means" : "SKATER", resolution_m: r.res, couches: r.defs.filter((l) => r.layers.includes(l.key)).map((l) => (l.scene ? l.label.replace(" ", "_") : l.key) + ((r.weights[l.key] || 1) !== 1 ? "x" + r.weights[l.key] : "")).join("+") }), geometry: f.geometry })) };
    }

    saveToLibrary() {
      const vm = window.vectorManager, fc = this.collection();
      if (!fc) return;
      if (!vm || typeof vm.createLayerFromCollection !== "function") { this.setAlert("« Mes données » n'est pas disponible : utilisez Exporter GeoJSON."); return; }
      const folderId = typeof vm.ensureFolderPath === "function" ? vm.ensureFolderPath(["Zones de gestion"], null) : null;
      const folder = folderId && typeof vm.getFolder === "function" ? vm.getFolder(folderId) : null;
      if (folder) folder.collapsed = false;
      const name = `${this.parcelName()} · ${fc.features.length} zones`;
      // une seule couche pour toutes les zones ; chaque zone garde sa couleur (attribut « couleur »)
      const layer = vm.createLayerFromCollection(fc, name, folderId, { geometryType: "Polygon", visible: true,
        style: { fillColor: "#4477AA", fillOpacity: this.opacity, strokeColor: "#ffffff", strokeWidth: 1.5, strokeStyle: "solid", markerShape: "circle", markerSize: 8, labelProperty: "nom", colorProperty: "couleur" } });
      if (!layer) { this.setAlert("Enregistrement impossible."); return; }
      // la couche enregistrée remplace l'aperçu sur la carte ; le bouton confirme l'enregistrement jusqu'au prochain calcul
      this.removeZoneLayers();
      const btn = $("btn-zones-save");
      if (btn) { btn.disabled = true; btn.textContent = "Enregistrées ✓"; }
      if (typeof vm.markDirty === "function") vm.markDirty(layer);
      if (typeof vm.saveLayers === "function") vm.saveLayers();
      if (typeof vm.renderLayersList === "function") vm.renderLayersList();
      if (typeof vm.showToast === "function") vm.showToast(`Zones enregistrées dans Mes données › Zones de gestion › ${name}`);
    }

    async exportShapefile() {
      const fc = this.collection(); if (!fc) return;
      const p = (this.currentParcel && this.currentParcel.properties) || {};
      const idp = String(p.IDPAR || p.idpar || p.NO_LOT || "parcelle").replace(/[^a-zA-Z0-9_-]/g, "_");
      const S = window.PfShapefile;
      const ok = S && typeof S.download === "function" ? await S.download(fc, `zones_gestion_${idp}_${fc.features.length}zones`) : false;
      if (!ok) this.setAlert("Export Shapefile impossible.");
    }

    exportGeoJson() {
      const fc = this.collection(); if (!fc) return;
      const p = (this.currentParcel && this.currentParcel.properties) || {};
      const idp = String(p.IDPAR || p.idpar || p.NO_LOT || "parcelle").replace(/[^a-zA-Z0-9_-]/g, "_");
      const url = URL.createObjectURL(new Blob([JSON.stringify(fc)], { type: "application/geo+json" }));
      const a = document.createElement("a");
      a.href = url; a.download = `zones_gestion_${idp}_${fc.features.length}zones.geojson`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  window.ManagementZonesManager = ManagementZonesManager;
  // Création dès que la carte existe (même principe que les autres analyses de parcelle)
  (function boot() {
    if (window.zonesManager) return;
    if (window.map && typeof window.map.on === "function") window.zonesManager = new ManagementZonesManager(window.map);
    else setTimeout(boot, 300);
  })();
})();
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["zones"] = "42e053ba";
