/* ============================================================================
 * Plan de Ferme — Écran partagé (comparaison gauche / droite avec curseur)
 *
 * Même principe que la « Layer Swipe » de GeoLibre : une seule carte à l'écran,
 * coupée par un curseur, chaque côté montrant son propre ensemble de couches.
 * Mise en œuvre : deux copies d'affichage de la carte principale (sans interaction),
 * superposées et découpées de part et d'autre du curseur. La carte principale reste
 * dessous et garde clics, fiches, outils et calculs (NDVI, LiDAR, RUSLE…) ; ses sources
 * et couches sont recopiées en continu dans les deux copies, seule la visibilité diffère.
 * ========================================================================== */
(function () {
  "use strict";
  const esc = window.pfEsc || ((v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]));

  // ---------------------------------------------------------------------------
  // Groupes de couches proposés au choix (par identifiant de couche ou de source)
  // ---------------------------------------------------------------------------
  const LIDAR = ["relief", "ombrage", "pentes", "canopee", "courbes"];
  const GROUP_LABEL = {
    basemap: "Fond de carte", google: "Imagerie Google", relief: "Relief LiDAR (MNE)", ombrage: "Ombrage LiDAR",
    pentes: "Pentes", canopee: "Canopée", courbes: "Courbes de niveau", ndvi: "NDVI Sentinel-2",
    parcelles: "Parcelles", sols: "Sols", drainage: "Drainage", ecoulement: "Écoulement",
    cutfill: "Déblais / remblais", erosion: "Érosion / pluie", cadastre: "Cadastre",
    regional: "Couches régionales", vectors: "Mes données", autres: "Autres couches"
  };
  const ORDER = ["basemap", "google", "relief", "ombrage", "pentes", "canopee", "courbes", "ndvi", "parcelles", "sols", "drainage", "ecoulement", "cutfill", "erosion", "cadastre", "regional", "vectors"];

  function groupOf(layer, sources) {
    const id = layer.id, src = layer.source || "";
    const spec = sources[src] || {};
    const u = String(spec.url || (spec.tiles && spec.tiles[0]) || "");
    if (layer.type === "background" || /openfreemap|naturalearth/i.test(u)) return "basemap";
    if (/^(measure|raster-profile|ndvi-field|vector-draw|.*-hl$|.*highlight|reg-parcel-hl)/.test(id) || /-hit(-layer)?$/.test(id)) return null; // outils : des deux côtés
    if (/google-hybrid/.test(id)) return "google";
    if (/hrdem-topo/.test(id)) return "relief";
    if (/hillshade/.test(id)) return "ombrage";
    if (/pentes/.test(id)) return "pentes";
    if (/canopee/.test(id)) return "canopee";
    if (/contour/.test(id) || /contour/.test(src)) return "courbes";
    if (/sentinel2-ndvi/.test(id)) return "ndvi";
    if (/^parcelles|reg-lyr-(fields|us-csb|fr-rpg)/.test(id)) return "parcelles";
    if (/^pedologie|reg-lyr-.*(sol|bodem|buek|bodeneignung|ssurgo)/.test(id)) return "sols";
    if (/drainage/.test(id)) return "drainage";
    if (/^hydro/.test(id)) return "ecoulement";
    if (/cutfill/.test(id) || /cutfill/.test(src)) return "cutfill";
    if (/rusle|sim-rain|erosion/.test(id) || /rusle|sim-rain/.test(src)) return "erosion";
    if (/cadastre/.test(id)) return "cadastre";
    if (/^wms-layer-/.test(id)) return "wms:" + id.replace(/^wms-layer-/, "");
    if (/^vector-/.test(id)) return "vectors";
    if (/^reg-lyr-/.test(id)) return "regional";
    return "autres";
  }
  function groupLabel(key) {
    if (key.startsWith("wms:")) {
      const id = key.slice(4);
      const reg = window.wmsManager && window.wmsManager.registry && window.wmsManager.registry.get(id);
      return (reg && (reg.name || reg.title || reg.label)) || id.replace(/_/g, " ");
    }
    return GROUP_LABEL[key] || key;
  }

  // ---------------------------------------------------------------------------
  // Copie d'affichage de la carte principale
  // ---------------------------------------------------------------------------
  class Mirror {
    constructor(main, side, host) {
      this.main = main;
      this.side = side;
      this.el = document.createElement("div");
      this.el.className = `pf-split-mirror pf-split-${side}`;
      host.parentNode.insertBefore(this.el, host.nextSibling);
      this.srcSig = {};
      this.layerSig = {};
      this.ready = false;
      const st = this.cleanStyle(main.getStyle());
      this.map = new maplibregl.Map({
        container: this.el, style: st, interactive: false, attributionControl: false,
        center: main.getCenter(), zoom: main.getZoom(), bearing: main.getBearing(), pitch: main.getPitch(),
        fadeDuration: 0, maxPitch: 85
      });
      // « style.load » et non « load » : « load » attend toutes les sources, et une source
      // lente ou en erreur le bloquerait
      const onReady = () => { if (this.ready) return; this.ready = true; this.remember(this.cleanStyle(st)); split.schedule(0); };
      this.map.once("style.load", onReady);
      this.map.once("load", onReady);
    }
    cleanStyle(st) {
      const out = Object.assign({}, st, { sources: {}, layers: [] });
      Object.entries(st.sources || {}).forEach(([id, s]) => { if (s.type !== "canvas") out.sources[id] = s; });
      out.layers = (st.layers || []).filter((l) => !l.source || out.sources[l.source]);
      if (out.terrain && !out.sources[out.terrain.source]) delete out.terrain;
      return out;
    }
    sourceSig(id, spec) {
      if (spec.type === "geojson") { const s = this.main.getSource(id); return s && s._data !== undefined ? s._data : spec.data; }
      if (spec.type === "image") return `${spec.url}|${JSON.stringify(spec.coordinates)}`;
      return JSON.stringify(spec);
    }
    layerSigOf(l) { return JSON.stringify([l.paint, Object.assign({}, l.layout, { visibility: undefined }), l.filter, l.minzoom, l.maxzoom]); }
    remember(st) {
      Object.entries(st.sources).forEach(([id, s]) => { this.srcSig[id] = this.sourceSig(id, s); });
      st.layers.forEach((l) => { this.layerSig[l.id] = this.layerSigOf(l); });
    }
    sync(st, visibleFor) {
      if (!this.ready) return;
      const m = this.map;
      st = this.cleanStyle(st);
      // 1. Couches disparues, puis sources disparues
      const keep = new Set(st.layers.map((l) => l.id));
      m.getStyle().layers.forEach((l) => { if (!keep.has(l.id)) { m.removeLayer(l.id); delete this.layerSig[l.id]; } });
      Object.keys(m.getStyle().sources).forEach((id) => {
        if (!st.sources[id]) { m.getStyle().layers.filter((l) => l.source === id).forEach((l) => m.removeLayer(l.id)); m.removeSource(id); delete this.srcSig[id]; }
      });
      // 2. Sources nouvelles ou modifiées
      Object.entries(st.sources).forEach(([id, spec]) => {
        const sig = this.sourceSig(id, spec);
        if (!m.getSource(id)) { m.addSource(id, spec); this.srcSig[id] = sig; return; }
        if (this.srcSig[id] === sig) return;
        try {
          if (spec.type === "geojson") m.getSource(id).setData(spec.data);
          else if (spec.type === "image") m.getSource(id).updateImage({ url: spec.url, coordinates: spec.coordinates });
          else {
            const users = m.getStyle().layers.filter((l) => l.source === id);
            users.forEach((l) => { m.removeLayer(l.id); delete this.layerSig[l.id]; });
            m.removeSource(id);
            m.addSource(id, spec);
          }
        } catch (e) { console.warn("[split] source", id, e && e.message); }
        this.srcSig[id] = sig;
      });
      // 3. Couches : ajout dans l'ordre, propriétés, visibilité propre au côté
      for (let i = st.layers.length - 1; i >= 0; i--) {
        const l = st.layers[i];
        const before = i + 1 < st.layers.length ? st.layers[i + 1].id : undefined;
        const want = visibleFor(l) ? "visible" : "none";
        if (!m.getLayer(l.id)) {
          const spec = Object.assign({}, l, { layout: Object.assign({}, l.layout, { visibility: want }) });
          try { m.addLayer(spec, before && m.getLayer(before) ? before : undefined); } catch (e) { console.warn("[split] couche", l.id, e && e.message); continue; }
          this.layerSig[l.id] = this.layerSigOf(l);
          continue;
        }
        const sig = this.layerSigOf(l);
        if (this.layerSig[l.id] !== sig) {
          Object.entries(l.paint || {}).forEach(([k, v]) => { try { m.setPaintProperty(l.id, k, v); } catch (e) { /* propriété non modifiable */ } });
          Object.entries(l.layout || {}).forEach(([k, v]) => { if (k !== "visibility") { try { m.setLayoutProperty(l.id, k, v); } catch (e) { /* idem */ } } });
          try { m.setFilter(l.id, l.filter || null); m.setLayerZoomRange(l.id, l.minzoom || 0, l.maxzoom || 24); } catch (e) { /* idem */ }
          this.layerSig[l.id] = sig;
        }
        if (m.getLayoutProperty(l.id, "visibility") !== want) m.setLayoutProperty(l.id, "visibility", want);
      }
      // 4. Ordre des couches
      const cur = m.getStyle().layers.map((l) => l.id);
      const target = st.layers.map((l) => l.id).filter((id) => m.getLayer(id));
      if (cur.join("|") !== target.join("|")) {
        for (let i = target.length - 2; i >= 0; i--) { try { m.moveLayer(target[i], target[i + 1]); } catch (e) { /* ignoré */ } }
      }
      // 5. Relief 3D
      const t = st.terrain || null;
      const mt = m.getTerrain ? m.getTerrain() : null;
      if (JSON.stringify(t) !== JSON.stringify(mt)) { try { m.setTerrain(t); } catch (e) { /* ignoré */ } }
    }
    camera() {
      const c = this.main;
      this.map.jumpTo({ center: c.getCenter(), zoom: c.getZoom(), bearing: c.getBearing(), pitch: c.getPitch() });
    }
    resize() { this.map.resize(); }
    destroy() { try { this.map.remove(); } catch (e) { /* déjà retirée */ } this.el.remove(); }
  }

  // ---------------------------------------------------------------------------
  // Contrôleur
  // ---------------------------------------------------------------------------
  const split = {
    active: false, pos: 50, sides: { left: {}, right: {} }, mirrors: [], timer: null, groups: [],
    get map() { return window.map; },

    toggle() { this.active ? this.stop() : this.start(); },

    start() {
      const map = this.map;
      if (!map || this.active || typeof maplibregl === "undefined") return;
      this.active = true;
      document.body.classList.add("pf-split-on");
      const canvas = map.getCanvas();
      this.left = new Mirror(map, "left", canvas);
      this.right = new Mirror(map, "right", this.left.el);
      this.mirrors = [this.left, this.right];
      this.buildUi();
      this.onMove = () => this.mirrors.forEach((m) => m.camera());
      this.onData = (e) => { if (!e || !e.tile) this.schedule(); };
      this.onResize = () => { this.mirrors.forEach((m) => m.resize()); this.applyPos(); };
      map.on("move", this.onMove);
      map.on("data", this.onData);
      map.on("styledata", this.onData);
      map.on("resize", this.onResize);
      // Préréglage automatique : LiDAR à gauche, NDVI à droite quand les deux sont affichés
      const g = this.currentGroups();
      if (g.includes("ndvi") && g.some((k) => LIDAR.includes(k))) this.preset("lidar-ndvi", false);
      this.applyPos();
      this.schedule(0);
      const b = document.getElementById("pf-split-entry");
      if (b) b.classList.add("pf-on");
    },

    stop() {
      const map = this.map;
      if (!this.active) return;
      this.active = false;
      document.body.classList.remove("pf-split-on");
      map.off("move", this.onMove);
      map.off("data", this.onData);
      map.off("styledata", this.onData);
      map.off("resize", this.onResize);
      this.mirrors.forEach((m) => m.destroy());
      this.mirrors = [];
      ["pf-split-handle", "pf-split-panel", "pf-split-tag-left", "pf-split-tag-right"].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
      const b = document.getElementById("pf-split-entry");
      if (b) b.classList.remove("pf-on");
    },

    // Au plus une synchronisation toutes les 150 ms : un délai réinitialisé à chaque événement
    // ne s'exécuterait jamais pendant le chargement continu des tuiles
    schedule(ms = 150) {
      if (this.timer && ms > 0) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; this.sync(); }, ms);
    },

    // Groupes ayant au moins une couche visible sur la carte principale
    currentGroups() {
      const st = this.map.getStyle();
      const set = new Set();
      st.layers.forEach((l) => {
        if (l.layout && l.layout.visibility === "none") return;
        const g = groupOf(l, st.sources);
        if (g) set.add(g);
      });
      return [...set].sort((a, b) => {
        const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
        return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.localeCompare(b);
      });
    },

    sideShows(side, g) { const v = this.sides[side][g]; return v === undefined ? true : v; },

    sync() {
      if (!this.active) return;
      const st = this.map.getStyle();
      this.mirrors.forEach((mr) => {
        mr.sync(st, (l) => {
          if (l.layout && l.layout.visibility === "none") return false;
          const g = groupOf(l, st.sources);
          return g === null ? true : this.sideShows(mr.side, g);
        });
      });
      this.renderList();
    },

    preset(name, resync = true) {
      const groups = this.currentGroups();
      this.sides = { left: {}, right: {} };
      if (name === "lidar-ndvi") {
        groups.forEach((g) => {
          this.sides.left[g] = g !== "ndvi";
          this.sides.right[g] = !LIDAR.includes(g);
        });
      } else if (name === "swap") {
        // (géré par swap())
      }
      if (resync) this.schedule(0);
      this.renderList(true);
    },

    swap() {
      const l = this.sides.left;
      this.sides.left = this.sides.right;
      this.sides.right = l;
      this.schedule(0);
      this.renderList(true);
    },

    // ------------------------------------------------------------------ interface
    buildUi() {
      const map = this.map;
      const container = map.getContainer();
      const handle = document.createElement("div");
      handle.id = "pf-split-handle";
      handle.className = "pf-split-handle";
      handle.setAttribute("role", "slider");
      handle.setAttribute("aria-label", "Position du curseur de comparaison");
      handle.setAttribute("aria-valuemin", "0");
      handle.setAttribute("aria-valuemax", "100");
      handle.tabIndex = 0;
      handle.innerHTML = `<div class="pf-split-knob"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 3 12 9 18"></polyline><polyline points="15 6 21 12 15 18"></polyline></svg></div>`;
      container.appendChild(handle);
      const drag = (ev) => {
        const r = container.getBoundingClientRect();
        const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        this.pos = Math.max(2, Math.min(98, (x / r.width) * 100));
        this.applyPos();
      };
      handle.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        handle.setPointerCapture(ev.pointerId);
        handle.classList.add("pf-dragging");
        const mv = (e) => drag(e);
        const up = () => { handle.classList.remove("pf-dragging"); handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); };
        handle.addEventListener("pointermove", mv);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });
      handle.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") { this.pos = Math.max(2, this.pos - 2); this.applyPos(); e.preventDefault(); }
        if (e.key === "ArrowRight") { this.pos = Math.min(98, this.pos + 2); this.applyPos(); e.preventDefault(); }
      });

      ["left", "right"].forEach((side) => {
        const tag = document.createElement("div");
        tag.id = `pf-split-tag-${side}`;
        tag.className = `pf-split-tag pf-split-tag-${side}`;
        container.appendChild(tag);
      });

      const panel = document.createElement("div");
      panel.id = "pf-split-panel";
      panel.className = "pf-split-panel";
      panel.innerHTML = `
        <div class="pf-split-head">
          <div class="pf-split-title">Écran partagé</div>
          <button type="button" class="pf-split-collapse" aria-label="Replier" title="Replier">▾</button>
          <button type="button" class="pf-split-close" aria-label="Quitter l'écran partagé" title="Quitter">&times;</button>
        </div>
        <div class="pf-split-body">
          <div class="pf-split-presets">
            <button type="button" data-split="lidar-ndvi">LiDAR ◂▸ NDVI</button>
            <button type="button" data-split="all">Tout des deux côtés</button>
            <button type="button" data-split="swap" title="Inverser gauche et droite">⇄</button>
          </div>
          <div class="pf-split-cols"><span></span><span>Gauche</span><span>Droite</span></div>
          <div class="pf-split-list"></div>
          <p class="pf-split-hint">Activez d'abord les couches à comparer (Couches, NDVI…) : elles apparaissent ici. Glissez la poignée pour comparer.</p>
        </div>`;
      container.appendChild(panel);
      panel.querySelector(".pf-split-close").addEventListener("click", () => this.stop());
      panel.querySelector(".pf-split-collapse").addEventListener("click", () => panel.classList.toggle("pf-collapsed"));
      panel.querySelectorAll("[data-split]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.split;
        if (k === "swap") this.swap();
        else this.preset(k === "all" ? "all" : k);
      }));
      ["mousedown", "touchstart", "wheel", "dblclick", "click"].forEach((ev) => panel.addEventListener(ev, (e) => e.stopPropagation()));
      this.renderList(true);
    },

    renderList(force) {
      const list = document.querySelector("#pf-split-panel .pf-split-list");
      if (!list) return;
      const groups = this.currentGroups();
      const key = groups.join("|") + "#" + JSON.stringify(this.sides);
      if (!force && key === this._listKey) { this.renderTags(groups); return; }
      this._listKey = key;
      list.innerHTML = groups.length ? groups.map((g) => `
        <div class="pf-split-row">
          <span class="pf-split-name">${esc(groupLabel(g))}</span>
          <label><input type="checkbox" data-side="left" data-g="${esc(g)}" ${this.sideShows("left", g) ? "checked" : ""} aria-label="${esc(groupLabel(g))} à gauche" /></label>
          <label><input type="checkbox" data-side="right" data-g="${esc(g)}" ${this.sideShows("right", g) ? "checked" : ""} aria-label="${esc(groupLabel(g))} à droite" /></label>
        </div>`).join("") : `<div class="pf-split-empty">Aucune couche affichée.</div>`;
      list.querySelectorAll("input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
        this.sides[cb.dataset.side][cb.dataset.g] = cb.checked;
        this._listKey = null;
        this.schedule(0);
      }));
      this.renderTags(groups);
    },

    renderTags(groups) {
      ["left", "right"].forEach((side) => {
        const tag = document.getElementById(`pf-split-tag-${side}`);
        if (!tag) return;
        const shown = (groups || this.currentGroups()).filter((g) => g !== "basemap" && this.sideShows(side, g)).map(groupLabel);
        tag.textContent = shown.length ? shown.slice(0, 3).join(" · ") + (shown.length > 3 ? ` +${shown.length - 3}` : "") : "Fond de carte seul";
      });
    },

    applyPos() {
      const p = this.pos;
      if (this.left) this.left.el.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
      if (this.right) this.right.el.style.clipPath = `inset(0 0 0 ${p}%)`;
      const h = document.getElementById("pf-split-handle");
      if (h) { h.style.left = `${p}%`; h.setAttribute("aria-valuenow", String(Math.round(p))); }
      const tl = document.getElementById("pf-split-tag-left"), tr = document.getElementById("pf-split-tag-right");
      if (tl) tl.style.right = `calc(${100 - p}% + 14px)`;
      if (tr) tr.style.left = `calc(${p}% + 14px)`;
    }
  };

  window.pfSplit = split;

  // Boutons d'entrée (panneau Analyses et boîte à outils mobile)
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("#pf-split-entry, #mobile-tool-split");
    if (!b) return;
    e.preventDefault();
    if (b.id === "mobile-tool-split") {
      const close = document.getElementById("mobile-tools-close");
      if (close) close.click();
    }
    split.toggle();
  });
})();
