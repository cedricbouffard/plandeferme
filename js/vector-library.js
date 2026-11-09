/**
 * Plan de Ferme — Bibliothèque de couches personnelles
 *
 * Étend VectorManager (js/vectors.js) sans en changer l'API :
 *  1. Sauvegarde locale dans IndexedDB (côté client uniquement, propre à l'origine du site)
 *  2. Arborescence de dossiers et sous-dossiers (glisser-déposer ou « Déplacer vers… »)
 *  3. Sauvegarde complète (.zip : GeoJSON par dossier + manifeste) et restauration
 *  4. Export Shapefile (.zip : .shp/.shx/.dbf/.prj/.cpg) par couche, par dossier ou global
 *  5. « Tout supprimer » avec fenêtre de confirmation
 */
(function () {
  "use strict";

  const VM = window.VectorManager;
  if (!VM) return;
  const P = VM.prototype;

  const esc = window.pfEsc || ((v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]));
  const safeColor = window.pfSafeColor || ((v, f = "#16a34a") => (/^#[0-9a-f]{3,8}$/i.test(String(v || "")) ? v : f));

  const PALETTE = ["#16a34a", "#0284c7", "#ea580c", "#9333ea", "#e11d48", "#d97706", "#0d9488", "#475569"];
  const SETTING_KEY = "pf-vec-save";
  const MANIFEST = "plandeferme-couches.json";

  const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const isSaveEnabled = () => { try { return localStorage.getItem(SETTING_KEY) !== "0"; } catch (e) { return true; } };
  const setSaveEnabled = (on) => { try { localStorage.setItem(SETTING_KEY, on ? "1" : "0"); } catch (e) { /* stockage bloqué */ } };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  /** Nom de fichier sûr (dossiers du zip, .shp, .geojson) */
  function safeFileName(name, fallback = "couche") {
    const s = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9 _.-]+/g, "_").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^[._]+|[._]+$/g, "");
    return (s || fallback).slice(0, 60);
  }

  function downloadBlobFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function sanitizeStyle(style) {
    const s = Object.assign({}, style || {});
    ["fillColor", "strokeColor"].forEach((k) => { if (s[k] !== undefined) s[k] = safeColor(s[k]); });
    ["fillOpacity", "strokeWidth", "markerSize"].forEach((k) => {
      if (s[k] !== undefined) { const n = Number(s[k]); s[k] = Number.isFinite(n) ? n : undefined; }
    });
    return s;
  }

  // ===========================================================================
  // 1. STOCKAGE INDEXEDDB
  // ===========================================================================
  const STORES = ["folders", "layers", "layerData"];
  const Store = {
    dbp: null,
    open() {
      if (this.dbp) return this.dbp;
      this.dbp = new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) return reject(new Error("IndexedDB indisponible"));
        let req;
        try { req = indexedDB.open("plandeferme", 1); } catch (e) { return reject(e); }
        req.onupgradeneeded = () => {
          const db = req.result;
          STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" }); });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("Base locale bloquée par un autre onglet"));
      });
      this.dbp.catch(() => { this.dbp = null; });
      return this.dbp;
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES, mode);
        let out;
        try { out = fn(tx); } catch (e) { try { tx.abort(); } catch (_) { /* déjà terminée */ } return reject(e); }
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Transaction annulée"));
      });
    },
    async getAll(store) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
    },
    clearAll() {
      return this.run("readwrite", (tx) => STORES.forEach((s) => tx.objectStore(s).clear()));
    }
  };

  P.markDirty = function (layer) {
    if (!layer) return;
    if (!this._dirty) this._dirty = new Set();
    this._dirty.add(layer.id);
    this.scheduleSave();
  };

  P.saveLayers = function () { this.scheduleSave(); };

  P.scheduleSave = function () {
    if (this._restoring) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.persistNow(), 600);
  };

  P.persistNow = async function () {
    if (!isSaveEnabled() || !this._storeReady) return;
    const dirty = this._dirty || new Set();
    this._dirty = new Set();
    const layers = this.layers.slice();
    const folders = (this.folders || []).slice();
    const layerIds = new Set(layers.map((l) => l.id));
    const folderIds = new Set(folders.map((f) => f.id));
    const prevL = this._persistedLayerIds || new Set();
    const prevF = this._persistedFolderIds || new Set();

    try {
      await Store.run("readwrite", (tx) => {
        const fs = tx.objectStore("folders"), ls = tx.objectStore("layers"), ds = tx.objectStore("layerData");
        folders.forEach((f, i) => fs.put({ id: f.id, name: f.name, parentId: f.parentId || null, collapsed: !!f.collapsed, order: i }));
        prevF.forEach((id) => { if (!folderIds.has(id)) fs.delete(id); });
        layers.forEach((l, i) => ls.put({
          id: l.id, name: l.name, geometryType: l.geometryType, visible: !!l.visible,
          style: JSON.parse(JSON.stringify(l.style || {})), fields: JSON.parse(JSON.stringify(l.fields || [])),
          folderId: l.folderId || null, order: i, updatedAt: Date.now()
        }));
        prevL.forEach((id) => { if (!layerIds.has(id)) { ls.delete(id); ds.delete(id); } });
        layers.forEach((l) => {
          if (!dirty.has(l.id) && prevL.has(l.id)) return;
          try {
            ds.put({ id: l.id, data: l.data });
          } catch (e) {
            // Objets non clonables (entités issues de lecteurs binaires) : copie JSON
            ds.put({ id: l.id, data: JSON.parse(JSON.stringify(l.data)) });
          }
        });
      });
      this._persistedLayerIds = layerIds;
      this._persistedFolderIds = folderIds;
      if (layers.length && !this._persistRequested && navigator.storage && navigator.storage.persist) {
        this._persistRequested = true;
        navigator.storage.persist().catch(() => {});
      }
      this.updateStorageStatus();
    } catch (err) {
      dirty.forEach((id) => this._dirty.add(id));
      console.warn("[Couches] Sauvegarde locale impossible :", err);
      const quota = err && (err.name === "QuotaExceededError" || /quota/i.test(err.message || ""));
      this.showToast(quota
        ? "Espace de stockage insuffisant : téléchargez une sauvegarde et supprimez des couches."
        : "Sauvegarde locale impossible sur ce navigateur.", true);
      this.updateStorageStatus();
    }
  };

  P.restoreFromStore = async function () {
    this.folders = this.folders || [];
    if (!isSaveEnabled()) {
      this._storeReady = false;
      this.updateStorageStatus();
      return;
    }
    try {
      const [folders, metas, datas] = await Promise.all([Store.getAll("folders"), Store.getAll("layers"), Store.getAll("layerData")]);
      const dataById = new Map(datas.map((d) => [d.id, d.data]));
      folders.sort((a, b) => (a.order || 0) - (b.order || 0));
      metas.sort((a, b) => (a.order || 0) - (b.order || 0));

      const knownFolders = new Set(this.folders.map((f) => f.id));
      folders.forEach((f) => {
        if (!knownFolders.has(f.id)) this.folders.push({ id: f.id, name: String(f.name || "Dossier"), parentId: f.parentId || null, collapsed: !!f.collapsed });
      });

      const knownLayers = new Set(this.layers.map((l) => l.id));
      const restored = [];
      this._restoring = true;
      metas.forEach((m) => {
        if (knownLayers.has(m.id)) return;
        const data = dataById.get(m.id);
        const layer = {
          id: m.id,
          name: String(m.name || "Couche"),
          geometryType: m.geometryType || "Polygon",
          visible: m.visible !== false,
          data: data && Array.isArray(data.features) ? data : { type: "FeatureCollection", features: [] },
          style: sanitizeStyle(m.style),
          fields: Array.isArray(m.fields) ? m.fields : [],
          folderId: m.folderId || null
        };
        this.layers.push(layer);
        restored.push(layer);
        this.syncLayerToMap(layer);
        if (!layer.visible) this.setLayerVisibility(layer.id, false);
      });
      this._restoring = false;

      this._persistedLayerIds = new Set(metas.map((m) => m.id));
      this._persistedFolderIds = new Set(folders.map((f) => f.id));
      this._storeReady = true;

      if (restored.length) {
        this.bringToFront();
        this.showToast(`${plural(restored.length, "couche personnelle restaurée", "couches personnelles restaurées")} depuis cet appareil.`);
      }
      this.renderLayersList();
      this.scheduleSave(); // couches créées pendant le chargement
    } catch (err) {
      this._restoring = false;
      this._storeReady = false;
      console.warn("[Couches] Stockage local indisponible :", err);
      this.updateStorageStatus("Stockage local indisponible sur ce navigateur (navigation privée ?).");
      this.renderInlineLayersList();
    }
  };

  P.updateStorageStatus = function (forcedText) {
    const el = document.getElementById("pf-lib-storage-status");
    const toggle = document.getElementById("pf-lib-save-toggle");
    if (toggle) toggle.checked = isSaveEnabled();
    if (!el) return;
    if (forcedText) { el.textContent = forcedText; return; }
    if (!isSaveEnabled()) {
      el.textContent = "Non conservé : les couches disparaissent à la fermeture de la page.";
      return;
    }
    const n = this.layers.length;
    const base = n ? `${plural(n, "couche enregistrée", "couches enregistrées")} sur cet appareil` : "Vos couches seront enregistrées sur cet appareil.";
    el.textContent = base;
    if (n && navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((est) => {
        if (!est || !Number.isFinite(est.usage)) return;
        const mo = est.usage / (1024 * 1024);
        el.textContent = `${base} · ${mo < 0.1 ? "< 0,1" : mo.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} Mo utilisés par le site`;
      }).catch(() => {});
    }
  };

  // ===========================================================================
  // 2. CYCLE DE VIE : branchement sur VectorManager
  // ===========================================================================
  const origInit = P.init;
  P.init = function (mapInstance) {
    this.folders = this.folders || [];
    this.activeFolderId = null;
    origInit.call(this, mapInstance);
    this.bindLibraryUi();
    this.restoreFromStore();
  };

  const origSync = P.syncLayerToMap;
  P.syncLayerToMap = function (layer) {
    if (layer && layer.folderId === undefined) {
      // Nouvelle couche (dessin ou import) : elle va dans le dossier sélectionné
      layer.folderId = this.activeFolderId && this.getFolder(this.activeFolderId) ? this.activeFolderId : null;
    }
    const out = origSync.apply(this, arguments);
    if (layer && !this._restoring) this.markDirty(layer);
    return out;
  };

  const origDelete = P.deleteLayer;
  P.deleteLayer = function (layerId) {
    const out = origDelete.apply(this, arguments);
    this.scheduleSave();
    return out;
  };

  // ===========================================================================
  // 3. DOSSIERS
  // ===========================================================================
  P.getFolder = function (id) { return (this.folders || []).find((f) => f.id === id) || null; };

  P.folderDescendants = function (folderId) {
    const out = new Set();
    const walk = (id) => (this.folders || []).forEach((f) => { if (f.parentId === id && !out.has(f.id)) { out.add(f.id); walk(f.id); } });
    walk(folderId);
    return out;
  };

  P.folderPath = function (folderId) {
    const parts = [];
    let f = this.getFolder(folderId);
    let guard = 0;
    while (f && guard++ < 50) { parts.unshift(f.name); f = this.getFolder(f.parentId); }
    return parts;
  };

  P.layersInFolderTree = function (folderId) {
    const ids = this.folderDescendants(folderId);
    ids.add(folderId);
    return this.layers.filter((l) => ids.has(l.folderId || null));
  };

  P.createFolder = function (parentId = null, name) {
    const label = name || prompt("Nom du dossier :", parentId ? "Sous-dossier" : "Nouveau dossier");
    if (!label || !label.trim()) return null;
    const folder = { id: uid("dir"), name: label.trim().slice(0, 120), parentId: parentId || null, collapsed: false };
    this.folders.push(folder);
    if (parentId) { const p = this.getFolder(parentId); if (p) p.collapsed = false; }
    this.activeFolderId = folder.id;
    this.renderInlineLayersList();
    return folder;
  };

  P.renameFolder = function (folderId) {
    const f = this.getFolder(folderId);
    if (!f) return;
    const val = prompt("Nouveau nom du dossier :", f.name);
    if (val && val.trim() && val.trim() !== f.name) {
      f.name = val.trim().slice(0, 120);
      this.renderInlineLayersList();
    }
  };

  P.moveLayerTo = function (layerId, folderId) {
    const layer = this.getLayer(layerId);
    if (!layer) return;
    layer.folderId = folderId || null;
    if (folderId) { const f = this.getFolder(folderId); if (f) f.collapsed = false; }
    this.renderInlineLayersList();
  };

  P.moveFolderTo = function (folderId, parentId) {
    const f = this.getFolder(folderId);
    if (!f || folderId === parentId) return;
    if (parentId && this.folderDescendants(folderId).has(parentId)) {
      this.showToast("Impossible de déplacer un dossier dans l'un de ses sous-dossiers.", true);
      return;
    }
    f.parentId = parentId || null;
    if (parentId) { const p = this.getFolder(parentId); if (p) p.collapsed = false; }
    this.renderInlineLayersList();
  };

  P.setFolderVisibility = function (folderId, visible) {
    this.layersInFolderTree(folderId).forEach((l) => {
      l.visible = visible;
      this.setLayerVisibility(l.id, visible);
    });
    this.renderLayersList();
  };

  P.deleteFolder = async function (folderId) {
    const f = this.getFolder(folderId);
    if (!f) return;
    const sub = this.folderDescendants(folderId);
    const layers = this.layersInFolderTree(folderId);
    const details = [];
    if (sub.size) details.push(plural(sub.size, "sous-dossier", "sous-dossiers"));
    if (layers.length) details.push(plural(layers.length, "couche", "couches"));
    const ok = await this.confirmDialog({
      title: `Supprimer le dossier « ${f.name} » ?`,
      message: details.length
        ? `Le dossier et son contenu (${details.join(" et ")}) seront supprimés définitivement.`
        : "Ce dossier est vide.",
      confirmLabel: "Supprimer le dossier",
      danger: true
    });
    if (!ok) return;
    if (this.isDrawing && layers.some((l) => l.id === this.activeLayerId)) this.cancelDrawing();
    layers.forEach((l) => this.removeLayerFromMap(l.id));
    const layerIds = new Set(layers.map((l) => l.id));
    this.layers = this.layers.filter((l) => !layerIds.has(l.id));
    sub.add(folderId);
    this.folders = this.folders.filter((x) => !sub.has(x.id));
    if (layerIds.has(this.activeLayerId)) this.activeLayerId = null;
    if (sub.has(this.activeFolderId)) this.activeFolderId = null;
    this.renderLayersList();
    this.showToast(`Dossier « ${f.name} » supprimé.`);
  };

  P.deleteAllLayers = async function () {
    const n = this.layers.length, m = (this.folders || []).length;
    if (!n && !m) { this.showToast("Aucune couche personnelle à supprimer."); return; }
    const parts = [];
    if (n) parts.push(plural(n, "couche", "couches"));
    if (m) parts.push(plural(m, "dossier", "dossiers"));
    const ok = await this.confirmDialog({
      title: "Tout supprimer ?",
      message: `Ceci supprimera définitivement ${parts.join(" et ")} de la carte${isSaveEnabled() ? " et de cet appareil" : ""}. Cette action est irréversible : téléchargez une sauvegarde d'abord si vous voulez les conserver.`,
      confirmLabel: "Tout supprimer",
      danger: true,
      extraAction: n ? { label: "Télécharger une sauvegarde", onClick: () => this.downloadBackup() } : null
    });
    if (!ok) return;
    if (this.isDrawing) this.cancelDrawing();
    if (typeof this.clearFeatureSelection === "function") this.clearFeatureSelection();
    this.layers.forEach((l) => this.removeLayerFromMap(l.id));
    this.layers = [];
    this.folders = [];
    this.activeLayerId = null;
    this.activeFolderId = null;
    this._dirty = new Set();
    if (isSaveEnabled()) {
      try {
        await Store.clearAll();
        this._persistedLayerIds = new Set();
        this._persistedFolderIds = new Set();
      } catch (e) { console.warn("[Couches] Effacement local impossible :", e); }
    }
    this.renderLayersList();
    this.showToast("Toutes les couches personnelles ont été supprimées.");
  };

  // ===========================================================================
  // 4. INTERFACE : arborescence, menus, fenêtre de confirmation
  // ===========================================================================
  const ICON = {
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    eyeOff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
    draw: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    zoom: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>',
    more: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="19" cy="12" r="1.7"></circle></svg>',
    chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg>',
    folder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path></svg>'
  };
  const DND_LAYER = "application/x-pf-layer";
  const DND_FOLDER = "application/x-pf-folder";

  P.renderInlineLayersList = function () {
    const container = document.getElementById("panel-vector-layers-list");
    if (!container) return;
    this.folders = this.folders || [];

    // Réparer les références orphelines
    const fids = new Set(this.folders.map((f) => f.id));
    this.folders.forEach((f) => { if (f.parentId && !fids.has(f.parentId)) f.parentId = null; });
    this.layers.forEach((l) => { if (l.folderId && !fids.has(l.folderId)) l.folderId = null; });
    if (this.activeFolderId && !fids.has(this.activeFolderId)) this.activeFolderId = null;

    this.updateTargetChip();
    container.innerHTML = "";
    container.classList.add("pf-lib-tree");
    this.bindRootDrop(container);

    if (!this.layers.length && !this.folders.length) {
      const empty = document.createElement("div");
      empty.className = "pf-lib-empty";
      empty.innerHTML = "Aucune couche personnelle.<br>Dessinez avec <strong>+</strong> ou glissez un fichier sur la carte.";
      container.appendChild(empty);
      this.updateStorageStatus();
      this.scheduleSave();
      return;
    }

    const frag = document.createDocumentFragment();
    const level = (parentId, depth) => {
      this.folders.filter((f) => (f.parentId || null) === parentId).forEach((f) => {
        frag.appendChild(this.buildFolderRow(f, depth));
        if (!f.collapsed) level(f.id, depth + 1);
      });
      this.layers.filter((l) => (l.folderId || null) === parentId).forEach((l) => frag.appendChild(this.buildLayerRow(l, depth)));
    };
    level(null, 0);
    container.appendChild(frag);
    this.updateStorageStatus();
    this.scheduleSave();
  };

  P.buildFolderRow = function (folder, depth) {
    const row = document.createElement("div");
    row.className = "pf-lib-row pf-lib-folder" + (folder.id === this.activeFolderId ? " active" : "");
    row.style.setProperty("--pf-depth", depth);
    row.draggable = true;
    row.dataset.folderId = folder.id;
    const count = this.layersInFolderTree(folder.id).length;
    row.innerHTML = `
      <button type="button" class="pf-lib-chevron${folder.collapsed ? "" : " open"}" aria-label="${folder.collapsed ? "Déplier" : "Replier"} le dossier" aria-expanded="${folder.collapsed ? "false" : "true"}">${ICON.chevron}</button>
      <span class="pf-lib-folder-icon" aria-hidden="true">${ICON.folder}</span>
      <span class="pf-lib-name" title="${esc(folder.name)}">${esc(folder.name)}</span>
      <span class="pf-lib-count">${count}</span>
      <button type="button" class="pf-lib-btn pf-lib-more" aria-label="Actions du dossier ${esc(folder.name)}" title="Actions">${ICON.more}</button>
    `;
    const toggle = () => { folder.collapsed = !folder.collapsed; this.renderInlineLayersList(); };
    row.querySelector(".pf-lib-chevron").addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    row.addEventListener("click", () => {
      // Un clic sélectionne le dossier (cible des nouvelles couches) et le déplie / replie
      if (this.activeFolderId === folder.id) folder.collapsed = !folder.collapsed;
      else { this.activeFolderId = folder.id; folder.collapsed = false; }
      this.renderInlineLayersList();
    });
    row.addEventListener("dblclick", (e) => { e.stopPropagation(); this.renameFolder(folder.id); });
    row.querySelector(".pf-lib-more").addEventListener("click", (e) => {
      e.stopPropagation();
      const anyVisible = this.layersInFolderTree(folder.id).some((l) => l.visible);
      this.openMenu(e.currentTarget, [
        { label: "Nouveau sous-dossier", onClick: () => this.createFolder(folder.id) },
        { label: "Renommer", onClick: () => this.renameFolder(folder.id) },
        { label: "Déplacer vers…", onClick: (anchor) => this.openMoveMenu(anchor, { folderId: folder.id }) , keepOpen: true },
        { label: anyVisible ? "Masquer toutes les couches" : "Afficher toutes les couches", onClick: () => this.setFolderVisibility(folder.id, !anyVisible), disabled: !count },
        { sep: true },
        { label: "Exporter en shapefile (.zip)", onClick: () => this.exportFolderShapefile(folder.id), disabled: !count },
        { sep: true },
        { label: "Supprimer le dossier", danger: true, onClick: () => this.deleteFolder(folder.id) }
      ]);
    });
    this.bindDragSource(row, DND_FOLDER, folder.id);
    this.bindFolderDrop(row, folder.id);
    return row;
  };

  P.buildLayerRow = function (layer, depth) {
    const row = document.createElement("div");
    row.className = "pf-lib-row pf-lib-layer" + (layer.id === this.activeLayerId ? " active" : "");
    row.style.setProperty("--pf-depth", depth);
    row.draggable = true;
    row.dataset.layerId = layer.id;
    const count = layer.data && layer.data.features ? layer.data.features.length : 0;
    const color = safeColor(layer.style && (layer.style.fillColor || layer.style.strokeColor));
    const gt = String(layer.geometryType || "").toLowerCase();
    const shape = gt.includes("line") ? "line" : gt.includes("point") ? "point" : "poly";
    row.innerHTML = `
      <button type="button" class="pf-lib-btn pf-lib-vis${layer.visible ? "" : " muted"}" aria-pressed="${layer.visible ? "true" : "false"}" aria-label="${layer.visible ? "Masquer" : "Afficher"} ${esc(layer.name)}" title="${layer.visible ? "Masquer" : "Afficher"}">${layer.visible ? ICON.eye : ICON.eyeOff}</button>
      <span class="pf-lib-swatch pf-lib-swatch-${shape}" style="--pf-sw:${color}" aria-hidden="true"></span>
      <span class="pf-lib-name" title="${esc(layer.name)}">${esc(layer.name)}</span>
      <span class="pf-lib-count">${count}</span>
      <button type="button" class="pf-lib-btn pf-lib-draw" aria-label="Dessiner dans ${esc(layer.name)}" title="Dessiner une entité">${ICON.draw}</button>
      <button type="button" class="pf-lib-btn pf-lib-zoom" aria-label="Zoomer sur ${esc(layer.name)}" title="Zoomer sur la couche">${ICON.zoom}</button>
      <button type="button" class="pf-lib-btn pf-lib-more" aria-label="Actions de la couche ${esc(layer.name)}" title="Actions">${ICON.more}</button>
    `;
    row.querySelector(".pf-lib-vis").addEventListener("click", (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      this.setLayerVisibility(layer.id, layer.visible);
      this.renderLayersList();
    });
    row.querySelector(".pf-lib-draw").addEventListener("click", (e) => {
      e.stopPropagation();
      this.activeLayerId = layer.id;
      this.startDrawing(layer.id);
    });
    row.querySelector(".pf-lib-zoom").addEventListener("click", (e) => { e.stopPropagation(); this.zoomToLayer(layer.id); });
    row.querySelector(".pf-lib-name").addEventListener("dblclick", (e) => { e.stopPropagation(); this.renameLayer(layer.id); });
    row.querySelector(".pf-lib-more").addEventListener("click", (e) => {
      e.stopPropagation();
      const anchor = e.currentTarget;
      this.openMenu(anchor, [
        { label: "Renommer", onClick: () => this.renameLayer(layer.id) },
        { label: "Déplacer vers…", onClick: (a) => this.openMoveMenu(a, { layerId: layer.id }), keepOpen: true },
        { label: "Style et QML", onClick: () => this.openStyleModal(layer.id) },
        { label: "Table d'attributs", onClick: () => this.openTableModal(layer.id) },
        { label: "Exporter…", onClick: () => this.showExportMenu(layer, anchor) },
        { sep: true },
        { label: "Supprimer la couche", danger: true, onClick: () => this.confirmDeleteLayer(layer.id) }
      ]);
    });
    row.addEventListener("click", () => {
      this.activeLayerId = layer.id;
      document.querySelectorAll("#panel-vector-layers-list .pf-lib-layer.active").forEach((el) => el.classList.remove("active"));
      row.classList.add("active");
    });
    this.bindDragSource(row, DND_LAYER, layer.id);
    return row;
  };

  /** Étiquette « Ajout dans : dossier » (cible des nouveaux dessins et imports) */
  P.updateTargetChip = function () {
    const chip = document.getElementById("pf-lib-target");
    if (!chip) return;
    const f = this.activeFolderId ? this.getFolder(this.activeFolderId) : null;
    chip.hidden = !f;
    if (!f) return;
    chip.querySelector(".pf-lib-target-name").textContent = this.folderPath(f.id).join(" / ");
  };

  P.renameLayer = function (layerId) {
    const layer = this.getLayer(layerId);
    if (!layer) return;
    const val = prompt("Nouveau nom de la couche :", layer.name);
    if (val && val.trim() && val.trim() !== layer.name) {
      layer.name = val.trim().slice(0, 160);
      this.updateLayerOnMap(layer);
      this.renderLayersList();
      this.showToast(`Couche renommée en « ${layer.name} »`);
    }
  };

  P.confirmDeleteLayer = async function (layerId) {
    const layer = this.getLayer(layerId);
    if (!layer) return;
    const ok = await this.confirmDialog({
      title: `Supprimer « ${layer.name} » ?`,
      message: "La couche et ses entités seront supprimées définitivement.",
      confirmLabel: "Supprimer",
      danger: true
    });
    if (ok) this.deleteLayer(layerId);
  };

  // ---- Glisser-déposer interne (couches et dossiers) ----
  P.bindDragSource = function (row, type, id) {
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      e.dataTransfer.setData(type, id);
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      document.querySelectorAll(".pf-lib-drop-target").forEach((el) => el.classList.remove("pf-lib-drop-target"));
    });
  };

  const draggedKind = (e) => {
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    if (types.includes(DND_LAYER)) return DND_LAYER;
    if (types.includes(DND_FOLDER)) return DND_FOLDER;
    return null;
  };

  P.bindFolderDrop = function (row, folderId) {
    row.addEventListener("dragover", (e) => {
      if (!draggedKind(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("pf-lib-drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("pf-lib-drop-target"));
    row.addEventListener("drop", (e) => {
      const kind = draggedKind(e);
      if (!kind) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("pf-lib-drop-target");
      const id = e.dataTransfer.getData(kind);
      if (kind === DND_LAYER) this.moveLayerTo(id, folderId);
      else this.moveFolderTo(id, folderId);
    });
  };

  P.bindRootDrop = function (container) {
    if (container._pfRootDrop) return;
    container._pfRootDrop = true;
    container.addEventListener("dragover", (e) => {
      if (!draggedKind(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    container.addEventListener("drop", (e) => {
      const kind = draggedKind(e);
      if (!kind) return;
      e.preventDefault();
      const id = e.dataTransfer.getData(kind);
      if (kind === DND_LAYER) this.moveLayerTo(id, null);
      else this.moveFolderTo(id, null);
    });
  };

  // ---- Menu contextuel générique ----
  P.closeMenu = function () {
    if (this._menu) { this._menu.remove(); this._menu = null; }
    if (this._menuCleanup) { this._menuCleanup(); this._menuCleanup = null; }
  };

  P.openMenu = function (anchor, items) {
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "pf-lib-menu";
    menu.setAttribute("role", "menu");
    items.forEach((it) => {
      if (it.sep) {
        const s = document.createElement("div");
        s.className = "pf-lib-menu-sep";
        menu.appendChild(s);
        return;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.className = "pf-lib-menu-item" + (it.danger ? " danger" : "") + (it.indent ? " indent-" + Math.min(it.indent, 6) : "");
      b.textContent = it.label;
      if (it.disabled) b.disabled = true;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (it.keepOpen) { it.onClick(anchor); return; }
        this.closeMenu();
        it.onClick(anchor);
      });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this._menu = menu;
    const onDoc = (e) => { if (!menu.contains(e.target)) this.closeMenu(); };
    const onKey = (e) => { if (e.key === "Escape") this.closeMenu(); };
    setTimeout(() => document.addEventListener("click", onDoc), 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onDoc, { once: true });
    this._menuCleanup = () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
    const first = menu.querySelector("button:not([disabled])");
    if (first) first.focus({ preventScroll: true });
  };

  P.openMoveMenu = function (anchor, { layerId, folderId }) {
    const exclude = folderId ? this.folderDescendants(folderId) : new Set();
    if (folderId) exclude.add(folderId);
    const current = layerId ? (this.getLayer(layerId) || {}).folderId || null : (this.getFolder(folderId) || {}).parentId || null;
    const items = [{ label: "Racine (aucun dossier)", disabled: current === null, onClick: () => (layerId ? this.moveLayerTo(layerId, null) : this.moveFolderTo(folderId, null)) }];
    const walk = (parentId, depth) => {
      this.folders.filter((f) => (f.parentId || null) === parentId).forEach((f) => {
        if (exclude.has(f.id)) return;
        items.push({ label: f.name, indent: depth + 1, disabled: f.id === current, onClick: () => (layerId ? this.moveLayerTo(layerId, f.id) : this.moveFolderTo(folderId, f.id)) });
        walk(f.id, depth + 1);
      });
    };
    walk(null, 0);
    if (items.length === 1) items.push({ label: "Aucun dossier : créez-en un d'abord", disabled: true, onClick: () => {} });
    this.openMenu(anchor, items);
  };

  // ---- Fenêtre de confirmation ----
  P.confirmDialog = function ({ title, message, confirmLabel = "Confirmer", cancelLabel = "Annuler", danger = false, extraAction = null }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "vector-modal-overlay active pf-lib-confirm";
      overlay.innerHTML = `
        <div class="vector-modal" role="alertdialog" aria-modal="true" aria-labelledby="pf-lib-confirm-title" aria-describedby="pf-lib-confirm-msg">
          <div class="vector-modal-header">
            <div class="vector-modal-title"><span id="pf-lib-confirm-title"></span></div>
          </div>
          <div class="vector-modal-body">
            <p id="pf-lib-confirm-msg" class="pf-lib-confirm-msg"></p>
            <div class="pf-lib-confirm-actions">
              <button type="button" class="pf-lib-confirm-extra" hidden></button>
              <span class="pf-lib-spacer"></span>
              <button type="button" class="pf-lib-confirm-cancel"></button>
              <button type="button" class="pf-lib-confirm-ok${danger ? " danger" : ""}"></button>
            </div>
          </div>
        </div>`;
      overlay.querySelector("#pf-lib-confirm-title").textContent = title;
      overlay.querySelector("#pf-lib-confirm-msg").textContent = message;
      const okBtn = overlay.querySelector(".pf-lib-confirm-ok");
      const cancelBtn = overlay.querySelector(".pf-lib-confirm-cancel");
      okBtn.textContent = confirmLabel;
      cancelBtn.textContent = cancelLabel;
      const extraBtn = overlay.querySelector(".pf-lib-confirm-extra");
      if (extraAction) {
        extraBtn.hidden = false;
        extraBtn.textContent = extraAction.label;
        extraBtn.addEventListener("click", () => extraAction.onClick());
      }
      const prevFocus = document.activeElement;
      const done = (val) => {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus({ preventScroll: true });
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); done(false); }
        if (e.key === "Tab") {
          const f = Array.from(overlay.querySelectorAll("button:not([hidden])"));
          const i = f.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      };
      okBtn.addEventListener("click", () => done(true));
      cancelBtn.addEventListener("click", () => done(false));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) done(false); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(overlay);
      // Action destructive : le focus va sur « Annuler »
      (danger ? cancelBtn : okBtn).focus();
    });
  };

  // ---- Barre d'outils de la section « Mes données » ----
  P.bindLibraryUi = function () {
    const $ = (id) => document.getElementById(id);
    const newFolder = $("pf-lib-new-folder");
    if (newFolder) newFolder.addEventListener("click", () => this.createFolder(this.activeFolderId || null));
    const backup = $("pf-lib-backup-menu");
    if (backup) {
      backup.addEventListener("click", (e) => {
        e.stopPropagation();
        const has = this.layers.length > 0;
        this.openMenu(e.currentTarget, [
          { label: "Télécharger une sauvegarde (.zip)", onClick: () => this.downloadBackup(), disabled: !has },
          { label: "Restaurer une sauvegarde…", onClick: () => { const i = $("pf-lib-restore-input"); if (i) i.click(); } },
          { sep: true },
          { label: "Tout exporter en shapefile (.zip)", onClick: () => this.exportAllShapefile(), disabled: !has }
        ]);
      });
    }
    const restoreInput = $("pf-lib-restore-input");
    if (restoreInput) {
      restoreInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (file) await this.importVectorFile(file);
      });
    }
    const targetClear = $("pf-lib-target-clear");
    if (targetClear) targetClear.addEventListener("click", () => { this.activeFolderId = null; this.renderInlineLayersList(); });
    const clearAll = $("pf-lib-clear-all");
    if (clearAll) clearAll.addEventListener("click", () => this.deleteAllLayers());
    const toggle = $("pf-lib-save-toggle");
    if (toggle) {
      toggle.checked = isSaveEnabled();
      toggle.addEventListener("change", async () => {
        if (toggle.checked) {
          setSaveEnabled(true);
          this._storeReady = true;
          this._persistedLayerIds = new Set();
          this._persistedFolderIds = new Set();
          this.layers.forEach((l) => this.markDirty(l));
          await this.persistNow();
          this.showToast("Vos couches seront conservées sur cet appareil.");
        } else {
          const ok = await this.confirmDialog({
            title: "Ne plus conserver vos couches ?",
            message: "Les couches enregistrées sur cet appareil seront effacées. Celles affichées restent disponibles jusqu'à la fermeture de la page.",
            confirmLabel: "Effacer et désactiver",
            danger: true
          });
          if (!ok) { toggle.checked = true; return; }
          setSaveEnabled(false);
          this._storeReady = false;
          try { await Store.clearAll(); } catch (e) { /* rien à effacer */ }
          this._persistedLayerIds = new Set();
          this._persistedFolderIds = new Set();
          this.showToast("Sauvegarde locale désactivée et effacée.");
        }
        this.updateStorageStatus();
      });
    }
    this.updateStorageStatus();
  };

  // ===========================================================================
  // 5. CRÉATION DE COUCHES (imports multiples, restauration)
  // ===========================================================================
  P.createLayerFromCollection = function (fc, name, folderId, meta) {
    const features = (fc && Array.isArray(fc.features) ? fc.features : []).filter((f) => f && f.type === "Feature");
    let geomType = (meta && meta.geometryType) || "Polygon";
    if (!meta || !meta.geometryType) {
      const first = features.find((f) => f.geometry && f.geometry.type);
      if (first) {
        const t = first.geometry.type;
        if (t.includes("Line")) geomType = "LineString";
        else if (t.includes("Point")) geomType = "Point";
      }
    }
    features.forEach((feat, idx) => {
      if (!feat.properties || typeof feat.properties !== "object") feat.properties = {};
      const fid = feat.properties.__pf_id || feat.id || feat.properties.id || `feat_${Date.now()}_${idx}_${Math.floor(Math.random() * 100000)}`;
      feat.id = fid;
      feat.properties.__pf_id = fid;
      if (feat.properties.id === undefined) feat.properties.id = fid;
    });
    const keys = new Set();
    features.forEach((f) => Object.keys(f.properties).forEach((k) => { if (!k.startsWith("__")) keys.add(k); }));
    const fields = meta && Array.isArray(meta.fields) && meta.fields.length ? meta.fields : Array.from(keys).map((k) => ({ name: k, label: k }));
    const color = PALETTE[this.layers.length % PALETTE.length];
    const style = meta && meta.style ? sanitizeStyle(meta.style) : {
      fillColor: color, fillOpacity: geomType === "Polygon" ? 0.4 : 0.9, strokeColor: color, strokeWidth: 2,
      strokeStyle: "solid", markerShape: "circle", markerSize: 8,
      labelProperty: keys.has("nom") ? "nom" : (keys.has("name") ? "name" : (fields[0] ? fields[0].name : "nom"))
    };
    const layer = {
      id: "vec_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
      name: String(name || "Couche importée").slice(0, 160),
      geometryType: geomType,
      visible: meta && meta.visible === false ? false : true,
      data: { type: "FeatureCollection", features },
      style,
      fields,
      folderId: folderId || null
    };
    this.layers.push(layer);
    this.syncLayerToMap(layer);
    if (!layer.visible) this.setLayerVisibility(layer.id, false);
    return layer;
  };

  P.ensureFolderPath = function (parts, rootId) {
    let parent = rootId || null;
    parts.forEach((name) => {
      const clean = String(name).trim();
      if (!clean) return;
      let f = this.folders.find((x) => (x.parentId || null) === parent && x.name === clean);
      if (!f) { f = { id: uid("dir"), name: clean.slice(0, 120), parentId: parent, collapsed: false }; this.folders.push(f); }
      parent = f.id;
    });
    return parent;
  };

  P.zoomToLayers = function (layers) {
    let b = null;
    const scan = (c) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number" && typeof c[1] === "number") {
        if (!b) b = [c[0], c[1], c[0], c[1]];
        else { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }
      } else c.forEach(scan);
    };
    layers.forEach((l) => (l.data.features || []).forEach((f) => f.geometry && scan(f.geometry.coordinates)));
    if (b && this.map) this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 17, duration: 900 });
  };

  const origImport = P.importVectorFile;
  P.importVectorFile = async function (file) {
    const lower = String(file.name || "").toLowerCase();
    if (lower.endsWith(".zip") && window.JSZip) {
      let zip = null, buf = null;
      try {
        buf = await file.arrayBuffer();
        zip = await window.JSZip.loadAsync(buf);
      } catch (e) { zip = null; }
      if (zip) {
        const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith("__MACOSX/"));
        if (names.some((n) => n.split("/").pop() === MANIFEST)) return this.restoreBackupZip(zip);
        const shpNames = names.filter((n) => n.toLowerCase().endsWith(".shp"));
        if (shpNames.length > 1 && typeof window.shp === "function") return this.importMultiShapefileZip(buf, file.name);
        if (!shpNames.length && names.some((n) => /\.(geo)?json$/i.test(n))) return this.importGeojsonZip(zip, file.name);
      }
    }
    return origImport.call(this, file);
  };

  P.importMultiShapefileZip = async function (buf, zipName) {
    try {
      const res = await window.shp(buf);
      const list = Array.isArray(res) ? res : [res];
      const folderId = this.ensureFolderPath([zipName.replace(/\.zip$/i, "")], this.activeFolderId);
      const created = list.filter((fc) => fc && fc.features && fc.features.length)
        .map((fc, i) => this.createLayerFromCollection(fc, String(fc.fileName || `Couche ${i + 1}`).split("/").pop(), folderId));
      this.bringToFront();
      this.renderLayersList();
      this.zoomToLayers(created);
      this.showToast(`${plural(created.length, "couche importée", "couches importées")} dans « ${zipName.replace(/\.zip$/i, "")} ».`);
      return created.length ? created[created.length - 1].id : null;
    } catch (err) {
      this.showToast("Erreur lors de l'import du shapefile : " + err.message, true);
      return null;
    }
  };

  P.importGeojsonZip = async function (zip, zipName) {
    const rootId = this.ensureFolderPath([zipName.replace(/\.zip$/i, "")], this.activeFolderId);
    const created = [];
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith("__MACOSX/") && /\.(geo)?json$/i.test(n)).sort();
    for (const n of names) {
      try {
        const fc = JSON.parse(await zip.file(n).async("string"));
        if (!fc || !Array.isArray(fc.features)) continue;
        const parts = n.split("/");
        const file = parts.pop();
        const folderId = this.ensureFolderPath(parts, rootId);
        created.push(this.createLayerFromCollection(fc, file.replace(/\.(geo)?json$/i, ""), folderId));
      } catch (e) { console.warn("[Couches] Fichier ignoré :", n, e); }
    }
    this.bringToFront();
    this.renderLayersList();
    this.zoomToLayers(created);
    this.showToast(created.length ? `${plural(created.length, "couche importée", "couches importées")}.` : "Aucune couche GeoJSON valide dans l'archive.", !created.length);
    return created.length ? created[created.length - 1].id : null;
  };

  // ===========================================================================
  // 6. SAUVEGARDE COMPLÈTE (.zip) ET RESTAURATION
  // ===========================================================================
  P.downloadBackup = async function () {
    if (!window.JSZip) { this.showToast("Module ZIP indisponible.", true); return; }
    if (!this.layers.length) { this.showToast("Aucune couche à sauvegarder."); return; }
    const zip = new window.JSZip();
    const used = new Set();
    const pathFor = (folderId, name, ext) => {
      const dir = this.folderPath(folderId).map((p) => safeFileName(p, "dossier")).join("/");
      let base = safeFileName(name), file = `${dir ? dir + "/" : ""}${base}.${ext}`, i = 2;
      while (used.has(file.toLowerCase())) file = `${dir ? dir + "/" : ""}${base}_${i++}.${ext}`;
      used.add(file.toLowerCase());
      return file;
    };
    const manifest = {
      format: "plandeferme-couches",
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: (this.folders || []).map((f) => ({ id: f.id, name: f.name, parentId: f.parentId || null, collapsed: !!f.collapsed })),
      layers: []
    };
    this.layers.forEach((l) => {
      const file = pathFor(l.folderId, l.name, "geojson");
      zip.file(file, JSON.stringify(l.data));
      manifest.layers.push({ name: l.name, geometryType: l.geometryType, visible: !!l.visible, style: l.style, fields: l.fields || [], folderId: l.folderId || null, file });
    });
    zip.file(MANIFEST, JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    downloadBlobFile(blob, `plandeferme-couches-${new Date().toISOString().slice(0, 10)}.zip`);
    this.showToast(`Sauvegarde téléchargée (${plural(this.layers.length, "couche", "couches")}).`);
  };

  P.restoreBackupZip = async function (zip) {
    try {
      const mfName = Object.keys(zip.files).find((n) => n.split("/").pop() === MANIFEST);
      const prefix = mfName.slice(0, mfName.length - MANIFEST.length);
      const manifest = JSON.parse(await zip.file(mfName).async("string"));
      if (!manifest || !Array.isArray(manifest.layers)) throw new Error("Manifeste de sauvegarde invalide.");
      // Nouveaux identifiants : la restauration s'ajoute aux couches existantes
      const idMap = new Map();
      (manifest.folders || []).forEach((f) => idMap.set(f.id, uid("dir")));
      (manifest.folders || []).forEach((f) => {
        this.folders.push({
          id: idMap.get(f.id),
          name: String(f.name || "Dossier").slice(0, 120),
          parentId: f.parentId && idMap.has(f.parentId) ? idMap.get(f.parentId) : null,
          collapsed: !!f.collapsed
        });
      });
      const created = [];
      for (const m of manifest.layers) {
        const entry = m && m.file ? zip.file(prefix + m.file) : null;
        if (!entry) continue;
        const fc = JSON.parse(await entry.async("string"));
        const folderId = m.folderId && idMap.has(m.folderId) ? idMap.get(m.folderId) : null;
        created.push(this.createLayerFromCollection(fc, m.name, folderId, m));
      }
      this.bringToFront();
      this.renderLayersList();
      this.zoomToLayers(created.filter((l) => l.visible));
      this.showToast(`Sauvegarde restaurée : ${plural(created.length, "couche", "couches")}, ${plural((manifest.folders || []).length, "dossier", "dossiers")}.`);
      return created.length ? created[created.length - 1].id : null;
    } catch (err) {
      this.showToast("Restauration impossible : " + err.message, true);
      return null;
    }
  };

  // ===========================================================================
  // 7. EXPORT SHAPEFILE
  // ===========================================================================
  const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  const FAMILY_LABEL = { points: "points", lines: "lignes", polygons: "polygones" };

  /** Aplatit les géométries en familles shapefile (une couche peut mélanger les types) */
  function explodeFeatures(features) {
    const fam = { points: [], lines: [], polygons: [] };
    const add = (geom, props) => {
      if (!geom || !geom.type) return;
      const t = geom.type;
      if (t === "GeometryCollection") { (geom.geometries || []).forEach((g) => add(g, props)); return; }
      if (!Array.isArray(geom.coordinates)) return;
      if (t === "Point" || t === "MultiPoint") fam.points.push({ geom, props });
      else if (t === "LineString" || t === "MultiLineString") fam.lines.push({ geom, props });
      else if (t === "Polygon" || t === "MultiPolygon") fam.polygons.push({ geom, props });
    };
    features.forEach((f) => f && add(f.geometry, f.properties || {}));
    return fam;
  }

  const xy = (p) => [Number(p[0]), Number(p[1])];
  const validPt = (p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));

  // Aire signée (> 0 : sens horaire avec y vers le haut)
  function ringClockwise(ring) {
    let s = 0;
    for (let i = 0; i < ring.length - 1; i++) s += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
    return s > 0;
  }
  function closeRing(ring) {
    const r = ring.filter(validPt).map(xy);
    if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([r[0][0], r[0][1]]);
    return r;
  }

  /** Parties (anneaux/lignes) au format shapefile pour une géométrie */
  function partsOf(geom, family) {
    if (family === "points") {
      return geom.type === "Point" ? [[xy(geom.coordinates)]] : [geom.coordinates.filter(validPt).map(xy)];
    }
    if (family === "lines") {
      const lines = geom.type === "LineString" ? [geom.coordinates] : geom.coordinates;
      return lines.map((l) => (l || []).filter(validPt).map(xy)).filter((l) => l.length >= 2);
    }
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    const out = [];
    polys.forEach((poly) => (poly || []).forEach((ring, k) => {
      const r = closeRing(ring || []);
      if (r.length < 4) return;
      const cw = ringClockwise(r);
      // Shapefile : anneau extérieur en sens horaire, trous en sens antihoraire
      if ((k === 0 && !cw) || (k > 0 && cw)) r.reverse();
      out.push(r);
    }));
    return out;
  }

  function writeShp(items, family) {
    const multiPoint = family === "points" && items.some((it) => it.geom.type === "MultiPoint");
    const shapeType = family === "points" ? (multiPoint ? 8 : 1) : family === "lines" ? 3 : 5;
    const recs = [];
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    items.forEach((it) => {
      const parts = partsOf(it.geom, family);
      const pts = parts.flat();
      if (!pts.length) return;
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      pts.forEach(([x, y]) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); });
      for (let i = 0; i < 2; i++) { bb[i] = Math.min(bb[i], b[i]); bb[i + 2] = Math.max(bb[i + 2], b[i + 2]); }
      let len;
      if (shapeType === 1) len = 20;
      else if (shapeType === 8) len = 40 + 16 * pts.length;
      else len = 44 + 4 * parts.length + 16 * pts.length;
      recs.push({ it, parts, pts, b, len });
    });
    const shpLen = 100 + recs.reduce((s, r) => s + 8 + r.len, 0);
    const shxLen = 100 + recs.length * 8;
    const shp = new DataView(new ArrayBuffer(shpLen));
    const shx = new DataView(new ArrayBuffer(shxLen));
    const header = (dv, byteLen) => {
      dv.setInt32(0, 9994, false);
      dv.setInt32(24, byteLen / 2, false);
      dv.setInt32(28, 1000, true);
      dv.setInt32(32, shapeType, true);
      const box = recs.length ? bb : [0, 0, 0, 0];
      box.forEach((v, i) => dv.setFloat64(36 + i * 8, v, true));
    };
    header(shp, shpLen);
    header(shx, shxLen);
    let o = 100;
    recs.forEach((r, i) => {
      shx.setInt32(100 + i * 8, o / 2, false);
      shx.setInt32(104 + i * 8, r.len / 2, false);
      shp.setInt32(o, i + 1, false);
      shp.setInt32(o + 4, r.len / 2, false);
      let p = o + 8;
      shp.setInt32(p, shapeType, true); p += 4;
      if (shapeType === 1) {
        shp.setFloat64(p, r.pts[0][0], true); shp.setFloat64(p + 8, r.pts[0][1], true);
      } else {
        r.b.forEach((v, k) => shp.setFloat64(p + k * 8, v, true)); p += 32;
        if (shapeType === 8) {
          shp.setInt32(p, r.pts.length, true); p += 4;
        } else {
          shp.setInt32(p, r.parts.length, true);
          shp.setInt32(p + 4, r.pts.length, true);
          p += 8;
          let start = 0;
          r.parts.forEach((part) => { shp.setInt32(p, start, true); p += 4; start += part.length; });
        }
        r.pts.forEach(([x, y]) => { shp.setFloat64(p, x, true); shp.setFloat64(p + 8, y, true); p += 16; });
      }
      o += 8 + r.len;
    });
    return { shp: shp.buffer, shx: shx.buffer, rows: recs.map((r) => r.it.props), count: recs.length };
  }

  const ENC = new TextEncoder();
  /** Tronque une chaîne UTF-8 sans couper un caractère multioctet */
  function utf8Truncate(str, maxBytes) {
    const bytes = ENC.encode(str);
    if (bytes.length <= maxBytes) return bytes;
    let out = new Uint8Array(0), total = 0, acc = [];
    for (const ch of str) {
      const b = ENC.encode(ch);
      if (total + b.length > maxBytes) break;
      acc.push(b); total += b.length;
    }
    out = new Uint8Array(total);
    let k = 0; acc.forEach((b) => { out.set(b, k); k += b.length; });
    return out;
  }

  function dbfFieldName(name, used) {
    let base = String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
    if (!base || /^[0-9_]/.test(base)) base = "F" + base;
    base = base.slice(0, 10);
    let n = base, i = 1;
    while (used.has(n.toUpperCase())) { const suf = String(i++); n = base.slice(0, 10 - suf.length) + suf; }
    used.add(n.toUpperCase());
    return n;
  }

  const cellString = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

  function writeDbf(rows) {
    const keys = [];
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => { if (!k.startsWith("__") && !keys.includes(k)) keys.push(k); }));
    const used = new Set();
    let fields = keys.map((k) => {
      const vals = rows.map((r) => (r ? r[k] : undefined)).filter((v) => v !== null && v !== undefined && v !== "");
      const numeric = vals.length > 0 && vals.every((v) => typeof v === "number" && Number.isFinite(v));
      if (numeric) {
        const isInt = vals.every((v) => Number.isInteger(v));
        const dec = isInt ? 0 : Math.min(8, Math.max(...vals.map((v) => {
          if (Number.isInteger(v)) return 0;
          const s = String(v);
          if (/e/i.test(s)) return 8;
          const i = s.indexOf(".");
          return i < 0 ? 0 : s.length - i - 1;
        })));
        const intDigits = Math.max(...vals.map((v) => String(Math.trunc(Math.abs(v))).length + (v < 0 ? 1 : 0)));
        const len = Math.min(19, Math.max(1, intDigits + (dec ? dec + 1 : 0)));
        return { key: k, name: dbfFieldName(k, used), type: "N", len, dec };
      }
      const len = Math.min(254, Math.max(1, ...vals.map((v) => ENC.encode(cellString(v)).length)));
      return { key: k, name: dbfFieldName(k, used), type: "C", len, dec: 0 };
    });
    if (!fields.length) fields = [{ key: null, name: "FID", type: "N", len: 10, dec: 0 }];
    if (fields.length > 255) fields = fields.slice(0, 255);

    const headerLen = 32 + fields.length * 32 + 1;
    const recLen = 1 + fields.reduce((s, f) => s + f.len, 0);
    const buf = new Uint8Array(headerLen + rows.length * recLen + 1);
    const dv = new DataView(buf.buffer);
    const d = new Date();
    buf[0] = 0x03;
    buf[1] = d.getFullYear() - 1900; buf[2] = d.getMonth() + 1; buf[3] = d.getDate();
    dv.setUint32(4, rows.length, true);
    dv.setUint16(8, headerLen, true);
    dv.setUint16(10, recLen, true);
    fields.forEach((f, i) => {
      const o = 32 + i * 32;
      for (let c = 0; c < f.name.length; c++) buf[o + c] = f.name.charCodeAt(c);
      buf[o + 11] = f.type.charCodeAt(0);
      buf[o + 16] = f.len;
      buf[o + 17] = f.dec;
    });
    buf[headerLen - 1] = 0x0d;
    rows.forEach((r, ri) => {
      let o = headerLen + ri * recLen;
      buf[o++] = 0x20;
      fields.forEach((f) => {
        buf.fill(0x20, o, o + f.len);
        if (f.type === "N") {
          const v = f.key === null ? ri + 1 : r ? r[f.key] : null;
          if (typeof v === "number" && Number.isFinite(v)) {
            let s = f.dec ? v.toFixed(f.dec) : String(Math.round(v));
            if (s.length > f.len) s = "*".repeat(f.len);
            for (let c = 0; c < s.length; c++) buf[o + f.len - s.length + c] = s.charCodeAt(c);
          }
        } else {
          buf.set(utf8Truncate(cellString(r ? r[f.key] : ""), f.len), o);
        }
        o += f.len;
      });
    });
    buf[buf.length - 1] = 0x1a;
    return buf.buffer;
  }

  /** Ajoute les fichiers shapefile d'une couche dans le zip, sous « dir » */
  function addLayerShapefiles(zip, layer, dir, used) {
    const fam = explodeFeatures((layer.data && layer.data.features) || []);
    const present = Object.keys(fam).filter((k) => fam[k].length);
    let written = 0;
    present.forEach((k) => {
      const out = writeShp(fam[k], k);
      if (!out.count) return;
      let base = safeFileName(layer.name) + (present.length > 1 ? "_" + FAMILY_LABEL[k] : "");
      let name = `${dir ? dir + "/" : ""}${base}`, i = 2;
      while (used.has(name.toLowerCase())) name = `${dir ? dir + "/" : ""}${base}_${i++}`;
      used.add(name.toLowerCase());
      zip.file(name + ".shp", out.shp);
      zip.file(name + ".shx", out.shx);
      zip.file(name + ".dbf", writeDbf(out.rows));
      zip.file(name + ".prj", PRJ_WGS84);
      zip.file(name + ".cpg", "UTF-8");
      written++;
    });
    return written;
  }
  // Exposé pour les tests et pour d'autres modules
  window.PfShapefile = { writeShp, writeDbf, explodeFeatures, addLayerShapefiles };

  P.exportShapefileZip = async function (layers, zipName, relativeTo) {
    if (!window.JSZip) { this.showToast("Module ZIP indisponible.", true); return; }
    const zip = new window.JSZip();
    const used = new Set();
    const rootDepth = relativeTo ? this.folderPath(relativeTo).length : 0;
    let files = 0;
    layers.forEach((l) => {
      const dir = this.folderPath(l.folderId).slice(rootDepth).map((p) => safeFileName(p, "dossier")).join("/");
      files += addLayerShapefiles(zip, l, dir, used);
    });
    if (!files) { this.showToast("Aucune géométrie à exporter.", true); return; }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    downloadBlobFile(blob, `${safeFileName(zipName)}_shp.zip`);
    this.showToast(`Shapefile exporté (${plural(files, "fichier .shp", "fichiers .shp")}).`);
  };

  P.exportLayerShapefile = function (layer) { return this.exportShapefileZip([layer], layer.name, layer.folderId); };
  P.exportFolderShapefile = function (folderId) {
    const f = this.getFolder(folderId);
    return this.exportShapefileZip(this.layersInFolderTree(folderId), f ? f.name : "dossier", folderId);
  };
  P.exportAllShapefile = function () { return this.exportShapefileZip(this.layers.slice(), "plandeferme-couches", null); };

  // Ajoute « Shapefile » au menu d'export existant de chaque couche
  const origExportMenu = P.showExportMenu;
  P.showExportMenu = function (layer, anchorEl) {
    origExportMenu.call(this, layer, anchorEl);
    const pop = document.getElementById("vector-export-popover");
    if (!pop) return;
    const csv = pop.querySelector(".btn-exp-csv");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "personal-dropdown-item btn-exp-shp";
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2e6a4c" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>Shapefile (.zip)</span>';
    btn.addEventListener("click", () => { pop.remove(); this.exportLayerShapefile(layer); });
    if (csv && csv.parentNode) csv.parentNode.insertBefore(btn, csv.nextSibling);
    else pop.appendChild(btn);
  };
})();
