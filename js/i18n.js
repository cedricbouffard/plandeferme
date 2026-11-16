/*
  Traductions de l'interface (i18n)
  ---------------------------------
  Le français est la langue source : il reste écrit dans index.html et dans les modules.
  Les autres langues sont des fichiers séparés dans le dossier i18n/ :

    i18n/langues.js   liste des langues offertes dans le menu (et fuseaux horaires associés)
    i18n/en.js        « phrase française » : « traduction anglaise »
    i18n/es.js        « phrase française » : « traduction espagnole »
    i18n/_modele.js   toutes les phrases, à copier pour créer une nouvelle langue

  Ces fichiers sont chargés comme des scripts (pas de fetch) : ils fonctionnent sur n'importe quel
  serveur, et aussi quand index.html est ouvert directement depuis le disque.

  Ce module remplace à l'écran chaque texte français par sa traduction, y compris les textes
  créés plus tard par les modules (fiches, tiroirs, messages). Une phrase absente du fichier
  reste en français. Dans une phrase, {0}, {1}… marquent les valeurs variables (nombres, noms).

  Langue de départ : paramètre ?lang=xx, sinon choix enregistré, sinon emplacement (fuseau
  horaire de l'appareil), sinon langue du navigateur, sinon français.

  Console : pfI18n.missing() liste les textes vus à l'écran qui n'ont pas de traduction.
*/
(function () {
  "use strict";
  if (window.pfI18n) return;

  const SOURCE = "fr";
  const STORE_KEY = "pf-lang";
  const ATTRS = ["title", "placeholder", "aria-label", "alt"];
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };
  const HAS_LETTERS = /[A-Za-zÀ-ÿ]{2}/;
  const base = (document.currentScript && document.currentScript.src ? new URL("../i18n/", document.currentScript.src) : new URL("i18n/", location.href)).href;

  // Liste de secours si i18n/langues.js ne se charge pas
  let langs = [{ code: SOURCE, nom: "Français" }, { code: "en", nom: "English", fichier: "en.js" }, { code: "es", nom: "Español", fichier: "es.js" }];
  let lang = SOURCE;
  let exact = new Map();      // phrase française normalisée -> traduction
  let patterns = [];          // phrases à trous : { re, out, anchor }
  let cache = new Map();
  const missing = new Set();
  const textRec = new WeakMap(); // noeud texte -> { src, out }
  const attrRec = new WeakMap(); // élément -> { attribut: { src, out } }
  const dicts = {};

  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function setDict(dict) {
    exact = new Map(); patterns = []; cache = new Map(); missing.clear();
    Object.keys(dict || {}).forEach((k) => {
      const v = dict[k];
      if (k === "_meta" || typeof v !== "string" || !v) return;
      const key = norm(k);
      if (!/\{\d+\}/.test(key)) { exact.set(key, v); return; }
      const order = [];
      // un trou collé à une lettre (ex. « entité{1} » pour le pluriel) ne prend que quelques caractères
      const re = new RegExp("^" + escRe(key).replace(/([A-Za-zÀ-ÿ])?\\\{(\d+)\\\}(?=([A-Za-zÀ-ÿ])?)/g, (m, before, d, after) => { order.push(d); return (before || "") + (before || after ? "([\\s\\S]{0,3}?)" : "([\\s\\S]*?)"); }) + "$");
      const statics = key.split(/\{\d+\}/).sort((a, b) => b.length - a.length);
      patterns.push({ re, out: v, order, anchor: statics[0], weight: key.replace(/\{\d+\}/g, "").length });
    });
    patterns.sort((a, b) => b.weight - a.weight);
  }

  // Traduit une phrase française ; null si aucune traduction
  function translate(str) {
    if (lang === SOURCE || typeof str !== "string") return null;
    const key = norm(str);
    if (!key || !HAS_LETTERS.test(key)) return null;
    if (cache.has(key)) return cache.get(key);
    let out = exact.has(key) ? exact.get(key) : null;
    if (out === null && key.length < 2000) {
      for (let i = 0; i < patterns.length; i++) {
        const p = patterns[i];
        if (p.anchor && key.indexOf(p.anchor) < 0) continue;
        const m = p.re.exec(key);
        if (!m) continue;
        const vals = {};
        p.order.forEach((d, j) => { if (!(d in vals)) vals[d] = m[j + 1]; });
        out = p.out.replace(/\{(\d+)\}/g, (all, d) => { const v = vals[d]; if (v === undefined) return ""; const t = exact.get(norm(v)); return t !== undefined ? t : v; });
        break;
      }
    }
    if (out === null && missing.size < 3000) missing.add(key);
    if (cache.size > 6000) cache.clear();
    cache.set(key, out);
    return out;
  }
  // Même chose, en gardant les espaces de début et de fin ; rend le texte d'origine s'il n'y a pas de traduction
  function render(src) {
    const t = translate(src);
    if (t === null) return src;
    return (/^\s*/.exec(src)[0]) + t + (/\s*$/.exec(src)[0]);
  }
  const t = (s) => { const r = translate(s); return r === null ? s : r; };

  // ---- application au document -------------------------------------------------
  function skipped(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP_TAGS[e.nodeName] || e.isContentEditable || (e.hasAttribute && (e.hasAttribute("data-no-i18n") || e.classList.contains("notranslate")))) return true;
    }
    return false;
  }
  function applyText(node) {
    const data = node.data;
    let rec = textRec.get(node);
    if (!rec) { if (!HAS_LETTERS.test(data)) return; rec = { src: data, out: data }; textRec.set(node, rec); }
    else if (data !== rec.out) rec.src = data; // texte réécrit par l'application : nouvelle source
    const out = render(rec.src);
    rec.out = out;
    if (data !== out) node.data = out;
  }
  function applyAttrs(el) {
    let recs = attrRec.get(el);
    for (let i = 0; i < ATTRS.length; i++) {
      const a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      const val = el.getAttribute(a);
      if (!recs) { recs = {}; attrRec.set(el, recs); }
      let rec = recs[a];
      if (!rec) { if (!HAS_LETTERS.test(val)) continue; rec = recs[a] = { src: val, out: val }; }
      else if (val !== rec.out) rec.src = val;
      const out = render(rec.src);
      rec.out = out;
      if (val !== out) el.setAttribute(a, out);
    }
    if (el.nodeName === "META" && /^(description|og:title|og:description|twitter:title|twitter:description)$/.test(el.getAttribute("name") || el.getAttribute("property") || "")) {
      if (!recs) { recs = {}; attrRec.set(el, recs); }
      const val = el.getAttribute("content") || "";
      const rec = recs.content || (recs.content = { src: val, out: val });
      rec.out = render(rec.src);
      if (val !== rec.out) el.setAttribute("content", rec.out);
    }
  }
  function applyTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (root.parentNode && !skipped(root.parentNode)) applyText(root); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    applyAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
        if (SKIP_TAGS[n.nodeName] || n.isContentEditable || n.hasAttribute("data-no-i18n") || n.classList.contains("notranslate")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { if (n.nodeType === 3) applyText(n); else applyAttrs(n); }
  }

  // Tout texte ajouté ou modifié plus tard par les modules passe par ici
  let queue = [], scheduled = false;
  function flush() {
    scheduled = false;
    const items = queue; queue = [];
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      if (m.type === "childList") m.addedNodes.forEach((n) => { if (n.isConnected) applyTree(n); });
      else if (m.type === "characterData") { const n = m.target; if (n.nodeType === 3 && n.isConnected && n.parentNode && !skipped(n.parentNode)) applyText(n); }
      else if (m.type === "attributes") { const el = m.target; if (el.isConnected && !skipped(el)) applyAttrs(el); }
    }
  }
  const observer = new MutationObserver((list) => {
    if (lang === SOURCE && !observer.tracking) return;
    for (let i = 0; i < list.length; i++) queue.push(list[i]);
    if (!scheduled) { scheduled = true; Promise.resolve().then(flush); }
  });
  function observe() {
    observer.tracking = true;
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // ---- textes hors du document : boîtes de dialogue, canevas, PDF ----------------
  ["alert", "confirm", "prompt"].forEach((fn) => {
    const orig = window[fn];
    if (typeof orig !== "function") return;
    window[fn] = function (msg) { const args = Array.prototype.slice.call(arguments); if (typeof msg === "string") args[0] = msg.split("\n").map(t).join("\n"); return orig.apply(window, args); };
  });
  if (window.CanvasRenderingContext2D) {
    ["fillText", "strokeText", "measureText"].forEach((fn) => {
      const proto = CanvasRenderingContext2D.prototype, orig = proto[fn];
      if (typeof orig !== "function") return;
      proto[fn] = function (text) { if (lang !== SOURCE && typeof text === "string") arguments[0] = t(text); return orig.apply(this, arguments); };
    });
  }
  function hookPdf() {
    const J = window.jspdf && window.jspdf.jsPDF;
    if (!J || !J.API || J.API.__pfI18n) return;
    J.API.__pfI18n = true;
    const tx = (v) => (typeof v === "string" ? t(v) : Array.isArray(v) ? v.map(tx) : v);
    ["text", "getTextWidth", "splitTextToSize", "getStringUnitWidth", "getTextDimensions"].forEach((fn) => {
      const orig = J.API[fn];
      if (typeof orig !== "function") return;
      J.API[fn] = function () { if (lang !== SOURCE) arguments[0] = tx(arguments[0]); return orig.apply(this, arguments); };
    });
  }

  // ---- choix de la langue ----------------------------------------------------------
  const known = (code) => langs.some((l) => l.code === code);
  function detect() {
    try { const q = new URLSearchParams(location.search).get("lang"); if (q && known(q.toLowerCase())) return q.toLowerCase(); } catch (e) {}
    try { const s = localStorage.getItem(STORE_KEY); if (s && known(s)) return s; } catch (e) {}
    // emplacement : fuseau horaire de l'appareil, comparé aux listes de i18n/langues.json
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    if (tz) {
      const hit = langs.find((l) => Array.isArray(l.fuseaux) && l.fuseaux.some((z) => (z.endsWith("/") ? tz.indexOf(z) === 0 : tz === z)));
      if (hit) return hit.code;
    }
    // fuseau partagé entre plusieurs langues (ex. l'est du Canada) : langue du navigateur
    const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    for (let i = 0; i < prefs.length; i++) { const c = String(prefs[i]).slice(0, 2).toLowerCase(); if (known(c)) return c; }
    return SOURCE;
  }

  // Charge un fichier du dossier i18n/ comme un script ; le fichier s'enregistre lui-même par pfI18n.langue(...)
  function loadScript(file) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = base + file;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("fichier introuvable ou illisible : " + el.src));
      (document.head || document.documentElement).appendChild(el);
    });
  }
  async function loadDict(code) {
    if (code === SOURCE) return {};
    if (dicts[code]) return dicts[code];
    const entry = langs.find((l) => l.code === code) || {};
    await api.charger(entry.fichier || code + ".js");
    if (!dicts[code]) throw new Error("le fichier de langue « " + code + " » n'a pas appelé pfI18n.langue(\"" + code + "\", {...})");
    return dicts[code];
  }

  async function setLang(code, opts) {
    if (!known(code)) code = SOURCE;
    let dict = {};
    try { dict = await loadDict(code); } catch (e) {
      console.warn("[i18n] traductions indisponibles :", e);
      lastError = String((e && e.message) || e);
      code = SOURCE;
    }
    lang = code;
    setDict(dict);
    if (!opts || opts.save !== false) { try { localStorage.setItem(STORE_KEY, code); } catch (e) {} }
    document.documentElement.lang = code;
    if (code !== SOURCE || observer.tracking) { if (!observer.tracking) observe(); applyTree(document.documentElement); }
    hookPdf();
    document.querySelectorAll("select.pf-lang-select").forEach((s) => { s.value = code; });
    document.dispatchEvent(new CustomEvent("pf-lang-changed", { detail: { lang: code } }));
    return code;
  }

  // ---- menu de sélection --------------------------------------------------------------
  function fillMenus() {
    document.querySelectorAll("select.pf-lang-select").forEach((sel) => {
      sel.setAttribute("data-no-i18n", "");
      sel.innerHTML = "";
      langs.forEach((l) => { const o = document.createElement("option"); o.value = l.code; o.textContent = l.nom || l.code; sel.appendChild(o); });
      sel.value = lang;
      if (!sel.__pfBound) { sel.__pfBound = true; sel.addEventListener("change", () => setLang(sel.value)); }
    });
  }

  let lastError = "";
  const api = window.pfI18n = {
    t, setLang, hookPdf,
    charger: loadScript,
    // appelés par les fichiers du dossier i18n/
    langues(list) { if (Array.isArray(list) && list.length) { langs = list.filter((l) => l && l.code); if (!known(SOURCE)) langs.unshift({ code: SOURCE, nom: "Français" }); } },
    langue(code, dict) { if (code && dict && typeof dict === "object") dicts[code] = dict; },
    get erreur() { return lastError; },
    get lang() { return lang; },
    get langs() { return langs.slice(); },
    missing: () => Array.from(missing).sort()
  };

  (async function start() {
    try { await api.charger("langues.js"); } catch (e) { lastError = String((e && e.message) || e); console.warn("[i18n] liste des langues indisponible, liste de secours utilisée :", e); }
    const first = detect();
    const ready = () => { fillMenus(); hookPdf(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
    if (first !== SOURCE) await setLang(first, { save: false }); else document.documentElement.lang = SOURCE;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { fillMenus(); if (lang !== SOURCE) applyTree(document.documentElement); });
    window.addEventListener("load", hookPdf);
  })();
})();
