(() => {
  const state = {
    reportes: [],
    adminReportes: [],
    adminUsuarios: [],
    adminEquipos: [],
    adminUsuarioEquipoIds: [],
    adminReporteEquipoIds: [],
    me: null,
    autoRefreshTimer: null,
    apiBase: window.location.origin,
    selectedRequestId: null,
  };

  const AUTH_STORAGE_KEY = "reporteador_token";
  const SIDEBAR_COLLAPSED_KEY = "reporteador_sidebar_collapsed";

  function getToken() {
    return localStorage.getItem(AUTH_STORAGE_KEY);
  }

  function setToken(token) {
    if (token) localStorage.setItem(AUTH_STORAGE_KEY, token);
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  function showLoginView(errorMessage) {
    $("login-view").style.display = "flex";
    $("app-view").style.display = "none";
    
    const errorEl = $("loginError");
    if (errorMessage) {
      errorEl.innerText = errorMessage;
      errorEl.style.display = "";
    } else {
      errorEl.style.display = "none";
    }
    $("loginUsername").focus();
  }

  function showAppView() {
    $("login-view").style.display = "none";
    $("app-view").style.display = "grid";
  }

  function setAuthUI(me) {
    state.me = me || null;
    $("authUser").innerText = me?.username ? me.username : "-";
    const isAdmin = me?.roles?.includes("ADMIN") || me?.username === "admin";

    const adminTabs = [
      '.menu__item[data-tab="tab-admin-rutas"]',
      '.menu__item[data-tab="tab-admin-reportes"]',
      '.menu__item[data-tab="tab-admin-equipos"]',
    ];
    adminTabs.forEach((selector) => {
      const btn = document.querySelector(selector);
      if (btn) btn.style.display = isAdmin ? "" : "none";
    });

    const usersAdminCard = $("usuariosAdminCard");
    if (usersAdminCard) {
      usersAdminCard.style.display = isAdmin ? "" : "none";
    }
  }

  function setSidebarCollapsed(collapsed) {
    const appView = $("app-view");
    if (!appView) return;
    appView.classList.toggle("app-shell--collapsed", !!collapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }

  function openNuevaModal() {
    const modal = $("nuevaSolicitudModal");
    if (modal) modal.style.display = "";
  }

  function closeNuevaModal() {
    const modal = $("nuevaSolicitudModal");
    if (modal) modal.style.display = "none";
  }

  // ---------- Utils ----------
  const $ = (id) => document.getElementById(id);

  const fmtDate = (iso) => {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const safeJsonParse = (txt, fallback = {}) => {
    try {
      const val = JSON.parse(txt);
      return val ?? fallback;
    } catch {
      return null;
    }
  };

  const esc = (s) => (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function showAlert(message, type = "info") {
    const wrap = $("alerts");
    const el = document.createElement("div");
    el.className = `alert alert--${type}`;
    el.innerText = message;
    wrap.prepend(el);
    setTimeout(() => el.remove(), 4500);
  }

  async function api(path, opts = {}) {
    const token = getToken();

    const headers = {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };

    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${state.apiBase}${path}`, {
      ...opts,
      headers,
    });

    if (!res.ok) {
      // Si expira token o es inválido
      if (res.status === 401) {
        let detail = "No autenticado";
        try {
          const b = await res.json();
          detail = b.detail;
        } catch (e) { /* ignore */ }
        
        setToken(null);
        showLoginView(`Sesión expirada o inválida. Por favor, ingrese de nuevo. (Detalle: ${detail})`);
      }

      if (res.status === 403) {
        throw new Error("Permisos insuficientes. Requieres permisos de administrador.");
      }

      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = body.detail || detail;
      } catch (_) { }
      throw new Error(detail);
    }

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res.text();
  }

  // ---------- Tabs ----------
  function setupTabs() {
    const buttons = document.querySelectorAll(".menu__item");
    const tabs = document.querySelectorAll(".tab");

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");

        const target = btn.dataset.tab;
        tabs.forEach((t) => t.classList.remove("is-active"));
        $(target).classList.add("is-active");
      });
    });
  }

  // ---------- Health ----------
  async function loadHealth() {
    const badge = $("healthBadge");
    try {
      const h = await api("/health");
      badge.className = "badge badge--ok";
      badge.textContent = `API OK • Cliente: ${h.client_ip}`;
    } catch (e) {
      badge.className = "badge badge--err";
      badge.textContent = `API caída: ${e.message}`;
    }
  }

  // ---------- Reportes ----------
  async function loadReportes() {
    const sel = $("reporte");
    sel.innerHTML = `<option value="">Cargando...</option>`;
    try {
      const rows = await api("/reportes");
      state.reportes = rows || [];
      if (!rows.length) {
        sel.innerHTML = `<option value="">No hay reportes activos</option>`;
        return;
      }

      sel.innerHTML = `<option value="">Seleccione un reporte</option>` +
        rows.map(r => `<option value="${esc(r.codigo)}">${esc(r.codigo)} — ${esc(r.nombre)}</option>`).join("");

      updateHintRutaInput();

      // Also update admin dropdown
      fillAdminReportesSelect();
    } catch (e) {
      sel.innerHTML = `<option value="">Error al cargar reportes</option>`;
      showAlert(`No se pudieron cargar reportes: ${e.message}`, "err");
    }
  }

  async function cargarArchivosReporte(codigo) {
    const res = await fetch(`/reportes/${encodeURIComponent(codigo)}/archivos-input`);
    const data = await res.json();
    const sel = document.getElementById("ruta_input_select");
    sel.innerHTML = `<option value="">-- Selecciona un archivo --</option>`;

    for (const ruta of (data.archivos || [])) {
      const opt = document.createElement("option");
      opt.value = ruta;
      sel.appendChild(opt);
    }

    document.getElementById("archivos_help").textContent = `${(data.archivos || []).length} archivo(s) disponibles`;
  }

  function getReporteByCodigo(codigo) {
    return state.reportes.find(r => r.codigo === codigo) || null;
  }

  function updateHintRutaInput() {
    const codigo = $("reporte").value || "";
    const r = getReporteByCodigo(codigo);
    const hint = $("hintRutaInput");

    if (!hint) return;

    if (!r) {
      hint.textContent = "Este reporte podría requerir archivo de entrada.";
      return;
    }

    if (r.requiere_input_archivo) {
      const tipos = r.tipos_permitidos ? ` (${r.tipos_permitidos})` : "";
      hint.textContent = `Obligatorio para este reporte${tipos}.`;
    } else {
      hint.textContent = "Opcional para este reporte.";
    }
  }

  // ---------- Nueva solicitud ----------
  function setupNuevaSolicitud() {
    $("reporte").addEventListener("change", async () => {
      updateHintRutaInput();
      await cargarArchivosPermitidosDelReporte();
    });
    $("btn_cargar_archivos")?.addEventListener("click", async () => {
      try {
        await cargarArchivosPermitidosDelReporte();
      } catch (e) {
        showAlert(`No se pudieron cargar archivos: ${e.message}`, "err");
      }
    });

    $("btnLimpiar").addEventListener("click", () => {
      $("formNueva").reset();
      $("parametros").value = "";
      $("resultNueva").innerHTML = `<div class="result-empty">Formulario limpiado.</div>`;
      updateHintRutaInput();
    });

    $("formNueva").addEventListener("submit", async (ev) => {
      ev.preventDefault();

      const reporte_codigo = $("reporte").value.trim();
      const ruta_input_raw = $("ruta_input_select")?.value || "";
      const parametros_txt = $("parametros").value.trim();

      if (!reporte_codigo) {
        showAlert("Selecciona un reporte.", "err");
        return;
      }

      let parametros = {};
      if (parametros_txt) {
        const parsed = safeJsonParse(parametros_txt, {});
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          showAlert("Parámetros JSON inválidos. Debe ser un objeto JSON.", "err");
          return;
        }
        parametros = parsed;
      }

      const payload = {
        // usuario: sera tomado del token en backend
        reporte_codigo,
        ruta_input: ruta_input_raw.trim() || null,
        parametros,
        max_intentos: 2,
      };

      try {
        const out = await api("/solicitudes", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        state.selectedRequestId = out.request_id;
        $("detalleRequestId").value = out.request_id;
        renderResultNueva(out);
        closeNuevaModal();
        showAlert(`Solicitud enviada: ${out.request_id}`, "ok");

        // precargar usuario en filtros usando el usuario de la respuesta
        $("fUsuario").value = out.usuario;

        // refresca lista y detalle
        await fetchMisSolicitudes();
        await cargarDetalle(out.request_id);
      } catch (e) {
        showAlert(`No se pudo crear solicitud: ${e.message}`, "err");
      }
    });
  }

  async function cargarArchivosPermitidosDelReporte() {
    const reporteSel = $("reporte");
    const sel = $("ruta_input_select");

    if (!reporteSel || !sel) return;

    const codigo = (reporteSel.value || "").trim();

    // reset visual
    sel.innerHTML = `<option value="">Seleccione archivo...</option>`;

    if (!codigo) return;

    sel.innerHTML = `<option value="">Cargando archivos...</option>`;

    try {
      const data = await api(`/reportes/${encodeURIComponent(codigo)}/archivos-input`);
      const archivos = Array.isArray(data?.archivos) ? data.archivos : [];

      if (!archivos.length) {
        sel.innerHTML = `<option value="">No hay archivos disponibles</option>`;
        return;
      }

      sel.innerHTML =
        `<option value="">Seleccione archivo...</option>` +
        archivos.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join("");

    } catch (e) {
      sel.innerHTML = `<option value="">Error cargando archivos</option>`;
      showAlert(`No se pudieron cargar archivos permitidos: ${e.message}`, "err");
    }
  }

  function renderResultNueva(out) {
    const html = `
      <div class="result-card">
        <div><strong>Solicitud creada correctamente</strong></div>
        <div class="result-card__id">${esc(out.request_id)}</div>
        <div><strong>Estado:</strong> ${esc(out.estado)} • <strong>Progreso:</strong> ${esc(out.progreso)}%</div>
        <div><strong>Mensaje:</strong> ${esc(out.mensaje_estado || "-")}</div>
        <div><strong>Usuario:</strong> ${esc(out.usuario)}</div>
        <div><strong>Reporte:</strong> ${esc(out.reporte_codigo)}</div>
        <div>
          <button class="btn btn--ghost" id="btnCopiarRequestId">Copiar Request ID</button>
          <button class="btn btn--primary" id="btnIrDetalle">Ver detalle</button>
        </div>
      </div>
    `;
    $("resultNueva").innerHTML = html;

    $("btnCopiarRequestId").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(out.request_id);
        showAlert("Request ID copiado al portapapeles.", "ok");
      } catch {
        showAlert("No se pudo copiar al portapapeles.", "err");
      }
    });

    $("btnIrDetalle").addEventListener("click", () => {
      document.querySelector(`.menu__item[data-tab="tab-detalle"]`).click();
      $("detalleRequestId").value = out.request_id;
      cargarDetalle(out.request_id);
    });
  }

  // ---------- Mis solicitudes ----------
  function statusPill(estado) {
    return `<span class="status-pill status-${esc(estado)}">${esc(estado)}</span>`;
  }

  function progressBar(v) {
    const value = Math.max(0, Math.min(100, Number(v || 0)));
    return `
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="progress"><span style="width:${value}%"></span></div>
        <small>${value}%</small>
      </div>
    `;
  }

  async function fetchMisSolicitudes() {
    const usuario = $("fUsuario").value.trim();
    const estado = $("fEstado").value.trim();
    const limitInput = $("fLimit");
    const limit = Number(limitInput?.value || 100);

    if (!usuario) {
      $("tbodyMis").innerHTML = `<tr><td colspan="8" class="table-empty">Ingresa un usuario para buscar.</td></tr>`;
      return;
    }

    try {
      const rows = await api(`/mis-solicitudes?usuario=${encodeURIComponent(usuario)}&limit=${encodeURIComponent(limit)}`);
      const filtered = estado ? rows.filter(r => r.estado === estado) : rows;
      renderTablaMis(filtered);
    } catch (e) {
      showAlert(`Error consultando solicitudes: ${e.message}`, "err");
    }
  }

  function renderTablaMis(rows) {
    const tb = $("tbodyMis");
    if (!rows?.length) {
      tb.innerHTML = `<tr><td colspan="8" class="table-empty">No se encontraron solicitudes.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map(r => `
      <tr>
        <td class="mono">${esc(r.request_id)}</td>
        <td>${esc(r.reporte_codigo)}</td>
        <td>${statusPill(r.estado)}</td>
        <td>${progressBar(r.progreso)}</td>
        <td>${esc(r.mensaje_estado || "-")}</td>
        <td>${esc(fmtDate(r.fecha_solicitud))}</td>
        <td>${esc(fmtDate(r.updated_at))}</td>
        <td>
          <button class="btn btn--ghost btn-detalle" data-rid="${esc(r.request_id)}">Ver</button>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-detalle").forEach(btn => {
      btn.addEventListener("click", () => {
        const rid = btn.dataset.rid;
        state.selectedRequestId = rid;
        $("detalleRequestId").value = rid;
        document.querySelector(`.menu__item[data-tab="tab-detalle"]`).click();
        cargarDetalle(rid);
      });
    });
  }

  function setupMisSolicitudes() {
    $("btnBuscarMis").addEventListener("click", fetchMisSolicitudes);

    $("btnRefreshAll").addEventListener("click", async () => {
      await loadHealth();
      await loadReportes();
      await fetchMisSolicitudes();
      await loadAdminReportes();
      await loadAdminEquiposData();
      await fetchUsuariosAdmin();
      if (state.selectedRequestId) {
        await cargarDetalle(state.selectedRequestId);
      }
      showAlert("Panel actualizado.", "info");
    });

    $("autoRefresh").addEventListener("change", setupAutoRefresh);
    setupAutoRefresh();
  }

  function setupAutoRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
    if ($("autoRefresh").checked) {
      state.autoRefreshTimer = setInterval(async () => {
        await fetchMisSolicitudes();
        if (state.selectedRequestId) await cargarDetalle(state.selectedRequestId);
      }, 5000);
    }
  }

  // ---------- Detalle ----------
  async function cargarDetalle(requestId) {
    const rid = (requestId || $("detalleRequestId").value || "").trim();
    if (!rid) {
      showAlert("Ingresa un Request ID.", "err");
      return;
    }

    try {
      const [sol, eventos] = await Promise.all([
        api(`/solicitudes/${encodeURIComponent(rid)}`),
        api(`/solicitudes/${encodeURIComponent(rid)}/eventos`)
      ]);
      state.selectedRequestId = rid;
      renderDetalle(sol, eventos);
    } catch (e) {
      $("detalleResumen").innerHTML = `<div class="result-empty">No se pudo cargar detalle: ${esc(e.message)}</div>`;
      $("detalleEventos").innerHTML = `<div class="result-empty">Sin eventos.</div>`;
      showAlert(`Error detalle: ${e.message}`, "err");
    }
  }

  function renderDetalle(sol, eventos) {
    $("detalleResumen").innerHTML = `
      <div class="kv"><label>Request ID</label><div class="mono">${esc(sol.request_id)}</div></div>
      <div class="kv"><label>Reporte</label><div>${esc(sol.reporte_codigo)}</div></div>
      <div class="kv"><label>Usuario</label><div>${esc(sol.usuario)}</div></div>
      <div class="kv"><label>Estado</label><div>${statusPill(sol.estado)}</div></div>
      <div class="kv"><label>Progreso</label><div>${progressBar(sol.progreso)}</div></div>
      <div class="kv"><label>Mensaje</label><div>${esc(sol.mensaje_estado || "-")}</div></div>
      <div class="kv"><label>Solicitado</label><div>${esc(fmtDate(sol.fecha_solicitud))}</div></div>
      <div class="kv"><label>Inicio</label><div>${esc(fmtDate(sol.fecha_inicio))}</div></div>
      <div class="kv"><label>Fin</label><div>${esc(fmtDate(sol.fecha_fin))}</div></div>
      <div class="kv"><label>Ruta output</label><div>${esc(sol.ruta_output || "-")}</div></div>
      <div class="kv"><label>Error detalle</label><div>${esc(sol.error_detalle || "-")}</div></div>
      <div class="kv"><label>Última actualización</label><div>${esc(fmtDate(sol.updated_at))}</div></div>
    `;

    if (!eventos?.length) {
      $("detalleEventos").innerHTML = `<div class="result-empty">No hay eventos.</div>`;
      return;
    }

    $("detalleEventos").innerHTML = eventos.map(ev => `
      <div class="tl-item">
        <div class="tl-item__meta">
          <span><strong>${esc(ev.tipo_evento)}</strong></span>
          <span>•</span>
          <span>${esc(ev.origen || "-")}</span>
          <span>•</span>
          <span>${esc(fmtDate(ev.created_at))}</span>
        </div>
        <div>${esc(ev.detalle || "-")}</div>
      </div>
    `).join("");
  }

  function setupDetalle() {
    $("btnCargarDetalle").addEventListener("click", () => cargarDetalle());
  }

  function setupLayoutControls() {
    const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    setSidebarCollapsed(collapsed);

    $("btnSidebarToggle")?.addEventListener("click", () => {
      const appView = $("app-view");
      const isCollapsed = appView?.classList.contains("app-shell--collapsed");
      setSidebarCollapsed(!isCollapsed);
    });

    $("btnOpenNuevaModal")?.addEventListener("click", openNuevaModal);
    $("btnCloseNuevaModal")?.addEventListener("click", closeNuevaModal);
    $("btnCloseNuevaModalBg")?.addEventListener("click", closeNuevaModal);

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeNuevaModal();
    });
  }

  // ---------- Init ----------
  async function init() {
    $("apiBaseLabel").textContent = state.apiBase;
    setupLayoutControls();
    setupTabs();
    setupNuevaSolicitud();
    setupMisSolicitudes();
    setupDetalle();
    setupAdminRutas();
    setupAdminReportes();
    setupAdminEquipos();
    setupUsuarios();
    setupAuthUI();

    await bootstrapAuth();
    await loadHealth();
    await fillAdminReportesSelect();

    $("parametros").value = `{
  "periodo": "2026-02"
}`;
  }

  async function bootstrapAuth() {
    const token = getToken();
    if (!token) {
      showLoginView();
      return;
    }

    try {
      const me = await api("/auth/me");
      setAuthUI(me);
      if (me.username) $("fUsuario").value = me.username;

      showAppView();

      // Load initial dashboard data
      await loadReportes();
      await fetchMisSolicitudes();
      await loadAdminReportes();
      await loadAdminEquiposData();
      await fetchUsuariosAdmin();
    } catch (e) {
      setToken(null);
      showLoginView();
    }
  }

  // ---------- Admin Rutas ----------
  async function fillAdminReportesSelect() {
    const sel = $("adminReporte");
    if (!sel) return;

    const rows = state.reportes || [];
    if (!rows.length) {
      sel.innerHTML = `<option value="">No hay reportes activos</option>`;
      return;
    }

    sel.innerHTML =
      `<option value="">Seleccione un reporte</option>` +
      rows.map(r => `<option value="${esc(r.codigo)}">${esc(r.codigo)} — ${esc(r.nombre)}</option>`).join("");
  }

  async function fetchAdminRutas() {
    const codigo = $("adminReporte")?.value?.trim();
    const tb = $("tbodyAdminRutas");
    if (!tb) return;

    if (!codigo) {
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">Selecciona un reporte.</td></tr>`;
      return;
    }

    tb.innerHTML = `<tr><td colspan="4" class="table-empty">Cargando...</td></tr>`;

    try {
      const rows = await api(`/admin/reportes/${encodeURIComponent(codigo)}/carpetas`);
      renderAdminRutas(rows || []);
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">Error al cargar rutas.</td></tr>`;
      showAlert(`No se pudieron cargar rutas: ${e.message}`, "err");
    }
  }

  function renderAdminRutas(rows) {
    const tb = $("tbodyAdminRutas");
    if (!tb) return;

    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">No hay rutas registradas para este reporte.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map(r => `
      <tr>
        <td class="mono">${esc(r.id)}</td>
        <td>
          <input
            id="ruta_edit_${esc(r.id)}"
            type="text"
            value="${esc(r.ruta_base)}"
            style="width:100%;"
          />
        </td>
        <td>
          ${r.activo === 1
        ? '<span class="status-pill status-OK">ACTIVO</span>'
        : '<span class="status-pill status-CANCELADO">INACTIVO</span>'}
        </td>
        <td>
          <div class="inline-controls">
            <button class="btn btn--ghost btn-admin-guardar" data-id="${esc(r.id)}">Guardar</button>
            ${r.activo === 1
        ? `<button class="btn btn--ghost btn-admin-toggle" data-id="${esc(r.id)}" data-next="0">Desactivar</button>`
        : `<button class="btn btn--ghost btn-admin-toggle" data-id="${esc(r.id)}" data-next="1">Activar</button>`}
          </div>
        </td>
      </tr>
    `).join("");

    // Guardar ruta editada
    document.querySelectorAll(".btn-admin-guardar").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const inp = $(`ruta_edit_${id}`);
        const nuevaRuta = (inp?.value || "").trim();

        if (!nuevaRuta) {
          showAlert("La ruta no puede estar vacía.", "err");
          return;
        }

        try {
          await api(`/admin/carpetas/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ ruta_base: nuevaRuta }),
          });
          showAlert(`Ruta ${id} actualizada.`, "ok");
          await fetchAdminRutas();

          // refresca selector de archivos en Nueva Solicitud si coincide reporte actual
          const repNueva = $("reporte")?.value?.trim();
          const repAdmin = $("adminReporte")?.value?.trim();
          if (repNueva && repAdmin && repNueva === repAdmin) {
            await cargarArchivosPermitidosDelReporte();
          }
        } catch (e) {
          showAlert(`No se pudo actualizar ruta: ${e.message}`, "err");
        }
      });
    });

    // Activar / desactivar
    document.querySelectorAll(".btn-admin-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const next = Number(btn.dataset.next);

        try {
          await api(`/admin/carpetas/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ activo: next }),
          });
          showAlert(`Ruta ${id} ${next === 1 ? "activada" : "desactivada"}.`, "ok");
          await fetchAdminRutas();

          const repNueva = $("reporte")?.value?.trim();
          const repAdmin = $("adminReporte")?.value?.trim();
          if (repNueva && repAdmin && repNueva === repAdmin) {
            await cargarArchivosPermitidosDelReporte();
          }
        } catch (e) {
          showAlert(`No se pudo cambiar estado: ${e.message}`, "err");
        }
      });
    });
  }

  async function addAdminRuta() {
    const codigo = $("adminReporte")?.value?.trim();
    const ruta = $("adminRutaNueva")?.value?.trim();

    if (!codigo) {
      showAlert("Selecciona un reporte.", "err");
      return;
    }
    if (!ruta) {
      showAlert("Ingresa una ruta base.", "err");
      return;
    }

    try {
      await api(`/admin/reportes/${encodeURIComponent(codigo)}/carpetas`, {
        method: "POST",
        body: JSON.stringify({ ruta_base: ruta }),
      });
      $("adminRutaNueva").value = "";
      showAlert("Ruta agregada correctamente.", "ok");
      await fetchAdminRutas();

      // refresca selector de archivos de Nueva Solicitud si aplica
      const repNueva = $("reporte")?.value?.trim();
      if (repNueva && repNueva === codigo) {
        await cargarArchivosPermitidosDelReporte();
      }
    } catch (e) {
      showAlert(`No se pudo agregar ruta: ${e.message}`, "err");
    }
  }

  function setupAdminRutas() {
    if (!$("adminReporte")) return; // por si aún no está el tab en HTML

    // sincroniza reportes al selector admin
    fillAdminReportesSelect();

    $("btnAdminCargar")?.addEventListener("click", fetchAdminRutas);
    $("adminReporte")?.addEventListener("change", fetchAdminRutas);
    $("btnAdminAgregar")?.addEventListener("click", addAdminRuta);
  }

  // ---------- Admin Reportes ----------
  async function loadAdminReportes() {
    const tb = $("tbodyAdminReportes");
    if (!tb) return;

    const isAdmin = state.me?.roles?.includes("ADMIN") || state.me?.username === "admin";
    if (!isAdmin) {
      tb.innerHTML = `<tr><td colspan="7" class="table-empty">Sin permisos.</td></tr>`;
      return;
    }

    tb.innerHTML = `<tr><td colspan="7" class="table-empty">Cargando...</td></tr>`;
    try {
      const rows = await api("/admin/reportes");
      state.adminReportes = rows || [];
      renderAdminReportes(rows || []);
      fillReporteEquiposSelect();
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="7" class="table-empty">Error al cargar reportes.</td></tr>`;
      showAlert(`No se pudieron cargar reportes admin: ${e.message}`, "err");
    }
  }

  function renderAdminReportes(rows) {
    const tb = $("tbodyAdminReportes");
    if (!tb) return;

    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="7" class="table-empty">No hay reportes.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map((r) => `
      <tr>
        <td class="mono">${esc(r.id)}</td>
        <td><input id="adm_codigo_${esc(r.id)}" value="${esc(r.codigo)}" /></td>
        <td><input id="adm_nombre_${esc(r.id)}" value="${esc(r.nombre)}" /></td>
        <td><input id="adm_out_${esc(r.id)}" value="${esc(r.ruta_output_base || "")}" /></td>
        <td>
          <select id="adm_req_${esc(r.id)}">
            <option value="1" ${r.requiere_input_archivo === 1 ? "selected" : ""}>SI</option>
            <option value="0" ${r.requiere_input_archivo === 0 ? "selected" : ""}>NO</option>
          </select>
        </td>
        <td>
          <select id="adm_activo_${esc(r.id)}">
            <option value="1" ${r.activo === 1 ? "selected" : ""}>ACTIVO</option>
            <option value="0" ${r.activo === 0 ? "selected" : ""}>INACTIVO</option>
          </select>
        </td>
        <td>
          <div class="inline-controls">
            <button class="btn btn--ghost btn-admrep-save" data-id="${esc(r.id)}">Guardar</button>
            <button class="btn btn--ghost btn-admrep-delete" data-id="${esc(r.id)}">Desactivar</button>
          </div>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-admrep-save").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        try {
          await api(`/admin/reportes/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              codigo: $(`adm_codigo_${id}`)?.value?.trim(),
              nombre: $(`adm_nombre_${id}`)?.value?.trim(),
              ruta_output_base: $(`adm_out_${id}`)?.value?.trim() || null,
              requiere_input_archivo: Number($(`adm_req_${id}`)?.value || 0),
              activo: Number($(`adm_activo_${id}`)?.value || 0),
            }),
          });
          showAlert(`Reporte ${id} actualizado.`, "ok");
          await loadReportes();
          await loadAdminReportes();
        } catch (e) {
          showAlert(`No se pudo actualizar reporte: ${e.message}`, "err");
        }
      });
    });

    document.querySelectorAll(".btn-admrep-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        try {
          await api(`/admin/reportes/${encodeURIComponent(id)}`, { method: "DELETE" });
          showAlert(`Reporte ${id} desactivado.`, "ok");
          await loadReportes();
          await loadAdminReportes();
        } catch (e) {
          showAlert(`No se pudo desactivar reporte: ${e.message}`, "err");
        }
      });
    });
  }

  async function createAdminReporte() {
    const payload = {
      codigo: $("admRepCodigo")?.value?.trim(),
      nombre: $("admRepNombre")?.value?.trim(),
      descripcion: $("admRepDescripcion")?.value?.trim() || null,
      tipos_permitidos: $("admRepTipos")?.value?.trim() || null,
      comando: $("admRepComando")?.value?.trim() || null,
      ruta_output_base: $("admRepRutaOutput")?.value?.trim() || null,
      requiere_input_archivo: Number($("admRepReqInput")?.value || 0),
      activo: Number($("admRepActivo")?.value || 1),
    };

    if (!payload.codigo || !payload.nombre) {
      showAlert("Código y nombre son obligatorios.", "err");
      return;
    }

    try {
      await api("/admin/reportes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      $("admRepCodigo").value = "";
      $("admRepNombre").value = "";
      $("admRepDescripcion").value = "";
      $("admRepTipos").value = "";
      $("admRepComando").value = "";
      $("admRepRutaOutput").value = "";
      showAlert("Reporte creado correctamente.", "ok");
      await loadReportes();
      await loadAdminReportes();
    } catch (e) {
      showAlert(`No se pudo crear reporte: ${e.message}`, "err");
    }
  }

  function setupAdminReportes() {
    $("btnAdmRepCrear")?.addEventListener("click", createAdminReporte);
    $("btnAdmRepRefrescar")?.addEventListener("click", loadAdminReportes);
  }

  // ---------- Admin Equipos ----------
  function renderChecks(containerId, equipos, selectedIds = [], stateKey = null, filterText = "") {
    const wrap = $(containerId);
    if (!wrap) return;

    const selected = new Set((selectedIds || []).map(Number));
    const filter = (filterText || "").trim().toLowerCase();
    const filteredEquipos = filter
      ? (equipos || []).filter((e) => (e.nombre || "").toLowerCase().includes(filter))
      : (equipos || []);

    if (!equipos?.length) {
      wrap.innerHTML = `<div class="result-empty">No hay equipos disponibles.</div>`;
      return;
    }

    if (!filteredEquipos.length) {
      wrap.innerHTML = `<div class="result-empty">No hay equipos que coincidan con el filtro.</div>`;
      return;
    }

    wrap.innerHTML = filteredEquipos.map((e) => `
      <label class="check-item">
        <input type="checkbox" value="${esc(e.id)}" ${selected.has(Number(e.id)) ? "checked" : ""} />
        <span>${esc(e.nombre)}</span>
      </label>
    `).join("");

    if (stateKey) {
      wrap.querySelectorAll("input[type='checkbox']").forEach((el) => {
        el.addEventListener("change", () => {
          const current = new Set((state[stateKey] || []).map(Number));
          const id = Number(el.value);
          if (el.checked) current.add(id);
          else current.delete(id);
          state[stateKey] = Array.from(current);
        });
      });
    }
  }

  function fillUsuarioEquiposSelect() {
    const sel = $("admUsuarioEquipo");
    if (!sel) return;

    const rows = state.adminUsuarios || [];
    if (!rows.length) {
      sel.innerHTML = `<option value="">No hay usuarios</option>`;
      return;
    }
    sel.innerHTML =
      `<option value="">Seleccione usuario</option>` +
      rows.map((u) => `<option value="${esc(u.id)}">${esc(u.username)}</option>`).join("");
  }

  function fillReporteEquiposSelect() {
    const sel = $("admReporteEquipo");
    if (!sel) return;

    const rows = state.adminReportes || [];
    if (!rows.length) {
      sel.innerHTML = `<option value="">No hay reportes</option>`;
      return;
    }
    sel.innerHTML =
      `<option value="">Seleccione reporte</option>` +
      rows.map((r) => `<option value="${esc(r.id)}">${esc(r.codigo)} - ${esc(r.nombre)}</option>`).join("");
  }

  function renderUsuarioEquiposChecks() {
    renderChecks(
      "admUsuarioEquiposChecks",
      state.adminEquipos,
      state.adminUsuarioEquipoIds,
      "adminUsuarioEquipoIds",
      $("admUsuarioEquiposFiltro")?.value || ""
    );
  }

  function renderReporteEquiposChecks() {
    renderChecks(
      "admReporteEquiposChecks",
      state.adminEquipos,
      state.adminReporteEquipoIds,
      "adminReporteEquipoIds",
      $("admReporteEquiposFiltro")?.value || ""
    );
  }

  function renderEquiposTable(rows) {
    const tb = $("tbodyEquipos");
    if (!tb) return;
    if (!rows?.length) {
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">No hay equipos.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map((e) => `
      <tr>
        <td class="mono">${esc(e.id)}</td>
        <td><input id="equipo_nombre_${esc(e.id)}" value="${esc(e.nombre)}" /></td>
        <td>
          <select id="equipo_activo_${esc(e.id)}">
            <option value="1" ${Number(e.activo) === 1 ? "selected" : ""}>ACTIVO</option>
            <option value="0" ${Number(e.activo) === 0 ? "selected" : ""}>INACTIVO</option>
          </select>
        </td>
        <td>
          <button class="btn btn--ghost btn-equipo-save" data-id="${esc(e.id)}">Guardar</button>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-equipo-save").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        try {
          await api(`/admin/equipos/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              nombre: $(`equipo_nombre_${id}`)?.value?.trim(),
              activo: Number($(`equipo_activo_${id}`)?.value || 1),
            }),
          });
          showAlert(`Equipo ${id} actualizado.`, "ok");
          await loadAdminEquiposData();
        } catch (e) {
          showAlert(`No se pudo actualizar equipo: ${e.message}`, "err");
        }
      });
    });
  }

  async function loadAdminEquiposData() {
    const isAdmin = state.me?.roles?.includes("ADMIN") || state.me?.username === "admin";
    if (!isAdmin) return;

    try {
      const [equipos, usuarios, reportes] = await Promise.all([
        api("/admin/equipos"),
        api("/admin/usuarios"),
        api("/admin/reportes"),
      ]);
      state.adminEquipos = equipos || [];
      state.adminUsuarios = usuarios || [];
      state.adminReportes = reportes || [];

      renderEquiposTable(state.adminEquipos);
      fillUsuarioEquiposSelect();
      fillReporteEquiposSelect();
      renderUsuarioEquiposChecks();
      renderReporteEquiposChecks();
    } catch (e) {
      showAlert(`No se pudo cargar administración de equipos: ${e.message}`, "err");
    }
  }

  async function createEquipoAdmin() {
    const nombre = $("admEquipoNombre")?.value?.trim();
    const activo = Number($("admEquipoActivo")?.value || 1);
    if (!nombre) {
      showAlert("Ingresa el nombre del equipo.", "err");
      return;
    }
    try {
      await api("/admin/equipos", {
        method: "POST",
        body: JSON.stringify({ nombre, activo }),
      });
      $("admEquipoNombre").value = "";
      $("admEquipoActivo").value = "1";
      showAlert("Equipo creado correctamente.", "ok");
      await loadAdminEquiposData();
    } catch (e) {
      showAlert(`No se pudo crear equipo: ${e.message}`, "err");
    }
  }

  async function loadEquiposUsuarioSeleccionado() {
    const usuarioId = $("admUsuarioEquipo")?.value?.trim();
    if (!usuarioId) {
      state.adminUsuarioEquipoIds = [];
      renderUsuarioEquiposChecks();
      return;
    }
    try {
      const rows = await api(`/admin/usuarios/${encodeURIComponent(usuarioId)}/equipos`);
      state.adminUsuarioEquipoIds = (rows || []).map((r) => Number(r.id));
      renderUsuarioEquiposChecks();
    } catch (e) {
      showAlert(`No se pudieron cargar equipos del usuario: ${e.message}`, "err");
    }
  }

  async function saveEquiposUsuario() {
    const usuarioId = $("admUsuarioEquipo")?.value?.trim();
    if (!usuarioId) {
      showAlert("Selecciona un usuario.", "err");
      return;
    }
    const ids = (state.adminUsuarioEquipoIds || []).map(Number);
    try {
      await api(`/admin/usuarios/${encodeURIComponent(usuarioId)}/equipos`, {
        method: "PUT",
        body: JSON.stringify({ equipo_ids: ids }),
      });
      showAlert("Asignación de equipos a usuario actualizada.", "ok");
      await loadReportes();
    } catch (e) {
      showAlert(`No se pudo guardar asignación de usuario: ${e.message}`, "err");
    }
  }

  async function loadEquiposReporteSeleccionado() {
    const reporteId = $("admReporteEquipo")?.value?.trim();
    if (!reporteId) {
      state.adminReporteEquipoIds = [];
      renderReporteEquiposChecks();
      return;
    }
    try {
      const rows = await api(`/admin/reportes/${encodeURIComponent(reporteId)}/equipos`);
      state.adminReporteEquipoIds = (rows || []).map((r) => Number(r.id));
      renderReporteEquiposChecks();
    } catch (e) {
      showAlert(`No se pudieron cargar equipos del reporte: ${e.message}`, "err");
    }
  }

  async function saveEquiposReporte() {
    const reporteId = $("admReporteEquipo")?.value?.trim();
    if (!reporteId) {
      showAlert("Selecciona un reporte.", "err");
      return;
    }
    const ids = (state.adminReporteEquipoIds || []).map(Number);
    try {
      await api(`/admin/reportes/${encodeURIComponent(reporteId)}/equipos`, {
        method: "PUT",
        body: JSON.stringify({ equipo_ids: ids }),
      });
      showAlert("Asignación de equipos a reporte actualizada.", "ok");
      await loadReportes();
    } catch (e) {
      showAlert(`No se pudo guardar asignación de reporte: ${e.message}`, "err");
    }
  }

  function setupAdminEquipos() {
    $("btnAdmEquipoCrear")?.addEventListener("click", createEquipoAdmin);
    $("btnAdmEquipoRefrescar")?.addEventListener("click", loadAdminEquiposData);
    $("admUsuarioEquipo")?.addEventListener("change", loadEquiposUsuarioSeleccionado);
    $("admUsuarioEquiposFiltro")?.addEventListener("input", renderUsuarioEquiposChecks);
    $("btnAdmUsuarioEquiposGuardar")?.addEventListener("click", saveEquiposUsuario);
    $("admReporteEquipo")?.addEventListener("change", loadEquiposReporteSeleccionado);
    $("admReporteEquiposFiltro")?.addEventListener("input", renderReporteEquiposChecks);
    $("btnAdmReporteEquiposGuardar")?.addEventListener("click", saveEquiposReporte);
  }

  // ---------- Usuarios ----------
  async function cambiarPassword() {
    const current_password = $("pwdActual")?.value || "";
    const new_password = $("pwdNueva")?.value || "";

    if (!current_password || !new_password) {
      showAlert("Completa la contraseña actual y la nueva.", "err");
      return;
    }

    try {
      await api("/auth/change-password", {
        method: "PATCH",
        body: JSON.stringify({ current_password, new_password }),
      });
      $("pwdActual").value = "";
      $("pwdNueva").value = "";
      showAlert("Contraseña actualizada correctamente.", "ok");
    } catch (e) {
      showAlert(`No se pudo actualizar contraseña: ${e.message}`, "err");
    }
  }

  async function fetchUsuariosAdmin() {
    const tb = $("tbodyUsuarios");
    if (!tb) return;

    const isAdmin = state.me?.roles?.includes("ADMIN") || state.me?.username === "admin";
    if (!isAdmin) return;

    tb.innerHTML = `<tr><td colspan="4" class="table-empty">Cargando...</td></tr>`;
    try {
      const rows = await api("/admin/usuarios");
      state.adminUsuarios = rows || [];
      fillUsuarioEquiposSelect();
      if (!rows?.length) {
        tb.innerHTML = `<tr><td colspan="4" class="table-empty">No hay usuarios.</td></tr>`;
        return;
      }
      tb.innerHTML = rows.map((u) => `
        <tr>
          <td class="mono">${esc(u.id)}</td>
          <td>${esc(u.username)}</td>
          <td>${esc((u.roles || []).join(", "))}</td>
          <td>${u.activo === 1 ? '<span class="status-pill status-OK">ACTIVO</span>' : '<span class="status-pill status-CANCELADO">INACTIVO</span>'}</td>
        </tr>
      `).join("");
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">Error al cargar usuarios.</td></tr>`;
      showAlert(`No se pudieron cargar usuarios: ${e.message}`, "err");
    }
  }

  async function crearUsuarioAdmin() {
    const username = $("nuevoUsername")?.value?.trim();
    const rol = $("nuevoRol")?.value || "USER";

    if (!username) {
      showAlert("Ingresa el nombre de usuario.", "err");
      return;
    }

    try {
      const out = await api("/admin/usuarios", {
        method: "POST",
        body: JSON.stringify({
          username,
          roles: [rol],
          activo: 1,
        }),
      });
      $("nuevoUsername").value = "";
      showAlert(`Usuario creado. Contraseña temporal: ${out.password_temporal}`, "ok");
      await fetchUsuariosAdmin();
      await loadAdminEquiposData();
    } catch (e) {
      showAlert(`No se pudo crear usuario: ${e.message}`, "err");
    }
  }

  function setupUsuarios() {
    $("btnCambiarPassword")?.addEventListener("click", cambiarPassword);
    $("btnCrearUsuario")?.addEventListener("click", crearUsuarioAdmin);
  }

  function setupAuthUI() {
    $("formLogin").addEventListener("submit", async (e) => {
      e.preventDefault();
      doLogin();
    });

    $("btnLogout").addEventListener("click", () => {
      setToken(null);
      // setAuthUI(null);
      showAlert("Sesión cerrada.", "info");
      showLoginView();
    });

    async function doLogin() {
      const username = $("loginUsername").value.trim();
      const password = $("loginPassword").value;

      if (!username || !password) {
        $("loginError").style.display = "";
        $("loginError").innerText = "Completa usuario y contraseña.";
        return;
      }

      const btn = $("btnDoLogin");
      btn.disabled = true;
      btn.innerText = "Verificando...";
      $("loginError").style.display = "none";

      try {
        const out = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });

        setToken(out.access_token);

        const me = await api("/auth/me");
        setAuthUI(me);

        showAlert(`Bienvenido, ${me.username}.`, "ok");
        showAppView();

        // Opcional: recargar data
        await loadReportes();
        await fetchMisSolicitudes();
        await loadAdminReportes();
        await loadAdminEquiposData();
        await fetchUsuariosAdmin();
      } catch (err) {
        $("loginError").style.display = "";
        $("loginError").innerText = err.message || "Error de autenticación";
        setToken(null);
      } finally {
        btn.disabled = false;
        btn.innerText = "Entrar";
      }
    }

    // Enter key support handled by form submit
  }

  document.addEventListener("DOMContentLoaded", init);
})();
