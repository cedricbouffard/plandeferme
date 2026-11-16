/*
  Visionneuse de plans (plans de drainage numérisés)
  --------------------------------------------------
  Un lien marqué data-pf-plan s'ouvre dans une fenêtre par-dessus la carte, au lieu de quitter le site :
  zoom à la molette ou au pincement, déplacement en glissant, double-clic pour agrandir.
  Ctrl+clic, clic du milieu ou le bouton « Nouvel onglet » gardent l'ouverture dans un autre onglet.
  Si le fichier n'est pas une image (PDF, page web), il est affiché dans un cadre.
*/
(function () {
  "use strict";
  if (window.pfPlanViewer) return;
  let root = null, img = null, frame = null, stage = null, titleEl = null, statusEl = null, linkEl = null;
  let scale = 1, tx = 0, ty = 0, fitScale = 1, lastFocus = null;
  const pointers = new Map();
  let pinch = null;

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "pf-plan-viewer";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Plan numérisé");
    root.innerHTML = `
      <div class="pf-plan-bar">
        <span class="pf-plan-title" data-no-i18n></span>
        <span class="pf-plan-tools">
          <button type="button" class="pf-plan-btn" data-act="out" title="Réduire" aria-label="Réduire">−</button>
          <button type="button" class="pf-plan-btn" data-act="in" title="Agrandir" aria-label="Agrandir">+</button>
          <button type="button" class="pf-plan-btn pf-plan-text" data-act="fit" title="Ajuster le plan à la fenêtre">Ajuster</button>
          <a class="pf-plan-btn pf-plan-text pf-plan-newtab" target="_blank" rel="noopener noreferrer" title="Ouvrir le fichier dans un nouvel onglet">Nouvel onglet</a>
          <button type="button" class="pf-plan-btn pf-plan-close" data-act="close" title="Fermer (Échap)" aria-label="Fermer">×</button>
        </span>
      </div>
      <div class="pf-plan-stage">
        <div class="pf-plan-status" aria-live="polite"></div>
        <img class="pf-plan-img" alt="Plan numérisé" draggable="false" />
        <iframe class="pf-plan-frame" title="Plan numérisé" hidden></iframe>
      </div>`;
    document.body.appendChild(root);
    img = root.querySelector(".pf-plan-img"); frame = root.querySelector(".pf-plan-frame"); stage = root.querySelector(".pf-plan-stage");
    titleEl = root.querySelector(".pf-plan-title"); statusEl = root.querySelector(".pf-plan-status"); linkEl = root.querySelector(".pf-plan-newtab");

    root.querySelector(".pf-plan-bar").addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const act = b.dataset.act;
      if (act === "close") close();
      else if (act === "fit") fit();
      else zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, act === "in" ? 1.5 : 1 / 1.5);
    });
    img.addEventListener("load", () => { statusEl.textContent = ""; img.style.visibility = "visible"; fit(); });
    img.addEventListener("error", () => { // pas une image lisible : on tente un cadre (PDF, page)
      if (!root.classList.contains("open") || !img.getAttribute("src")) return;
      img.style.visibility = "hidden";
      frame.hidden = false; frame.src = linkEl.href;
      statusEl.textContent = "Si le plan ne s'affiche pas ici, utilisez « Nouvel onglet ».";
      root.classList.add("pf-plan-framed");
    });
    stage.addEventListener("wheel", (e) => {
      if (!frame.hidden) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    stage.addEventListener("dblclick", (e) => { if (!frame.hidden) return; const r = stage.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 2); });
    stage.addEventListener("pointerdown", (e) => {
      if (!frame.hidden || e.button > 0) return;
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { const p = Array.from(pointers.values()); pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1 }; }
      stage.classList.add("pf-plan-grab");
    });
    stage.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId); if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) { tx += cur.x - prev.x; ty += cur.y - prev.y; apply(); }
      else if (pointers.size === 2 && pinch) {
        const p = Array.from(pointers.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, r = stage.getBoundingClientRect();
        zoomAt((p[0].x + p[1].x) / 2 - r.left, (p[0].y + p[1].y) / 2 - r.top, d / pinch.d);
        pinch.d = d;
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) stage.classList.remove("pf-plan-grab"); };
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (e.key === "+" || e.key === "=") zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.5);
      else if (e.key === "-") zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.5);
      else if (e.key === "0") fit();
    });
    window.addEventListener("resize", () => { if (root.classList.contains("open") && frame.hidden && Math.abs(scale - fitScale) < 1e-6) fit(); });
  }

  function apply() { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; }
  function fit() {
    const w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) return;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    fitScale = scale = Math.min(sw / w, sh / h, 1);
    tx = (sw - w * scale) / 2; ty = (sh - h * scale) / 2;
    apply();
  }
  function zoomAt(x, y, factor) {
    const next = Math.max(fitScale * 0.5, Math.min(12, scale * factor)), k = next / scale;
    tx = x - (x - tx) * k; ty = y - (y - ty) * k; scale = next;
    apply();
  }

  function open(url, title) {
    if (!url) return;
    build();
    lastFocus = document.activeElement;
    let name = title || "";
    if (!name) { try { name = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() || ""); } catch (e) { name = ""; } }
    titleEl.textContent = name || "Plan";
    linkEl.href = url;
    root.classList.remove("pf-plan-framed");
    frame.hidden = true; frame.removeAttribute("src");
    img.style.visibility = "hidden"; img.style.transform = "";
    statusEl.textContent = "Chargement du plan…";
    root.classList.add("open");
    img.src = url;
    const closeBtn = root.querySelector(".pf-plan-close"); if (closeBtn) closeBtn.focus({ preventScroll: true });
  }
  function close() {
    if (!root) return;
    root.classList.remove("open", "pf-plan-framed");
    img.removeAttribute("src"); frame.hidden = true; frame.removeAttribute("src");
    pointers.clear(); pinch = null;
    if (lastFocus && typeof lastFocus.focus === "function" && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  // Tout lien marqué data-pf-plan s'ouvre dans la visionneuse (sauf Ctrl/Cmd/Maj+clic : nouvel onglet habituel)
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest ? e.target.closest("a[data-pf-plan]") : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const href = a.getAttribute("href"); if (!href) return;
    e.preventDefault();
    open(a.href, a.getAttribute("data-pf-plan") || "");
  });

  window.pfPlanViewer = { open, close };
})();
