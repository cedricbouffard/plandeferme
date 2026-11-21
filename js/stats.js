/* Plan de Ferme — © 2026 Cédric Bouffard — GPL-3.0 (voir LICENSE) — https://plandeferme.ca */
/*
  Statistiques d'utilisation anonymes
  -----------------------------------
  Ce module compte des événements ; il ne suit personne.
  - Aucun témoin (cookie), aucun identifiant de visiteur, aucune empreinte de l'appareil, aucune adresse IP
    conservée par ce code, aucune coordonnée de carte ni nom de parcelle.
  - Visiteurs uniques : le navigateur retient seulement la date de sa dernière visite (la même valeur pour tout
    le monde ce jour-là) et dit « première visite du jour » ou « du mois ». Le serveur additionne ces
    signalements sans jamais recevoir d'identifiant.
  - Chaque mesure est un compteur séparé (langue, type d'appareil, outil ouvert, couche affichée, durée) : rien
    ne permet de relier deux compteurs à une même personne, donc aucun profil ne peut être reconstitué.
  - Respecte « Ne pas me pister » (Do Not Track) et le Contrôle mondial de confidentialité (GPC), ainsi que le
    refus enregistré par le visiteur (pfStats.optOut()).
  - Rien n'est envoyé tant que CONFIG.endpoint est vide, ni hors des domaines de CONFIG.hosts.

  Transports : "goatcounter" (un pixel par événement vers https://CODE.goatcounter.com/count) ou
  "json" (lot d'événements en POST vers un point de collecte à soi : { v: 1, e: ["visite", "outil/ndvi", …] }).
*/
(function () {
  "use strict";
  const CONFIG = {
    transport: "goatcounter",          // "goatcounter" ou "json"
    endpoint: "https://plandeferme.goatcounter.com/count",                      // ex. "https://plandeferme.goatcounter.com/count" ; vide = rien n'est envoyé
    hosts: ["plandeferme.ca", "www.plandeferme.ca"]
  };
  const OFF_KEY = "pf-stats-off", DAY_KEY = "pf-vu-j", MONTH_KEY = "pf-vu-m";
  const MAX_PER_NAME = 5, MAX_EVENTS = 150; // plafonds par visite : un clic répété ne gonfle pas les compteurs
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } } };
  const seen = new Map(); let total = 0, queue = [], timer = null;

  const refused = () => store.get(OFF_KEY) === "1" || navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  const active = () => !!CONFIG.endpoint && CONFIG.hosts.includes(location.hostname) && !navigator.webdriver && !refused();
  // nom d'événement : lettres, chiffres, tirets et barres obliques seulement (jamais de texte saisi par le visiteur)
  const clean = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

  function send(names) {
    if (!names.length) return;
    try {
      if (CONFIG.transport === "json") {
        const body = JSON.stringify({ v: 1, e: names });
        if (!(navigator.sendBeacon && navigator.sendBeacon(CONFIG.endpoint, new Blob([body], { type: "text/plain" })))) fetch(CONFIG.endpoint, { method: "POST", body, keepalive: true, credentials: "omit", mode: "no-cors" }).catch(() => {});
      } else {
        // GoatCounter : un appel par événement, sans référent, sans taille d'écran, sans titre
        names.forEach((n) => { const img = new Image(); img.referrerPolicy = "no-referrer"; img.src = `${CONFIG.endpoint}?p=${encodeURIComponent(n)}&e=true&rnd=${Math.random().toString(36).slice(2, 8)}`; });
      }
    } catch (e) { /* les statistiques ne doivent jamais gêner l'application */ }
  }
  function flush() { clearTimeout(timer); timer = null; const q = queue; queue = []; if (active()) send(q); }
  function count(name) {
    const n = clean(name);
    if (!n || !active()) return;
    const c = seen.get(n) || 0;
    if (c >= MAX_PER_NAME || total >= MAX_EVENTS) return;
    seen.set(n, c + 1); total++;
    queue.push(n);
    if (!timer) timer = setTimeout(flush, 3837);
  }

  // ---- visites : total, première du jour, première du mois ---------------------------------------------------
  function visit() {
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, month = day.slice(0, 7);
    count("visite");
    const hadDay = store.get(DAY_KEY), hadMonth = store.get(MONTH_KEY);
    if (hadDay !== day) { count("visiteur/jour"); store.set(DAY_KEY, day); }
    if (hadMonth !== month) { count("visiteur/mois"); store.set(MONTH_KEY, month); }
    if (!hadDay && !hadMonth) count("visiteur/nouveau");
    count("langue/" + ((window.pfI18n && window.pfI18n.lang) || document.documentElement.lang || "fr").slice(0, 2));
    count("appareil/" + (window.innerWidth < 768 ? "telephone" : window.innerWidth < 1100 ? "tablette" : "ordinateur"));
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) count("appareil/application-installee");
  }
  // ---- durée d'utilisation : temps passé avec l'onglet visible, signalé au passage de quelques seuils --------
  function watchTime() {
    const steps = [1, 5, 15, 30, 60]; let activeMs = 0, last = Date.now(), next = 0;
    setInterval(() => {
      const now = Date.now();
      if (!document.hidden && now - last < 20000) activeMs += now - last;
      last = now;
      while (next < steps.length && activeMs >= steps[next] * 60000) { count(`duree/${steps[next]}-min-et-plus`); next++; }
    }, 10000);
  }
  // ---- ce qui est utilisé : couches cochées, outils ouverts, enregistrements et exports ------------------------
  function watchUse() {
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (t && t.type === "checkbox" && t.checked && /^toggle-/.test(t.id || "")) count("couche/" + t.id.slice(7));
      else if (t && t.classList && t.classList.contains("pf-lang-select")) count("langue-choisie/" + String(t.value).slice(0, 2));
    }, true);
    document.addEventListener("click", (e) => {
      const el = e.target && e.target.closest ? e.target.closest("button, a[data-pf-plan]") : null;
      if (!el) return;
      if (el.matches("a[data-pf-plan]")) { count("outil/plan-de-drainage"); return; }
      const cls = Array.from(el.classList || []), act = el.dataset && el.dataset.pfAct;
      if (act) { count("outil/" + act); return; }
      const named = cls.find((c) => /^btn-popup-action-/.test(c)) || cls.find((c) => /^pf-reg-/.test(c));
      if (named) { count("outil/" + named.replace(/^btn-popup-action-|^pf-reg-/, "")); return; }
      const id = el.id || "";
      let m;
      if ((m = /^btn-popup-(\w+)-feat$/.exec(id))) count("outil-couche/" + m[1]);
      else if (id === "btn-tab-ndvi" || id === "btn-quick-ndvi") count("outil/ndvi");
      else if ((m = /^btn-(\w+)-save$/.exec(id))) count("enregistrer/" + m[1]);
      else if ((m = /^btn-(\w+)-export(-shp)?$/.exec(id))) count(`exporter/${m[1]}${m[2] ? "-shapefile" : "-geojson"}`);
      else if (id === "btn-essai-sim") count("outil/essai-simulation");
      else if (/^btn-quick-/.test(id)) count("outil/" + id.slice(10));
    }, true);
    // territoire regardé, une fois par visite : code de pays ou de province seulement, jamais de coordonnées
    setTimeout(() => {
      try {
        const map = window.map; if (!map || typeof map.getCenter !== "function" || map.getZoom() < 7) return;
        const c = map.getCenter(), k = window.pfDem && typeof window.pfDem.regionAt === "function" ? window.pfDem.regionAt(c.lng, c.lat) : null;
        const qc = c.lng > -80 && c.lng < -57 && c.lat > 44.9 && c.lat < 62.6;
        count("territoire/" + (k || (qc ? "qc" : "autre")));
      } catch (e) { /* carte pas prête */ }
    }, 30000);
  }

  // ---- choix du visiteur ---------------------------------------------------------------------------------------
  function syncToggle() {
    document.querySelectorAll(".pf-stats-toggle").forEach((cb) => { cb.checked = !refused(); cb.disabled = store.get(OFF_KEY) !== "1" && refused(); });
  }
  function optOut() { queue = []; store.set(OFF_KEY, "1"); store.del(DAY_KEY); store.del(MONTH_KEY); syncToggle(); }
  function optIn() { store.del(OFF_KEY); syncToggle(); }
  function start() {
    syncToggle();
    document.addEventListener("change", (e) => { const t = e.target; if (t && t.classList && t.classList.contains("pf-stats-toggle")) { if (t.checked) optIn(); else optOut(); } });
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
    window.addEventListener("pagehide", flush);
    if (!active()) return;
    visit(); watchTime(); watchUse();
  }
  window.pfStats = { count, optOut, optIn, flush, refused, active, config: CONFIG, _clean: clean, _seen: seen };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
if (typeof window !== "undefined") (window.pfModules = window.pfModules || {})["stats"] = "95d24e1a";
