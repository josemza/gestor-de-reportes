(() => {
  const state = {
    reportes: [],
    misSolicitudes: [],
    adminReportes: [],
    adminReportesAll: [],
    adminUsuarios: [],
    adminEquipos: [],
    adminUsuarioEquipoIds: [],
    adminUsuarioEquiposModal: {
      selectedUser: null,
    },
    adminReporteEquipoIds: [],
    adminTablasConsulta: [],
    adminTablaConsultaEquipoIds: [],
    consultaTablasDisponibles: [],
    consultaTablaResultadoCols: [],
    misCurrentPage: 1,
    misPageSize: 10,
    admRepCurrentPage: 1,
    admRepPageSize: 10,
    admCtCurrentPage: 1,
    admCtPageSize: 10,
    admEquipoCurrentPage: 1,
    admEquipoPageSize: 10,
    me: null,
    apiBase: window.location.origin,
    selectedRequestId: null,
    lastParametrosEjemploAplicado: "",
    auth: {
      token: null,
      user: null,
      isAuthenticated: false,
      sessionExpiredNotified: false,
      logoutInProgress: false,
      requestVersion: 0,
    },
    timers: {
      authenticated: {
        autoRefresh: null,
      },
    },
    nuevaSolicitudInputs: {
      modo: null,
      definitions: [],
      values: {},
      filesByInput: {},
      loading: false,
      errors: {},
    },
    adminAccessSummary: {
      usuarioEquipoIds: [],
      reporteEquipoIds: [],
    },
    adminEquipoConfigurator: {
      mode: "create",
      currentStep: "datos",
      selectedEquipo: null,
      selectedUsuarioIds: [],
      selectedReporteIds: [],
      usuariosDisponibles: [],
      reportesDisponibles: [],
      resumen: null,
    },
    adminConfigurator: {
      mode: "create",
      step: "datos",
      selectedReport: null,
      rutas: [],
      inputs: {
        items: [],
        selectedInputId: null,
        carpetasByInput: {},
        loading: false,
        mode: "legacy",
        editingInputId: null,
      },
    },
    adminTablaConsultaConfigurator: {
      mode: "create",
      step: "datos",
      selectedTabla: null,
    },
    versionMonitor: {
      localVersion: String(window.APP_VERSION || "dev"),
      pollTimer: null,
      updateDetected: false,
      toastHandle: null,
    },
  };

  const APP_VERSION = String(window.APP_VERSION || "dev");
  const AUTH_STORAGE_KEY = "reporteador_token";
  const SIDEBAR_COLLAPSED_KEY = "reporteador_sidebar_collapsed";
  const VERSION_ENDPOINT = "/version";
  const VERSION_POLL_INTERVAL_MS = 60000;
  const VERSION_UPDATE_TOAST_ID = "app-version-update";
  const LOGOUT_TOAST_ID = "auth-logout";
  const SESSION_EXPIRED_TOAST_ID = "auth-session-expired";
  const AUTH_CANCELLED_MESSAGE = "__auth_request_cancelled__";
  const PUBLIC_API_PATHS = new Set(["/auth/login", "/health", VERSION_ENDPOINT]);

  function getToken() {
    return localStorage.getItem(AUTH_STORAGE_KEY);
  }

  function isAuthenticated() {
    return Boolean(getToken());
  }

  function setToken(token) {
    if (token) localStorage.setItem(AUTH_STORAGE_KEY, token);
    else localStorage.removeItem(AUTH_STORAGE_KEY);
    state.auth.token = token || null;
    state.auth.isAuthenticated = Boolean(token);
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
    state.auth.user = me || null;
    state.auth.isAuthenticated = isAuthenticated();
    $("authUser").innerText = me?.username ? me.username : "-";
    const isAdmin = me?.roles?.includes("ADMIN") || me?.username === "admin";

    const adminTabs = [
      '.menu__item[data-tab="tab-admin-reportes"]',
      '.menu__item[data-tab="tab-admin-equipos"]',
      '.menu__item[data-tab="tab-admin-tablas-consulta"]',
    ];
    adminTabs.forEach((selector) => {
      const btn = document.querySelector(selector);
      if (btn) btn.style.display = isAdmin ? "" : "none";
    });

    const usersAdminCard = $("usuariosAdminCard");
    if (usersAdminCard) {
      usersAdminCard.style.display = isAdmin ? "" : "none";
    }

    const fUsuario = $("fUsuario");
    if (fUsuario) {
      if (isAdmin) {
        fUsuario.disabled = false;
        fUsuario.readOnly = false;
        fUsuario.title = "";
      } else {
        fUsuario.value = me?.username || "";
        fUsuario.disabled = true;
        fUsuario.title = "Solo los administradores pueden cambiar este filtro.";
      }
    }
  }

  function isPublicApiPath(path) {
    return PUBLIC_API_PATHS.has(path);
  }

  function createSilentAuthError() {
    const err = new Error(AUTH_CANCELLED_MESSAGE);
    err.code = "AUTH_REQUEST_CANCELLED";
    err.silent = true;
    return err;
  }

  function isSilentAuthError(error) {
    return Boolean(
      error?.silent ||
      error?.code === "AUTH_REQUEST_CANCELLED" ||
      error?.message === AUTH_CANCELLED_MESSAGE
    );
  }

  function clearAuthenticatedTimer(name) {
    const timerId = state.timers.authenticated[name];
    if (timerId) {
      window.clearInterval(timerId);
      state.timers.authenticated[name] = null;
    }
  }

  function registerAuthenticatedTimer(name, callback, intervalMs) {
    clearAuthenticatedTimer(name);
    if (!isAuthenticated()) return null;
    const timerId = window.setInterval(() => {
      if (!isAuthenticated()) return;
      void callback();
    }, intervalMs);
    state.timers.authenticated[name] = timerId;
    return timerId;
  }

  function stopAuthenticatedPollers() {
    Object.keys(state.timers.authenticated).forEach(clearAuthenticatedTimer);
  }

  function resetProtectedUiState() {
    state.reportes = [];
    state.misSolicitudes = [];
    state.adminReportes = [];
    state.adminReportesAll = [];
    state.adminUsuarios = [];
    state.adminEquipos = [];
    state.adminUsuarioEquipoIds = [];
    state.adminReporteEquipoIds = [];
    state.adminTablasConsulta = [];
    state.adminTablaConsultaEquipoIds = [];
    state.consultaTablasDisponibles = [];
    state.consultaTablaResultadoCols = [];
    state.selectedRequestId = null;
    state.misCurrentPage = 1;
    state.me = null;

    resetNuevaSolicitudInputsState();
    resetConfiguratorInputsState();

    if ($("reporte")) {
      $("reporte").innerHTML = `<option value="">Inicia sesión para ver reportes</option>`;
      $("reporte").value = "";
    }
    if ($("tbodyMis")) {
      $("tbodyMis").innerHTML = `<tr><td colspan="8" class="table-empty">Inicia sesión para consultar solicitudes.</td></tr>`;
    }
    updateMisPaginationControls(1, 1, 0);
    if ($("detalleRequestId")) $("detalleRequestId").value = "";
    if ($("detalleResumen")) $("detalleResumen").innerHTML = `<div class="result-empty">Inicia sesión para ver el detalle.</div>`;
    if ($("detalleIntentos")) $("detalleIntentos").innerHTML = `<div class="result-empty">Sin intentos.</div>`;
    if ($("detalleEventos")) $("detalleEventos").innerHTML = `<div class="result-empty">Sin eventos.</div>`;
    if ($("tbodyAdminReportes")) {
      $("tbodyAdminReportes").innerHTML = `<tr><td colspan="6" class="table-empty">Inicia sesión para cargar datos.</td></tr>`;
    }
    if ($("tbodyAdmCt")) {
      $("tbodyAdmCt").innerHTML = `<tr><td colspan="6" class="table-empty">Inicia sesión para cargar datos.</td></tr>`;
    }
    if ($("tbodyUsuarios")) {
      $("tbodyUsuarios").innerHTML = `<tr><td colspan="5" class="table-empty">Inicia sesión para cargar datos.</td></tr>`;
    }

    closeNuevaModal();
    closeAdminReporteModal();
    closeAdminEquipoModal();
    closeAdminUsuarioEquiposModal();
    closeAdminTablaConsultaModal();
    closeConsultaResultadosModal();
    renderNuevaSolicitudInputs();
    updateHintRutaInput();
  }

  function startAuthenticatedPollers() {
    setupAutoRefresh();
  }

  function logout(options = {}) {
    const { silent = false, loginMessage = "", preserveSessionExpiredNotice = false } = options;

    state.auth.logoutInProgress = true;
    state.auth.requestVersion += 1;
    stopAuthenticatedPollers();
    setToken(null);
    if (!preserveSessionExpiredNotice) {
      state.auth.sessionExpiredNotified = false;
    }
    resetProtectedUiState();
    setAuthUI(null);
    showLoginView(loginMessage);

    if (!silent) {
      showAlert("Sesion cerrada.", "info", {
        id: LOGOUT_TOAST_ID,
        replaceTypes: ["info"],
      });
    }
  }

  function handleUnauthorized(detail = "No autenticado") {
    if (!isAuthenticated()) {
      stopAuthenticatedPollers();
      throw createSilentAuthError();
    }

    if (!state.auth.sessionExpiredNotified) {
      state.auth.sessionExpiredNotified = true;
      showAlert("Tu sesion expiro. Vuelve a iniciar sesion.", "warning", {
        id: SESSION_EXPIRED_TOAST_ID,
        replaceTypes: ["warning", "error"],
      });
    }

    logout({
      silent: true,
      loginMessage: `Sesion expirada o invalida. Por favor, ingresa de nuevo. (Detalle: ${detail})`,
      preserveSessionExpiredNotice: true,
    });
    throw createSilentAuthError();
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

  function openAdminReporteModal() {
    const modal = $("adminReporteModal");
    if (modal) modal.style.display = "";
  }

  function openAdminEquipoModal() {
    const modal = $("adminEquipoModal");
    if (modal) modal.style.display = "";
  }

  function openAdminUsuarioEquiposModal() {
    const modal = $("adminUsuarioEquiposModal");
    if (modal) modal.style.display = "";
  }

  function closeAdminReporteModal() {
    const modal = $("adminReporteModal");
    if (modal) modal.style.display = "none";
    state.adminConfigurator.mode = "create";
    state.adminConfigurator.step = "datos";
    state.adminConfigurator.selectedReport = null;
    state.adminConfigurator.rutas = [];
    resetConfiguratorInputsState();
    closeConfiguratorInputForm();
  }

  function closeAdminEquipoModal() {
    const modal = $("adminEquipoModal");
    if (modal) modal.style.display = "none";
    state.adminEquipoConfigurator.mode = "create";
    state.adminEquipoConfigurator.currentStep = "datos";
    state.adminEquipoConfigurator.selectedEquipo = null;
    state.adminEquipoConfigurator.selectedUsuarioIds = [];
    state.adminEquipoConfigurator.selectedReporteIds = [];
    state.adminEquipoConfigurator.resumen = null;
  }

  function closeAdminUsuarioEquiposModal() {
    const modal = $("adminUsuarioEquiposModal");
    if (modal) modal.style.display = "none";
    state.adminUsuarioEquiposModal.selectedUser = null;
    state.adminUsuarioEquipoIds = [];
    if ($("admUsuarioEquiposFiltro")) $("admUsuarioEquiposFiltro").value = "";
  }

  function resetAdminReporteModalForCreate() {
    $("adminReporteModalTitle").textContent = "Nuevo reporte";
    $("btnSubmitAdminReporteModal").textContent = "Crear reporte";
    $("admEditRepId").value = "";
    $("admEditRepIdView").value = "";
    $("admEditRepCodigo").value = "";
    $("admEditRepNombre").value = "";
    $("admEditRepDescripcion").value = "";
    $("admEditRepReqInput").value = "1";
    $("admEditRepActivo").value = "1";
    $("admEditRepRutaOutput").value = "";
    $("admEditRepParametrosEjemplo").value = "";
    $("admEditRepTipos").value = "";
    $("admEditRepComando").value = "";
    setAdminReporteIdFieldVisibility(false);
  }

  function prepareAdminReporteModalForEdit(row) {
    $("adminReporteModalTitle").textContent = "Editar reporte";
    $("btnSubmitAdminReporteModal").textContent = "Guardar cambios";
    setAdminReporteIdFieldVisibility(true);
    $("admEditRepId").value = row.id;
    $("admEditRepIdView").value = row.id;
    $("admEditRepCodigo").value = row.codigo || "";
    $("admEditRepNombre").value = row.nombre || "";
    $("admEditRepDescripcion").value = row.descripcion || "";
    $("admEditRepReqInput").value = String(row.requiere_input_archivo ?? 0);
    $("admEditRepActivo").value = String(row.activo ?? 0);
    $("admEditRepRutaOutput").value = row.ruta_output_base || "";
    $("admEditRepParametrosEjemplo").value = normalizeJsonExampleText(row.parametros_ejemplo_json || "");
    $("admEditRepTipos").value = row.tipos_permitidos || "";
    $("admEditRepComando").value = row.comando || "";
  }

  function getAdminReportePayloadFromForm() {
    const requiereInput = Number($("admEditRepReqInput")?.value || 0) === 1;
    return {
      codigo: $("admEditRepCodigo")?.value?.trim(),
      nombre: $("admEditRepNombre")?.value?.trim(),
      descripcion: $("admEditRepDescripcion")?.value?.trim() || null,
      requiere_input_archivo: requiereInput ? 1 : 0,
      activo: Number($("admEditRepActivo")?.value || 0),
      ruta_output_base: $("admEditRepRutaOutput")?.value?.trim() || null,
      parametros_ejemplo_json: $("admEditRepParametrosEjemplo")?.value?.trim() || null,
      tipos_permitidos: requiereInput ? ($("admEditRepTipos")?.value?.trim() || null) : null,
      comando: $("admEditRepComando")?.value?.trim() || null,
    };
  }

  function getConfiguratorSelectedReport() {
    return state.adminConfigurator.selectedReport || null;
  }

  function setConfiguratorSelectedReport(report) {
    state.adminConfigurator.selectedReport = report || null;
    const selected = getConfiguratorSelectedReport();
    const identity = $("cfgReportIdentity");
    const context = $("cfgReportContextText");

    if (identity) {
      identity.textContent = selected?.id
        ? `ID ${selected.id}`
        : "Reporte nuevo";
    }

    if (context) {
      context.textContent = selected?.id
        ? `Configurando ${selected.codigo || `reporte ${selected.id}`} · ${selected.nombre || "sin nombre descriptivo"}.`
        : "Completa los datos base para iniciar la configuración.";
    }
  }

  function isConfiguratorInputRequired() {
    return Number($("admEditRepReqInput")?.value || getConfiguratorSelectedReport()?.requiere_input_archivo || 0) === 1;
  }

  function setAdminReporteIdFieldVisibility(isVisible) {
    const field = $("admEditRepIdField");
    if (!field) return;
    field.hidden = !isVisible;
    field.style.display = isVisible ? "" : "none";
    field.setAttribute("aria-hidden", isVisible ? "false" : "true");
  }

  function syncAdminReporteIdVisibility() {
    setAdminReporteIdFieldVisibility(!!(state.adminConfigurator.mode === "edit" && getConfiguratorSelectedReport()?.id));
  }

  function syncConfiguratorInputFields() {
    const requiereInput = isConfiguratorInputRequired();
    const tiposField = $("admEditRepTiposField");
    const tiposInput = $("admEditRepTipos");
    if (tiposField) {
      tiposField.hidden = !requiereInput;
      tiposField.style.display = requiereInput ? "" : "none";
      tiposField.setAttribute("aria-hidden", requiereInput ? "false" : "true");
    }
    if (tiposInput) {
      tiposInput.disabled = !requiereInput;
      if (!requiereInput) {
        tiposInput.value = "";
      }
    }
  }

  function validateAdminReporteCodigo() {
    const codigoInput = $("admEditRepCodigo");
    if (!codigoInput) return true;
    const value = (codigoInput.value || "").trim();
    if (!value) {
      codigoInput.setCustomValidity("El código es obligatorio.");
      return false;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      codigoInput.setCustomValidity("El código solo puede contener letras, números, guion y guion bajo, sin espacios ni tildes.");
      return false;
    }
    codigoInput.setCustomValidity("");
    return true;
  }

  function validateAdminReporteForm() {
    const nombreInput = $("admEditRepNombre");
    if (nombreInput) {
      const hasName = !!(nombreInput.value || "").trim();
      nombreInput.setCustomValidity(hasName ? "" : "El nombre es obligatorio.");
    }
    const isCodigoValid = validateAdminReporteCodigo();
    const form = $("formAdminReporteEdit");
    return !!(form?.reportValidity() && isCodigoValid);
  }

  function syncConfiguratorFlowActions() {
    const hasReport = canUseAdvancedConfiguratorSteps();
    const btnDatos = $("btnCfgGoToRutas");
    const btnRutas = $("btnCfgGoToEquipos");
    const rutasActivas = (state.adminConfigurator.rutas || []).filter((r) => Number(r.activo) === 1).length;
    const inputState = getConfiguratorInputsState();
    const inputMode = getConfiguratorInputMode();
    const activeInputs = (inputState.items || []).filter((r) => Number(r.activo) === 1);

    if (btnDatos) {
      btnDatos.textContent = "Continuar con entradas";
      btnDatos.disabled = !hasReport;
    }

    if (btnRutas) {
      const canContinue = inputMode === "multi_input"
        ? activeInputs.length > 0
        : (Number($("admEditRepReqInput")?.value || 0) !== 1 || rutasActivas > 0);
      btnRutas.hidden = !hasReport || !canContinue;
    }
  }

  function canUseAdvancedConfiguratorSteps() {
    const report = getConfiguratorSelectedReport();
    return !!(report?.id && report?.codigo);
  }

  function getConfiguratorStepAvailability() {
    const hasReport = canUseAdvancedConfiguratorSteps();
    return {
      datos: true,
      rutas: hasReport,
      equipos: hasReport,
      revision: hasReport,
    };
  }

  function setConfiguratorStep(stepName) {
    const availability = getConfiguratorStepAvailability();
    const targetStep = availability[stepName] ? stepName : "datos";
    state.adminConfigurator.step = targetStep;

    document.querySelectorAll("[data-config-step]").forEach((btn) => {
      const step = btn.dataset.configStep;
      const enabled = !!availability[step];
      btn.classList.toggle("is-active", step === targetStep);
      btn.classList.toggle("is-disabled", !enabled);
      btn.disabled = !enabled;
    });

    document.querySelectorAll("[data-config-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.configPanel === targetStep);
    });

    syncConfiguratorFlowActions();
  }

  function renderConfiguratorReview() {
    const wrap = $("cfgReviewGrid");
    if (!wrap) return;

    const selected = getConfiguratorSelectedReport();
    const report = selected?.id
      ? { ...selected, ...getAdminReportePayloadFromForm(), id: selected.id }
      : null;
    if (!report?.id) {
      wrap.innerHTML = `<div class="result-empty">Aún no hay un reporte seleccionado para resumir.</div>`;
      return;
    }

    const equiposAsignados = (state.adminReporteEquipoIds || []).length;
    const rutasConfiguradas = (state.adminConfigurator.rutas || []).filter((r) => Number(r.activo) === 1).length;
    const requiereInput = Number(report.requiere_input_archivo) === 1;
    const inputState = getConfiguratorInputsState();
    const inputMode = getConfiguratorInputMode();
    const activeInputs = (inputState.items || []).filter((r) => Number(r.activo) === 1);
    const requiredInputs = activeInputs.filter((r) => Number(r.obligatorio) === 1);
    const fileInputs = activeInputs.filter((r) => r.tipo_input === "archivo");
    const fileInputsWithoutFolders = fileInputs.filter((input) => {
      const cache = getInputFolderCache(input.id);
      const items = cache.items || [];
      return items.filter((folder) => Number(folder.activo) === 1).length === 0;
    });

    wrap.innerHTML = `
      <div class="kv"><label>ID</label><div class="mono">${esc(report.id)}</div></div>
      <div class="kv"><label>Código</label><div class="mono">${esc(report.codigo || "-")}</div></div>
      <div class="kv"><label>Nombre</label><div>${esc(report.nombre || "-")}</div></div>
      <div class="kv"><label>Activo</label><div>${Number(report.activo) === 1 ? "Sí" : "No"}</div></div>
      <div class="kv"><label>Modo</label><div>${inputMode === "multi_input" ? "Multi-input" : "Legacy"}</div></div>
      <div class="kv"><label>Requiere input</label><div>${requiereInput ? "Sí" : "No"}</div></div>
      <div class="kv"><label>Tipos permitidos legacy</label><div>${esc(report.tipos_permitidos || "No configurado")}</div></div>
      <div class="kv"><label>Rutas legacy activas</label><div>${requiereInput ? rutasConfiguradas : "No aplica"}</div></div>
      <div class="kv"><label>Inputs activos</label><div>${inputMode === "multi_input" ? activeInputs.length : "No aplica"}</div></div>
      <div class="kv"><label>Inputs obligatorios</label><div>${inputMode === "multi_input" ? requiredInputs.length : "No aplica"}</div></div>
      <div class="kv"><label>Inputs tipo archivo</label><div>${inputMode === "multi_input" ? fileInputs.length : "No aplica"}</div></div>
      <div class="kv"><label>Archivo sin carpetas activas</label><div>${inputMode === "multi_input" ? fileInputsWithoutFolders.length : "No aplica"}</div></div>
      <div class="kv"><label>Equipos asignados</label><div>${equiposAsignados}</div></div>
      <div class="kv"><label>Comando</label><div>${esc(report.comando || "Sin comando configurado")}</div></div>
    `;
  }

  function renderConfiguratorEquiposChecks() {
    renderChecks(
      "cfgReporteEquiposChecks",
      state.adminEquipos,
      state.adminReporteEquipoIds,
      "adminReporteEquipoIds",
      $("cfgReporteEquiposFiltro")?.value || ""
    );
  }

  function getConfiguratorInputsState() {
    return state.adminConfigurator.inputs || {
      items: [],
      selectedInputId: null,
      carpetasByInput: {},
      loading: false,
      mode: "legacy",
      editingInputId: null,
    };
  }

  function resetConfiguratorInputsState() {
    state.adminConfigurator.inputs = {
      items: [],
      selectedInputId: null,
      carpetasByInput: {},
      loading: false,
      mode: "legacy",
      editingInputId: null,
    };
  }

  function getConfiguratorInputMode() {
    return getConfiguratorInputsState().mode || "legacy";
  }

  function getSelectedConfiguratorInput() {
    const inputState = getConfiguratorInputsState();
    return (inputState.items || []).find((item) => Number(item.id) === Number(inputState.selectedInputId)) || null;
  }

  function getInputTypeLabel(tipo) {
    if (tipo === "archivo") return "Archivo";
    if (tipo === "texto") return "Texto";
    if (tipo === "periodo") return "Periodo";
    return tipo || "-";
  }

  function getInputStatusLabel(value) {
    return Number(value) === 1 ? "Activo" : "Inactivo";
  }

  function getBinaryLabel(value) {
    return Number(value) === 1 ? "Sí" : "No";
  }

  function getInputFolderCache(inputId) {
    const inputState = getConfiguratorInputsState();
    return inputState.carpetasByInput[String(inputId)] || { items: [], loaded: false, loading: false };
  }

  function setInputFolderCache(inputId, patch) {
    const inputState = getConfiguratorInputsState();
    inputState.carpetasByInput[String(inputId)] = {
      ...getInputFolderCache(inputId),
      ...(patch || {}),
    };
  }

  async function preloadInputFolderCaches(items = []) {
    const fileInputs = (items || []).filter((item) => item.tipo_input === "archivo");
    await Promise.all(fileInputs.map(async (input) => {
      const cache = getInputFolderCache(input.id);
      if (cache.loaded || cache.loading) return;
      setInputFolderCache(input.id, { loading: true });
      try {
        const rows = await getAdminInputCarpetas(input.id);
        setInputFolderCache(input.id, { items: rows || [], loaded: true, loading: false });
      } catch (_) {
        setInputFolderCache(input.id, { items: [], loaded: false, loading: false });
      }
    }));
  }

  function validateConfiguratorInputCode(value) {
    return /^[a-z][a-z0-9_]{1,99}$/.test((value || "").trim());
  }

  function syncConfiguratorInputModeUI() {
    const report = getConfiguratorSelectedReport();
    const inputState = getConfiguratorInputsState();
    const modeEl = $("cfgInputModeBadge");
    const helperEl = $("cfgInputModeHint");
    const warningEl = $("cfgLegacyCompatibilityWarning");
    const rutasSection = $("cfgLegacyRutasSection");
    const rutasLabel = $("cfgLegacyRutasLabel");
    const inputSection = $("cfgInputsSection");

    if (modeEl) {
      modeEl.textContent = inputState.mode === "multi_input" ? "Modo de entradas: Multi-input" : "Modo de entradas: Legacy";
      modeEl.className = `badge ${inputState.mode === "multi_input" ? "badge--multi-input" : "badge--neutral"}`;
    }

    if (helperEl) {
      if (!report?.id) {
        helperEl.textContent = "Guarda primero el reporte para habilitar la configuración avanzada.";
      } else if (inputState.mode === "multi_input") {
        helperEl.textContent = "Este reporte tiene inputs definidos. La gestión principal ocurre por input.";
      } else {
        helperEl.textContent = "Este reporte sigue usando la configuración legacy de input único y rutas por reporte.";
      }
    }

    if (warningEl) {
      warningEl.hidden = inputState.mode !== "multi_input";
    }

    if (rutasSection) {
      rutasSection.classList.toggle("is-secondary", inputState.mode === "multi_input");
    }

    if (rutasLabel) {
      rutasLabel.textContent = inputState.mode === "multi_input" ? "Rutas legacy del reporte" : "Rutas legacy del reporte (modo principal)";
    }

    if (inputSection) {
      inputSection.classList.toggle("is-secondary", inputState.mode === "legacy");
    }
  }

  function syncConfiguratorInputForm() {
    const type = $("cfgInputTipo")?.value || "archivo";
    const tiposField = $("cfgInputTiposField");
    const tiposInput = $("cfgInputTipos");
    const title = $("cfgInputFormTitle");
    const inputState = getConfiguratorInputsState();
    const isEditing = !!inputState.editingInputId;

    if (tiposField) {
      tiposField.hidden = type !== "archivo";
    }
    if (tiposInput && type !== "archivo") {
      tiposInput.value = "";
    }
    if (title) {
      title.textContent = isEditing ? "Editar input" : "Nuevo input";
    }
    const codeInput = $("cfgInputCodigo");
    if (codeInput) {
      codeInput.disabled = isEditing;
      codeInput.title = isEditing ? "codigo_input no se puede editar en V1." : "";
    }
  }

  function clearConfiguratorInputForm() {
    const inputState = getConfiguratorInputsState();
    inputState.editingInputId = null;
    if ($("cfgInputForm")) $("cfgInputForm").reset();
    if ($("cfgInputActivo")) $("cfgInputActivo").value = "1";
    if ($("cfgInputObligatorio")) $("cfgInputObligatorio").value = "1";
    if ($("cfgInputOrden")) $("cfgInputOrden").value = "1";
    if ($("cfgInputTipo")) $("cfgInputTipo").value = "archivo";
    if ($("cfgInputTipos")) $("cfgInputTipos").value = "";
    if ($("cfgInputCodigo")) $("cfgInputCodigo").value = "";
    if ($("cfgInputNombre")) $("cfgInputNombre").value = "";
    syncConfiguratorInputForm();
  }

  function openInputFormForCreate() {
    const report = getConfiguratorSelectedReport();
    if (!report?.id) {
      showAlert("Primero guarda el reporte.", "err");
      return;
    }
    clearConfiguratorInputForm();
    const wrap = $("cfgInputFormWrap");
    if (wrap) wrap.hidden = false;
  }

  function openInputFormForEdit(inputId) {
    const inputState = getConfiguratorInputsState();
    const row = (inputState.items || []).find((item) => Number(item.id) === Number(inputId));
    if (!row) {
      showAlert("No se encontró el input seleccionado.", "err");
      return;
    }

    inputState.editingInputId = Number(row.id);
    if ($("cfgInputCodigo")) $("cfgInputCodigo").value = row.codigo_input || "";
    if ($("cfgInputNombre")) $("cfgInputNombre").value = row.nombre_visible || "";
    if ($("cfgInputTipo")) $("cfgInputTipo").value = row.tipo_input || "archivo";
    if ($("cfgInputObligatorio")) $("cfgInputObligatorio").value = String(Number(row.obligatorio) === 1 ? 1 : 0);
    if ($("cfgInputOrden")) $("cfgInputOrden").value = String(row.orden || 1);
    if ($("cfgInputActivo")) $("cfgInputActivo").value = String(Number(row.activo) === 1 ? 1 : 0);
    if ($("cfgInputTipos")) $("cfgInputTipos").value = row.tipos_permitidos || "";
    syncConfiguratorInputForm();
    const wrap = $("cfgInputFormWrap");
    if (wrap) wrap.hidden = false;
  }

  function closeConfiguratorInputForm() {
    const wrap = $("cfgInputFormWrap");
    if (wrap) wrap.hidden = true;
    clearConfiguratorInputForm();
  }

  function getConfiguratorInputPayloadFromForm() {
    const tipo = $("cfgInputTipo")?.value || "archivo";
    return {
      codigo_input: $("cfgInputCodigo")?.value?.trim(),
      nombre_visible: $("cfgInputNombre")?.value?.trim(),
      tipo_input: tipo,
      obligatorio: Number($("cfgInputObligatorio")?.value || 0),
      orden: Number($("cfgInputOrden")?.value || 1),
      activo: Number($("cfgInputActivo")?.value || 0),
      tipos_permitidos: tipo === "archivo" ? ($("cfgInputTipos")?.value?.trim() || null) : null,
    };
  }

  function validateConfiguratorInputForm() {
    const code = $("cfgInputCodigo");
    const name = $("cfgInputNombre");
    const order = $("cfgInputOrden");
    const tipos = $("cfgInputTipos");
    const type = $("cfgInputTipo")?.value || "";

    if (code) {
      const valid = validateConfiguratorInputCode(code.value);
      code.setCustomValidity(valid ? "" : "Usa snake_case seguro: empieza con letra y sigue con letras, números o _.");
    }
    if (name) {
      name.setCustomValidity((name.value || "").trim() ? "" : "El nombre visible es obligatorio.");
    }
    if (order) {
      const orderValue = Number(order.value || 0);
      order.setCustomValidity(orderValue >= 1 ? "" : "El orden debe ser mayor o igual que 1.");
    }
    if (tipos) {
      const raw = (tipos.value || "").trim();
      const valid = !raw || /^[A-Za-z0-9.;,\s]+$/.test(raw);
      tipos.setCustomValidity(type !== "archivo" || valid ? "" : "Usa extensiones como csv;xlsx.");
    }
    return !!$("cfgInputForm")?.reportValidity();
  }

  async function loadConfiguratorInputs() {
    const report = getConfiguratorSelectedReport();
    const tbody = $("cfgTbodyInputs");
    const emptyWrap = $("cfgInputsEmpty");
    const inputState = getConfiguratorInputsState();
    if (!tbody) return;

    if (!report?.id) {
      resetConfiguratorInputsState();
      renderConfiguratorInputs();
      syncConfiguratorInputModeUI();
      renderConfiguratorReview();
      return;
    }

    inputState.loading = true;
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Cargando inputs...</td></tr>`;
    if (emptyWrap) emptyWrap.hidden = true;

    try {
      const rows = await getAdminReporteInputs(report.id);
      inputState.items = rows || [];
      inputState.mode = (rows || []).length > 0 ? "multi_input" : "legacy";
      if (inputState.selectedInputId && !(rows || []).some((item) => Number(item.id) === Number(inputState.selectedInputId))) {
        inputState.selectedInputId = null;
      }
      await preloadInputFolderCaches(rows || []);
      renderConfiguratorInputs();
    } catch (e) {
      resetConfiguratorInputsState();
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Error al cargar inputs.</td></tr>`;
      showAlert(`No se pudieron cargar inputs del reporte: ${e.message}`, "err");
    } finally {
      inputState.loading = false;
      syncConfiguratorInputModeUI();
      renderInputCarpetas();
      renderConfiguratorReview();
      syncConfiguratorFlowActions();
    }
  }

  function renderConfiguratorInputs() {
    const tbody = $("cfgTbodyInputs");
    const emptyWrap = $("cfgInputsEmpty");
    if (!tbody) return;

    const inputState = getConfiguratorInputsState();
    const rows = inputState.items || [];

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No hay inputs definidos para este reporte.</td></tr>`;
      if (emptyWrap) emptyWrap.hidden = false;
      syncConfiguratorInputModeUI();
      syncConfiguratorFlowActions();
      return;
    }

    if (emptyWrap) emptyWrap.hidden = true;
    tbody.innerHTML = rows.map((r) => `
      <tr class="${Number(r.id) === Number(inputState.selectedInputId) ? "is-row-highlighted" : ""}">
        <td class="mono">${esc(r.codigo_input)}</td>
        <td>${esc(r.nombre_visible)}</td>
        <td>${esc(getInputTypeLabel(r.tipo_input))}</td>
        <td>${getBinaryLabel(r.obligatorio)}</td>
        <td>${esc(r.orden)}</td>
        <td>${Number(r.activo) === 1 ? '<span class="status-pill status-OK">Activo</span>' : '<span class="status-pill status-CANCELADO">Inactivo</span>'}</td>
        <td>
          <div class="inline-controls inline-controls--wrap">
            <button class="btn btn--ghost btn--sm btn-cfg-input-edit" data-id="${esc(r.id)}">Editar</button>
            <button class="btn btn--ghost btn--sm btn-cfg-input-toggle" data-id="${esc(r.id)}" data-next="${Number(r.activo) === 1 ? "0" : "1"}">
              ${Number(r.activo) === 1 ? "Desactivar" : "Activar"}
            </button>
            ${r.tipo_input === "archivo" ? `<button class="btn btn--ghost btn--sm btn-cfg-input-folders" data-id="${esc(r.id)}">Carpetas</button>` : ""}
          </div>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-cfg-input-edit").forEach((btn) => {
      btn.addEventListener("click", () => openInputFormForEdit(btn.dataset.id));
    });

    document.querySelectorAll(".btn-cfg-input-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id || 0);
        const next = Number(btn.dataset.next || 0);
        const row = rows.find((item) => Number(item.id) === id);
        if (!row) return;

        if (Number(row.activo) === 1 && !window.confirm("Este input dejará de aparecer en nuevas solicitudes, pero no se eliminará su historial.")) {
          return;
        }

        try {
          if (next === 0) {
            await deleteAdminReporteInput(id);
            showAlert("Input desactivado correctamente.", "ok");
          } else {
            await updateAdminReporteInput(id, { activo: 1 });
            showAlert("Input reactivado correctamente.", "ok");
          }
          await loadConfiguratorInputs();
        } catch (e) {
          showAlert(`No se pudo cambiar el estado del input: ${e.message}`, "err");
        }
      });
    });

    document.querySelectorAll(".btn-cfg-input-folders").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const inputId = Number(btn.dataset.id || 0);
        inputState.selectedInputId = inputId;
        await loadInputCarpetas(inputId);
        renderConfiguratorInputs();
      });
    });

    syncConfiguratorInputModeUI();
    renderInputCarpetas();
    syncConfiguratorFlowActions();
  }

  async function saveConfiguratorInput(ev) {
    ev.preventDefault();
    const report = getConfiguratorSelectedReport();
    const inputState = getConfiguratorInputsState();
    if (!report?.id) {
      showAlert("Primero guarda el reporte.", "err");
      return;
    }
    if (!validateConfiguratorInputForm()) return;

    const payload = getConfiguratorInputPayloadFromForm();
    const isEditing = !!inputState.editingInputId;
    const previous = isEditing
      ? (inputState.items || []).find((item) => Number(item.id) === Number(inputState.editingInputId))
      : null;

    if (previous?.tipo_input === "archivo" && payload.tipo_input !== "archivo") {
      const confirmed = window.confirm("Este input dejará de ser de tipo archivo. Sus carpetas asociadas no se eliminarán, pero ya no serán usadas mientras el input no sea de tipo archivo.");
      if (!confirmed) return;
    }

    const wasLegacy = getConfiguratorInputMode() === "legacy";
    try {
      if (isEditing) {
        const patchPayload = {
          nombre_visible: payload.nombre_visible,
          tipo_input: payload.tipo_input,
          obligatorio: payload.obligatorio,
          orden: payload.orden,
          activo: payload.activo,
          tipos_permitidos: payload.tipo_input === "archivo" ? payload.tipos_permitidos : null,
        };
        await updateAdminReporteInput(inputState.editingInputId, patchPayload);
        showAlert("Input actualizado correctamente.", "ok");
      } else {
        await createAdminReporteInput(report.id, payload);
        showAlert("Input creado correctamente.", "ok");
      }
      closeConfiguratorInputForm();
      await loadConfiguratorInputs();
      if (!isEditing && wasLegacy && getConfiguratorInputMode() === "multi_input") {
        showAlert("Se creó el primer input del reporte. Este reporte ahora queda configurado como multi-input para el nuevo flujo.", "info");
      }
    } catch (e) {
      showAlert(`${isEditing ? "No se pudo actualizar el input" : "No se pudo crear el input"}: ${e.message}`, "err");
    }
  }

  async function loadInputCarpetas(inputId) {
    const inputState = getConfiguratorInputsState();
    const input = (inputState.items || []).find((item) => Number(item.id) === Number(inputId));
    if (!input || input.tipo_input !== "archivo") {
      inputState.selectedInputId = null;
      renderInputCarpetas();
      return;
    }

    inputState.selectedInputId = Number(inputId);
    setInputFolderCache(inputId, { loading: true });
    renderInputCarpetas();
    try {
      const rows = await getAdminInputCarpetas(inputId);
      setInputFolderCache(inputId, { items: rows || [], loaded: true, loading: false });
    } catch (e) {
      setInputFolderCache(inputId, { items: [], loaded: false, loading: false });
      showAlert(`No se pudieron cargar carpetas del input: ${e.message}`, "err");
    }
    renderInputCarpetas();
    renderConfiguratorReview();
  }

  function renderInputCarpetas() {
    const wrap = $("cfgInputFoldersWrap");
    const title = $("cfgInputFoldersTitle");
    const tbody = $("cfgInputFoldersTbody");
    const hint = $("cfgInputFoldersHint");
    if (!wrap || !tbody || !title || !hint) return;

    const selectedInput = getSelectedConfiguratorInput();
    if (!selectedInput || selectedInput.tipo_input !== "archivo") {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    title.textContent = `Carpetas permitidas para: ${selectedInput.nombre_visible}`;
    const cache = getInputFolderCache(selectedInput.id);

    if (cache.loading) {
      hint.textContent = "Cargando carpetas...";
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Cargando carpetas...</td></tr>`;
      return;
    }

    hint.textContent = "Administra carpetas activas e inactivas para este input de tipo archivo.";
    if (!(cache.items || []).length) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No hay carpetas registradas para este input.</td></tr>`;
      return;
    }

    tbody.innerHTML = (cache.items || []).map((r) => `
      <tr>
        <td class="mono">${esc(r.id)}</td>
        <td><input id="cfg_input_carpeta_${esc(r.id)}" class="input-sm" type="text" value="${esc(r.ruta_base)}" /></td>
        <td>${Number(r.activo) === 1 ? '<span class="status-pill status-OK">Activo</span>' : '<span class="status-pill status-CANCELADO">Inactivo</span>'}</td>
        <td>
          <div class="inline-controls inline-controls--wrap">
            <button class="btn btn--ghost btn--sm btn-cfg-input-folder-save" data-id="${esc(r.id)}">Guardar</button>
            <button class="btn btn--ghost btn--sm btn-cfg-input-folder-toggle" data-id="${esc(r.id)}" data-next="${Number(r.activo) === 1 ? "0" : "1"}">
              ${Number(r.activo) === 1 ? "Desactivar" : "Activar"}
            </button>
          </div>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-cfg-input-folder-save").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id || 0);
        const ruta = ($(`cfg_input_carpeta_${id}`)?.value || "").trim();
        if (!ruta) {
          showAlert("La ruta base no puede estar vacía.", "err");
          return;
        }
        try {
          await updateAdminInputCarpeta(id, { ruta_base: ruta });
          showAlert("Carpeta actualizada correctamente.", "ok");
          await loadInputCarpetas(selectedInput.id);
        } catch (e) {
          showAlert(`No se pudo actualizar la carpeta: ${e.message}`, "err");
        }
      });
    });

    document.querySelectorAll(".btn-cfg-input-folder-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id || 0);
        const next = Number(btn.dataset.next || 0);
        try {
          await updateAdminInputCarpeta(id, { activo: next });
          showAlert(`Carpeta ${next === 1 ? "activada" : "desactivada"} correctamente.`, "ok");
          await loadInputCarpetas(selectedInput.id);
        } catch (e) {
          showAlert(`No se pudo cambiar el estado de la carpeta: ${e.message}`, "err");
        }
      });
    });
  }

  async function addInputCarpeta() {
    const selectedInput = getSelectedConfiguratorInput();
    const ruta = $("cfgInputCarpetaNueva")?.value?.trim();
    if (!selectedInput || selectedInput.tipo_input !== "archivo") {
      showAlert("Selecciona un input de tipo archivo para administrar carpetas.", "err");
      return;
    }
    if (!ruta) {
      showAlert("Ingresa una ruta base.", "err");
      return;
    }
    try {
      await createAdminInputCarpeta(selectedInput.id, { ruta_base: ruta });
      $("cfgInputCarpetaNueva").value = "";
      showAlert("Carpeta agregada correctamente.", "ok");
      await loadInputCarpetas(selectedInput.id);
    } catch (e) {
      showAlert(`No se pudo agregar la carpeta: ${e.message}`, "err");
    }
  }

  function openAdminTablaConsultaModal() {
    const modal = $("adminTablaConsultaModal");
    if (modal) modal.style.display = "";
  }

  function closeAdminTablaConsultaModal() {
    const modal = $("adminTablaConsultaModal");
    if (modal) modal.style.display = "none";
    state.adminTablaConsultaConfigurator.mode = "create";
    state.adminTablaConsultaConfigurator.step = "datos";
    state.adminTablaConsultaConfigurator.selectedTabla = null;
    state.adminTablaConsultaEquipoIds = [];
  }

  function openConsultaResultadosModal() {
    const modal = $("consultaResultadosModal");
    if (modal) modal.style.display = "";
  }

  function closeConsultaResultadosModal() {
    const modal = $("consultaResultadosModal");
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

  const isAdminUser = () => state.me?.roles?.includes("ADMIN") || state.me?.username === "admin";

  function normalizeJsonExampleText(txt) {
    const raw = (txt || "").trim();
    if (!raw) return "";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  const getFileName = (p) => {
    const raw = (p || "").toString();
    const parts = raw.split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : raw;
  };

  const getFileOptionLabel = (p) => {
    const raw = (p || "").toString();
    const file = getFileName(raw);
    const parts = raw.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 1) return file;
    const parent = parts[parts.length - 2];
    return `${file} (${parent})`;
  };

  async function copyOutputPath(path) {
    const raw = (path || "").trim();
    if (!raw) {
      showAlert("No hay ruta de salida para copiar.", "err");
      return;
    }
    try {
      await navigator.clipboard.writeText(raw);
      showAlert("Ruta copiada al portapapeles.", "ok");
    } catch (e) {
      showAlert("No se pudo copiar la ruta al portapapeles.", "err");
    }
  }

  function normalizeToastType(type) {
    const normalized = String(type || "info").toLowerCase();
    if (normalized === "ok") return "success";
    if (normalized === "err") return "error";
    if (["success", "error", "warning", "info"].includes(normalized)) return normalized;
    return "info";
  }

  function showToast(message, type = "info", options = {}) {
    const wrap = $("toastContainer");
    if (!wrap || !message) return null;

    const normalizedType = normalizeToastType(type);
    const duration = Number(options.duration);
    const autoCloseAfter = Number.isFinite(duration) ? duration : 4500;

    if (options.replace) {
      const replaceTypes = Array.isArray(options.replaceTypes) && options.replaceTypes.length
        ? options.replaceTypes.map(normalizeToastType)
        : null;
      wrap.querySelectorAll(".app-toast").forEach((existingToast) => {
        const matchesType = !replaceTypes || replaceTypes.some((toastType) => existingToast.classList.contains(toastType));
        if (!matchesType) return;
        existingToast.remove();
      });
    }

    if (options.id) {
      wrap.querySelectorAll(".app-toast").forEach((existingToast) => {
        if (existingToast.dataset.toastId === String(options.id)) {
          existingToast.remove();
        }
      });
    }

    const toast = document.createElement("div");
    toast.className = `app-toast ${normalizedType}`;
    toast.setAttribute("role", normalizedType === "error" || normalizedType === "warning" ? "alert" : "status");
    if (options.id) {
      toast.dataset.toastId = String(options.id);
    }

    const body = document.createElement("div");
    body.className = "app-toast__body";

    if (options.title) {
      const title = document.createElement("strong");
      title.className = "app-toast__title";
      title.textContent = String(options.title);
      body.appendChild(title);
    }

    const text = document.createElement("p");
    text.className = "app-toast__message";
    text.textContent = String(message);
    body.appendChild(text);

    if (Array.isArray(options.actions) && options.actions.length) {
      const actions = document.createElement("div");
      actions.className = "app-toast__actions";

      options.actions.forEach((action) => {
        if (!action?.label) return;
        const actionBtn = document.createElement("button");
        actionBtn.type = "button";
        actionBtn.className = `app-toast__action ${action.variant === "primary" ? "is-primary" : ""}`.trim();
        actionBtn.textContent = String(action.label);
        actionBtn.addEventListener("click", () => {
          if (typeof action.onClick === "function") {
            action.onClick(removeToast);
          }
        });
        actions.appendChild(actionBtn);
      });

      if (actions.childElementCount > 0) {
        body.appendChild(actions);
      }
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "app-toast__close";
    closeBtn.setAttribute("aria-label", "Cerrar notificación");
    closeBtn.textContent = "×";

    let removed = false;
    let timeoutId = null;
    const removeToast = () => {
      if (removed) return;
      removed = true;
      if (timeoutId) clearTimeout(timeoutId);
      toast.classList.add("is-closing");
      window.setTimeout(() => toast.remove(), 180);
    };

    closeBtn.addEventListener("click", removeToast);

    toast.appendChild(body);
    toast.appendChild(closeBtn);
    wrap.prepend(toast);

    if (autoCloseAfter > 0) {
      timeoutId = window.setTimeout(removeToast, autoCloseAfter);
    }

    return { close: removeToast, element: toast };
  }

  function showAlert(message, type = "info", options = {}) {
    if (typeof message === "string" && message.includes(AUTH_CANCELLED_MESSAGE)) {
      return null;
    }
    return showToast(message, type, options);
  }

  window.showToast = showToast;
  window.showAlert = showAlert;

  async function fetchRemoteAppVersion() {
    const response = await fetch(`${state.apiBase}${VERSION_ENDPOINT}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const version = String(data?.version || "").trim();
    return version || null;
  }

  function stopVersionPolling() {
    if (state.versionMonitor.pollTimer) {
      window.clearInterval(state.versionMonitor.pollTimer);
      state.versionMonitor.pollTimer = null;
    }
  }

  function showVersionUpdateToast(remoteVersion) {
    if (state.versionMonitor.toastHandle) return;

    state.versionMonitor.toastHandle = showToast(
      "Hay una nueva versión disponible. Actualiza para cargar los últimos cambios.",
      "warning",
      {
        id: VERSION_UPDATE_TOAST_ID,
        title: "Nueva versión disponible",
        duration: 0,
        actions: [
          {
            label: "Actualizar",
            variant: "primary",
            onClick: () => {
              window.location.reload();
            },
          },
        ],
      }
    );

    if (state.versionMonitor.toastHandle?.element && remoteVersion) {
      state.versionMonitor.toastHandle.element.dataset.remoteVersion = remoteVersion;
    }
  }

  async function checkForAppVersionUpdate() {
    if (state.versionMonitor.updateDetected) return;

    try {
      const remoteVersion = await fetchRemoteAppVersion();
      if (!remoteVersion || remoteVersion === state.versionMonitor.localVersion) {
        return;
      }

      state.versionMonitor.updateDetected = true;
      showVersionUpdateToast(remoteVersion);
      stopVersionPolling();
    } catch (_) {
      // Silencioso: no afecta el uso normal de la app.
    }
  }

  function startVersionPolling() {
    stopVersionPolling();
    state.versionMonitor.localVersion = APP_VERSION;
    state.versionMonitor.updateDetected = false;
    state.versionMonitor.toastHandle = null;

    void checkForAppVersionUpdate();
    state.versionMonitor.pollTimer = window.setInterval(() => {
      void checkForAppVersionUpdate();
    }, VERSION_POLL_INTERVAL_MS);
  }

  async function api(path, opts = {}) {
    const requiresAuth = opts.requiresAuth !== false && !isPublicApiPath(path);
    const { requiresAuth: _requiresAuth, ...fetchOpts } = opts;
    const token = getToken();
    const requestVersion = state.auth.requestVersion;

    if (requiresAuth && !token) {
      throw createSilentAuthError();
    }

    const headers = {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };

    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${state.apiBase}${path}`, {
      ...fetchOpts,
      headers,
    });

    if (requiresAuth && (requestVersion !== state.auth.requestVersion || token !== getToken())) {
      throw createSilentAuthError();
    }

    if (!res.ok) {
      if (res.status === 401 && requiresAuth) {
        let detail = "No autenticado";
        try {
          const b = await res.json();
          detail = b.detail;
        } catch (_) { /* ignore */ }

        handleUnauthorized(detail);
      }

      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = body.detail || detail;
      } catch (_) { }
      if (res.status === 403 && !detail) {
        detail = "Permisos insuficientes.";
      }
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
    if (!sel) return;
    if (!isAuthenticated()) {
      sel.innerHTML = `<option value="">Inicia sesion para ver reportes</option>`;
      return;
    }

    sel.innerHTML = `<option value="">Cargando...</option>`;
    try {
      const rows = await api("/reportes");
      state.reportes = rows || [];
      if (!rows.length) {
        sel.innerHTML = `<option value="">No hay reportes activos</option>`;
        resetNuevaSolicitudInputsState();
        renderNuevaSolicitudInputs();
        updateHintRutaInput();
        return;
      }

      sel.innerHTML = `<option value="">Seleccione un reporte</option>` +
        rows.map(r => `<option value="${esc(r.codigo)}">${esc(r.codigo)} — ${esc(r.nombre)}</option>`).join("");

      updateHintRutaInput();
      renderNuevaSolicitudInputs();

      // Also update admin dropdown
      fillAdminReportesSelect();
    } catch (e) {
      if (isSilentAuthError(e)) return;
      sel.innerHTML = `<option value="">Error al cargar reportes</option>`;
      resetNuevaSolicitudInputsState();
      renderNuevaSolicitudInputs();
      showAlert(`No se pudieron cargar reportes: ${e.message}`, "err");
    }
  }

  function getReporteByCodigo(codigo) {
    return state.reportes.find(r => r.codigo === codigo) || null;
  }

  function getNuevaSolicitudInputsState() {
    return state.nuevaSolicitudInputs || {
      modo: null,
      definitions: [],
      values: {},
      filesByInput: {},
      loading: false,
      errors: {},
    };
  }

  function resetNuevaSolicitudInputsState() {
    state.nuevaSolicitudInputs = {
      modo: null,
      definitions: [],
      values: {},
      filesByInput: {},
      loading: false,
      errors: {},
    };
  }

  async function getReporteInputs(codigoReporte) {
    return api(`/reportes/${encodeURIComponent(codigoReporte)}/inputs`);
  }

  async function getArchivosInputReporte(codigoReporte, codigoInput) {
    return api(`/reportes/${encodeURIComponent(codigoReporte)}/inputs/${encodeURIComponent(codigoInput)}/archivos`);
  }

  function setNuevaSolicitudModeBadge(mode, options = {}) {
    const badge = $("nuevaSolicitudModeBadge");
    const help = $("nuevaSolicitudModeHelp");
    const parametrosHelp = $("parametros_help");
    if (badge) {
      badge.className = `badge ${mode === "multi_input" ? "badge--multi-input" : "badge--neutral"}`;
    }

    if (mode === "loading") {
      if (badge) badge.textContent = "Cargando modo";
      if (help) help.textContent = "Consultando la configuración operativa del reporte.";
      if (parametrosHelp) {
        parametrosHelp.textContent = "Espera a que se cargue el reporte para validar cómo se usarán los parámetros.";
      }
      return;
    }

    if (!mode) {
      if (badge) badge.textContent = "Modo pendiente";
      if (help) help.textContent = "Selecciona un reporte para detectar el flujo disponible.";
      if (parametrosHelp) {
        parametrosHelp.textContent = "El ejemplo cambia según el reporte configurado.";
      }
      return;
    }

    if (mode === "multi_input") {
      if (badge) badge.textContent = "Modo multi-input";
      if (help) {
        help.textContent = options.loading
          ? "Se están cargando los inputs definidos del reporte."
          : "Este reporte usa inputs definidos. El selector legacy queda solo como referencia.";
      }
      if (parametrosHelp) {
        parametrosHelp.textContent = "Los parámetros JSON son complementarios. No reemplazan los inputs definidos del reporte.";
      }
      return;
    }

    if (badge) badge.textContent = "Modo legacy";
    if (help) {
      help.textContent = options.loading
        ? "Se están cargando los archivos legacy permitidos para este reporte."
        : "Este reporte mantiene el flujo actual de archivo único y envío por POST /solicitudes.";
    }
    if (parametrosHelp) {
      parametrosHelp.textContent = "El ejemplo cambia según el reporte configurado.";
    }
  }

  function updateHintRutaInput() {
    const codigo = $("reporte").value || "";
    const r = getReporteByCodigo(codigo);
    const hint = $("hintRutaInput");
    const nuevaSolicitudState = getNuevaSolicitudInputsState();

    if (!hint) return;

    if (!r) {
      hint.textContent = "Este reporte podría requerir archivo de entrada.";
      return;
    }

    if (nuevaSolicitudState.modo === "multi_input") {
      hint.textContent = "Este selector pertenece al flujo legacy y no se usa para reportes multi-input.";
      return;
    }

    if (r.requiere_input_archivo) {
      const tipos = r.tipos_permitidos ? ` (${r.tipos_permitidos})` : "";
      hint.textContent = `Obligatorio para este reporte${tipos}.`;
    } else {
      hint.textContent = "Opcional para este reporte.";
    }
  }

  function updateParametrosEjemplo(reporte) {
    const textarea = $("parametros");
    const help = $("parametros_help");
    if (!textarea) return;

    const previousApplied = state.lastParametrosEjemploAplicado || "";
    const currentValue = textarea.value || "";
    const nextExample = normalizeJsonExampleText(reporte?.parametros_ejemplo_json || "");
    const shouldReplace = !currentValue.trim() || currentValue === previousApplied;

    if (shouldReplace) {
      textarea.value = nextExample;
      state.lastParametrosEjemploAplicado = nextExample;
    }

    if (help) {
      if (nextExample) {
        help.textContent = "Se cargó el ejemplo JSON configurado para este reporte.";
      } else if (reporte) {
        help.textContent = "Este reporte no tiene ejemplo JSON configurado.";
      } else {
        help.textContent = "El ejemplo cambia según el reporte configurado.";
      }
    }
  }

  function getNuevaSolicitudInputValue(codigoInput) {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    return nuevaSolicitudState.values?.[codigoInput] ?? "";
  }

  function setNuevaSolicitudInputValue(codigoInput, value) {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    nuevaSolicitudState.values = {
      ...(nuevaSolicitudState.values || {}),
      [codigoInput]: value ?? "",
    };
  }

  function clearNuevaSolicitudInputError(codigoInput) {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    if (!nuevaSolicitudState.errors?.[codigoInput]) return;
    const nextErrors = { ...(nuevaSolicitudState.errors || {}) };
    delete nextErrors[codigoInput];
    nuevaSolicitudState.errors = nextErrors;
    const errorEl = $(`nuevaSolicitudError_${codigoInput}`);
    if (errorEl) errorEl.textContent = "";
  }

  function validatePeriodoInputValue(value) {
    const raw = (value || "").trim();
    if (!raw) return null;
    if (!/^\d{6}$/.test(raw)) {
      return "El periodo debe tener formato YYYYMM.";
    }
    const month = Number(raw.slice(4, 6));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return "El periodo debe usar un mes entre 01 y 12.";
    }
    return null;
  }

  function getNuevaSolicitudFileCache(codigoInput) {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    return nuevaSolicitudState.filesByInput?.[codigoInput] || {
      items: [],
      loading: false,
      error: "",
      loaded: false,
    };
  }

  function renderLegacyInputSection() {
    const section = $("nuevaSolicitudLegacySection");
    const select = $("ruta_input_select");
    const refreshBtn = $("btn_cargar_archivos");
    const archivosHelp = $("archivos_help");
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    const reporte = getReporteByCodigo(($("reporte")?.value || "").trim());
    const isMultiInput = nuevaSolicitudState.modo === "multi_input";
    const isLoading = nuevaSolicitudState.loading;

    if (section) {
      section.classList.toggle("is-disabled", isMultiInput || isLoading);
    }
    if (select) {
      select.disabled = isMultiInput || isLoading;
    }
    if (refreshBtn) {
      refreshBtn.disabled = isLoading;
      refreshBtn.title = isMultiInput
        ? "Este botón aplica solo al flujo legacy."
        : "Refrescar archivos";
    }

    updateHintRutaInput();

    if (!archivosHelp) return;
    if (!reporte) {
      archivosHelp.textContent = "Opcional según reporte";
      archivosHelp.title = "";
      return;
    }
    if (isMultiInput) {
      archivosHelp.textContent = "No aplica en modo multi-input.";
      archivosHelp.title = "";
      return;
    }
    if (isLoading) {
      archivosHelp.textContent = "Cargando archivos legacy...";
      return;
    }
    if (!reporte.requiere_input_archivo) {
      archivosHelp.textContent = "Opcional según reporte";
    }
  }

  function getNuevaSolicitudInputDisplayValue(inputDef) {
    const value = getNuevaSolicitudInputValue(inputDef.codigo_input);
    if (!value) return "Pendiente";
    if (inputDef.tipo_input === "archivo") {
      return getFileName(value);
    }
    return value;
  }

  function renderNuevaSolicitudInputsSummary() {
    const wrap = $("nuevaSolicitudInputsSummary");
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    if (!wrap) return;

    if (nuevaSolicitudState.modo !== "multi_input" || !nuevaSolicitudState.definitions.length) {
      wrap.innerHTML = `<div class="result-empty">Aún no hay valores seleccionados.</div>`;
      return;
    }

    const selectedDefs = nuevaSolicitudState.definitions.filter((inputDef) => {
      const value = getNuevaSolicitudInputValue(inputDef.codigo_input);
      return !!(value || "").trim();
    });

    if (!selectedDefs.length) {
      wrap.innerHTML = `<div class="result-empty">Aún no hay valores seleccionados.</div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="nueva-inputs-summary-grid">
        ${selectedDefs.map((inputDef) => `
          <div class="nueva-input-summary-item">
            <strong>${esc(inputDef.nombre_visible)}</strong>
            <span>${esc(getNuevaSolicitudInputDisplayValue(inputDef))}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderMultiInputSection() {
    const section = $("nuevaSolicitudInputsSection");
    const container = $("nuevaSolicitudInputsContainer");
    const status = $("nuevaSolicitudInputsStatus");
    const help = $("nuevaSolicitudInputsHelp");
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    const hasReport = !!(($("reporte")?.value || "").trim());
    const isMultiInput = nuevaSolicitudState.modo === "multi_input";

    if (section) {
      section.hidden = !isMultiInput;
    }
    if (!container || !status || !help) {
      renderNuevaSolicitudInputsSummary();
      return;
    }

    if (!hasReport) {
      status.textContent = "Sin cargar";
      status.className = "badge badge--neutral";
      container.innerHTML = `<div class="result-empty">Selecciona un reporte para cargar sus inputs.</div>`;
      renderNuevaSolicitudInputsSummary();
      return;
    }

    if (!isMultiInput) {
      container.innerHTML = `<div class="result-empty">Este reporte opera en modo legacy.</div>`;
      renderNuevaSolicitudInputsSummary();
      return;
    }

    if (nuevaSolicitudState.loading) {
      status.textContent = "Cargando";
      status.className = "badge badge--neutral";
      help.textContent = "Consultando definiciones y archivos disponibles por input.";
      container.innerHTML = `<div class="result-empty">Cargando inputs del reporte...</div>`;
      renderNuevaSolicitudInputsSummary();
      return;
    }

    status.textContent = `${nuevaSolicitudState.definitions.length} input(s)`;
    status.className = "badge badge--multi-input";
    help.textContent = "Los archivos se listan por input. El resumen inferior muestra lo ya seleccionado.";

    if (!nuevaSolicitudState.definitions.length) {
      container.innerHTML = `<div class="result-empty">Este reporte no expone inputs activos.</div>`;
      renderNuevaSolicitudInputsSummary();
      return;
    }

    container.innerHTML = nuevaSolicitudState.definitions.map((inputDef) => {
      const inputId = inputDef.codigo_input;
      const inputError = nuevaSolicitudState.errors?.[inputId] || "";
      const currentValue = getNuevaSolicitudInputValue(inputId);
      const requiredLabel = Number(inputDef.obligatorio) === 1 ? "Obligatorio" : "Opcional";

      if (inputDef.tipo_input === "archivo") {
        const cache = getNuevaSolicitudFileCache(inputId);
        const options = cache.loading
          ? `<option value="">Cargando archivos...</option>`
          : !cache.items.length
            ? `<option value="">No hay archivos disponibles</option>`
            : `<option value="">Seleccione un archivo</option>` +
              cache.items.map((file) => `
                <option value="${esc(file.ruta_archivo)}" title="${esc(file.ruta_archivo)}" ${file.ruta_archivo === currentValue ? "selected" : ""}>
                  ${esc(file.nombre_archivo || getFileName(file.ruta_archivo))}
                </option>
              `).join("");
        const fileMessage = cache.error
          ? `<p class="nueva-input-card__message is-warning">${esc(cache.error)}</p>`
          : !cache.loading && !cache.items.length
            ? `<p class="nueva-input-card__message is-warning">No hay archivos disponibles para este input.</p>`
            : `<p class="nueva-input-card__message">Selecciona el archivo permitido para este input.</p>`;
        const tipos = inputDef.tipos_permitidos ? `Extensiones: ${inputDef.tipos_permitidos}` : "Sin restricción de extensiones configurada";

        return `
          <div class="nueva-input-card" data-nueva-input-card="${esc(inputId)}">
            <div class="nueva-input-card__header">
              <div>
                <h4 class="nueva-input-card__title">${esc(inputDef.nombre_visible)}</h4>
                <p class="nueva-input-card__subtitle">${esc(tipos)}</p>
              </div>
              <div class="nueva-input-card__meta">
                <span class="badge badge--neutral">Archivo</span>
                <span class="badge ${Number(inputDef.obligatorio) === 1 ? "badge--multi-input" : "badge--neutral"}">${esc(requiredLabel)}</span>
              </div>
            </div>
            <div class="nueva-input-card__body">
              <select id="nuevaSolicitudInput_${esc(inputId)}" data-input-kind="archivo" data-codigo-input="${esc(inputId)}" ${cache.loading ? "disabled" : ""}>
                ${options}
              </select>
              ${fileMessage}
              <p id="nuevaSolicitudError_${esc(inputId)}" class="nueva-input-error">${esc(inputError)}</p>
            </div>
          </div>
        `;
      }

      const placeholder = inputDef.tipo_input === "periodo" ? "YYYYMM" : "Ingresa un valor";
      const helper = inputDef.tipo_input === "periodo"
        ? "Usa 6 dígitos y un mes entre 01 y 12."
        : "Valor libre complementario al resto de inputs.";

      return `
        <div class="nueva-input-card" data-nueva-input-card="${esc(inputId)}">
          <div class="nueva-input-card__header">
            <div>
              <h4 class="nueva-input-card__title">${esc(inputDef.nombre_visible)}</h4>
              <p class="nueva-input-card__subtitle">${esc(helper)}</p>
            </div>
            <div class="nueva-input-card__meta">
              <span class="badge badge--neutral">${esc(getInputTypeLabel(inputDef.tipo_input))}</span>
              <span class="badge ${Number(inputDef.obligatorio) === 1 ? "badge--multi-input" : "badge--neutral"}">${esc(requiredLabel)}</span>
            </div>
          </div>
          <div class="nueva-input-card__body">
            <input
              id="nuevaSolicitudInput_${esc(inputId)}"
              data-input-kind="${esc(inputDef.tipo_input)}"
              data-codigo-input="${esc(inputId)}"
              type="text"
              maxlength="${inputDef.tipo_input === "periodo" ? "6" : "1000"}"
              placeholder="${esc(placeholder)}"
              value="${esc(currentValue)}"
            />
            <p id="nuevaSolicitudError_${esc(inputId)}" class="nueva-input-error">${esc(inputError)}</p>
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll("[data-codigo-input]").forEach((el) => {
      const eventName = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(eventName, () => {
        const codigoInput = el.dataset.codigoInput;
        const value = el.value || "";
        setNuevaSolicitudInputValue(codigoInput, value);
        clearNuevaSolicitudInputError(codigoInput);
        renderNuevaSolicitudInputsSummary();
      });
    });

    renderNuevaSolicitudInputsSummary();
  }

  function renderNuevaSolicitudInputs() {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    setNuevaSolicitudModeBadge(nuevaSolicitudState.modo, { loading: nuevaSolicitudState.loading });
    renderLegacyInputSection();
    renderMultiInputSection();
  }

  async function loadArchivosForInput(inputDef, options = {}) {
    const force = !!options.force;
    const reporteCodigo = ($("reporte")?.value || "").trim();
    if (!reporteCodigo || inputDef?.tipo_input !== "archivo") return [];

    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    const currentCache = getNuevaSolicitudFileCache(inputDef.codigo_input);
    if (currentCache.loaded && !force) {
      return currentCache.items || [];
    }

    nuevaSolicitudState.filesByInput = {
      ...(nuevaSolicitudState.filesByInput || {}),
      [inputDef.codigo_input]: {
        ...currentCache,
        loading: true,
        error: "",
      },
    };
    renderMultiInputSection();

    try {
      const data = await getArchivosInputReporte(reporteCodigo, inputDef.codigo_input);
      const items = Array.isArray(data?.archivos) ? data.archivos : [];
      const currentValue = (getNuevaSolicitudInputValue(inputDef.codigo_input) || "").trim();
      if (currentValue && !items.some((file) => file.ruta_archivo === currentValue)) {
        setNuevaSolicitudInputValue(inputDef.codigo_input, "");
      }
      nuevaSolicitudState.filesByInput[inputDef.codigo_input] = {
        items,
        loading: false,
        error: "",
        loaded: true,
      };
      return items;
    } catch (e) {
      nuevaSolicitudState.filesByInput[inputDef.codigo_input] = {
        items: [],
        loading: false,
        error: e.message || "No se pudieron cargar archivos para este input.",
        loaded: true,
      };
      return [];
    } finally {
      renderMultiInputSection();
    }
  }

  async function loadInputsForSelectedReporte(options = {}) {
    const reporteCodigo = ($("reporte")?.value || "").trim();
    const forceFiles = !!options.forceFiles;

    resetNuevaSolicitudInputsState();
    renderNuevaSolicitudInputs();

    if (!reporteCodigo) {
      updateHintRutaInput();
      return;
    }

    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    nuevaSolicitudState.loading = true;
    setNuevaSolicitudModeBadge("loading");
    renderNuevaSolicitudInputs();

    try {
      const data = await getReporteInputs(reporteCodigo);
      const mode = data?.modo_inputs === "multi_input" ? "multi_input" : "legacy";
      const definitions = Array.isArray(data?.inputs) ? data.inputs : [];

      nuevaSolicitudState.modo = mode;
      nuevaSolicitudState.definitions = definitions;
      nuevaSolicitudState.errors = {};
      nuevaSolicitudState.values = definitions.reduce((acc, inputDef) => {
        acc[inputDef.codigo_input] = "";
        return acc;
      }, {});
      nuevaSolicitudState.filesByInput = {};

      if (mode === "legacy") {
        nuevaSolicitudState.loading = false;
        renderNuevaSolicitudInputs();
        await cargarArchivosPermitidosDelReporte();
        return;
      }

      renderNuevaSolicitudInputs();
      await Promise.all(definitions
        .filter((inputDef) => inputDef.tipo_input === "archivo")
        .map((inputDef) => loadArchivosForInput(inputDef, { force: forceFiles })));
    } catch (e) {
      resetNuevaSolicitudInputsState();
      setNuevaSolicitudModeBadge(null);
      renderNuevaSolicitudInputs();
      showAlert(`No se pudieron cargar inputs del reporte: ${e.message}`, "err");
      return;
    } finally {
      const currentState = getNuevaSolicitudInputsState();
      currentState.loading = false;
      renderNuevaSolicitudInputs();
      updateHintRutaInput();
    }
  }

  function parseNuevaSolicitudParametros() {
    const parametrosTxt = ($("parametros")?.value || "").trim();
    if (!parametrosTxt) {
      return { ok: true, parametros: {} };
    }

    const parsed = safeJsonParse(parametrosTxt, {});
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: "Parámetros JSON inválidos. Debe ser un objeto JSON.",
      };
    }

    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    const duplicatedKeys = Object.keys(parsed).filter((key) =>
      (nuevaSolicitudState.definitions || []).some((inputDef) => inputDef.codigo_input === key)
    );
    if (duplicatedKeys.length) {
      return {
        ok: false,
        error: `Los parámetros JSON no pueden repetir códigos de input: ${duplicatedKeys.join(", ")}.`,
      };
    }

    return { ok: true, parametros: parsed };
  }

  function validateMultiInputValues() {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    const errors = {};

    (nuevaSolicitudState.definitions || []).forEach((inputDef) => {
      const rawValue = getNuevaSolicitudInputValue(inputDef.codigo_input);
      const value = (rawValue || "").trim();
      const isRequired = Number(inputDef.obligatorio) === 1;

      if (!value) {
        if (isRequired) {
          if (inputDef.tipo_input === "archivo") {
            errors[inputDef.codigo_input] = "Selecciona un archivo para este input.";
          } else if (inputDef.tipo_input === "periodo") {
            errors[inputDef.codigo_input] = "Ingresa el periodo requerido con formato YYYYMM.";
          } else {
            errors[inputDef.codigo_input] = "Completa este input obligatorio.";
          }
        }
        return;
      }

      if (inputDef.tipo_input === "periodo") {
        const periodoError = validatePeriodoInputValue(value);
        if (periodoError) {
          errors[inputDef.codigo_input] = periodoError;
        }
        return;
      }

      if (inputDef.tipo_input === "archivo") {
        const cache = getNuevaSolicitudFileCache(inputDef.codigo_input);
        if (cache.loaded && cache.items.length && !cache.items.some((file) => file.ruta_archivo === value)) {
          errors[inputDef.codigo_input] = "Selecciona un archivo válido de la lista disponible.";
        }
      }
    });

    nuevaSolicitudState.errors = errors;
    renderMultiInputSection();
    return {
      ok: Object.keys(errors).length === 0,
      errors,
    };
  }

  function collectMultiInputValues() {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    return (nuevaSolicitudState.definitions || []).reduce((acc, inputDef) => {
      const rawValue = getNuevaSolicitudInputValue(inputDef.codigo_input);
      const value = (rawValue || "").trim();
      if (!value) return acc;

      if (inputDef.tipo_input === "archivo") {
        acc.push({
          codigo_input: inputDef.codigo_input,
          ruta_archivo: value,
        });
        return acc;
      }

      acc.push({
        codigo_input: inputDef.codigo_input,
        valor: value,
      });
      return acc;
    }, []);
  }

  function applyNuevaSolicitudBackendInputErrors(message) {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    const errorMessage = (message || "").trim();
    if (!errorMessage || nuevaSolicitudState.modo !== "multi_input") return false;

    const nextErrors = {};
    (nuevaSolicitudState.definitions || []).forEach((inputDef) => {
      if (errorMessage.toLowerCase().includes((inputDef.codigo_input || "").toLowerCase())) {
        nextErrors[inputDef.codigo_input] = errorMessage;
      }
    });

    if (!Object.keys(nextErrors).length) return false;
    nuevaSolicitudState.errors = {
      ...(nuevaSolicitudState.errors || {}),
      ...nextErrors,
    };
    renderMultiInputSection();
    return true;
  }

  // ---------- Nueva solicitud ----------
  function setupNuevaSolicitud() {
    $("reporte").addEventListener("change", async () => {
      updateParametrosEjemplo(getReporteByCodigo(($("reporte").value || "").trim()));
      await loadInputsForSelectedReporte();
    });
    $("btn_cargar_archivos")?.addEventListener("click", async () => {
      try {
        const nuevaSolicitudState = getNuevaSolicitudInputsState();
        if (nuevaSolicitudState.modo === "multi_input") {
          await Promise.all((nuevaSolicitudState.definitions || [])
            .filter((inputDef) => inputDef.tipo_input === "archivo")
            .map((inputDef) => loadArchivosForInput(inputDef, { force: true })));
          showAlert("Archivos multi-input actualizados.", "info");
          return;
        }
        await cargarArchivosPermitidosDelReporte();
      } catch (e) {
        showAlert(`No se pudieron cargar archivos: ${e.message}`, "err");
      }
    });

    $("btnLimpiar").addEventListener("click", () => {
      limpiarFormularioNuevaSolicitud();
    });

    $("ruta_input_select")?.addEventListener("change", () => {
      const v = $("ruta_input_select")?.value || "";
      const help = $("archivos_help");
      if (!help) return;
      if (!v) return;
      help.textContent = `Archivo seleccionado: ${getFileName(v)}`;
      help.title = v;
    });

    $("formNueva").addEventListener("submit", async (ev) => {
      ev.preventDefault();

      const reporte_codigo = $("reporte").value.trim();

      if (!reporte_codigo) {
        showAlert("Selecciona un reporte.", "err");
        return;
      }

      const nuevaSolicitudState = getNuevaSolicitudInputsState();
      if (nuevaSolicitudState.loading || !nuevaSolicitudState.modo) {
        showAlert("Espera a que termine de cargarse la configuración del reporte.", "err");
        return;
      }

      try {
        const parametrosResult = parseNuevaSolicitudParametros();
        if (!parametrosResult.ok) {
          showAlert(parametrosResult.error, "err");
          return;
        }

        if (nuevaSolicitudState.modo === "multi_input") {
          await submitSolicitudMultiInput({
            reporte_codigo,
            parametros: parametrosResult.parametros,
          });
          return;
        }

        await submitSolicitudLegacy({
          reporte_codigo,
          parametros: parametrosResult.parametros,
        });
      } catch (e) {
        const mapped = applyNuevaSolicitudBackendInputErrors(e.message || "");
        showAlert(`No se pudo crear solicitud${mapped ? " multi-input" : ""}: ${e.message}`, "err");
      }
    });

    renderNuevaSolicitudInputs();
  }

  async function cargarArchivosPermitidosDelReporte() {
    const reporteSel = $("reporte");
    const sel = $("ruta_input_select");
    const nuevaSolicitudState = getNuevaSolicitudInputsState();

    if (!reporteSel || !sel) return;

    const codigo = (reporteSel.value || "").trim();

    // reset visual
    sel.innerHTML = `<option value="">Seleccione archivo...</option>`;

    if (!codigo) return;
    if (nuevaSolicitudState.modo === "multi_input") {
      renderLegacyInputSection();
      return;
    }

    nuevaSolicitudState.loading = true;
    renderLegacyInputSection();
    sel.innerHTML = `<option value="">Cargando archivos...</option>`;

    try {
      const data = await api(`/reportes/${encodeURIComponent(codigo)}/archivos-input`);
      const archivos = Array.isArray(data?.archivos) ? data.archivos : [];

      if (!archivos.length) {
        sel.innerHTML = `<option value="">No hay archivos disponibles</option>`;
        if ($("archivos_help")) $("archivos_help").textContent = "0 archivo(s) disponibles";
        return;
      }

      sel.innerHTML =
        `<option value="">Seleccione archivo...</option>` +
        archivos.map(r => `<option value="${esc(r)}" title="${esc(r)}">${esc(getFileOptionLabel(r))}</option>`).join("");
      if ($("archivos_help")) $("archivos_help").textContent = `${archivos.length} archivo(s) disponibles`;

    } catch (e) {
      sel.innerHTML = `<option value="">Error cargando archivos</option>`;
      showAlert(`No se pudieron cargar archivos permitidos: ${e.message}`, "err");
    } finally {
      nuevaSolicitudState.loading = false;
      renderLegacyInputSection();
    }
  }

  function limpiarFormularioNuevaSolicitud(preserveResult = false) {
    $("formNueva").reset();
    $("parametros").value = "";
    state.lastParametrosEjemploAplicado = "";
    resetNuevaSolicitudInputsState();
    $("ruta_input_select").innerHTML = `<option value="">Seleccione archivo...</option>`;
    if ($("archivos_help")) {
      $("archivos_help").textContent = "Opcional según reporte";
      $("archivos_help").title = "";
    }
    if ($("parametros_help")) {
      $("parametros_help").textContent = "El ejemplo cambia según el reporte configurado.";
    }
    if (!preserveResult) {
      $("resultNueva").innerHTML = `<div class="result-empty">Formulario limpiado.</div>`;
    }
    renderNuevaSolicitudInputs();
    updateHintRutaInput();
  }

  async function submitSolicitudLegacy({ reporte_codigo, parametros }) {
    const ruta_input_raw = $("ruta_input_select")?.value || "";
    const payload = {
      reporte_codigo,
      ruta_input: ruta_input_raw.trim() || null,
      parametros,
      max_intentos: 2,
    };

    const out = await api("/solicitudes", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    await finalizeSolicitudCreada(out, {
      successMessage: `Solicitud enviada: ${out.request_id}`,
    });
  }

  async function submitSolicitudMultiInput({ reporte_codigo, parametros }) {
    const nuevaSolicitudState = getNuevaSolicitudInputsState();
    if (!(nuevaSolicitudState.definitions || []).length) {
      showAlert("Este reporte no tiene inputs activos disponibles para el flujo multi-input.", "err");
      return;
    }

    const validation = validateMultiInputValues();
    if (!validation.ok) {
      showAlert("Completa los inputs obligatorios y corrige los errores marcados.", "err");
      return;
    }

    const payload = {
      reporte_codigo,
      inputs: collectMultiInputValues(),
      parametros,
      max_intentos: 2,
    };

    const out = await api("/solicitudes-v2", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    await finalizeSolicitudCreada(out, {
      successMessage: "Solicitud multi-input creada correctamente. El worker la tomará para ejecución.",
    });
  }

  async function finalizeSolicitudCreada(out, options = {}) {
    state.selectedRequestId = out.request_id;
    $("detalleRequestId").value = out.request_id;
    renderResultNueva(out);
    limpiarFormularioNuevaSolicitud(true);
    closeNuevaModal();
    showAlert(options.successMessage || `Solicitud enviada: ${out.request_id}`, "ok", {
      replace: true,
    });

    if ($("fUsuario")) {
      $("fUsuario").value = out.usuario;
    }

    await fetchMisSolicitudes();
    await cargarDetalle(out.request_id);
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
    if (!isAuthenticated()) return;

    const isAdmin = state.me?.roles?.includes("ADMIN") || state.me?.username === "admin";
    const usuarioInput = $("fUsuario")?.value?.trim() || "";
    const usuario = isAdmin ? usuarioInput : (state.me?.username || usuarioInput);

    if (!usuario) {
      state.misSolicitudes = [];
      renderTablaMis([]);
      $("tbodyMis").innerHTML = `<tr><td colspan="8" class="table-empty">Ingresa un usuario para buscar.</td></tr>`;
      updateMisPaginationControls(1, 1, 0);
      return;
    }

    try {
      const pageSize = Number($("misPageSize")?.value || state.misPageSize || 10);
      const params = new URLSearchParams();
      params.set("usuario", usuario);
      params.set("page", String(state.misCurrentPage || 1));
      params.set("page_size", String(pageSize));

      const estado = $("fEstado")?.value?.trim();
      const reporteCodigo = $("fReporteCodigo")?.value?.trim();
      const fechaDesde = $("fFechaDesde")?.value?.trim();
      const fechaHasta = $("fFechaHasta")?.value?.trim();
      if (estado) params.set("estado", estado);
      if (reporteCodigo) params.set("reporte_codigo", reporteCodigo);
      if (fechaDesde) params.set("fecha_desde", fechaDesde);
      if (fechaHasta) params.set("fecha_hasta", fechaHasta);

      const result = await api(`/mis-solicitudes?${params.toString()}`);
      state.misSolicitudes = result?.items || [];
      state.misCurrentPage = Number(result?.page || 1);
      state.misPageSize = Number(result?.page_size || pageSize);
      if ($("misPageSize")) $("misPageSize").value = String(state.misPageSize);
      renderTablaMis(state.misSolicitudes);
      updateMisPaginationControls(
        Number(result?.page || 1),
        Number(result?.total_pages || 1),
        Number(result?.total || 0)
      );
    } catch (e) {
      if (isSilentAuthError(e)) return;
      showAlert(`Error consultando solicitudes: ${e.message}`, "err");
    }
  }

  function updateMisPaginationControls(page, totalPages, totalItems) {
    const info = $("misPageInfo");
    const prev = $("misPrevPage");
    const next = $("misNextPage");
    if (info) info.textContent = `Página ${page} de ${totalPages} (${totalItems} registros)`;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  }

  function renderTablaMis(rows = []) {
    const tb = $("tbodyMis");
    if (!rows.length) {
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
    $("btnLimpiarMisFiltros")?.addEventListener("click", () => {
      if ($("fEstado")) $("fEstado").value = "";
      if ($("fReporteCodigo")) $("fReporteCodigo").value = "";
      if ($("fFechaDesde")) $("fFechaDesde").value = "";
      if ($("fFechaHasta")) $("fFechaHasta").value = "";
      state.misCurrentPage = 1;
      fetchMisSolicitudes();
    });
    $("fEstado")?.addEventListener("change", () => {
      state.misCurrentPage = 1;
      fetchMisSolicitudes();
    });
    $("fReporteCodigo")?.addEventListener("input", () => {
      state.misCurrentPage = 1;
      fetchMisSolicitudes();
    });
    $("fFechaDesde")?.addEventListener("change", () => {
      state.misCurrentPage = 1;
      fetchMisSolicitudes();
    });
    $("fFechaHasta")?.addEventListener("change", () => {
      state.misCurrentPage = 1;
      fetchMisSolicitudes();
    });
    $("misPageSize")?.addEventListener("change", () => {
      state.misCurrentPage = 1;
      fetchMisSolicitudes();
    });
    $("misPrevPage")?.addEventListener("click", () => {
      state.misCurrentPage = Math.max(1, state.misCurrentPage - 1);
      fetchMisSolicitudes();
    });
    $("misNextPage")?.addEventListener("click", () => {
      state.misCurrentPage = state.misCurrentPage + 1;
      fetchMisSolicitudes();
    });

    $("btnRefreshAll").addEventListener("click", async () => {
      await loadHealth();
      if (!isAuthenticated()) return;
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
    clearAuthenticatedTimer("autoRefresh");
    if (!isAuthenticated()) return;
    if ($("autoRefresh").checked) {
      registerAuthenticatedTimer("autoRefresh", async () => {
        await fetchMisSolicitudes();
        if (state.selectedRequestId) await cargarDetalle(state.selectedRequestId);
      }, 5000);
    }
  }

  // ---------- Detalle ----------
  async function cargarDetalle(requestId) {
    if (!isAuthenticated()) return;

    const rid = (requestId || $("detalleRequestId").value || "").trim();
    if (!rid) {
      showAlert("Ingresa un Request ID.", "err");
      return;
    }

    try {
      const [sol, eventos] = await Promise.all([
        api(`/solicitudes/${encodeURIComponent(rid)}/detalle`),
        api(`/solicitudes/${encodeURIComponent(rid)}/eventos`)
      ]);
      state.selectedRequestId = rid;
      renderDetalle(sol, eventos);
    } catch (e) {
      if (isSilentAuthError(e)) return;
      $("detalleResumen").innerHTML = `<div class="result-empty">No se pudo cargar detalle: ${esc(e.message)}</div>`;
      $("detalleIntentos").innerHTML = `<div class="result-empty">Sin intentos.</div>`;
      $("detalleEventos").innerHTML = `<div class="result-empty">Sin eventos.</div>`;
      showAlert(`Error detalle: ${e.message}`, "err");
    }
  }

  function attemptStatusPill(result) {
    const normalized = String(result || "").toLowerCase();
    if (normalized === "ok") return '<span class="status-pill status-OK">OK</span>';
    if (normalized === "error" || normalized === "worker_error") return '<span class="status-pill status-ERROR">ERROR</span>';
    if (normalized === "sin_resultado") return '<span class="status-pill status-EN_COLA">SIN RESULTADO</span>';
    return '<span class="status-pill status-CANCELADO">N/D</span>';
  }

  function eventTypeBadge(type) {
    const normalized = String(type || "").toUpperCase();
    const statusClass = ["ERROR", "RESULTADO"].includes(normalized)
      ? "status-ERROR"
      : ["INTENTO", "EJECUCION"].includes(normalized)
        ? "status-EJECUTANDO"
        : normalized === "ESTADO"
          ? "status-EN_COLA"
          : "status-CANCELADO";
    return `<span class="status-pill ${statusClass}">${esc(normalized || "INFO")}</span>`;
  }

  function renderJsonDetailBlock(value, emptyLabel) {
    if (!value || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)) {
      return `<span class="muted">${esc(emptyLabel)}</span>`;
    }
    return `<pre class="detail-json mono">${esc(JSON.stringify(value, null, 2))}</pre>`;
  }

  function renderTechnicalValue(value, emptyLabel = "-") {
    if (value === null || value === undefined || value === "") {
      return `<span class="muted">${esc(emptyLabel)}</span>`;
    }
    return `<div class="detail-technical mono">${esc(String(value))}</div>`;
  }

  function renderInputDetailList(inputsEnviados) {
    if (!inputsEnviados.length) {
      return `<span class="muted">No se registraron inputs estructurados.</span>`;
    }

    return `<div class="detail-input-list">${inputsEnviados.map((input) => {
      const valorPrincipal = input.tipo_input === "archivo"
        ? (input.ruta_archivo || input.valor || "-")
        : (input.valor || "-");
      return `
        <div class="detail-input-list__item">
          <div class="detail-input-list__title">
            <strong>${esc(input.nombre_visible || input.codigo_input)}</strong>
            <div class="detail-input-list__badges">
              <span class="badge badge--neutral">${esc(getInputTypeLabel(input.tipo_input))}</span>
              <span class="badge ${Number(input.obligatorio) === 1 ? "badge--multi-input" : "badge--neutral"}">${Number(input.obligatorio) === 1 ? "Obligatorio" : "Opcional"}</span>
            </div>
          </div>
          <div class="detail-data-points">
            <div class="detail-data-point">
              <span class="detail-data-point__label">Código</span>
              ${renderTechnicalValue(input.codigo_input)}
            </div>
            <div class="detail-data-point">
              <span class="detail-data-point__label">Valor</span>
              ${renderTechnicalValue(valorPrincipal)}
            </div>
            ${input.ruta_archivo ? `
              <div class="detail-data-point detail-data-point--full">
                <span class="detail-data-point__label">Ruta archivo</span>
                ${renderTechnicalValue(input.ruta_archivo)}
              </div>
            ` : ""}
            <div class="detail-data-point detail-data-point--full">
              <span class="detail-data-point__label">Metadata</span>
              ${renderJsonDetailBlock(input.metadata, "Sin metadata adicional")}
            </div>
          </div>
        </div>
      `;
    }).join("")}</div>`;
  }

  function renderAttemptDetailList(intentos) {
    if (!intentos.length) {
      return `<div class="result-empty">Sin intentos registrados todavía.</div>`;
    }

    return intentos.map((intento) => {
      const summaryItems = [
        { label: "Modo", value: intento.modo_inputs || "-" },
        { label: "Inputs", value: intento.input_count ?? "-" },
        { label: "Returncode", value: intento.returncode ?? "-" },
        { label: "Duración", value: intento.duration_sec != null ? `${Number(intento.duration_sec).toFixed(3)} s` : "-" },
        { label: "Timed out", value: intento.timed_out == null ? "-" : (intento.timed_out ? "Sí" : "No") },
      ];

      const technicalBlocks = [
        intento.log_path ? `
          <div class="detail-attempt-block">
            <h5>Log del intento</h5>
            ${renderTechnicalValue(intento.log_path)}
          </div>
        ` : "",
        intento.payload_path ? `
          <div class="detail-attempt-block">
            <h5>Payload temporal</h5>
            ${renderTechnicalValue(intento.payload_path)}
          </div>
        ` : "",
        intento.comando ? `
          <div class="detail-attempt-block detail-attempt-block--full">
            <h5>Comando construido</h5>
            ${renderTechnicalValue(intento.comando)}
          </div>
        ` : "",
        intento.payload_preview ? `
          <div class="detail-attempt-block detail-attempt-block--full">
            <h5>JSON temporal generado</h5>
            ${renderJsonDetailBlock(intento.payload_preview, "Sin payload")}
          </div>
        ` : "",
        intento.stdout_tail ? `
          <div class="detail-attempt-block detail-attempt-block--full">
            <h5>STDOUT resumido</h5>
            <pre class="detail-json mono">${esc(intento.stdout_tail)}</pre>
          </div>
        ` : "",
        intento.stderr_tail ? `
          <div class="detail-attempt-block detail-attempt-block--full">
            <h5>STDERR resumido</h5>
            <pre class="detail-json mono">${esc(intento.stderr_tail)}</pre>
          </div>
        ` : "",
        intento.worker_error ? `
          <div class="detail-attempt-block detail-attempt-block--full">
            <h5>Error del worker</h5>
            <pre class="detail-json mono">${esc(intento.worker_error)}</pre>
          </div>
        ` : "",
      ].filter(Boolean).join("");

      return `
        <article class="detail-attempt-card">
          <div class="detail-attempt-card__header">
            <div>
              <h4>Intento ${esc(intento.intento)}</h4>
              <p class="muted">Resumen operativo del intento ejecutado por el worker.</p>
            </div>
            ${attemptStatusPill(intento.estado_resultado)}
          </div>
          <div class="detail-data-points">
            ${summaryItems.map((item) => `
              <div class="detail-data-point">
                <span class="detail-data-point__label">${esc(item.label)}</span>
                <span>${esc(String(item.value))}</span>
              </div>
            `).join("")}
          </div>
          ${technicalBlocks ? `<div class="detail-attempt-grid">${technicalBlocks}</div>` : '<div class="detail-attempt-empty">Sin evidencia técnica adicional visible para este usuario.</div>'}
        </article>
      `;
    }).join("");
  }

  function renderDetalle(sol, eventos) {
    const outputPath = (sol.ruta_output || "").trim();
    const modoInputs = sol.modo_inputs === "multi_input" ? "Multi-input" : "Legacy";
    const inputsEnviados = Array.isArray(sol.inputs_enviados) ? sol.inputs_enviados : [];
    const intentos = Array.isArray(sol.intentos_detalle) ? sol.intentos_detalle : [];
    const parametros = renderJsonDetailBlock(sol.parametros, "Sin parámetros adicionales");
    const inputsHtml = renderInputDetailList(inputsEnviados);
    const outputHtml = renderTechnicalValue(outputPath, "Sin ruta de salida registrada");
    const legacyHtml = `
      <div class="detail-data-points">
        <div class="detail-data-point detail-data-point--full">
          <span class="detail-data-point__label">Ruta input legacy</span>
          ${renderTechnicalValue(sol.ruta_input_legacy, "No aplica")}
        </div>
        <div class="detail-data-point detail-data-point--full">
          <span class="detail-data-point__label">Parámetros JSON</span>
          ${parametros}
        </div>
        ${sol.comando_ultimo ? `
          <div class="detail-data-point detail-data-point--full">
            <span class="detail-data-point__label">Último comando construido</span>
            ${renderTechnicalValue(sol.comando_ultimo)}
          </div>
        ` : ""}
      </div>
    `;
    const multiInputHtml = `
      <div class="detail-data-points">
        <div class="detail-data-point detail-data-point--full">
          <span class="detail-data-point__label">Parámetros adicionales</span>
          ${parametros}
        </div>
      </div>
      <div class="detail-section-caption">Inputs enviados</div>
      ${inputsHtml}
    `;

    $("detalleResumen").innerHTML = `
      <div class="kv"><label>Request ID</label><div class="mono">${esc(sol.request_id)}</div></div>
      <div class="kv"><label>Reporte</label><div>${esc(sol.reporte_codigo)}</div></div>
      <div class="kv"><label>Usuario</label><div>${esc(sol.usuario)}</div></div>
      <div class="kv"><label>Modo inputs</label><div>${esc(modoInputs)}</div></div>
      <div class="kv"><label>Estado</label><div>${statusPill(sol.estado)}</div></div>
      <div class="kv"><label>Progreso</label><div>${progressBar(sol.progreso)}</div></div>
      <div class="kv"><label>Solicitado</label><div>${esc(fmtDate(sol.fecha_solicitud))}</div></div>
      <div class="kv"><label>Inicio</label><div>${esc(fmtDate(sol.fecha_inicio))}</div></div>
      <div class="kv"><label>Fin</label><div>${esc(fmtDate(sol.fecha_fin))}</div></div>
      <div class="kv"><label>Intentos</label><div>${esc(`${sol.intentos_registrados} / ${sol.max_intentos}`)}</div></div>
      <div class="kv"><label>Intento actual o último</label><div>${esc(sol.intento_actual_o_ultimo == null ? "-" : String(sol.intento_actual_o_ultimo))}</div></div>
      <div class="kv kv--span-3"><label>Mensaje de estado</label><div>${esc(sol.mensaje_estado || "-")}</div></div>
      <div class="kv kv--span-2">
        <label>Ruta output</label>
        ${outputHtml}
        ${outputPath ? '<button id="btnCopyOutputPath" class="btn btn--ghost btn--sm" type="button" style="margin-top:8px;">Copiar ruta</button>' : ""}
      </div>
      <div class="kv"><label>Última actualización</label><div>${esc(fmtDate(sol.updated_at))}</div></div>
      <div class="kv kv--span-3">
        <label>${sol.modo_inputs === "multi_input" ? "Solicitud multi-input" : "Solicitud legacy"}</label>
        <div class="detail-section-body">
          ${sol.modo_inputs === "multi_input" ? multiInputHtml : legacyHtml}
        </div>
      </div>
      <div class="kv kv--span-3">
        <label>Error detalle</label>
        ${sol.error_detalle ? renderTechnicalValue(sol.error_detalle) : '<span class="muted">Sin error final registrado.</span>'}
      </div>
    `;

    $("detalleIntentos").innerHTML = renderAttemptDetailList(intentos);

    if (outputPath) {
      $("btnCopyOutputPath")?.addEventListener("click", () => copyOutputPath(outputPath));
    }

    if (!eventos?.length) {
      $("detalleEventos").innerHTML = `<div class="result-empty">No hay eventos.</div>`;
      return;
    }

    $("detalleEventos").innerHTML = eventos.map(ev => `
      <div class="tl-item">
        <div class="tl-item__meta">
          ${eventTypeBadge(ev.tipo_evento)}
          <span>${esc(ev.origen || "-")}</span>
          <span>•</span>
          <span>${esc(fmtDate(ev.created_at))}</span>
        </div>
        <div class="tl-item__body">${esc(ev.detalle || "-")}</div>
      </div>
    `).join("");
  }

  function setupDetalle() {
    $("btnCargarDetalle").addEventListener("click", () => cargarDetalle());
  }

  function setupLayoutControls() {
    const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    setSidebarCollapsed(collapsed);

    const toggleSidebar = () => {
      const appView = $("app-view");
      const isCollapsed = appView?.classList.contains("app-shell--collapsed");
      setSidebarCollapsed(!isCollapsed);
    };

    $("btnSidebarToggle")?.addEventListener("click", toggleSidebar);
    $("btnSidebarBrand")?.addEventListener("click", toggleSidebar);

    $("btnOpenNuevaModal")?.addEventListener("click", openNuevaModal);
    $("btnCloseNuevaModal")?.addEventListener("click", closeNuevaModal);
    $("btnCloseNuevaModalBg")?.addEventListener("click", closeNuevaModal);
    $("btnCloseConsultaResultados")?.addEventListener("click", closeConsultaResultadosModal);
    $("btnCloseConsultaResultadosBg")?.addEventListener("click", closeConsultaResultadosModal);

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        closeNuevaModal();
        closeAdminReporteModal();
        closeAdminEquipoModal();
        closeAdminUsuarioEquiposModal();
        closeAdminTablaConsultaModal();
        closeConsultaResultadosModal();
      }
    });
  }

  // ---------- Init ----------
  async function init() {
    $("apiBaseLabel").textContent = state.apiBase;
    setupLayoutControls();
    setupTabs();
    setupConsultaTablas();
    setupNuevaSolicitud();
    setupMisSolicitudes();
    setupDetalle();
    setupAdminReportes();
    setupAdminEquipos();
    setupAdminTablasConsulta();
    setupUsuarios();
    setupAuthUI();
    startVersionPolling();

    await bootstrapAuth();
    await loadHealth();

    if ($("parametros_help")) {
      $("parametros_help").textContent = "El ejemplo cambia según el reporte configurado.";
    }
  }

  async function bootstrapAuth() {
    const token = getToken();
    state.auth.token = token;
    state.auth.isAuthenticated = Boolean(token);
    if (!token) {
      stopAuthenticatedPollers();
      showLoginView();
      return;
    }

    try {
      const me = await api("/auth/me");
      setAuthUI(me);
      state.auth.logoutInProgress = false;
      state.auth.sessionExpiredNotified = false;
      if (me.username) $("fUsuario").value = me.username;

      showAppView();
      startAuthenticatedPollers();

      // Load initial dashboard data
      await loadReportes();
      await fetchMisSolicitudes();
      await loadAdminReportes();
      await loadAdminEquiposData();
      await loadAdminTablasConsulta();
      await loadConsultaTablasDisponibles();
      await fetchUsuariosAdmin();
    } catch (e) {
      if (isSilentAuthError(e)) return;
      logout({ silent: true });
    }
  }

  async function getAdminRutasByCodigo(codigo) {
    return api(`/admin/reportes/${encodeURIComponent(codigo)}/carpetas`);
  }

  async function createAdminRutaByCodigo(codigo, rutaBase) {
    return api(`/admin/reportes/${encodeURIComponent(codigo)}/carpetas`, {
      method: "POST",
      body: JSON.stringify({ ruta_base: rutaBase }),
    });
  }

  async function updateAdminRutaById(id, payload) {
    return api(`/admin/carpetas/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async function getAdminReporteInputs(reporteId) {
    return api(`/admin/reportes/${encodeURIComponent(reporteId)}/inputs`);
  }

  async function createAdminReporteInput(reporteId, payload) {
    return api(`/admin/reportes/${encodeURIComponent(reporteId)}/inputs`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async function updateAdminReporteInput(inputId, payload) {
    return api(`/admin/reportes/inputs/${encodeURIComponent(inputId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async function deleteAdminReporteInput(inputId) {
    return api(`/admin/reportes/inputs/${encodeURIComponent(inputId)}`, {
      method: "DELETE",
    });
  }

  async function getAdminInputCarpetas(inputId) {
    return api(`/admin/reportes/inputs/${encodeURIComponent(inputId)}/carpetas`);
  }

  async function createAdminInputCarpeta(inputId, payload) {
    return api(`/admin/reportes/inputs/${encodeURIComponent(inputId)}/carpetas`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async function updateAdminInputCarpeta(carpetaId, payload) {
    return api(`/admin/reportes/inputs/carpetas/${encodeURIComponent(carpetaId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async function getEquiposReporteById(reporteId) {
    return api(`/admin/reportes/${encodeURIComponent(reporteId)}/equipos`);
  }

  async function updateEquiposReporteById(reporteId, equipoIds) {
    return api(`/admin/reportes/${encodeURIComponent(reporteId)}/equipos`, {
      method: "PUT",
      body: JSON.stringify({ equipo_ids: (equipoIds || []).map(Number) }),
    });
  }

  async function getEquiposUsuarioById(usuarioId) {
    return api(`/admin/usuarios/${encodeURIComponent(usuarioId)}/equipos`);
  }

  async function updateEquiposUsuarioById(usuarioId, equipoIds) {
    return api(`/admin/usuarios/${encodeURIComponent(usuarioId)}/equipos`, {
      method: "PUT",
      body: JSON.stringify({ equipo_ids: (equipoIds || []).map(Number) }),
    });
  }

  async function getUsuariosEquipoById(equipoId) {
    return api(`/admin/equipos/${encodeURIComponent(equipoId)}/usuarios`);
  }

  async function updateUsuariosEquipoById(equipoId, usuarioIds) {
    return api(`/admin/equipos/${encodeURIComponent(equipoId)}/usuarios`, {
      method: "PUT",
      body: JSON.stringify({ usuario_ids: (usuarioIds || []).map(Number) }),
    });
  }

  async function getReportesEquipoById(equipoId) {
    return api(`/admin/equipos/${encodeURIComponent(equipoId)}/reportes`);
  }

  async function updateReportesEquipoById(equipoId, reporteIds) {
    return api(`/admin/equipos/${encodeURIComponent(equipoId)}/reportes`, {
      method: "PUT",
      body: JSON.stringify({ reporte_ids: (reporteIds || []).map(Number) }),
    });
  }

  async function getEquiposResumen() {
    return api("/admin/equipos/resumen");
  }

  async function getEquipoResumenById(equipoId) {
    return api(`/admin/equipos/${encodeURIComponent(equipoId)}/resumen`);
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
      const rows = await getAdminRutasByCodigo(codigo);
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
            class="input-sm"
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
            <button class="btn btn--ghost btn--sm btn-admin-guardar" data-id="${esc(r.id)}">Guardar</button>
            ${r.activo === 1
        ? `<button class="btn btn--ghost btn--sm btn-admin-toggle" data-id="${esc(r.id)}" data-next="0">Desactivar</button>`
        : `<button class="btn btn--ghost btn--sm btn-admin-toggle" data-id="${esc(r.id)}" data-next="1">Activar</button>`}
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
          await updateAdminRutaById(id, { ruta_base: nuevaRuta });
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
          await updateAdminRutaById(id, { activo: next });
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
      await createAdminRutaByCodigo(codigo, ruta);
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

  async function loadConfiguratorRutas() {
    const report = getConfiguratorSelectedReport();
    const tb = $("cfgTbodyRutas");
    const status = $("cfgRutasStatus");
    if (!tb || !status) return;

    if (!report?.codigo) {
      status.textContent = "Guarda el reporte para habilitar rutas legacy por reporte.";
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">Guarda el reporte para administrar rutas.</td></tr>`;
      state.adminConfigurator.rutas = [];
      renderConfiguratorReview();
      syncConfiguratorFlowActions();
      return;
    }

    if (Number(report.requiere_input_archivo) !== 1) {
      status.textContent = "Este reporte no requiere archivo de entrada en el flujo legacy.";
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">No aplica porque el reporte no requiere archivo de entrada.</td></tr>`;
      state.adminConfigurator.rutas = [];
      renderConfiguratorReview();
      syncConfiguratorFlowActions();
      return;
    }

    tb.innerHTML = `<tr><td colspan="4" class="table-empty">Cargando rutas...</td></tr>`;
    status.textContent = `Rutas legacy permitidas para ${report.codigo}.`;

    try {
      const rows = await getAdminRutasByCodigo(report.codigo);
      state.adminConfigurator.rutas = rows || [];
      renderConfiguratorRutas(rows || []);
      renderConfiguratorReview();
      syncConfiguratorFlowActions();
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">Error al cargar rutas.</td></tr>`;
      state.adminConfigurator.rutas = [];
      syncConfiguratorFlowActions();
      showAlert(`No se pudieron cargar rutas del configurador: ${e.message}`, "err");
    }
  }

  function renderConfiguratorRutas(rows = []) {
    const tb = $("cfgTbodyRutas");
    if (!tb) return;

    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="4" class="table-empty">No hay rutas registradas para este reporte.</td></tr>`;
      syncConfiguratorFlowActions();
      return;
    }

    tb.innerHTML = rows.map((r) => `
      <tr>
        <td class="mono">${esc(r.id)}</td>
        <td><input id="cfg_ruta_edit_${esc(r.id)}" class="input-sm" type="text" value="${esc(r.ruta_base)}" /></td>
        <td>${Number(r.activo) === 1 ? '<span class="status-pill status-OK">ACTIVO</span>' : '<span class="status-pill status-CANCELADO">INACTIVO</span>'}</td>
        <td>
          <div class="inline-controls">
            <button class="btn btn--ghost btn--sm btn-cfg-ruta-save" data-id="${esc(r.id)}">Guardar</button>
            <button class="btn btn--ghost btn--sm btn-cfg-ruta-toggle" data-id="${esc(r.id)}" data-next="${Number(r.activo) === 1 ? "0" : "1"}">
              ${Number(r.activo) === 1 ? "Desactivar" : "Activar"}
            </button>
          </div>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-cfg-ruta-save").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const nuevaRuta = ($(`cfg_ruta_edit_${id}`)?.value || "").trim();
        if (!nuevaRuta) {
          showAlert("La ruta no puede estar vacía.", "err");
          return;
        }
        try {
          await updateAdminRutaById(id, { ruta_base: nuevaRuta });
          showAlert(`Ruta ${id} actualizada.`, "ok");
          await loadConfiguratorRutas();
        } catch (e) {
          showAlert(`No se pudo actualizar ruta: ${e.message}`, "err");
        }
      });
    });

    document.querySelectorAll(".btn-cfg-ruta-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const next = Number(btn.dataset.next || 0);
        try {
          await updateAdminRutaById(id, { activo: next });
          showAlert(`Ruta ${id} ${next === 1 ? "activada" : "desactivada"}.`, "ok");
          await loadConfiguratorRutas();
        } catch (e) {
          showAlert(`No se pudo cambiar estado de ruta: ${e.message}`, "err");
        }
      });
    });

    syncConfiguratorFlowActions();
  }

  function activateTab(tabId) {
    if (!tabId) return;
    document.querySelector(`.menu__item[data-tab="${tabId}"]`)?.click();
  }

  async function addConfiguratorRuta() {
    const report = getConfiguratorSelectedReport();
    const ruta = $("cfgRutaNueva")?.value?.trim();

    if (!report?.codigo) {
      showAlert("Primero guarda el reporte.", "err");
      return;
    }
    if (Number(report.requiere_input_archivo) !== 1) {
      showAlert("Este reporte no requiere rutas de entrada.", "err");
      return;
    }
    if (!ruta) {
      showAlert("Ingresa una ruta base.", "err");
      return;
    }

    try {
      await createAdminRutaByCodigo(report.codigo, ruta);
      $("cfgRutaNueva").value = "";
      showAlert("Ruta agregada correctamente.", "ok");
      await loadConfiguratorRutas();
    } catch (e) {
      showAlert(`No se pudo agregar ruta: ${e.message}`, "err");
    }
  }

  // ---------- Admin Reportes ----------
  async function loadAdminReportes() {
    const tb = $("tbodyAdminReportes");
    if (!tb) return;
    if (!isAuthenticated()) return;

    const isAdmin = state.me?.roles?.includes("ADMIN") || state.me?.username === "admin";
    if (!isAdmin) {
      tb.innerHTML = `<tr><td colspan="6" class="table-empty">Sin permisos.</td></tr>`;
      return;
    }

    tb.innerHTML = `<tr><td colspan="6" class="table-empty">Cargando...</td></tr>`;
    try {
      const pageSize = Number($("admRepPageSize")?.value || state.admRepPageSize || 10);
      const params = new URLSearchParams();
      params.set("page", String(state.admRepCurrentPage || 1));
      params.set("page_size", String(pageSize));
      const codigo = $("admRepFiltroCodigo")?.value?.trim();
      if (codigo) params.set("codigo", codigo);

      const result = await api(`/admin/reportes?${params.toString()}`);
      state.adminReportes = result?.items || [];
      state.admRepCurrentPage = Number(result?.page || 1);
      state.admRepPageSize = Number(result?.page_size || pageSize);
      if ($("admRepPageSize")) $("admRepPageSize").value = String(state.admRepPageSize);

      renderAdminReportes(state.adminReportes);
      updateAdminReportesPaginationControls(
        Number(result?.page || 1),
        Number(result?.total_pages || 1),
        Number(result?.total || 0)
      );
      await refreshAdminReportesAll();
    } catch (e) {
      if (isSilentAuthError(e)) return;
      tb.innerHTML = `<tr><td colspan="6" class="table-empty">Error al cargar reportes.</td></tr>`;
      showAlert(`No se pudieron cargar reportes admin: ${e.message}`, "err");
    }
  }

  async function refreshAdminReportesAll() {
    try {
      const out = await api("/admin/reportes?page=1&page_size=500");
      state.adminReportesAll = out?.items || [];
      fillReporteEquiposSelect();
    } catch (e) {
      // noop: no bloquea la pantalla principal de admin reportes
    }
  }

  function updateAdminReportesPaginationControls(page, totalPages, totalItems) {
    const info = $("admRepPageInfo");
    const prev = $("admRepPrevPage");
    const next = $("admRepNextPage");
    if (info) info.textContent = `Página ${page} de ${totalPages} (${totalItems} registros)`;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  }

  async function loadConfiguratorEquipos() {
    const report = getConfiguratorSelectedReport();
    if (!report?.id) {
      state.adminReporteEquipoIds = [];
      renderConfiguratorEquiposChecks();
      renderConfiguratorReview();
      return;
    }

    try {
      const rows = await getEquiposReporteById(report.id);
      state.adminReporteEquipoIds = (rows || []).map((r) => Number(r.id));
      renderConfiguratorEquiposChecks();
      renderConfiguratorReview();
    } catch (e) {
      showAlert(`No se pudieron cargar equipos del reporte: ${e.message}`, "err");
    }
  }

  async function saveConfiguratorEquipos() {
    const btn = $("btnCfgGuardarEquipos");
    const report = getConfiguratorSelectedReport();
    if (!report?.id) {
      showAlert("Primero guarda el reporte.", "err");
      return;
    }

    try {
      if (btn) {
        btn.disabled = true;
        btn.dataset.prevText = btn.textContent || "";
        btn.textContent = "Guardando...";
      }
      await updateEquiposReporteById(report.id, state.adminReporteEquipoIds || []);
      showAlert(`Asignación aplicada para reporte ${report.codigo || report.id}.`, "ok");
      await loadReportes();
      await loadConfiguratorEquipos();
      setConfiguratorStep("revision");
      renderConfiguratorReview();
    } catch (e) {
      showAlert(`No se pudo guardar asignación de reporte: ${e.message}`, "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.prevText || "Guardar asignación";
      }
    }
  }

  async function hydrateConfiguratorForReport(report, { mode = "edit", step = "datos" } = {}) {
    state.adminConfigurator.mode = mode;
    setConfiguratorSelectedReport(report || null);
    syncAdminReporteIdVisibility();
    syncConfiguratorInputFields();
    setConfiguratorStep(step);
    openAdminReporteModal();
    renderConfiguratorEquiposChecks();
    renderConfiguratorReview();
    syncConfiguratorFlowActions();

    if (canUseAdvancedConfiguratorSteps()) {
      await Promise.all([
        loadConfiguratorInputs(),
        loadConfiguratorRutas(),
        loadConfiguratorEquipos(),
      ]);
    } else {
      resetConfiguratorInputsState();
      renderConfiguratorInputs();
      renderInputCarpetas();
      await loadConfiguratorRutas();
      state.adminReporteEquipoIds = [];
      renderConfiguratorEquiposChecks();
      renderConfiguratorReview();
    }
  }

  async function openReportConfiguratorCreate() {
    resetAdminReporteModalForCreate();
    state.adminReporteEquipoIds = [];
    $("cfgRutaNueva").value = "";
    closeConfiguratorInputForm();
    if ($("cfgInputCarpetaNueva")) $("cfgInputCarpetaNueva").value = "";
    await hydrateConfiguratorForReport(null, { mode: "create", step: "datos" });
  }

  async function openReportConfiguratorEdit(row) {
    prepareAdminReporteModalForEdit(row);
    $("cfgRutaNueva").value = "";
    closeConfiguratorInputForm();
    if ($("cfgInputCarpetaNueva")) $("cfgInputCarpetaNueva").value = "";
    await hydrateConfiguratorForReport(row, { mode: "edit", step: "datos" });
  }

  function renderAdminReportes(rows = []) {
    const tb = $("tbodyAdminReportes");
    if (!tb) return;
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="6" class="table-empty">No hay reportes.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map((r) => `
      <tr>
        <td class="mono">${esc(r.id)}</td>
        <td class="mono">${esc(r.codigo)}</td>
        <td>${esc(r.nombre)}</td>
        <td>${r.requiere_input_archivo === 1 ? "SI" : "NO"}</td>
        <td>${Number(r.activo) === 1 ? '<span class="status-pill status-OK">Activo</span>' : '<span class="status-pill status-CANCELADO">Inactivo</span>'}</td>
        <td>
          <div class="inline-controls">
            <button class="btn btn--ghost btn--sm btn-admrep-edit" data-id="${esc(r.id)}">Configurar</button>
            <button class="btn btn--ghost btn--sm btn-admrep-delete" data-id="${esc(r.id)}">Desactivar</button>
          </div>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-admrep-edit").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const row = (state.adminReportes || []).find((x) => Number(x.id) === id);
        if (!row) {
          showAlert("No se encontró el reporte seleccionado.", "err");
          return;
        }

        await openReportConfiguratorEdit(row);
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

  function setupAccordions(groupName) {
    const accordions = Array.from(document.querySelectorAll(`[data-accordion-group="${groupName}"]`));
    if (!accordions.length) return;

    const openAccordion = (targetAccordion) => {
      accordions.forEach((accordion) => {
        const trigger = accordion.querySelector("[data-accordion-trigger]");
        const body = accordion.querySelector("[data-accordion-body]");
        const icon = accordion.querySelector(".accordion__icon");
        const isOpen = accordion === targetAccordion;
        accordion.classList.toggle("is-open", isOpen);
        if (trigger) trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (body) body.hidden = !isOpen;
        if (icon) icon.textContent = isOpen ? "-" : "+";
      });
    };

    accordions.forEach((accordion) => {
      const trigger = accordion.querySelector("[data-accordion-trigger]");
      trigger?.addEventListener("click", () => {
        if (accordion.classList.contains("is-open")) {
          openAccordion(null);
          return;
        }
        openAccordion(accordion);
      });
    });
  }

  async function saveAdminReporteFromModal(ev) {
    ev.preventDefault();
    if (!validateAdminReporteForm()) return;
    const id = $("admEditRepId")?.value?.trim();
    const payload = getAdminReportePayloadFromForm();

    try {
      const out = await api(id ? `/admin/reportes/${encodeURIComponent(id)}` : "/admin/reportes", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      $("admEditRepId").value = out.id;
      $("admEditRepIdView").value = out.id;
      setConfiguratorSelectedReport(out);
      const nextStep = id
        ? (
          state.adminConfigurator.step === "rutas" && Number(payload.requiere_input_archivo) !== 1
            ? "equipos"
            : (state.adminConfigurator.step || "datos")
        )
        : "rutas";
      await hydrateConfiguratorForReport(out, {
        mode: id ? "edit" : "create",
        step: nextStep,
      });
      showAlert(id ? `Reporte ${id} actualizado.` : "Reporte creado correctamente.", "ok");
      await loadReportes();
      await loadAdminReportes();
      await loadAdminEquiposData();
    } catch (e) {
      showAlert(`${id ? "No se pudo actualizar reporte" : "No se pudo crear reporte"}: ${e.message}`, "err");
    }
  }

  function setupAdminReportes() {
    $("btnOpenAdmRepCreateModal")?.addEventListener("click", openReportConfiguratorCreate);
    $("btnAdmRepRefrescar")?.addEventListener("click", loadAdminReportes);
    $("btnCloseAdmRepModal")?.addEventListener("click", closeAdminReporteModal);
    $("btnCloseAdmRepModalBg")?.addEventListener("click", closeAdminReporteModal);
    $("formAdminReporteEdit")?.addEventListener("submit", saveAdminReporteFromModal);
    $("btnCfgGoToRutas")?.addEventListener("click", async () => {
      if (!canUseAdvancedConfiguratorSteps()) {
        showAlert("Primero guarda el reporte para continuar.", "err");
        return;
      }
      setConfiguratorStep("rutas");
      await Promise.all([
        loadConfiguratorInputs(),
        loadConfiguratorRutas(),
      ]);
    });
    $("btnCfgAgregarRuta")?.addEventListener("click", addConfiguratorRuta);
    $("btnCfgOpenInputForm")?.addEventListener("click", openInputFormForCreate);
    $("btnCfgCancelInputForm")?.addEventListener("click", closeConfiguratorInputForm);
    $("cfgInputTipo")?.addEventListener("change", syncConfiguratorInputForm);
    $("cfgInputForm")?.addEventListener("submit", saveConfiguratorInput);
    $("btnCfgAgregarInputCarpeta")?.addEventListener("click", addInputCarpeta);
    $("btnCfgGoToEquipos")?.addEventListener("click", async () => {
      setConfiguratorStep("equipos");
      await loadConfiguratorEquipos();
    });
    $("cfgReporteEquiposFiltro")?.addEventListener("input", renderConfiguratorEquiposChecks);
    $("btnCfgGuardarEquipos")?.addEventListener("click", saveConfiguratorEquipos);
    $("btnCfgOpenEquiposAdmin")?.addEventListener("click", () => {
      closeAdminReporteModal();
      activateTab("tab-admin-equipos");
    });
    $("btnCfgFinalizar")?.addEventListener("click", async () => {
      closeAdminReporteModal();
      await loadAdminReportes();
    });
    document.querySelectorAll("[data-config-step]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const step = btn.dataset.configStep;
        setConfiguratorStep(step);
        if (step === "rutas") {
          await Promise.all([
            loadConfiguratorInputs(),
            loadConfiguratorRutas(),
          ]);
        }
        if (step === "equipos") await loadConfiguratorEquipos();
        if (step === "revision") renderConfiguratorReview();
      });
    });
    $("admEditRepReqInput")?.addEventListener("change", () => {
      const selected = getConfiguratorSelectedReport();
      syncConfiguratorInputFields();
      if (selected) {
        selected.requiere_input_archivo = Number($("admEditRepReqInput")?.value || 0);
        renderConfiguratorReview();
        syncConfiguratorFlowActions();
        if (state.adminConfigurator.step === "rutas") {
          loadConfiguratorRutas();
        }
      } else {
        syncConfiguratorFlowActions();
      }
    });
    $("admEditRepCodigo")?.addEventListener("input", validateAdminReporteCodigo);
    $("admEditRepNombre")?.addEventListener("input", () => {
      const nombreInput = $("admEditRepNombre");
      if (!nombreInput) return;
      nombreInput.setCustomValidity((nombreInput.value || "").trim() ? "" : "El nombre es obligatorio.");
    });
    $("formAdminReporteEdit")?.addEventListener("input", () => {
      if (state.adminConfigurator.step === "revision") {
        renderConfiguratorReview();
      }
    });
    $("admRepFiltroCodigo")?.addEventListener("input", () => {
      state.admRepCurrentPage = 1;
      loadAdminReportes();
    });
    $("admRepPageSize")?.addEventListener("change", () => {
      state.admRepCurrentPage = 1;
      loadAdminReportes();
    });
    $("admRepPrevPage")?.addEventListener("click", () => {
      state.admRepCurrentPage = Math.max(1, state.admRepCurrentPage - 1);
      loadAdminReportes();
    });
    $("admRepNextPage")?.addEventListener("click", () => {
      state.admRepCurrentPage = state.admRepCurrentPage + 1;
      loadAdminReportes();
    });
  }

  // ---------- Admin Equipos ----------
  function renderSelectableChecks(containerId, options = {}) {
    const wrap = $(containerId);
    if (!wrap) return;

    const {
      items = [],
      selectedIds = [],
      onChange = null,
      filterText = "",
      emptyText = "No hay elementos disponibles.",
      filteredEmptyText = "No hay elementos que coincidan con el filtro.",
      labelFn = (item) => item?.nombre || "",
      searchTextFn = (item) => labelFn(item),
      titleFn = null,
    } = options;

    const selected = new Set((selectedIds || []).map(Number));
    const filter = (filterText || "").trim().toLowerCase();
    const filteredItems = filter
      ? (items || []).filter((item) => (searchTextFn(item) || "").toLowerCase().includes(filter))
      : (items || []);

    if (!items?.length) {
      wrap.innerHTML = `<div class="result-empty">${emptyText}</div>`;
      return;
    }

    if (!filteredItems.length) {
      wrap.innerHTML = `<div class="result-empty">${filteredEmptyText}</div>`;
      return;
    }

    wrap.innerHTML = filteredItems.map((item) => {
      const label = labelFn(item);
      const title = titleFn ? titleFn(item) : label;
      return `
      <label class="check-item" title="${esc(title)}">
        <input type="checkbox" value="${esc(item.id)}" ${selected.has(Number(item.id)) ? "checked" : ""} />
        <span title="${esc(title)}">${esc(label)}</span>
      </label>
    `;
    }).join("");

    if (!onChange) return;

    wrap.querySelectorAll("input[type='checkbox']").forEach((el) => {
      el.addEventListener("change", () => {
        const current = new Set((selectedIds || []).map(Number));
        const id = Number(el.value);
        if (el.checked) current.add(id);
        else current.delete(id);
        onChange(Array.from(current));
      });
    });
  }

  function renderChecks(containerId, equipos, selectedIds = [], stateKey = null, filterText = "", afterChange = null) {
    renderSelectableChecks(containerId, {
      items: equipos,
      selectedIds,
      filterText,
      emptyText: "No hay equipos disponibles.",
      filteredEmptyText: "No hay equipos que coincidan con el filtro.",
      labelFn: (equipo) => equipo?.nombre || "",
      searchTextFn: (equipo) => equipo?.nombre || "",
      onChange: stateKey ? (nextIds) => {
        state[stateKey] = nextIds;
        afterChange?.();
      } : null,
    });
  }

  function setSelectOptions(selectId, rows, placeholder, mapLabel) {
    const sel = $(selectId);
    if (!sel) return;

    const previousValue = sel.value;
    if (!rows.length) {
      sel.innerHTML = `<option value="">${placeholder}</option>`;
      return;
    }

    sel.innerHTML =
      `<option value="">${placeholder}</option>` +
      rows.map((row) => `<option value="${esc(row.id)}">${mapLabel(row)}</option>`).join("");

    if (previousValue && rows.some((row) => String(row.id) === previousValue)) {
      sel.value = previousValue;
    }
  }

  function fillUsuarioEquiposSelect() {
    const rows = state.adminUsuarios || [];
    setSelectOptions("admUsuarioEquipo", rows, rows.length ? "Seleccione usuario" : "No hay usuarios", (u) => esc(u.username));
    setSelectOptions("admAccessSummaryUsuario", rows, rows.length ? "Seleccione usuario" : "No hay usuarios", (u) => esc(u.username));
  }

  function fillReporteEquiposSelect() {
    const rows = (state.adminReportesAll?.length ? state.adminReportesAll : state.adminReportes) || [];
    const labelFn = (r) => `${esc(r.codigo)} - ${esc(r.nombre)}`;
    setSelectOptions("admReporteEquipo", rows, rows.length ? "Seleccione reporte" : "No hay reportes", labelFn);
    setSelectOptions("admAccessSummaryReporte", rows, rows.length ? "Seleccione reporte" : "No hay reportes", labelFn);
  }

  function renderEquipoSelectionInfo(targetId, selectedIds = []) {
    const el = $(targetId);
    if (!el) return;
    const ids = Array.from(new Set((selectedIds || []).map(Number)));
    const nombres = (state.adminEquipos || [])
      .filter((equipo) => ids.includes(Number(equipo.id)))
      .map((equipo) => equipo.nombre);
    el.textContent = !ids.length
      ? "0 equipos"
      : `${ids.length} equipo${ids.length === 1 ? "" : "s"}${nombres.length ? `: ${nombres.join(", ")}` : ""}`;
  }

  function renderUsuarioEquiposChecks() {
    renderSelectableChecks("admUsuarioEquiposChecks", {
      items: state.adminEquipos || [],
      selectedIds: state.adminUsuarioEquipoIds,
      filterText: $("admUsuarioEquiposFiltro")?.value || "",
      emptyText: "No hay equipos disponibles.",
      filteredEmptyText: "No hay equipos que coincidan con el filtro.",
      labelFn: (equipo) => Number(equipo?.activo) === 1
        ? `${equipo?.nombre || ""}`
        : `${equipo?.nombre || ""} (inactivo)`,
      searchTextFn: (equipo) => equipo?.nombre || "",
      onChange: (nextIds) => {
        state.adminUsuarioEquipoIds = nextIds;
        renderEquipoSelectionInfo("admUsuarioEquiposSeleccionInfo", state.adminUsuarioEquipoIds);
        renderAdminUsuarioEquiposInactiveNotice();
      },
    });
    renderEquipoSelectionInfo("admUsuarioEquiposSeleccionInfo", state.adminUsuarioEquipoIds);
    renderAdminUsuarioEquiposInactiveNotice();
  }

  function getAdminUsuarioEquiposSelectedUser() {
    return state.adminUsuarioEquiposModal.selectedUser || null;
  }

  function setAdminUsuarioEquiposSelectedUser(user) {
    state.adminUsuarioEquiposModal.selectedUser = user || null;
    const currentUser = getAdminUsuarioEquiposSelectedUser();
    if ($("admUsuarioEquiposIdentity")) {
      $("admUsuarioEquiposIdentity").textContent = currentUser?.username || "Usuario";
    }
    if ($("admUsuarioEquiposContextText")) {
      $("admUsuarioEquiposContextText").textContent = currentUser?.username
        ? `Selecciona los equipos que pertenecerán a ${currentUser.username}.`
        : "Selecciona los equipos que pertenecerán al usuario.";
    }
  }

  function renderAdminUsuarioEquiposInactiveNotice() {
    const banner = $("admUsuarioEquiposInactiveNotice");
    const text = $("admUsuarioEquiposInactiveText");
    if (!banner || !text) return;

    const inactiveIds = Array.from(
      new Set(
        (state.adminUsuarioEquipoIds || [])
          .map(Number)
          .filter((id) => Number((state.adminEquipos || []).find((equipo) => Number(equipo.id) === id)?.activo) !== 1)
      )
    );
    if (!inactiveIds.length) {
      banner.hidden = true;
      text.textContent = "";
      return;
    }

    const nombres = (state.adminEquipos || [])
      .filter((equipo) => inactiveIds.includes(Number(equipo.id)))
      .map((equipo) => equipo.nombre);
    const lista = nombres.length ? nombres.join(", ") : inactiveIds.map((id) => `ID ${id}`).join(", ");
    text.textContent = `Los equipos inactivos seleccionados (${lista}) quedarán preasignados, pero no concederán acceso hasta ser activados.`;
    banner.hidden = false;
  }

  async function openUsuarioEquiposModalForUser(user) {
    if (!user?.id) {
      showAlert("No se encontró el usuario seleccionado.", "err");
      return;
    }

    try {
      if (!(state.adminEquipos || []).length) {
        await refreshEquiposResumen();
      }
      setAdminUsuarioEquiposSelectedUser(user);
      state.adminUsuarioEquipoIds = [];
      if ($("admUsuarioEquiposFiltro")) $("admUsuarioEquiposFiltro").value = "";
      renderUsuarioEquiposChecks();
      openAdminUsuarioEquiposModal();
      const rows = await getEquiposUsuarioById(user.id);
      state.adminUsuarioEquipoIds = (rows || []).map((equipo) => Number(equipo.id));
      renderUsuarioEquiposChecks();
    } catch (e) {
      closeAdminUsuarioEquiposModal();
      showAlert(`No se pudieron cargar equipos del usuario: ${e.message}`, "err");
    }
  }

  async function saveUsuarioEquiposAdmin() {
    const btn = $("btnGuardarUsuarioEquipos");
    const user = getAdminUsuarioEquiposSelectedUser();
    if (!user?.id) {
      showAlert("No se encontró el usuario seleccionado.", "err");
      return;
    }

    const ids = Array.from(new Set((state.adminUsuarioEquipoIds || []).map(Number)));

    if (!ids.length) {
      const confirmed = window.confirm(`El usuario "${user.username}" quedará sin equipos asignados. ¿Deseas continuar?`);
      if (!confirmed) return;
    }

    try {
      if (btn) {
        btn.disabled = true;
        btn.dataset.prevText = btn.textContent || "";
        btn.textContent = "Guardando...";
      }
      await updateEquiposUsuarioById(user.id, ids);
      closeAdminUsuarioEquiposModal();
      await Promise.all([
        fetchUsuariosAdmin(),
        loadAdminEquiposData(),
      ]);
      showAlert("Equipos del usuario actualizados correctamente.", "ok");
    } catch (e) {
      showAlert(`No se pudo guardar equipos del usuario: ${e.message}`, "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.prevText || "Guardar equipos";
      }
    }
  }

  function renderReporteEquiposChecks() {
    renderChecks(
      "admReporteEquiposChecks",
      state.adminEquipos,
      state.adminReporteEquipoIds,
      "adminReporteEquipoIds",
      $("admReporteEquiposFiltro")?.value || "",
      () => renderEquipoSelectionInfo("admReporteEquiposSeleccionInfo", state.adminReporteEquipoIds)
    );
    renderEquipoSelectionInfo("admReporteEquiposSeleccionInfo", state.adminReporteEquipoIds);
  }

  function setAccessReferenceContext(sectionPrefix, teamName = "", description = "") {
    const banner = $(`${sectionPrefix}Context`);
    const text = $(`${sectionPrefix}ContextText`);
    if (!banner || !text) return;
    if (!teamName) {
      banner.hidden = true;
      text.textContent = "";
      return;
    }
    text.textContent = description || `${teamName}. Se usa como referencia visual y filtro inicial.`;
    banner.hidden = false;
  }

  function getEquipoConfiguratorSelectedEquipo() {
    return state.adminEquipoConfigurator.selectedEquipo || null;
  }

  function getEquipoConfiguratorSelectedUsuarioIds() {
    return Array.from(new Set((state.adminEquipoConfigurator.selectedUsuarioIds || []).map(Number)));
  }

  function getEquipoConfiguratorSelectedReporteIds() {
    return Array.from(new Set((state.adminEquipoConfigurator.selectedReporteIds || []).map(Number)));
  }

  function setEquipoConfiguratorSelectedUsuarioIds(ids = []) {
    state.adminEquipoConfigurator.selectedUsuarioIds = Array.from(new Set((ids || []).map(Number)));
    state.adminEquipoConfigurator.resumen = null;
  }

  function setEquipoConfiguratorSelectedReporteIds(ids = []) {
    state.adminEquipoConfigurator.selectedReporteIds = Array.from(new Set((ids || []).map(Number)));
    state.adminEquipoConfigurator.resumen = null;
  }

  function isEquipoConfiguratorSelectedEquipoActive() {
    return Number(getEquipoConfiguratorSelectedEquipo()?.activo) === 1;
  }

  function syncEquipoConfiguratorCatalogs() {
    state.adminEquipoConfigurator.usuariosDisponibles = state.adminUsuarios || [];
    state.adminEquipoConfigurator.reportesDisponibles = (state.adminReportesAll?.length ? state.adminReportesAll : state.adminReportes) || [];
  }

  function renderEntitySelectionInfo(targetId, selectedIds, totalLabel, singularLabel, pluralLabel) {
    const el = $(targetId);
    if (!el) return;
    const count = Array.from(new Set((selectedIds || []).map(Number))).length;
    if (!count) {
      el.textContent = `0 ${totalLabel}`;
      return;
    }
    el.textContent = `${count} ${count === 1 ? singularLabel : pluralLabel}`;
  }

  function usuarioEquipoChecklistLabel(usuario) {
    return Number(usuario?.activo) === 1
      ? `${usuario?.username || ""}`
      : `${usuario?.username || ""} (inactivo)`;
  }

  function reporteEquipoChecklistLabel(reporte) {
    const base = `${reporte?.codigo || ""} - ${reporte?.nombre || ""}`.trim();
    return Number(reporte?.activo) === 1 ? base : `${base} (inactivo)`;
  }

  function renderEquipoUsuariosChecks() {
    renderSelectableChecks("admEquipoUsuariosChecks", {
      items: state.adminEquipoConfigurator.usuariosDisponibles || [],
      selectedIds: getEquipoConfiguratorSelectedUsuarioIds(),
      filterText: $("admEquipoUsuariosFiltro")?.value || "",
      emptyText: "No hay usuarios disponibles.",
      filteredEmptyText: "No hay usuarios que coincidan con el filtro.",
      labelFn: usuarioEquipoChecklistLabel,
      searchTextFn: (usuario) => `${usuario?.username || ""} ${(usuario?.roles || []).join(" ")}`,
      onChange: (nextIds) => {
        setEquipoConfiguratorSelectedUsuarioIds(nextIds);
        renderEquipoUsuariosChecks();
        renderEquipoResumen();
      },
    });
    renderEntitySelectionInfo("admEquipoUsuariosSeleccionInfo", getEquipoConfiguratorSelectedUsuarioIds(), "usuarios", "usuario", "usuarios");
  }

  function renderEquipoReportesChecks() {
    renderSelectableChecks("admEquipoReportesChecks", {
      items: state.adminEquipoConfigurator.reportesDisponibles || [],
      selectedIds: getEquipoConfiguratorSelectedReporteIds(),
      filterText: $("admEquipoReportesFiltro")?.value || "",
      emptyText: "No hay reportes disponibles.",
      filteredEmptyText: "No hay reportes que coincidan con el filtro.",
      labelFn: reporteEquipoChecklistLabel,
      searchTextFn: (reporte) => `${reporte?.codigo || ""} ${reporte?.nombre || ""}`,
      onChange: (nextIds) => {
        setEquipoConfiguratorSelectedReporteIds(nextIds);
        renderEquipoReportesChecks();
        renderEquipoResumen();
      },
    });
    renderEntitySelectionInfo("admEquipoReportesSeleccionInfo", getEquipoConfiguratorSelectedReporteIds(), "reportes", "reporte", "reportes");
  }

  function renderEquipoInactiveNotices() {
    const isActive = isEquipoConfiguratorSelectedEquipoActive();
    [
      $("admEquipoUsuariosInactiveNotice"),
      $("admEquipoReportesInactiveNotice"),
      $("admEquipoResumenInactiveNotice"),
    ].forEach((el) => {
      if (!el) return;
      el.hidden = isActive || !getEquipoConfiguratorSelectedEquipo()?.id;
    });
  }

  function setEquipoConfiguratorSelectedEquipo(equipo) {
    state.adminEquipoConfigurator.selectedEquipo = equipo || null;
    const selected = getEquipoConfiguratorSelectedEquipo();
    const identity = $("cfgEquipoIdentity");
    const context = $("cfgEquipoContextText");
    const equipoNombre = selected?.nombre || "equipo nuevo";
    const usuariosHeading = $("cfgEquipoUsuariosHeading");
    const reportesHeading = $("cfgEquipoReportesHeading");

    if (identity) {
      identity.textContent = selected?.id
        ? `ID ${selected.id}`
        : "Equipo nuevo";
    }

    if (context) {
      context.textContent = selected?.id
        ? `Configurando ${equipoNombre}. Define primero sus usuarios y luego sus reportes.`
        : "Guarda primero el equipo para habilitar sus relaciones de acceso.";
    }

    if (usuariosHeading) {
      usuariosHeading.textContent = selected?.nombre
        ? `Usuarios del equipo: ${selected.nombre}`
        : "Usuarios del equipo";
    }

    if (reportesHeading) {
      reportesHeading.textContent = selected?.nombre
        ? `Reportes del equipo: ${selected.nombre}`
        : "Reportes del equipo";
    }

    renderEquipoInactiveNotices();
  }

  function canUseEquipoConfiguratorAdvancedSteps() {
    return !!getEquipoConfiguratorSelectedEquipo()?.id;
  }

  function getEquipoConfiguratorStepAvailability() {
    const hasEquipo = canUseEquipoConfiguratorAdvancedSteps();
    return {
      datos: true,
      usuarios: hasEquipo,
      reportes: hasEquipo,
      resumen: hasEquipo,
    };
  }

  function setEquipoConfiguratorStep(stepName) {
    const availability = getEquipoConfiguratorStepAvailability();
    const targetStep = availability[stepName] ? stepName : "datos";
    state.adminEquipoConfigurator.currentStep = targetStep;

    document.querySelectorAll("[data-equipo-config-step]").forEach((btn) => {
      const step = btn.dataset.equipoConfigStep;
      const enabled = !!availability[step];
      btn.classList.toggle("is-active", step === targetStep);
      btn.classList.toggle("is-disabled", !enabled);
      btn.disabled = !enabled;
    });

    document.querySelectorAll("[data-equipo-config-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.equipoConfigPanel === targetStep);
    });
  }

  function renderEquipoResumen() {
    const wrap = $("admEquipoResumenResult");
    if (!wrap) return;

    const equipo = getEquipoConfiguratorSelectedEquipo();
    if (!equipo?.id) {
      wrap.innerHTML = `<div class="result-empty">Guarda el equipo y configura usuarios y reportes para ver el resumen.</div>`;
      return;
    }

    const usuariosCount = getEquipoConfiguratorSelectedUsuarioIds().length;
    const reportesCount = getEquipoConfiguratorSelectedReporteIds().length;
    const estadoTexto = Number(equipo.activo) === 1 ? "Activo" : "Inactivo";
    const impacto = isEquipoConfiguratorSelectedEquipoActive()
      ? "Los usuarios de este equipo podrán acceder a los reportes asignados, siempre que los reportes estén activos."
      : "Este equipo tiene usuarios y reportes configurados, pero no concederá acceso mientras esté inactivo.";

    const advertencias = [];
    if (!usuariosCount) {
      advertencias.push("Este equipo no tiene usuarios asignados.");
    }
    if (!reportesCount) {
      advertencias.push("Este equipo no tiene reportes asignados.");
    }

    wrap.innerHTML = `
      <div class="access-summary-grid">
        <div class="access-summary-card">
          <span class="access-summary-card__label">Equipo</span>
          <strong>${esc(equipo.nombre || `ID ${equipo.id}`)}</strong>
          <p>ID ${esc(equipo.id)} · ${esc(estadoTexto)}</p>
        </div>
        <div class="access-summary-card">
          <span class="access-summary-card__label">Usuarios asignados</span>
          <strong>${usuariosCount}</strong>
          <p>${usuariosCount ? "Relaciones usuario-equipo activas en el configurador." : "Sin usuarios asignados."}</p>
        </div>
        <div class="access-summary-card">
          <span class="access-summary-card__label">Reportes asignados</span>
          <strong>${reportesCount}</strong>
          <p>${reportesCount ? "Relaciones reporte-equipo activas en el configurador." : "Sin reportes asignados."}</p>
        </div>
      </div>
      <div class="access-summary-note">${esc(impacto)}</div>
      ${advertencias.length
        ? `<div class="access-summary-note">${advertencias.map((msg) => `<div>${esc(msg)}</div>`).join("")}</div>`
        : ""}
    `;
  }

  function resetEquipoConfiguratorWorkspace() {
    setEquipoConfiguratorSelectedUsuarioIds([]);
    setEquipoConfiguratorSelectedReporteIds([]);
    state.adminEquipoConfigurator.resumen = null;
    if ($("admEquipoUsuariosFiltro")) $("admEquipoUsuariosFiltro").value = "";
    if ($("admEquipoReportesFiltro")) $("admEquipoReportesFiltro").value = "";
    renderEquipoInactiveNotices();
    renderEquipoUsuariosChecks();
    renderEquipoReportesChecks();
    renderEquipoResumen();
  }

  function resetAdminEquipoModalForCreate() {
    $("adminEquipoModalTitle").textContent = "Nuevo equipo";
    $("btnSubmitAdminEquipoModal").textContent = "Crear equipo";
    $("admCfgEquipoId").value = "";
    $("admCfgEquipoIdView").value = "";
    $("admCfgEquipoNombre").value = "";
    $("admCfgEquipoActivo").value = "1";
    $("admCfgEquipoIdField").hidden = true;
    resetEquipoConfiguratorWorkspace();
  }

  function prepareAdminEquipoModalForEdit(row) {
    $("adminEquipoModalTitle").textContent = "Configurar equipo";
    $("btnSubmitAdminEquipoModal").textContent = "Guardar cambios";
    $("admCfgEquipoIdField").hidden = false;
    $("admCfgEquipoId").value = row.id;
    $("admCfgEquipoIdView").value = row.id;
    $("admCfgEquipoNombre").value = row.nombre || "";
    $("admCfgEquipoActivo").value = String(row.activo ?? 1);
    resetEquipoConfiguratorWorkspace();
  }

  async function loadEquipoUsuarios() {
    const equipo = getEquipoConfiguratorSelectedEquipo();
    if (!equipo?.id) {
      setEquipoConfiguratorSelectedUsuarioIds([]);
      renderEquipoUsuariosChecks();
      renderEquipoResumen();
      return;
    }
    try {
      const rows = await getUsuariosEquipoById(equipo.id);
      setEquipoConfiguratorSelectedUsuarioIds((rows || []).map((row) => Number(row.id)));
      renderEquipoUsuariosChecks();
      renderEquipoResumen();
    } catch (e) {
      showAlert(`No se pudieron cargar usuarios del equipo: ${e.message}`, "err");
    }
  }

  async function loadEquipoReportes() {
    const equipo = getEquipoConfiguratorSelectedEquipo();
    if (!equipo?.id) {
      setEquipoConfiguratorSelectedReporteIds([]);
      renderEquipoReportesChecks();
      renderEquipoResumen();
      return;
    }
    try {
      const rows = await getReportesEquipoById(equipo.id);
      setEquipoConfiguratorSelectedReporteIds((rows || []).map((row) => Number(row.id)));
      renderEquipoReportesChecks();
      renderEquipoResumen();
    } catch (e) {
      showAlert(`No se pudieron cargar reportes del equipo: ${e.message}`, "err");
    }
  }

  async function refreshEquipoConfiguratorResumen() {
    const equipo = getEquipoConfiguratorSelectedEquipo();
    if (!equipo?.id) {
      state.adminEquipoConfigurator.resumen = null;
      renderEquipoResumen();
      return;
    }
    try {
      state.adminEquipoConfigurator.resumen = await getEquipoResumenById(equipo.id);
      renderEquipoResumen();
    } catch (e) {
      showAlert(`No se pudo cargar resumen del equipo: ${e.message}`, "err");
    }
  }

  async function hydrateConfiguratorForEquipo(equipo, { mode = "edit", step = "datos" } = {}) {
    state.adminEquipoConfigurator.mode = mode;
    syncEquipoConfiguratorCatalogs();
    setEquipoConfiguratorSelectedEquipo(equipo || null);
    setEquipoConfiguratorStep(step);
    openAdminEquipoModal();
    renderEquipoInactiveNotices();
    renderEquipoUsuariosChecks();
    renderEquipoReportesChecks();
    renderEquipoResumen();

    if (equipo?.id) {
      await Promise.all([
        loadEquipoUsuarios(),
        loadEquipoReportes(),
        refreshEquipoConfiguratorResumen(),
      ]);
    }
  }

  async function openEquipoConfiguratorCreate() {
    resetAdminEquipoModalForCreate();
    await hydrateConfiguratorForEquipo(null, { mode: "create", step: "datos" });
  }

  async function openEquipoConfiguratorEdit(row, step = "datos") {
    prepareAdminEquipoModalForEdit(row);
    await hydrateConfiguratorForEquipo(row, { mode: "edit", step });
  }

  function renderEquiposTable(rows) {
    const tb = $("tbodyEquipos");
    if (!tb) return;
    if (!rows?.length) {
      tb.innerHTML = `<tr><td colspan="6" class="table-empty">No hay equipos.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map((e) => `
      <tr data-equipo-row-id="${esc(e.id)}">
        <td class="mono">${esc(e.id)}</td>
        <td>${esc(e.nombre)}</td>
        <td>${Number(e.activo) === 1 ? '<span class="status-pill status-OK">Activo</span>' : '<span class="status-pill status-CANCELADO">Inactivo</span>'}</td>
        <td class="mono">${esc(e.usuarios_count ?? 0)}</td>
        <td class="mono">${esc(e.reportes_count ?? 0)}</td>
        <td>
          <div class="inline-controls inline-controls--wrap">
            <button class="btn btn--ghost btn--sm btn-equipo-config" data-id="${esc(e.id)}">Configurar</button>
          </div>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-equipo-config").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const row = (state.adminEquipos || []).find((x) => Number(x.id) === id);
        if (!row) {
          showAlert("No se encontró el equipo seleccionado.", "err");
          return;
        }
        await openEquipoConfiguratorEdit(row);
      });
    });
  }

  function updateAdminEquiposPaginationControls(page, totalPages, totalItems) {
    const info = $("admEquipoPageInfo");
    const prev = $("admEquipoPrevPage");
    const next = $("admEquipoNextPage");
    if (info) info.textContent = `Página ${page} de ${totalPages} (${totalItems} registros)`;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  }

  async function refreshEquiposResumen() {
    state.adminEquipos = await getEquiposResumen();
  }

  async function loadAdminEquiposData() {
    if (!isAuthenticated()) return;

    const isAdmin = isAdminUser();
    if (!isAdmin) return;

    try {
      const [equiposResumen, usuarios, reportes] = await Promise.all([
        getEquiposResumen(),
        api("/admin/usuarios"),
        api("/admin/reportes?page=1&page_size=500"),
      ]);
      state.adminEquipos = equiposResumen || [];
      state.adminUsuarios = usuarios || [];
      state.adminReportesAll = reportes?.items || [];
      syncEquipoConfiguratorCatalogs();

      const pageSize = Number($("admEquipoPageSize")?.value || state.admEquipoPageSize || 10);
      const totalItems = state.adminEquipos.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      state.admEquipoPageSize = pageSize;
      state.admEquipoCurrentPage = Math.min(Math.max(1, state.admEquipoCurrentPage || 1), totalPages);
      if ($("admEquipoPageSize")) $("admEquipoPageSize").value = String(state.admEquipoPageSize);

      const start = (state.admEquipoCurrentPage - 1) * state.admEquipoPageSize;
      const end = start + state.admEquipoPageSize;
      renderEquiposTable(state.adminEquipos.slice(start, end));
      updateAdminEquiposPaginationControls(state.admEquipoCurrentPage, totalPages, totalItems);
      renderEquipoUsuariosChecks();
      renderEquipoReportesChecks();
      renderEquipoResumen();
      renderConfiguratorEquiposChecks();
      renderAdmCtEquiposChecks();
    } catch (e) {
      if (isSilentAuthError(e)) return;
      showAlert(`No se pudo cargar administración de equipos: ${e.message}`, "err");
    }
  }

  function getAdminEquipoPayloadFromForm() {
    return {
      nombre: $("admCfgEquipoNombre")?.value?.trim(),
      activo: Number($("admCfgEquipoActivo")?.value || 1),
    };
  }

  async function saveAdminEquipoFromModal(ev) {
    ev.preventDefault();
    const id = $("admCfgEquipoId")?.value?.trim();
    const payload = getAdminEquipoPayloadFromForm();
    const currentStep = state.adminEquipoConfigurator.currentStep || "datos";

    if (!payload.nombre) {
      showAlert("Ingresa el nombre del equipo.", "err");
      return;
    }

    try {
      const out = await api(id ? `/admin/equipos/${encodeURIComponent(id)}` : "/admin/equipos", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      $("admCfgEquipoId").value = out.id;
      $("admCfgEquipoIdView").value = out.id;
      $("admCfgEquipoIdField").hidden = false;
      await refreshEquiposResumen();
      setEquipoConfiguratorSelectedEquipo(out);
      await hydrateConfiguratorForEquipo(out, {
        mode: id ? "edit" : "create",
        step: id ? currentStep : "usuarios",
      });
      showAlert(id ? `Equipo ${id} actualizado.` : "Equipo creado correctamente.", "ok");
      await loadAdminEquiposData();
    } catch (e) {
      showAlert(`${id ? "No se pudo actualizar equipo" : "No se pudo crear equipo"}: ${e.message}`, "err");
    }
  }

  async function saveEquipoUsuarios() {
    const btn = $("btnGuardarEquipoUsuarios");
    const equipo = getEquipoConfiguratorSelectedEquipo();
    if (!equipo?.id) {
      showAlert("Primero guarda el equipo para continuar.", "err");
      return;
    }

    const ids = getEquipoConfiguratorSelectedUsuarioIds();
    if (!ids.length) {
      const confirmed = window.confirm("Este equipo quedará sin usuarios asignados. Ningún usuario heredará acceso a reportes mediante este equipo.");
      if (!confirmed) return;
    }

    try {
      if (btn) {
        btn.disabled = true;
        btn.dataset.prevText = btn.textContent || "";
        btn.textContent = "Guardando...";
      }
      await updateUsuariosEquipoById(equipo.id, ids);
      await refreshEquiposResumen();
      await refreshEquipoConfiguratorResumen();
      showAlert("Usuarios del equipo actualizados correctamente.", "ok");
      await loadAdminEquiposData();
    } catch (e) {
      showAlert(`No se pudo guardar usuarios del equipo: ${e.message}`, "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.prevText || "Guardar usuarios del equipo";
      }
    }
  }

  async function saveEquipoReportes() {
    const btn = $("btnGuardarEquipoReportes");
    const equipo = getEquipoConfiguratorSelectedEquipo();
    if (!equipo?.id) {
      showAlert("Primero guarda el equipo para continuar.", "err");
      return;
    }

    const ids = getEquipoConfiguratorSelectedReporteIds();
    if (!ids.length) {
      const confirmed = window.confirm("Este equipo quedará sin reportes asignados. Los usuarios de este equipo no recibirán acceso a reportes mediante este equipo.");
      if (!confirmed) return;
    }

    try {
      if (btn) {
        btn.disabled = true;
        btn.dataset.prevText = btn.textContent || "";
        btn.textContent = "Guardando...";
      }
      await updateReportesEquipoById(equipo.id, ids);
      await refreshEquiposResumen();
      await refreshEquipoConfiguratorResumen();
      showAlert("Reportes del equipo actualizados correctamente.", "ok");
      await loadAdminEquiposData();
    } catch (e) {
      showAlert(`No se pudo guardar reportes del equipo: ${e.message}`, "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.prevText || "Guardar reportes del equipo";
      }
    }
  }

  function setupAdminEquipos() {
    $("btnOpenAdmEquipoCreateModal")?.addEventListener("click", openEquipoConfiguratorCreate);
    $("btnAdmEquipoRefrescar")?.addEventListener("click", loadAdminEquiposData);
    $("btnCloseAdmEquipoModal")?.addEventListener("click", closeAdminEquipoModal);
    $("btnCloseAdmEquipoModalBg")?.addEventListener("click", closeAdminEquipoModal);
    $("formAdminEquipoEdit")?.addEventListener("submit", saveAdminEquipoFromModal);
    $("btnCfgEquipoGoToUsuarios")?.addEventListener("click", () => {
      if (!canUseEquipoConfiguratorAdvancedSteps()) {
        showAlert("Primero guarda el equipo para continuar.", "err");
        return;
      }
      setEquipoConfiguratorStep("usuarios");
      renderEquipoUsuariosChecks();
    });
    $("btnCfgEquipoBackToDatos")?.addEventListener("click", () => setEquipoConfiguratorStep("datos"));
    $("btnCfgEquipoGoToReportes")?.addEventListener("click", () => {
      if (!canUseEquipoConfiguratorAdvancedSteps()) {
        showAlert("Primero guarda el equipo para continuar.", "err");
        return;
      }
      setEquipoConfiguratorStep("reportes");
      renderEquipoReportesChecks();
    });
    $("btnCfgEquipoBackToUsuarios")?.addEventListener("click", () => setEquipoConfiguratorStep("usuarios"));
    $("btnCfgEquipoGoToResumen")?.addEventListener("click", () => {
      if (!canUseEquipoConfiguratorAdvancedSteps()) {
        showAlert("Primero guarda el equipo para continuar.", "err");
        return;
      }
      setEquipoConfiguratorStep("resumen");
      renderEquipoResumen();
    });
    $("btnCfgEquipoBackToReportes")?.addEventListener("click", () => setEquipoConfiguratorStep("reportes"));
    $("btnCfgEquipoFinalizar")?.addEventListener("click", async () => {
      closeAdminEquipoModal();
      await loadAdminEquiposData();
    });
    document.querySelectorAll("[data-equipo-config-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = btn.dataset.equipoConfigStep;
        if (!getEquipoConfiguratorStepAvailability()[step]) return;
        setEquipoConfiguratorStep(step);
        if (step === "usuarios") renderEquipoUsuariosChecks();
        if (step === "reportes") renderEquipoReportesChecks();
        if (step === "resumen") renderEquipoResumen();
      });
    });
    $("admEquipoPageSize")?.addEventListener("change", () => {
      state.admEquipoCurrentPage = 1;
      loadAdminEquiposData();
    });
    $("admEquipoPrevPage")?.addEventListener("click", () => {
      state.admEquipoCurrentPage = Math.max(1, state.admEquipoCurrentPage - 1);
      loadAdminEquiposData();
    });
    $("admEquipoNextPage")?.addEventListener("click", () => {
      state.admEquipoCurrentPage = state.admEquipoCurrentPage + 1;
      loadAdminEquiposData();
    });
    $("admEquipoUsuariosFiltro")?.addEventListener("input", renderEquipoUsuariosChecks);
    $("admEquipoReportesFiltro")?.addEventListener("input", renderEquipoReportesChecks);
    $("btnGuardarEquipoUsuarios")?.addEventListener("click", saveEquipoUsuarios);
    $("btnGuardarEquipoReportes")?.addEventListener("click", saveEquipoReportes);
  }

  // ---------- Consulta de Tablas ----------
  function fillConsultaTablasSelect() {
    const sel = $("ctTabla");
    if (!sel) return;

    const rows = state.consultaTablasDisponibles || [];
    if (!rows.length) {
      sel.innerHTML = `<option value="">No hay tablas permitidas</option>`;
      return;
    }

    sel.innerHTML =
      `<option value="">Seleccione una tabla</option>` +
      rows.map((r) => `<option value="${esc(r.id)}">${esc(r.codigo)} - ${esc(r.nombre)}</option>`).join("");
  }

  function getTablaConsultaSeleccionada() {
    const tablaId = Number($("ctTabla")?.value || 0);
    return (state.consultaTablasDisponibles || []).find((r) => Number(r.id) === tablaId) || null;
  }

  function fillConsultaOrderColumns() {
    const sel = $("ctOrderBy");
    if (!sel) return;
    const tabla = getTablaConsultaSeleccionada();
    const cols = tabla?.columnas_resultado || [];
    sel.innerHTML =
      `<option value="">Sin orden</option>` +
      cols.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }

  function renderConsultaFiltroRow(data = {}) {
    const wrap = document.createElement("div");
    wrap.className = "filter-row-builder";

    const tabla = getTablaConsultaSeleccionada();
    const columnas = tabla?.columnas_permitidas || [];

    const colSel = document.createElement("select");
    colSel.className = "input-sm";
    colSel.innerHTML =
      `<option value="">Columna</option>` +
      columnas.map((c) => `<option value="${esc(c)}" ${data.column === c ? "selected" : ""}>${esc(c)}</option>`).join("");

    const opSel = document.createElement("select");
    opSel.className = "input-sm";
    const ops = [
      { v: "eq", t: "=" },
      { v: "neq", t: "!=" },
      { v: "contains", t: "Contiene" },
      { v: "startswith", t: "Empieza con" },
      { v: "endswith", t: "Termina con" },
      { v: "gt", t: ">" },
      { v: "gte", t: ">=" },
      { v: "lt", t: "<" },
      { v: "lte", t: "<=" },
      { v: "in", t: "En lista (,)" },
      { v: "isnull", t: "Es nulo" },
    ];
    opSel.innerHTML = ops.map((o) => `<option value="${o.v}" ${data.operator === o.v ? "selected" : ""}>${o.t}</option>`).join("");

    const valInp = document.createElement("input");
    valInp.className = "input-sm";
    valInp.type = "text";
    valInp.placeholder = "Valor";
    valInp.value = data.value ?? "";

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "btn btn--ghost btn--sm";
    btnDel.textContent = "Quitar";
    btnDel.addEventListener("click", () => wrap.remove());

    wrap.appendChild(colSel);
    wrap.appendChild(opSel);
    wrap.appendChild(valInp);
    wrap.appendChild(btnDel);
    return wrap;
  }

  function clearConsultaFiltros() {
    const wrap = $("ctFiltros");
    if (!wrap) return;
    wrap.innerHTML = "";
  }

  function collectConsultaFiltros() {
    const wrap = $("ctFiltros");
    if (!wrap) return [];

    const rows = [];
    wrap.querySelectorAll(".filter-row-builder").forEach((row) => {
      const sels = row.querySelectorAll("select");
      const inp = row.querySelector("input");
      const column = (sels?.[0]?.value || "").trim();
      const operator = (sels?.[1]?.value || "eq").trim();
      const raw = (inp?.value ?? "").toString();

      if (!column) return;
      let value = raw;
      if (operator === "in") {
        value = raw.split(",").map((x) => x.trim()).filter(Boolean);
      } else if (operator === "isnull") {
        value = raw ? raw.trim() : null;
      }
      rows.push({ column, operator, value });
    });
    return rows;
  }

  function renderConsultaResultados(out) {
    const thead = $("ctModalTheadResultados");
    const tbody = $("ctModalTbodyResultados");
    const hint = $("ctModalResultadosHint");
    if (!thead || !tbody) return;

    const cols = out?.columns || [];
    const items = out?.items || [];

    if (!cols.length) {
      thead.innerHTML = "";
      tbody.innerHTML = `<tr><td class="table-empty-cell">Sin datos.</td></tr>`;
      if (hint) hint.textContent = "Sin consulta ejecutada.";
      return;
    }

    thead.innerHTML = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}" class="table-empty-cell">No se encontraron registros.</td></tr>`;
    } else {
      tbody.innerHTML = items.map((it) => `
        <tr>
          ${cols.map((c) => `<td>${esc(it[c] ?? "-")}</td>`).join("")}
        </tr>
      `).join("");
    }

    if (hint) {
      hint.textContent = out?.truncated
        ? `Se muestran ${out.total_returned} registros (máximo 20).`
        : `Se muestran ${out.total_returned} registros.`;
    }
  }

  function setConsultaLoading(isLoading) {
    const loadingWrap = $("ctLoadingWrap");
    const btnBuscar = $("btnCtBuscar");
    if (loadingWrap) loadingWrap.style.display = isLoading ? "" : "none";
    if (btnBuscar) {
      btnBuscar.disabled = isLoading;
      btnBuscar.textContent = isLoading ? "Buscando..." : "Buscar";
    }
  }

  async function loadConsultaTablasDisponibles() {
    if (!isAuthenticated()) return;

    try {
      const rows = await api("/consulta-tablas/disponibles");
      state.consultaTablasDisponibles = rows || [];
      fillConsultaTablasSelect();
      fillConsultaOrderColumns();
      clearConsultaFiltros();
      renderConsultaResultados(null);
      if ($("ctInfo")) $("ctInfo").textContent = `${state.consultaTablasDisponibles.length} tabla(s) disponibles`;
    } catch (e) {
      if (isSilentAuthError(e)) return;
      showAlert(`No se pudieron cargar tablas permitidas: ${e.message}`, "err");
    }
  }

  async function ejecutarConsultaTablas() {
    const tablaId = Number($("ctTabla")?.value || 0);
    if (!tablaId) {
      showAlert("Selecciona una tabla para consultar.", "err");
      return;
    }

    const payload = {
      tabla_id: tablaId,
      filters: collectConsultaFiltros(),
      order_by: $("ctOrderBy")?.value || null,
      order_dir: $("ctOrderDir")?.value || "asc",
    };

    openConsultaResultadosModal();
    setConsultaLoading(true);
    renderConsultaResultados(null);

    try {
      const out = await api("/consulta-tablas/search", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderConsultaResultados(out);
    } catch (e) {
      renderConsultaResultados({
        columns: [],
        items: [],
        total_returned: 0,
        truncated: false,
      });
      showAlert(`Error en consulta de tabla: ${e.message}`, "err");
      const hint = $("ctModalResultadosHint");
      if (hint) hint.textContent = `Error en la consulta: ${e.message}`;
    } finally {
      setConsultaLoading(false);
    }
  }

  function setupConsultaTablas() {
    $("ctTabla")?.addEventListener("change", () => {
      clearConsultaFiltros();
      fillConsultaOrderColumns();
      const wrap = $("ctFiltros");
      if (wrap) wrap.appendChild(renderConsultaFiltroRow());
    });

    $("btnCtAddFiltro")?.addEventListener("click", () => {
      const tabla = getTablaConsultaSeleccionada();
      if (!tabla) {
        showAlert("Selecciona una tabla antes de agregar filtros.", "err");
        return;
      }
      $("ctFiltros")?.appendChild(renderConsultaFiltroRow());
    });

    $("btnCtBuscar")?.addEventListener("click", ejecutarConsultaTablas);
    $("btnCtLimpiar")?.addEventListener("click", () => {
      clearConsultaFiltros();
      $("ctFiltros")?.appendChild(renderConsultaFiltroRow());
      renderConsultaResultados(null);
    });
  }

  // ---------- Admin Tablas Consulta ----------
  function getAdminTablaConsultaSelected() {
    return state.adminTablaConsultaConfigurator.selectedTabla || null;
  }

  function setAdminTablaConsultaSelected(tabla) {
    state.adminTablaConsultaConfigurator.selectedTabla = tabla || null;
    const selected = getAdminTablaConsultaSelected();
    const identity = $("cfgTablaIdentity");
    const context = $("cfgTablaContextText");

    if (identity) {
      identity.textContent = selected?.id
        ? `ID ${selected.id}`
        : "Tabla nueva";
    }

    if (context) {
      context.textContent = selected?.id
        ? `Configurando ${selected.codigo || `tabla ${selected.id}`} · ${selected.nombre || "sin nombre descriptivo"}.`
        : "Completa los datos base para iniciar la configuración.";
    }
  }

  function setAdminTablaConsultaIdFieldVisibility(isVisible) {
    const field = $("admEditCtIdField");
    if (!field) return;
    field.hidden = !isVisible;
    field.style.display = isVisible ? "" : "none";
    field.setAttribute("aria-hidden", isVisible ? "false" : "true");
  }

  function syncAdminTablaConsultaIdVisibility() {
    setAdminTablaConsultaIdFieldVisibility(!!(state.adminTablaConsultaConfigurator.mode === "edit" && getAdminTablaConsultaSelected()?.id));
  }

  function resetAdminTablaConsultaModalForCreate() {
    $("adminTablaConsultaModalTitle").textContent = "Nueva tabla consultable";
    $("btnSubmitAdminTablaConsultaModal").textContent = "Crear tabla";
    $("btnSubmitAdminTablaConsultaConsulta").textContent = "Crear tabla";
    $("admEditCtId").value = "";
    $("admEditCtIdView").value = "";
    $("admEditCtCodigo").value = "";
    $("admEditCtNombre").value = "";
    $("admEditCtTablaBd").value = "";
    $("admEditCtDescripcion").value = "";
    $("admEditCtColsPermitidas").value = "";
    $("admEditCtColsResultado").value = "";
    $("admEditCtActivo").value = "1";
    $("admCtEquiposFiltro").value = "";
    setAdminTablaConsultaIdFieldVisibility(false);
  }

  function prepareAdminTablaConsultaModalForEdit(row) {
    $("adminTablaConsultaModalTitle").textContent = "Editar tabla consultable";
    $("btnSubmitAdminTablaConsultaModal").textContent = "Guardar cambios";
    $("btnSubmitAdminTablaConsultaConsulta").textContent = "Guardar cambios";
    $("admEditCtId").value = row.id;
    $("admEditCtIdView").value = row.id;
    $("admEditCtCodigo").value = row.codigo || "";
    $("admEditCtNombre").value = row.nombre || "";
    $("admEditCtTablaBd").value = row.tabla_bd || "";
    $("admEditCtDescripcion").value = row.descripcion || "";
    $("admEditCtColsPermitidas").value = row.columnas_permitidas || "";
    $("admEditCtColsResultado").value = row.columnas_resultado || "";
    $("admEditCtActivo").value = String(row.activo ?? 1);
    $("admCtEquiposFiltro").value = "";
    setAdminTablaConsultaIdFieldVisibility(true);
  }

  function getAdminTablaConsultaPayloadFromForm() {
    return {
      codigo: $("admEditCtCodigo")?.value?.trim(),
      nombre: $("admEditCtNombre")?.value?.trim(),
      tabla_bd: $("admEditCtTablaBd")?.value?.trim(),
      descripcion: $("admEditCtDescripcion")?.value?.trim() || null,
      columnas_permitidas: $("admEditCtColsPermitidas")?.value?.trim(),
      columnas_resultado: $("admEditCtColsResultado")?.value?.trim() || null,
      activo: Number($("admEditCtActivo")?.value || 1),
    };
  }

  function validateAdminTablaConsultaCodigo() {
    const codigoInput = $("admEditCtCodigo");
    if (!codigoInput) return true;
    const value = (codigoInput.value || "").trim();
    if (!value) {
      codigoInput.setCustomValidity("El código es obligatorio.");
      return false;
    }
    if (!/^[A-Za-z0-9_]+$/.test(value)) {
      codigoInput.setCustomValidity("El código solo puede contener letras, números y guion bajo, sin espacios ni tildes.");
      return false;
    }
    codigoInput.setCustomValidity("");
    return true;
  }

  function validateAdminTablaConsultaForm() {
    const payload = getAdminTablaConsultaPayloadFromForm();
    const currentStep = state.adminTablaConsultaConfigurator.step || "datos";
    const requiresTechnicalFields = !getAdminTablaConsultaSelected()?.id || currentStep === "consulta";
    const nombreInput = $("admEditCtNombre");
    const tablaBdInput = $("admEditCtTablaBd");
    const colsPermitidasInput = $("admEditCtColsPermitidas");

    if (nombreInput) {
      nombreInput.setCustomValidity(payload.nombre ? "" : "El nombre es obligatorio.");
    }
    if (tablaBdInput) {
      tablaBdInput.setCustomValidity(!requiresTechnicalFields || payload.tabla_bd ? "" : "La tabla física es obligatoria.");
    }
    if (colsPermitidasInput) {
      colsPermitidasInput.setCustomValidity(!requiresTechnicalFields || payload.columnas_permitidas ? "" : "Debes indicar al menos una columna permitida.");
    }

    const isCodigoValid = validateAdminTablaConsultaCodigo();
    const form = $("formAdminTablaConsultaEdit");
    return !!(form?.reportValidity() && isCodigoValid);
  }

  function canUseAdminTablaConsultaAdvancedSteps() {
    const tabla = getAdminTablaConsultaSelected();
    return !!(tabla?.id && tabla?.codigo);
  }

  function getAdminTablaConsultaStepAvailability() {
    const hasTabla = canUseAdminTablaConsultaAdvancedSteps();
    return {
      datos: true,
      consulta: true,
      equipos: hasTabla,
      revision: hasTabla,
    };
  }

  function syncAdminTablaConsultaFlowActions() {
    const hasTabla = canUseAdminTablaConsultaAdvancedSteps();
    const btnDatos = $("btnCfgTablaGoToConsulta");
    const btnConsulta = $("btnCfgTablaGoToEquipos");

    if (btnDatos) btnDatos.disabled = false;
    if (btnConsulta) btnConsulta.disabled = !hasTabla;
  }

  function setAdminTablaConsultaStep(stepName) {
    const availability = getAdminTablaConsultaStepAvailability();
    const targetStep = availability[stepName] ? stepName : "datos";
    state.adminTablaConsultaConfigurator.step = targetStep;

    document.querySelectorAll("[data-tabla-config-step]").forEach((btn) => {
      const step = btn.dataset.tablaConfigStep;
      const enabled = !!availability[step];
      btn.classList.toggle("is-active", step === targetStep);
      btn.classList.toggle("is-disabled", !enabled);
      btn.disabled = !enabled;
    });

    document.querySelectorAll("[data-tabla-config-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.tablaConfigPanel === targetStep);
    });

    syncAdminTablaConsultaFlowActions();
  }

  function splitAdminTablaColumns(value) {
    return (value || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function renderAdminTablaConsultaReview() {
    const wrap = $("cfgTablaReviewGrid");
    if (!wrap) return;

    const selected = getAdminTablaConsultaSelected();
    const tabla = selected?.id
      ? { ...selected, ...getAdminTablaConsultaPayloadFromForm(), id: selected.id }
      : null;

    if (!tabla?.id) {
      wrap.innerHTML = `<div class="result-empty">Aún no hay una tabla seleccionada para resumir.</div>`;
      return;
    }

    const columnasPermitidas = splitAdminTablaColumns(tabla.columnas_permitidas);
    const columnasResultado = splitAdminTablaColumns(tabla.columnas_resultado);
    const equiposAsignados = Array.from(new Set((state.adminTablaConsultaEquipoIds || []).map(Number))).length;

    wrap.innerHTML = `
      <div class="kv"><label>ID</label><div class="mono">${esc(tabla.id)}</div></div>
      <div class="kv"><label>Código</label><div class="mono">${esc(tabla.codigo || "-")}</div></div>
      <div class="kv"><label>Nombre</label><div>${esc(tabla.nombre || "-")}</div></div>
      <div class="kv"><label>Activo</label><div>${Number(tabla.activo) === 1 ? "Sí" : "No"}</div></div>
      <div class="kv"><label>Tabla BD</label><div class="mono">${esc(tabla.tabla_bd || "-")}</div></div>
      <div class="kv"><label>Columnas filtro</label><div>${columnasPermitidas.length}</div></div>
      <div class="kv"><label>Columnas resultado</label><div>${columnasResultado.length || "Sin restricción explícita"}</div></div>
      <div class="kv"><label>Equipos asignados</label><div>${equiposAsignados}</div></div>
    `;
  }

  function renderAdmCtEquiposChecks() {
    renderChecks(
      "admCtEquiposChecks",
      state.adminEquipos,
      state.adminTablaConsultaEquipoIds,
      "adminTablaConsultaEquipoIds",
      $("admCtEquiposFiltro")?.value || "",
      () => {
        renderEntitySelectionInfo("admTablaEquiposSeleccionInfo", state.adminTablaConsultaEquipoIds, "equipos", "equipo", "equipos");
        renderAdminTablaConsultaReview();
      }
    );
    renderEntitySelectionInfo("admTablaEquiposSeleccionInfo", state.adminTablaConsultaEquipoIds, "equipos", "equipo", "equipos");
  }

  function updateAdminTablasConsultaPaginationControls(page, totalPages, totalItems) {
    const info = $("admCtPageInfo");
    const prev = $("admCtPrevPage");
    const next = $("admCtNextPage");
    if (info) info.textContent = `Página ${page} de ${totalPages} (${totalItems} registros)`;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  }

  function renderAdminTablasConsultaTable(rows = []) {
    const tb = $("tbodyAdmCt");
    if (!tb) return;

    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="6" class="table-empty">No hay tablas registradas.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map((r) => `
      <tr>
        <td class="mono">${esc(r.id)}</td>
        <td class="mono">${esc(r.codigo)}</td>
        <td>${esc(r.nombre)}</td>
        <td class="mono">${esc(r.tabla_bd)}</td>
        <td>${Number(r.activo) === 1 ? '<span class="status-pill status-OK">Activo</span>' : '<span class="status-pill status-CANCELADO">Inactivo</span>'}</td>
        <td>
          <div class="inline-controls">
            <button class="btn btn--ghost btn--sm btn-admct-edit" data-id="${esc(r.id)}">Configurar</button>
            <button class="btn btn--ghost btn--sm btn-admct-toggle" data-id="${esc(r.id)}" data-next="${Number(r.activo) === 1 ? "0" : "1"}">
              ${Number(r.activo) === 1 ? "Desactivar" : "Activar"}
            </button>
          </div>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-admct-edit").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const row = (state.adminTablasConsulta || []).find((x) => Number(x.id) === id);
        if (!row) {
          showAlert("No se encontró la tabla seleccionada.", "err");
          return;
        }

        await openAdminTablaConsultaEdit(row);
      });
    });

    document.querySelectorAll(".btn-admct-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const next = Number(btn.dataset.next || 0);
        try {
          await api(`/admin/tablas-consulta/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ activo: next }),
          });
          showAlert(`Tabla whitelist ${id} ${next === 1 ? "activada" : "desactivada"}.`, "ok");
          await loadAdminTablasConsulta();
          await loadConsultaTablasDisponibles();
        } catch (e) {
          showAlert(`No se pudo cambiar estado de tabla whitelist: ${e.message}`, "err");
        }
      });
    });
  }

  async function loadAdminTablasConsulta() {
    const tb = $("tbodyAdmCt");
    if (!tb) return;
    if (!isAuthenticated()) return;

    const isAdmin = state.me?.roles?.includes("ADMIN") || state.me?.username === "admin";
    if (!isAdmin) {
      tb.innerHTML = `<tr><td colspan="6" class="table-empty">Sin permisos.</td></tr>`;
      return;
    }

    tb.innerHTML = `<tr><td colspan="6" class="table-empty">Cargando...</td></tr>`;
    try {
      const pageSize = Number($("admCtPageSize")?.value || state.admCtPageSize || 10);
      const params = new URLSearchParams();
      params.set("page", String(state.admCtCurrentPage || 1));
      params.set("page_size", String(pageSize));
      const q = $("admCtFiltroQ")?.value?.trim();
      if (q) params.set("q", q);

      const out = await api(`/admin/tablas-consulta?${params.toString()}`);
      state.adminTablasConsulta = out?.items || [];
      state.admCtCurrentPage = Number(out?.page || 1);
      state.admCtPageSize = Number(out?.page_size || pageSize);
      if ($("admCtPageSize")) $("admCtPageSize").value = String(state.admCtPageSize);
      renderAdminTablasConsultaTable(state.adminTablasConsulta);
      updateAdminTablasConsultaPaginationControls(
        Number(out?.page || 1),
        Number(out?.total_pages || 1),
        Number(out?.total || 0)
      );
    } catch (e) {
      if (isSilentAuthError(e)) return;
      tb.innerHTML = `<tr><td colspan="6" class="table-empty">Error al cargar tablas.</td></tr>`;
      showAlert(`No se pudo cargar whitelist de tablas: ${e.message}`, "err");
    }
  }

  async function loadEquiposTablaConsultaSeleccionada() {
    const tabla = getAdminTablaConsultaSelected();
    if (!tabla?.id) {
      state.adminTablaConsultaEquipoIds = [];
      renderAdmCtEquiposChecks();
      renderAdminTablaConsultaReview();
      return;
    }

    try {
      const rows = await api(`/admin/tablas-consulta/${encodeURIComponent(tabla.id)}/equipos`);
      state.adminTablaConsultaEquipoIds = (rows || []).map((r) => Number(r.id));
      renderAdmCtEquiposChecks();
      renderAdminTablaConsultaReview();
    } catch (e) {
      showAlert(`No se pudieron cargar equipos de la tabla: ${e.message}`, "err");
    }
  }

  async function saveEquiposTablaConsulta() {
    const btn = $("btnAdmCtGuardarEquipos");
    const tabla = getAdminTablaConsultaSelected();
    if (!tabla?.id) {
      showAlert("Primero guarda la tabla.", "err");
      return;
    }
    try {
      if (btn) {
        btn.disabled = true;
        btn.dataset.prevText = btn.textContent || "";
        btn.textContent = "Guardando...";
      }
      await api(`/admin/tablas-consulta/${encodeURIComponent(tabla.id)}/equipos`, {
        method: "PUT",
        body: JSON.stringify({ equipo_ids: (state.adminTablaConsultaEquipoIds || []).map(Number) }),
      });
      showAlert(`Asignación aplicada para tabla ${tabla.codigo || tabla.id}.`, "ok");
      await loadConsultaTablasDisponibles();
      await loadEquiposTablaConsultaSeleccionada();
      setAdminTablaConsultaStep("revision");
      renderAdminTablaConsultaReview();
    } catch (e) {
      showAlert(`No se pudo guardar asignación de equipos: ${e.message}`, "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.prevText || "Guardar asignación";
      }
    }
  }

  async function hydrateConfiguratorForTablaConsulta(tabla, { mode = "edit", step = "datos" } = {}) {
    state.adminTablaConsultaConfigurator.mode = mode;
    setAdminTablaConsultaSelected(tabla || null);
    syncAdminTablaConsultaIdVisibility();
    setAdminTablaConsultaStep(step);
    openAdminTablaConsultaModal();
    renderAdmCtEquiposChecks();
    renderAdminTablaConsultaReview();
    syncAdminTablaConsultaFlowActions();

    if (canUseAdminTablaConsultaAdvancedSteps()) {
      await loadEquiposTablaConsultaSeleccionada();
    } else {
      state.adminTablaConsultaEquipoIds = [];
      renderAdmCtEquiposChecks();
      renderAdminTablaConsultaReview();
    }
  }

  async function openAdminTablaConsultaCreate() {
    resetAdminTablaConsultaModalForCreate();
    state.adminTablaConsultaEquipoIds = [];
    await hydrateConfiguratorForTablaConsulta(null, { mode: "create", step: "datos" });
  }

  async function openAdminTablaConsultaEdit(row) {
    prepareAdminTablaConsultaModalForEdit(row);
    state.adminTablaConsultaEquipoIds = [];
    await hydrateConfiguratorForTablaConsulta(row, { mode: "edit", step: "datos" });
  }

  async function saveAdminTablaConsultaFromModal(ev) {
    ev.preventDefault();
    const id = $("admEditCtId")?.value?.trim();
    const payload = getAdminTablaConsultaPayloadFromForm();
    if (!payload.codigo || !payload.nombre) {
      setAdminTablaConsultaStep("datos");
      showAlert("Completa código y nombre antes de guardar la tabla.", "err");
      return;
    }
    if (!id && state.adminTablaConsultaConfigurator.step === "datos") {
      setAdminTablaConsultaStep("consulta");
      showAlert("Completa la definición técnica antes de crear la tabla.", "err");
      return;
    }
    if (!validateAdminTablaConsultaForm()) return;

    try {
      const out = await api(id ? `/admin/tablas-consulta/${encodeURIComponent(id)}` : "/admin/tablas-consulta", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      $("admEditCtId").value = out.id;
      $("admEditCtIdView").value = out.id;
      setAdminTablaConsultaSelected(out);
      const nextStep = id ? (state.adminTablaConsultaConfigurator.step || "datos") : "equipos";
      await hydrateConfiguratorForTablaConsulta(out, {
        mode: id ? "edit" : "create",
        step: nextStep,
      });
      showAlert(id ? `Tabla whitelist ${id} actualizada.` : "Tabla agregada al whitelist.", "ok");
      await loadAdminTablasConsulta();
      await loadConsultaTablasDisponibles();
    } catch (e) {
      showAlert(`${id ? "No se pudo actualizar tabla whitelist" : "No se pudo crear tabla whitelist"}: ${e.message}`, "err");
    }
  }

  function setupAdminTablasConsulta() {
    $("btnOpenAdmCtCreateModal")?.addEventListener("click", openAdminTablaConsultaCreate);
    $("btnAdmCtRefrescar")?.addEventListener("click", loadAdminTablasConsulta);
    $("btnCloseAdmCtModal")?.addEventListener("click", closeAdminTablaConsultaModal);
    $("btnCloseAdmCtModalBg")?.addEventListener("click", closeAdminTablaConsultaModal);
    $("formAdminTablaConsultaEdit")?.addEventListener("submit", saveAdminTablaConsultaFromModal);
    $("btnCfgTablaGoToConsulta")?.addEventListener("click", () => {
      setAdminTablaConsultaStep("consulta");
    });
    $("btnCfgTablaGoToEquipos")?.addEventListener("click", async () => {
      if (!canUseAdminTablaConsultaAdvancedSteps()) {
        showAlert("Primero guarda la tabla para continuar.", "err");
        return;
      }
      setAdminTablaConsultaStep("equipos");
      await loadEquiposTablaConsultaSeleccionada();
    });
    $("admCtEquiposFiltro")?.addEventListener("input", renderAdmCtEquiposChecks);
    $("btnAdmCtGuardarEquipos")?.addEventListener("click", saveEquiposTablaConsulta);
    $("btnCfgTablaOpenEquiposAdmin")?.addEventListener("click", () => {
      closeAdminTablaConsultaModal();
      activateTab("tab-admin-equipos");
    });
    $("btnCfgTablaFinalizar")?.addEventListener("click", async () => {
      closeAdminTablaConsultaModal();
      await loadAdminTablasConsulta();
    });
    document.querySelectorAll("[data-tabla-config-step]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const step = btn.dataset.tablaConfigStep;
        setAdminTablaConsultaStep(step);
        if (step === "equipos") await loadEquiposTablaConsultaSeleccionada();
        if (step === "revision") renderAdminTablaConsultaReview();
      });
    });
    $("admEditCtCodigo")?.addEventListener("input", validateAdminTablaConsultaCodigo);
    $("admEditCtNombre")?.addEventListener("input", () => {
      const nombreInput = $("admEditCtNombre");
      if (!nombreInput) return;
      nombreInput.setCustomValidity((nombreInput.value || "").trim() ? "" : "El nombre es obligatorio.");
    });
    $("admEditCtTablaBd")?.addEventListener("input", () => {
      const tablaBdInput = $("admEditCtTablaBd");
      if (!tablaBdInput) return;
      tablaBdInput.setCustomValidity((tablaBdInput.value || "").trim() ? "" : "La tabla física es obligatoria.");
    });
    $("admEditCtColsPermitidas")?.addEventListener("input", () => {
      const colsInput = $("admEditCtColsPermitidas");
      if (!colsInput) return;
      colsInput.setCustomValidity((colsInput.value || "").trim() ? "" : "Debes indicar al menos una columna permitida.");
    });
    $("formAdminTablaConsultaEdit")?.addEventListener("input", () => {
      if (state.adminTablaConsultaConfigurator.step === "revision") {
        renderAdminTablaConsultaReview();
      }
    });
    $("admCtFiltroQ")?.addEventListener("input", () => {
      state.admCtCurrentPage = 1;
      loadAdminTablasConsulta();
    });
    $("admCtPageSize")?.addEventListener("change", () => {
      state.admCtCurrentPage = 1;
      loadAdminTablasConsulta();
    });
    $("admCtPrevPage")?.addEventListener("click", () => {
      state.admCtCurrentPage = Math.max(1, state.admCtCurrentPage - 1);
      loadAdminTablasConsulta();
    });
    $("admCtNextPage")?.addEventListener("click", () => {
      state.admCtCurrentPage = state.admCtCurrentPage + 1;
      loadAdminTablasConsulta();
    });
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
    if (!isAuthenticated()) return;

    const isAdmin = state.me?.roles?.includes("ADMIN") || state.me?.username === "admin";
    if (!isAdmin) return;

    tb.innerHTML = `<tr><td colspan="5" class="table-empty">Cargando...</td></tr>`;
    try {
      const rows = await api("/admin/usuarios");
      state.adminUsuarios = rows || [];
      fillUsuarioEquiposSelect();
      if (!rows?.length) {
        tb.innerHTML = `<tr><td colspan="5" class="table-empty">No hay usuarios.</td></tr>`;
        return;
      }
      tb.innerHTML = rows.map((u) => `
        <tr>
          <td class="mono">${esc(u.id)}</td>
          <td>${esc(u.username)}</td>
          <td>${esc((u.roles || []).join(", "))}</td>
          <td>${u.activo === 1 ? '<span class="status-pill status-OK">ACTIVO</span>' : '<span class="status-pill status-CANCELADO">INACTIVO</span>'}</td>
          <td>
            <button class="btn btn--ghost btn--sm btn-user-equipos" data-user-id="${esc(u.id)}">
              Equipos
            </button>
            <button class="btn btn--ghost btn--sm btn-reset-password" data-user-id="${esc(u.id)}" data-username="${esc(u.username)}">
              Restaurar contraseña
            </button>
          </td>
        </tr>
      `).join("");

      document.querySelectorAll(".btn-user-equipos").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const userId = Number(btn.dataset.userId || 0);
          const user = (state.adminUsuarios || []).find((row) => Number(row.id) === userId) || null;
          await openUsuarioEquiposModalForUser(user);
        });
      });

      document.querySelectorAll(".btn-reset-password").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const userId = btn.dataset.userId;
          const username = btn.dataset.username || `ID ${userId}`;
          await resetPasswordUsuarioAdmin(userId, username, btn);
        });
      });
    } catch (e) {
      if (isSilentAuthError(e)) return;
      tb.innerHTML = `<tr><td colspan="5" class="table-empty">Error al cargar usuarios.</td></tr>`;
      showAlert(`No se pudieron cargar usuarios: ${e.message}`, "err");
    }
  }

  async function resetPasswordUsuarioAdmin(userId, username, buttonEl = null) {
    if (!userId) return;
    const confirmed = window.confirm(`¿Restaurar contraseña del usuario "${username}"?`);
    if (!confirmed) return;

    try {
      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.dataset.prevText = buttonEl.textContent || "";
        buttonEl.textContent = "Restaurando...";
      }

      const out = await api(`/admin/usuarios/${encodeURIComponent(userId)}/reset-password`, {
        method: "POST",
      });
      showAlert(
        `Contraseña restaurada para ${username}. Temporal: ${out.password_temporal}`,
        "ok"
      );
    } catch (e) {
      showAlert(`No se pudo restaurar contraseña de ${username}: ${e.message}`, "err");
    } finally {
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = buttonEl.dataset.prevText || "Restaurar contraseña";
      }
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
    $("btnCloseAdmUsuarioEquiposModal")?.addEventListener("click", closeAdminUsuarioEquiposModal);
    $("btnCloseAdmUsuarioEquiposModalBg")?.addEventListener("click", closeAdminUsuarioEquiposModal);
    $("btnCancelarUsuarioEquipos")?.addEventListener("click", closeAdminUsuarioEquiposModal);
    $("btnGuardarUsuarioEquipos")?.addEventListener("click", saveUsuarioEquiposAdmin);
    $("admUsuarioEquiposFiltro")?.addEventListener("input", renderUsuarioEquiposChecks);
  }

  function setupAuthUI() {
    $("formLogin").addEventListener("submit", async (e) => {
      e.preventDefault();
      doLogin();
    });

    $("btnLogout").addEventListener("click", () => {
      logout();
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
        state.auth.logoutInProgress = false;
        state.auth.sessionExpiredNotified = false;

        const me = await api("/auth/me");
        setAuthUI(me);

        showAlert(`Bienvenido, ${me.username}.`, "ok");
        showAppView();
        startAuthenticatedPollers();

        // Opcional: recargar data
        await loadReportes();
        await fetchMisSolicitudes();
        await loadAdminReportes();
        await loadAdminEquiposData();
        await loadAdminTablasConsulta();
        await loadConsultaTablasDisponibles();
        await fetchUsuariosAdmin();
      } catch (err) {
        if (isSilentAuthError(err)) return;
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
