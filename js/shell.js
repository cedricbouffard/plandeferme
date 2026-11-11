/*
  Plan de Ferme — coquille d'interface (refonte).
  Ce module ne touche à aucune logique cartographique : il gère la barre de
  sections, la légende unique, le tiroir de résultats à onglets et la fiche
  parcelle, en s'appuyant sur les éléments et les gestionnaires existants.
*/
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const isDesktop = () => window.matchMedia("(min-width: 769px)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  };

  function resizeMapSoon() {
    if (!window.map || typeof window.map.resize !== "function") return;
    requestAnimationFrame(() => { try { window.map.resize(); } catch (e) { /* carte pas prête */ } });
  }

  /* ---------------- 1. Sections du panneau ---------------- */
  const SECTIONS = ["couches", "analyses", "donnees", "ressources"];
  let current = SECTIONS.includes(store.get("pf-section")) ? store.get("pf-section") : "couches";

  function showSection(name, opts) {
    const o = opts || {};
    if (!SECTIONS.includes(name)) return;
    const sameAndOpen = name === current && !document.body.classList.contains("pf-collapsed");
    if (o.toggle && sameAndOpen) {
      document.body.classList.add("pf-collapsed");
    } else {
      document.body.classList.remove("pf-collapsed");
      current = name;
      store.set("pf-section", name);
    }
    document.querySelectorAll(".pf-section").forEach((s) => {
      s.classList.toggle("pf-active", s.dataset.section === current);
    });
    document.querySelectorAll(".pf-rail-btn").forEach((b) => {
      const on = b.dataset.pfSection === current && !document.body.classList.contains("pf-collapsed");
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const panel = $("panel-tools");
    if (panel && o.scrollTo) {
      const el = $(o.scrollTo);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
    resizeMapSoon();
  }
  window.pfShowSection = showSection;

  document.querySelectorAll(".pf-rail-btn").forEach((b) => {
    b.addEventListener("click", () => showSection(b.dataset.pfSection, { toggle: true }));
  });

  /* Boutons proxy : déclenchent un bouton existant (un seul comportement, deux accès) */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-pf-click]");
    if (!t) return;
    const target = $(t.dataset.pfClick);
    if (target) {
      e.stopPropagation();
      target.click();
    }
  });

  /* Raccourcis existants qui ouvraient le tiroir : on ouvre la bonne section */
  ["btn-quick-vectors", "mobile-tool-vectors"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("click", () => { if (isDesktop()) showSection("donnees"); });
  });
  const rusleCard = $("card-rusle");
  if (rusleCard) {
    new MutationObserver(() => {
      if (rusleCard.open && isDesktop() && current !== "couches") showSection("couches", { scrollTo: "card-rusle" });
    }).observe(rusleCard, { attributes: true, attributeFilter: ["open"] });
  }
  const panelTools = $("panel-tools");
  if (panelTools) {
    new MutationObserver(() => {
      if (panelTools.classList.contains("open") && isDesktop()) {
        panelTools.classList.remove("open");
        const bd = $("tools-backdrop");
        if (bd) bd.classList.remove("active");
        if (document.body.classList.contains("pf-collapsed")) showSection(current);
      }
    }).observe(panelTools, { attributes: true, attributeFilter: ["class"] });
  }

  /* Diagnostic des sols sans contexte de parcelle */
  const soilBtn = $("pf-open-soil-ai");
  if (soilBtn) {
    soilBtn.addEventListener("click", () => {
      if (window.soilAiAssistant && typeof window.soilAiAssistant.open === "function") window.soilAiAssistant.open();
    });
  }

  /* Libellés accessibles pour la palette d'icônes */
  document.querySelectorAll(".map-profile-toolbar .floating-profile-btn").forEach((b) => {
    if (!b.getAttribute("aria-label")) {
      const label = (b.textContent || "").trim() || b.getAttribute("title") || "";
      if (label) b.setAttribute("aria-label", label);
    }
  });

  /* ---------------- 2. Légende unique + compteur de couches ---------------- */
  const legend = $("pf-legend");
  const legendItems = Array.from(document.querySelectorAll("[data-pf-legend]"));
  const LAYER_TOGGLES = ["toggle-pedo", "toggle-parcelles", "toggle-topo", "toggle-contours", "toggle-pentes",
    "toggle-hydro-parcelle", "toggle-canopee", "toggle-rusle"];
  let legendMin = store.get("pf-legend-min") === "1";

  function syncLegend() {
    let shown = 0;
    legendItems.forEach((it) => {
      const cb = $(it.dataset.pfLegend);
      const on = !!(cb && cb.checked);
      if (it.hidden === on) it.hidden = !on;
      if (on) shown++;
    });
    const wmsOn = document.querySelectorAll(".wms-layer-item.active").length;
    const total = LAYER_TOGGLES.reduce((n, id) => n + ($(id) && $(id).checked ? 1 : 0), 0) + wmsOn;
    const count = $("pf-active-count");
    const txt = total === 0 ? "Aucune couche affichée" : total === 1 ? "1 couche affichée" : total + " couches affichées";
    if (count && count.textContent !== txt) count.textContent = txt;
    if (legend) {
      const hide = shown === 0;
      if (legend.hidden !== hide) legend.hidden = hide;
      legend.classList.toggle("pf-legend-min", legendMin);
      const hint = $("pf-legend-hint");
      const h = legendMin ? shown + (shown > 1 ? " couches" : " couche") : "Réduire";
      if (hint && hint.textContent !== h) hint.textContent = h;
      const tg = $("pf-legend-toggle");
      if (tg) tg.setAttribute("aria-expanded", legendMin ? "false" : "true");
    }
  }
  const lt = $("pf-legend-toggle");
  if (lt) lt.addEventListener("click", () => { legendMin = !legendMin; store.set("pf-legend-min", legendMin ? "1" : "0"); syncLegend(); });
  document.addEventListener("change", (e) => { if (e.target && e.target.type === "checkbox") syncLegend(); });
  // Certaines couches sont activées par programme (lien partagé, RUSLE…) : vérification légère périodique.
  setInterval(syncLegend, 800);

  /* ---------------- 3. Tiroir des résultats à onglets ---------------- */
  const DOCKS = [
    { id: "elevation-profile-dock", name: "Profil altimétrique", close: "btn-close-profile-dock" },
    { id: "ndvi-dock", name: "NDVI Sentinel-2", close: "btn-close-ndvi-dock" },
    { id: "sim-dock", name: "Simulation de pluie", close: "btn-close-sim-dock" },
    { id: "cutfill-dock", name: "Déblais / remblais", close: "btn-close-cutfill-dock" }
  ].filter((d) => $(d.id));
  let order = [];   // plus récent en premier
  let active = null;
  const tabsBar = document.createElement("div");
  tabsBar.className = "pf-tray-tabs";
  tabsBar.setAttribute("role", "tablist");
  tabsBar.setAttribute("aria-label", "Résultats ouverts");

  const isOpen = (d) => $(d.id).classList.contains("open");

  // Couches de carte de chaque résultat : l'œil de l'onglet les masque / les réaffiche
  const DOCK_LAYERS = {
    "elevation-profile-dock": /^raster-profile/,
    "ndvi-dock": /^sentinel2-ndvi/,
    "sim-dock": /^sim-rain/,
    "cutfill-dock": /^cutfill-/
  };
  const hiddenDocks = new Map(); // id du dock -> Set des couches masquées par l'œil
  function applyDockVisibility(id) {
    const map = window.map;
    const re = DOCK_LAYERS[id];
    if (!map || typeof map.getStyle !== "function" || !re || !map.getStyle()) return;
    const hidden = hiddenDocks.get(id);
    map.getStyle().layers.forEach((l) => {
      if (!re.test(l.id)) return;
      if (hidden) {
        if (map.getLayoutProperty(l.id, "visibility") !== "none") { map.setLayoutProperty(l.id, "visibility", "none"); hidden.add(l.id); }
      }
    });
  }
  function setDockHidden(id, hide) {
    const map = window.map;
    if (hide) {
      if (!hiddenDocks.has(id)) hiddenDocks.set(id, new Set());
      applyDockVisibility(id);
    } else {
      const ids = hiddenDocks.get(id);
      hiddenDocks.delete(id);
      if (ids && map) ids.forEach((lid) => { if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", "visible"); });
    }
  }
  // Une couche recréée pendant qu'elle est masquée (ex. relance de la pluie) reste masquée
  (function hookMap() {
    const map = window.map;
    if (!map || typeof map.on !== "function") { setTimeout(hookMap, 400); return; }
    map.on("styledata", () => { hiddenDocks.forEach((_, id) => applyDockVisibility(id)); });
  })();
  const EYE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const EYE_OFF = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

  function renderTabs(openDocks) {
    tabsBar.textContent = "";
    openDocks.forEach((d) => {
      const wrap = document.createElement("div");
      const isHidden = hiddenDocks.has(d.id);
      wrap.className = "pf-tray-tab" + (d.id === active ? " pf-on" : "") + (isHidden ? " pf-layer-off" : "");
      if (DOCK_LAYERS[d.id]) {
        const eye = document.createElement("button");
        eye.type = "button";
        eye.className = "pf-tray-eye";
        eye.setAttribute("aria-pressed", isHidden ? "false" : "true");
        eye.setAttribute("aria-label", (isHidden ? "Afficher " : "Masquer ") + d.name + " sur la carte");
        eye.title = isHidden ? "Afficher sur la carte" : "Masquer sur la carte";
        eye.innerHTML = isHidden ? EYE_OFF : EYE;
        eye.addEventListener("click", () => { setDockHidden(d.id, !hiddenDocks.has(d.id)); applyTray(); });
        wrap.appendChild(eye);
      }
      const pick = document.createElement("button");
      pick.type = "button";
      pick.setAttribute("role", "tab");
      pick.setAttribute("aria-selected", d.id === active ? "true" : "false");
      pick.textContent = d.name;
      pick.addEventListener("click", () => { active = d.id; order = [d.id].concat(order.filter((x) => x !== d.id)); applyTray(); });
      const close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "Fermer " + d.name);
      close.textContent = "×";
      close.addEventListener("click", () => { const c = $(d.close); if (c) c.click(); });
      wrap.appendChild(pick);
      wrap.appendChild(close);
      tabsBar.appendChild(wrap);
    });
  }

  function applyTray() {
    const openDocks = DOCKS.filter(isOpen);
    const openIds = openDocks.map((d) => d.id);
    // nouveaux docks ouverts -> deviennent actifs
    openIds.forEach((id) => { if (!order.includes(id)) { order.unshift(id); active = id; } });
    order = order.filter((id) => openIds.includes(id));
    // Résultat fermé : on oublie son état masqué (la couche est retirée par son module)
    [...hiddenDocks.keys()].forEach((id) => { if (!openIds.includes(id)) setDockHidden(id, false); });
    if (!openIds.includes(active)) active = order[0] || null;

    DOCKS.forEach((d) => {
      const el = $(d.id);
      const hide = isOpen(d) && d.id !== active;
      if (el.classList.contains("pf-tray-hidden") !== hide) el.classList.toggle("pf-tray-hidden", hide);
    });
    document.body.classList.toggle("pf-tray-open", openDocks.length > 0);

    if (openDocks.length >= 1 && active) {
      const host = $(active);
      renderTabs(order.map((id) => DOCKS.find((d) => d.id === id)).filter(Boolean));
      if (tabsBar.parentNode !== host) host.insertBefore(tabsBar, host.firstChild);
    } else if (tabsBar.parentNode) {
      tabsBar.parentNode.removeChild(tabsBar);
    }
  }
  const dockObserver = new MutationObserver(applyTray);
  DOCKS.forEach((d) => dockObserver.observe($(d.id), { attributes: true, attributeFilter: ["class"] }));

  /* ---------------- 4. Fiche parcelle (popup ancrée à droite) ---------------- */
  function syncFiche() {
    const has = !!document.querySelector(".maplibregl-popup .popup-tabs-header");
    document.body.classList.toggle("pf-fiche-open", has);
  }
  const mapEl = $("map");
  if (mapEl) new MutationObserver(syncFiche).observe(mapEl, { childList: true, subtree: false });

  /* ---------------- Démarrage ---------------- */
  showSection(current);
  syncLegend();
  applyTray();
  syncFiche();
  window.addEventListener("resize", () => { if (!isDesktop()) document.body.classList.remove("pf-collapsed"); });

  // Mobile : la recherche est toujours affichée ; le bouton « Recherche » de la barre du bas
  // donne simplement le focus au champ (au lieu d'ouvrir / fermer le panneau)
  const mSearch = document.getElementById("mobile-btn-search");
  if (mSearch) {
    mSearch.addEventListener("click", (e) => {
      if (isDesktop()) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const input = document.getElementById("address-input");
      if (input) { input.focus(); input.select(); }
    }, true);
  }
})();
