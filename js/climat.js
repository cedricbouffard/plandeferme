/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
/*
  Climat : stations météo les plus proches et indicateurs agroclimatiques
  -----------------------------------------------------------------------
  pfClimat.open({ lng, lat, name }) / pfClimat.openForParcel(feature) / pfClimat.openAtMapCentre()
  Données quotidiennes d'Environnement et Changement climatique Canada (api.weather.gc.ca, collections
  climate-stations et climate-daily). Pour la station choisie : l'année demandée et les dix précédentes, qui
  servent de point de comparaison (moyenne, minimum et maximum à la même date).

  Indicateurs, du 1er avril au 31 octobre :
  - degrés-jours de croissance, base 5 °C : somme de max(0, T moyenne − 5) ;
  - unités thermiques maïs (UTM) : (Ymax + Ymin) / 2 par jour, avec Ymax = 3,33 (Tmax − 10) − 0,084 (Tmax − 10)²
    et Ymin = 1,8 (Tmin − 4,4), bornés à 0 ; cumul à partir du lendemain de trois jours consécutifs à 12,8 °C
    et plus de moyenne, jusqu'au premier gel de −2 °C ou moins après le 1er août ;
  - précipitations cumulées, 30 et 7 derniers jours ;
  - dernier gel du printemps (Tmin ≤ 0 °C avant le 15 juillet), premier gel d'automne (après le 1er août),
    saison sans gel ; jours à 30 °C et plus.
*/
const pfClimatCore = {
  SEASON_START: [4, 1], SEASON_DAYS: 214, // 1er avril au 31 octobre
  doy(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000); },
  dateOf(y, doy) { const t = new Date(Date.UTC(y, 0, 1 + doy)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`; },
  chu(tmax, tmin) { const a = tmax > 10 ? 3.33 * (tmax - 10) - 0.084 * (tmax - 10) * (tmax - 10) : 0, b = tmin > 4.4 ? 1.8 * (tmin - 4.4) : 0; return (Math.max(0, a) + Math.max(0, b)) / 2; },
  km(a, b) { const R = 6371, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r, h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); },
  // Enregistrements de l'API -> tableau par jour de l'année { tmin, tmax, tmean, p } (null = manquant)
  byDay(year, records) {
    const n = this.doy(year, 12, 31) + 1, days = new Array(n).fill(null);
    const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
    (records || []).forEach((r) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(r.LOCAL_DATE || "")); if (!m || +m[1] !== year) return;
      let tmin = num(r.MIN_TEMPERATURE), tmax = num(r.MAX_TEMPERATURE), tmean = num(r.MEAN_TEMPERATURE);
      if (tmean === null && tmin !== null && tmax !== null) tmean = (tmin + tmax) / 2;
      days[this.doy(year, +m[2], +m[3])] = { tmin, tmax, tmean, p: num(r.TOTAL_PRECIPITATION) };
    });
    return days;
  },
  /*
    Indicateurs d'une année. upto : dernier jour de l'année pris en compte (jour de l'année) ; par défaut le
    dernier jour qui a une observation. -> valeurs et séries cumulées par jour de la saison (0 = 1er avril)
  */
  indicators(year, days, upto) {
    const s0 = this.doy(year, 4, 1), sEnd = this.doy(year, 10, 31), jul15 = this.doy(year, 7, 15), aug1 = this.doy(year, 8, 1);
    let last = -1; for (let i = days.length - 1; i >= 0; i--) if (days[i] && (days[i].tmean !== null || days[i].p !== null)) { last = i; break; }
    if (upto === undefined || upto === null) upto = last; upto = Math.min(upto, last);
    const out = { year, last, upto, lastDate: last >= 0 ? this.dateOf(year, last) : null, gdd: 0, chu: 0, chuStart: null, chuEnd: null, precip: 0, precip30: 0, precip7: 0, hot: 0, rainDays: 0,
      springFrost: null, fallFrost: null, frostFree: null, missT: 0, missP: 0, seasonDays: 0, series: { gdd: [], chu: [], precip: [] } };
    if (last < 0) return out;
    // gels
    for (let i = 0; i <= Math.min(upto, jul15); i++) if (days[i] && days[i].tmin !== null && days[i].tmin <= 0) out.springFrost = i;
    for (let i = aug1; i <= upto; i++) if (days[i] && days[i].tmin !== null && days[i].tmin <= 0) { out.fallFrost = i; break; }
    if (out.springFrost !== null && out.fallFrost !== null) out.frostFree = out.fallFrost - out.springFrost - 1;
    // UTM : début après trois jours consécutifs à 12,8 °C et plus, fin au premier gel de −2 °C après le 1er août
    let run = 0, chuOn = false, chuOff = false;
    for (let i = s0; i <= Math.min(upto, sEnd); i++) {
      const d = days[i], k = i - s0; out.seasonDays++;
      if (!d || d.tmean === null) out.missT++;
      if (!d || d.p === null) out.missP++;
      if (d && d.tmean !== null) out.gdd += Math.max(0, d.tmean - 5);
      if (d && d.p !== null) { out.precip += d.p; if (d.p >= 1) out.rainDays++; }
      if (d && d.tmax !== null && d.tmax >= 30) out.hot++;
      if (chuOn && !chuOff && i >= aug1 && d && d.tmin !== null && d.tmin <= -2) { chuOff = true; out.chuEnd = i; }
      if (chuOn && !chuOff && d && d.tmax !== null && d.tmin !== null) out.chu += this.chu(d.tmax, d.tmin);
      if (!chuOn) { run = d && d.tmean !== null && d.tmean >= 12.8 ? run + 1 : 0; if (run >= 3) { chuOn = true; out.chuStart = i + 1; } }
      out.series.gdd[k] = out.gdd; out.series.chu[k] = out.chu; out.series.precip[k] = out.precip;
    }
    for (let i = Math.max(0, upto - 29); i <= upto; i++) if (days[i] && days[i].p !== null) { out.precip30 += days[i].p; if (i > upto - 7) out.precip7 += days[i].p; }
    return out;
  },
  // Comparaison : moyenne, minimum et maximum des années de référence, jour par jour de la saison
  reference(list) {
    const n = this.SEASON_DAYS, mk = () => ({ mean: new Array(n).fill(null), min: new Array(n).fill(null), max: new Array(n).fill(null) }), out = { gdd: mk(), chu: mk(), precip: mk(), years: list.length };
    ["gdd", "chu", "precip"].forEach((key) => {
      for (let k = 0; k < n; k++) { const v = list.map((r) => r.series[key][k]).filter((x) => Number.isFinite(x)); if (v.length >= 3) { out[key].mean[k] = v.reduce((a, b) => a + b, 0) / v.length; out[key].min[k] = Math.min(...v); out[key].max[k] = Math.max(...v); } }
    });
    const avg = (f) => { const v = list.map(f).filter((x) => x !== null && Number.isFinite(x)); return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    out.springFrost = avg((r) => r.springFrost); out.fallFrost = avg((r) => r.fallFrost); out.frostFree = avg((r) => r.frostFree); out.hot = avg((r) => r.hot);
    return out;
  },
  // Stations actives les plus proches. features : réponse de climate-stations ; since : "AAAA-MM-JJ"
  nearest(features, lng, lat, since, max) {
    return (features || []).map((f) => { const p = f.properties || {}, c = f.geometry && f.geometry.coordinates; if (!c) return null;
      return { id: p.CLIMATE_IDENTIFIER, name: p.STATION_NAME, lng: c[0], lat: c[1], elev: Number.isFinite(parseFloat(p.ELEVATION)) ? parseFloat(p.ELEVATION) : null, first: String(p.DLY_FIRST_DATE || "").slice(0, 10), last: String(p.DLY_LAST_DATE || "").slice(0, 10), km: this.km([lng, lat], c) }; })
      .filter((s) => s && s.id && s.last && s.last >= since).sort((a, b) => a.km - b.km).slice(0, max || 6);
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { pfClimatCore };

if (typeof window !== "undefined" && typeof document !== "undefined") (function () {
  "use strict";
  const C = pfClimatCore, API = "https://api.weather.gc.ca/collections/";
  const $ = (id) => document.getElementById(id);
  const fr = (v, d) => (Number.isFinite(v) ? v.toLocaleString("fr-CA", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const MONTHS_BY_LANG = { fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."], en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"] };
  const lang = () => String((window.pfI18n && window.pfI18n.lang) || document.documentElement.lang || "fr").slice(0, 2);
  const months = () => MONTHS_BY_LANG[lang()] || MONTHS_BY_LANG.fr;
  const dayLabel = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? (lang() === "en" ? `${months()[+m[2] - 1]} ${+m[3]}` : `${+m[3]} ${months()[+m[2] - 1]}`) : "–"; };
  const state = { lng: 0, lat: 0, name: "", stations: [], station: null, year: 0, cache: new Map(), ctl: null, bound: false, run: 0 };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  function setNote(text, warn) { const n = $("climat-note"); if (!n) return; n.textContent = text || ""; n.classList.toggle("pf-tp-warn", !!warn); }

  async function getJson(url, signal) {
    let r = await fetch(url, { signal });
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 669)); r = await fetch(url, { signal }); }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  // Stations actives autour du point ; la recherche s'élargit si trop peu de stations répondent
  async function findStations(signal) {
    const d = new Date(Date.now() - 46 * 86400000), since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    for (const half of [0.6, 1.3, 2.6]) {
      const dx = half / Math.max(0.3, Math.cos((state.lat * Math.PI) / 180)), bbox = [state.lng - dx, state.lat - half, state.lng + dx, state.lat + half].map((v) => v.toFixed(3)).join(",");
      const j = await getJson(`${API}climate-stations/items?f=json&limit=500&bbox=${bbox}`, signal);
      const list = C.nearest(j.features, state.lng, state.lat, since, 6);
      if (list.length >= 3 || half === 2.6) return list;
    }
    return [];
  }
  function loadYear(st, year, signal) {
    const key = st.id + ":" + year;
    if (state.cache.has(key)) return state.cache.get(key);
    const url = `${API}climate-daily/items?f=json&limit=400&sortby=LOCAL_DATE&CLIMATE_IDENTIFIER=${encodeURIComponent(st.id)}&datetime=${year}-01-01%2000:00:00/${year}-12-31%2000:00:00&properties=LOCAL_DATE,MEAN_TEMPERATURE,MIN_TEMPERATURE,MAX_TEMPERATURE,TOTAL_PRECIPITATION&skipGeometry=true`;
    const p = getJson(url, signal).then((j) => C.byDay(year, (j.features || []).map((f) => f.properties)));
    p.catch(() => state.cache.delete(key));
    state.cache.set(key, p);
    return p;
  }

  // ---- graphique : cumul de l'année, moyenne et étendue des années de comparaison ------------------------------
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k])); if (text !== undefined) e.textContent = text; return e; };
  function chart(box, title, unit, cur, ref, year, digits) {
    box.innerHTML = "";
    const W = 340, H = 200, L = 40, R = 46, T = 10, B = 24, n = C.SEASON_DAYS, pw = W - L - R, ph = H - T - B;
    const vals = cur.filter(Number.isFinite).concat((ref ? ref.max : []).filter(Number.isFinite));
    const vmax = Math.max(1, ...vals), step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => vmax / s <= 4) || 2000, top = Math.ceil(vmax / step) * step;
    const x = (k) => L + (k / (n - 1)) * pw, y = (v) => T + ph - (v / top) * ph;
    const head = el("div", "pf-cl-chart-head"); head.append(el("strong", "", title), el("span", "pf-cl-unit", unit)); box.appendChild(head);
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "pf-cl-svg", role: "img", "aria-label": title });
    for (let v = 0; v <= top + 1e-9; v += step) { root.appendChild(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "pf-cl-grid" })); root.appendChild(svg("text", { x: L - 6, y: y(v) + 3.5, class: "pf-cl-tick", "text-anchor": "end", "data-no-i18n": "" }, fr(v, 0))); }
    [[4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1]].forEach((md) => { const k = C.doy(year, md[0], md[1]) - C.doy(year, 4, 1); root.appendChild(svg("text", { x: x(k) + 2, y: H - 7, class: "pf-cl-tick", "data-no-i18n": "" }, months()[md[0] - 1])); root.appendChild(svg("line", { x1: x(k), x2: x(k), y1: T + ph, y2: T + ph + 4, class: "pf-cl-grid" })); });
    const path = (arr) => { let d = "", pen = false; for (let k = 0; k < n; k++) { if (!Number.isFinite(arr[k])) { pen = false; continue; } d += `${pen ? "L" : "M"}${x(k).toFixed(1)},${y(arr[k]).toFixed(1)}`; pen = true; } return d; };
    let lastRef = -1;
    if (ref) {
      let up = "", down = ""; for (let k = 0; k < n; k++) if (Number.isFinite(ref.max[k])) { up += `${up ? "L" : "M"}${x(k).toFixed(1)},${y(ref.max[k]).toFixed(1)}`; down = `L${x(k).toFixed(1)},${y(ref.min[k]).toFixed(1)}` + down; lastRef = k; }
      if (up) root.appendChild(svg("path", { d: up + down + "Z", class: "pf-cl-band" }));
      root.appendChild(svg("path", { d: path(ref.mean), class: "pf-cl-ref" }));
    }
    root.appendChild(svg("path", { d: path(cur), class: "pf-cl-cur" }));
    let lastCur = -1; for (let k = n - 1; k >= 0; k--) if (Number.isFinite(cur[k])) { lastCur = k; break; }
    // étiquettes directes au bout des courbes (écartées l'une de l'autre si elles se touchent)
    const yc = lastCur >= 0 ? y(cur[lastCur]) : null; let yr = lastRef >= 0 ? y(ref.mean[lastRef]) : null;
    if (lastCur >= 0) { root.appendChild(svg("circle", { cx: x(lastCur), cy: yc, r: 3.5, class: "pf-cl-dot" })); root.appendChild(svg("text", { x: Math.min(W - 2, x(lastCur) + 7), y: yc + 3.5, class: "pf-cl-lab pf-cl-lab-cur", "data-no-i18n": "" }, String(year))); }
    if (lastRef >= 0) { if (yc !== null && lastCur > n - 40 && Math.abs(yr - yc) < 11) yr = yc + (yr >= yc ? 11 : -11); root.appendChild(svg("text", { x: W - R + 5, y: yr + 3.5, class: "pf-cl-lab" }, "moy.")); }
    // survol : repère vertical et valeurs du jour
    const cross = svg("line", { y1: T, y2: T + ph, class: "pf-cl-cross", visibility: "hidden" }), tip = el("div", "pf-cl-tip"); tip.hidden = true;
    root.appendChild(cross);
    const hit = svg("rect", { x: L, y: T, width: pw, height: ph, fill: "transparent" }); root.appendChild(hit);
    const move = (e) => {
      const r = root.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W, k = Math.max(0, Math.min(n - 1, Math.round(((px - L) / pw) * (n - 1))));
      cross.setAttribute("x1", x(k)); cross.setAttribute("x2", x(k)); cross.setAttribute("visibility", "visible");
      tip.hidden = false; tip.innerHTML = "";
      const dl = el("strong", "", dayLabel(C.dateOf(year, C.doy(year, 4, 1) + k))); dl.setAttribute("data-no-i18n", ""); tip.append(dl);
      const row = (cls, name, v, raw) => { const d = el("div", "pf-cl-tip-row"); const sw = el("i", cls); const nm = el("span", "", name); if (raw) nm.setAttribute("data-no-i18n", ""); const val = el("b", "", Number.isFinite(v) ? `${fr(v, digits)} ${unit}` : "–"); val.setAttribute("data-no-i18n", ""); d.append(sw, nm, val); tip.appendChild(d); };
      row("pf-cl-sw-cur", String(year), cur[k], true);
      if (ref) { row("pf-cl-sw-ref", "Moyenne", ref.mean[k]); const d = el("div", "pf-cl-tip-row"); const sw = el("i", "pf-cl-sw-band"); const val = el("b", "", Number.isFinite(ref.min[k]) ? `${fr(ref.min[k], digits)} – ${fr(ref.max[k], digits)}` : "–"); val.setAttribute("data-no-i18n", ""); d.append(sw, el("span", "", "Étendue"), val); tip.appendChild(d); }
      const left = ((x(k) / W) * r.width); tip.style.left = (left > r.width * 0.6 ? left - 150 : left + 12) + "px";
    };
    hit.addEventListener("mousemove", move); hit.addEventListener("touchstart", (e) => { if (e.touches[0]) move(e.touches[0]); }, { passive: true });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; });
    const wrap = el("div", "pf-cl-plot"); wrap.append(root, tip); box.appendChild(wrap);
  }

  // ---- tuiles et tableau ---------------------------------------------------------------------------------------
  function tile(box, label, value, unit, sub, warn, title) {
    const t = el("div", "pf-cl-tile" + (warn ? " pf-cl-warn" : "")); if (title) t.title = title;
    t.appendChild(el("div", "pf-cl-tile-label", label));
    const v = el("div", "pf-cl-tile-value"); const num = el("span", "", value); num.setAttribute("data-no-i18n", ""); v.appendChild(num); if (unit) v.appendChild(el("small", "", " " + unit)); t.appendChild(v);
    [].concat(sub || []).filter(Boolean).forEach((line) => t.appendChild(el("div", "pf-cl-tile-sub", line)));
    box.appendChild(t);
  }
  const versus = (v, ref, unit) => (Number.isFinite(ref) ? `Moyenne à la même date : ${fr(ref, 0)}${unit ? " " + unit : ""} (${v - ref >= 0 ? "+" : "−"}${fr(Math.abs(v - ref), 0)})` : "");

  function render(cur, ref, refYears) {
    const st = state.station, year = state.year, k = Math.max(0, Math.min(C.SEASON_DAYS - 1, cur.upto - C.doy(year, 4, 1)));
    const info = $("climat-station-info");
    if (info) { info.textContent = ""; info.append(el("span", "", `À ${fr(st.km, 0)} km`), el("span", "", st.elev !== null ? `Altitude ${fr(st.elev, 0)} m` : ""), el("span", "", `Dernière observation : ${dayLabel(cur.lastDate)}`), el("span", "", refYears.length ? `Comparaison : ${refYears.length} années (${refYears[0]}–${refYears[refYears.length - 1]})` : "Comparaison : pas assez d'années à cette station")); }
    const tiles = $("climat-tiles"); tiles.innerHTML = "";
    const at = (o) => (ref && Number.isFinite(o.mean[k]) ? o.mean[k] : NaN), inSeason = cur.upto >= C.doy(year, 4, 1);
    const pWarn = cur.seasonDays > 0 && cur.missP / cur.seasonDays > 0.15, tWarn = cur.seasonDays > 0 && cur.missT / cur.seasonDays > 0.15;
    if (!inSeason) { tile(tiles, "Saison", "–", "", "Les indicateurs se calculent à partir du 1er avril."); }
    else {
      tile(tiles, "Degrés-jours (base 5 °C)", fr(cur.gdd, 0), "", versus(cur.gdd, at(ref ? ref.gdd : {}), ""), tWarn, "Somme, depuis le 1er avril, de la température moyenne du jour moins 5 °C (quand elle est positive)");
      tile(tiles, "Unités thermiques maïs", fr(cur.chu, 0), "UTM", cur.chuStart === null ? "Pas encore commencé : il faut trois jours de suite à 12,8 °C et plus" : [versus(cur.chu, at(ref ? ref.chu : {}), ""), `Début du cumul : ${dayLabel(C.dateOf(year, cur.chuStart))}`], tWarn, "Cumul à partir du lendemain de trois jours consécutifs à 12,8 °C et plus de moyenne, jusqu'au premier gel de −2 °C après le 1er août");
      tile(tiles, "Pluie depuis le 1er avril", fr(cur.precip, 0), "mm", versus(cur.precip, at(ref ? ref.precip : {}), "mm"), pWarn, "Précipitations totales (pluie et neige fondue) du 1er avril à la dernière observation");
      tile(tiles, "Pluie des 30 derniers jours", fr(cur.precip30, 0), "mm", `Dont ${fr(cur.precip7, 0)} mm dans les 7 derniers jours`, pWarn);
      tile(tiles, "Dernier gel du printemps", cur.springFrost !== null ? dayLabel(C.dateOf(year, cur.springFrost)) : "–", "", ref && ref.springFrost !== null ? `Moyenne : ${dayLabel(C.dateOf(year, Math.round(ref.springFrost)))}` : "", false, "Dernier jour à 0 °C ou moins avant le 15 juillet");
      tile(tiles, "Premier gel d'automne", cur.fallFrost !== null ? dayLabel(C.dateOf(year, cur.fallFrost)) : "Pas encore", "", [ref && ref.fallFrost !== null ? `Moyenne : ${dayLabel(C.dateOf(year, Math.round(ref.fallFrost)))}` : "", cur.frostFree !== null ? `Saison sans gel : ${cur.frostFree} jours` : ""], false, "Premier jour à 0 °C ou moins après le 1er août");
      tile(tiles, "Jours à 30 °C et plus", String(cur.hot), "", ref && ref.hot !== null ? `Moyenne sur la saison : ${fr(ref.hot, 0)}` : "");
      tile(tiles, "Jours de pluie (1 mm et plus)", String(cur.rainDays), "", `Sur ${cur.seasonDays} jours depuis le 1er avril`, pWarn);
    }
    chart($("climat-chart-gdd"), "Degrés-jours cumulés", "°C·j", cur.series.gdd, ref ? ref.gdd : null, year, 0);
    chart($("climat-chart-chu"), "Unités thermiques maïs cumulées", "UTM", cur.series.chu, ref ? ref.chu : null, year, 0);
    chart($("climat-chart-precip"), "Précipitations cumulées", "mm", cur.series.precip, ref ? ref.precip : null, year, 0);
    const miss = tWarn || pWarn;
    setNote(miss ? "Données incomplètes à cette station cette année : les cumuls sont sous-estimés. Essayez une autre station." : "", miss);
  }
  function renderStations() {
    const sel = $("climat-station"), box = $("climat-stations"); if (!sel || !box) return;
    sel.innerHTML = ""; box.innerHTML = "";
    state.stations.forEach((s) => {
      const o = el("option", "", `${s.name} · ${fr(s.km, 0)} km`); o.value = s.id; o.setAttribute("data-no-i18n", ""); sel.appendChild(o);
      const row = el("button", "pf-cl-st" + (state.station && state.station.id === s.id ? " pf-on" : "")); row.type = "button";
      const nm = el("strong", "", s.name); nm.setAttribute("data-no-i18n", "");
      row.append(nm, el("span", "", `${fr(s.km, 0)} km`), el("span", "", s.elev !== null ? `${fr(s.elev, 0)} m` : "–"), el("span", "", `Depuis ${s.first.slice(0, 4)}`));
      row.addEventListener("click", () => { state.station = s; fillYears(); renderStations(); load(); });
      box.appendChild(row);
    });
    if (state.station) sel.value = state.station.id;
  }
  function fillYears() {
    const sel = $("climat-year"), now = new Date().getFullYear(); if (!sel || !state.station) return;
    const first = Math.max(parseInt(state.station.first.slice(0, 4), 10) || now, now - 30), keep = state.year;
    sel.innerHTML = ""; for (let y = now; y >= first; y--) { const o = el("option", "", String(y)); o.value = String(y); o.setAttribute("data-no-i18n", ""); sel.appendChild(o); }
    state.year = keep >= first && keep <= now ? keep : now; sel.value = String(state.year);
  }
  async function load() {
    const st = state.station, my = ++state.run; if (!st) return;
    if (state.ctl) state.ctl.abort(); state.ctl = new AbortController(); const signal = state.ctl.signal;
    const body = $("climat-body"); if (body) body.classList.add("pf-cl-loading");
    setNote("Lecture des observations…");
    try {
      const year = state.year, first = parseInt(st.first.slice(0, 4), 10) || year, refYears = []; for (let y = year - 10; y < year; y++) if (y >= first) refYears.push(y);
      const all = await Promise.all([year].concat(refYears).map((y) => loadYear(st, y, signal).catch((e) => { if (signal.aborted) throw e; return null; })));
      if (my !== state.run) return;
      if (!all[0]) throw new Error("Les observations de cette station n'ont pas pu être lues.");
      const cur = C.indicators(year, all[0]);
      if (cur.last < 0) throw new Error("Aucune observation à cette station pour cette année.");
      // les années de comparaison sont arrêtées au même jour pour les cumuls « à la même date », mais leurs séries vont jusqu'au bout
      const okYears = [], refs = []; all.slice(1).forEach((d, i) => { if (!d) return; const r = C.indicators(refYears[i], d); if (r.last >= C.doy(refYears[i], 9, 30) && r.seasonDays && r.missT / r.seasonDays < 0.2) { refs.push(r); okYears.push(refYears[i]); } });
      const ref = refs.length >= 3 ? C.reference(refs) : null;
      if (body) body.hidden = false;
      render(cur, ref, ref ? okYears : []);
    } catch (e) {
      if (signal.aborted || my !== state.run) return;
      setNote((e && e.message) || "Lecture impossible.", true);
    } finally { if (my === state.run && body) body.classList.remove("pf-cl-loading"); }
  }
  async function start() {
    const my = ++state.run, body = $("climat-body"); if (body) body.hidden = true;
    if (state.ctl) state.ctl.abort(); state.ctl = new AbortController();
    setNote("Recherche des stations météo les plus proches…");
    try {
      const list = await findStations(state.ctl.signal);
      if (my !== state.run) return;
      state.stations = list; state.station = list[0] || null;
      if (!list.length) { renderStations(); setNote("Aucune station d'Environnement Canada en activité à moins de 250 km. Le climat n'est offert qu'au Canada pour l'instant.", true); return; }
      fillYears(); renderStations(); load();
    } catch (e) { if (my === state.run && !(state.ctl && state.ctl.signal.aborted)) setNote("Le service météo d'Environnement Canada ne répond pas. Réessayez dans un moment.", true); }
  }
  function close() { state.run++; if (state.ctl) state.ctl.abort(); const m = $("climat-modal"); if (m) m.classList.remove("active"); }
  function bind() {
    if (state.bound) return; state.bound = true;
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    on("btn-climat-close", "click", close);
    on("climat-station", "change", () => { const s = state.stations.find((x) => x.id === $("climat-station").value); if (s) { state.station = s; fillYears(); renderStations(); load(); } });
    on("climat-year", "change", () => { state.year = parseInt($("climat-year").value, 10); load(); });
    const m = $("climat-modal"); if (m) { m.addEventListener("click", (e) => { if (e.target === m) close(); }); m.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }); }
  }
  function open(opts) {
    const m = $("climat-modal"); if (!m || !opts || !Number.isFinite(opts.lng) || !Number.isFinite(opts.lat)) return;
    bind();
    state.lng = opts.lng; state.lat = opts.lat; state.name = String(opts.name || "").slice(0, 80); state.year = new Date().getFullYear();
    const src = $("climat-source"); if (src) src.textContent = state.name || `${fr(state.lat, 3)}° N, ${fr(Math.abs(state.lng), 3)}° O`;
    m.classList.add("active");
    start();
  }
  function centreOf(geom) { let b = null; const scan = (c) => { if (typeof c[0] === "number") b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])] : [c[0], c[1], c[0], c[1]]; else c.forEach(scan); }; scan(geom.coordinates); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null; }
  function openForParcel(feature, name) {
    if (!feature || !feature.geometry) return;
    const c = centreOf(feature.geometry), p = feature.properties || {}, pid = p.IDPAR || p.idpar, lot = p.NO_LOT || p.no_lot;
    if (c) open({ lng: c[0], lat: c[1], name: name || p.nom || p.name || (pid ? `Parcelle nº ${pid}` : lot ? `Lot nº ${lot}` : "") });
  }
  function openAtMapCentre() { const map = window.map; if (!map || typeof map.getCenter !== "function") return; const c = map.getCenter(); open({ lng: c.lng, lat: c.lat, name: "" }); }
  const quick = $("btn-quick-climat"); if (quick) quick.addEventListener("click", openAtMapCentre);
  window.pfClimat = { open, openForParcel, openAtMapCentre, close, core: C, _state: state };
})();
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["climat"] = "017f4811";
