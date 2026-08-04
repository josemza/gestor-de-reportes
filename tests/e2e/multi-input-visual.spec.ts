import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join("test-results", "visual-multi-input");
const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:8037";
const E2E_USER = process.env.E2E_USER || "";
const E2E_PASSWORD = process.env.E2E_PASSWORD || "";

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function saveEvidence(page: Page, fileName: string) {
  await ensureOutputDir();
  await page.screenshot({
    path: path.join(OUTPUT_DIR, fileName),
    fullPage: true,
  });
}

async function selectFirstNonEmptyOption(locator: Locator) {
  const optionValues = await locator.locator("option").evaluateAll((options) =>
    options
      .map((option) => option.getAttribute("value") || "")
      .filter((value) => value.trim().length > 0),
  );

  if (!optionValues.length) {
    return false;
  }

  await locator.selectOption(optionValues[0]);
  return true;
}

async function selectReporteBySearch(page: Page, query: string, expectedCode: string) {
  await page.locator("#reporteComboboxTrigger").click();
  await expect(page.locator("#reporteComboboxDropdown")).toBeVisible();
  await expect(page.locator("#reporteComboboxList")).toContainText(expectedCode);

  const search = page.locator("#reporteComboboxSearch");
  await search.fill(query);

  const option = page.locator("#reporteComboboxList .searchable-select__option").filter({ hasText: expectedCode }).first();
  await expect(option).toBeVisible();
  await option.click();

  await expect(page.locator("#reporteComboboxValue")).toContainText(expectedCode);
}

async function collectCriticalIssues(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("response", async (response) => {
    if (response.status() >= 500) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  return {
    consoleErrors,
    pageErrors,
    failedRequests,
  };
}

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.locator("#loginUsername").fill(E2E_USER);
  await page.locator("#loginPassword").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  await expect(page.getByRole("heading", { name: "Panel operativo" })).toBeVisible();
}

async function openAdminReportConfigurator(page: Page, reportCode: string) {
  await page.locator('.menu__item[data-tab="tab-admin-reportes"]').click();
  await expect(page.locator("#tablaAdminReportes")).toBeVisible();
  await page.locator("#admRepFiltroCodigo").fill(reportCode);

  const row = page.locator("#tbodyAdminReportes tr").filter({ hasText: reportCode }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Configurar" }).click();
  await expect(page.locator("#adminReporteModal")).toBeVisible();
}

async function apiRequest(page: Page, path: string, init: { method?: string; body?: string } = {}) {
  return page.evaluate(async ({ path: apiPath, init: apiInit }) => {
    const token = window.localStorage.getItem("reporteador_token");
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiInit.body) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(apiPath, {
      method: apiInit.method || "GET",
      headers,
      body: apiInit.body,
    });
    const raw = await response.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }

    if (!response.ok) {
      const detail = parsed && typeof parsed === "object" && "detail" in parsed
        ? String((parsed as { detail?: unknown }).detail ?? "")
        : raw;
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }

    return parsed;
  }, { path, init });
}

async function getAdminReportByCode(page: Page, reportCode: string) {
  const data = await apiRequest(page, `/admin/reportes?page=1&page_size=500&codigo=${encodeURIComponent(reportCode)}`) as {
    items?: Array<{ id: number; codigo: string }>;
  };
  const report = (data.items || []).find((item) => item.codigo === reportCode);
  if (!report) {
    throw new Error(`No se encontró el reporte ${reportCode}`);
  }
  return report;
}

async function getAdminInputByCode(page: Page, reportCode: string, inputCode: string) {
  const report = await getAdminReportByCode(page, reportCode);
  const inputs = await apiRequest(page, `/admin/reportes/${report.id}/inputs`) as Array<{
    id: number;
    codigo_input: string;
    obligatorio: number;
  }>;
  const input = (inputs || []).find((row) => row.codigo_input === inputCode);
  if (!input) {
    throw new Error(`No se encontró el input ${inputCode} en ${reportCode}`);
  }
  return input;
}

async function updateAdminInputRequiredFlag(page: Page, inputId: number, obligatorio: number) {
  await apiRequest(page, `/admin/reportes/inputs/${inputId}`, {
    method: "PATCH",
    body: JSON.stringify({ obligatorio }),
  });
}

async function waitForDetalleWithPayload(page: Page, requestId: string, timeoutMs = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const detail = await apiRequest(page, `/solicitudes/${encodeURIComponent(requestId)}/detalle`) as {
      intentos_detalle?: Array<{ payload_preview?: unknown }>;
      inputs_enviados?: Array<{
        codigo_input: string;
        obligatorio: number;
        valor: string | null;
        ruta_archivo: string | null;
        metadata: Record<string, unknown> | null;
      }>;
    };

    const attempts = Array.isArray(detail.intentos_detalle) ? detail.intentos_detalle : [];
    if (attempts.some((attempt) => Boolean(attempt.payload_preview))) {
      return detail;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`No se generó payload_preview para ${requestId} antes de ${timeoutMs} ms`);
}

test.describe("QA visual multiple inputs", () => {
  test("smoke visual publico: login visible y Chromium abre la app", async ({ page }) => {
    const issues = await collectCriticalIssues(page);

    await page.goto(BASE_URL);
    await expect(page.getByRole("heading", { name: "Centro de Reportes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await saveEvidence(page, "01-login-screen.png");

    expect.soft(issues.pageErrors, "No deben existir page errors críticos en login").toEqual([]);
  });

  test("flujo autenticado admin: legacy y multi-input", async ({ page }) => {
    test.skip(!E2E_USER || !E2E_PASSWORD, "Faltan E2E_USER y/o E2E_PASSWORD para QA autenticado.");
    test.setTimeout(180_000);

    const issues = await collectCriticalIssues(page);

    await loginAsAdmin(page);
    await saveEvidence(page, "02-dashboard-admin.png");

    const multiInputReportCode = "RPT_TRANSACCIONES_LIMPIAS";
    const optionalInputCode = "movimientos_ssgg";
    const targetInput = await getAdminInputByCode(page, multiInputReportCode, optionalInputCode);

    try {
      expect(Number(targetInput.obligatorio), `${optionalInputCode} debe estar configurado como opcional para esta prueba.`).toBe(0);

      await openAdminReportConfigurator(page, "RPT_EMAIL_CLI_ASEG_AG");
      await saveEvidence(page, "03-admin-legacy-datos.png");

      await page.locator('[data-config-step="rutas"]').click();
      await expect(page.locator("#cfgInputModeBadge")).toContainText(/legacy/i);
      await expect(page.locator("#cfgLegacyRutasSection")).toBeVisible();
      await saveEvidence(page, "04-admin-legacy-rutas.png");

      await page.locator('[data-config-step="revision"]').click();
      await expect(page.locator("#cfgReviewGrid")).toBeVisible();
      await saveEvidence(page, "05-admin-legacy-revision.png");
      await page.locator("#btnCloseAdmRepModal").click();
      await expect(page.locator("#adminReporteModal")).toBeHidden();

      await openAdminReportConfigurator(page, multiInputReportCode);
      await saveEvidence(page, "06-admin-multi-datos.png");

      await page.locator('[data-config-step="rutas"]').click();
      await expect(page.locator("#cfgInputModeBadge")).toContainText(/multi-input/i);
      await expect(page.locator("#cfgTbodyInputs")).toContainText("movimientos_salud");
      await expect(page.locator("#cfgTbodyInputs")).toContainText(optionalInputCode);
      await saveEvidence(page, "07-admin-multi-rutas.png");

      await page.locator("#cfgTbodyInputs tr").filter({ hasText: optionalInputCode }).getByRole("button", { name: "Editar" }).click();
      await expect(page.locator("#cfgInputFormWrap")).toBeVisible();
      await expect(page.locator("#cfgInputObligatorio")).toHaveValue("0");
      await saveEvidence(page, "08-admin-multi-input-form.png");
      await page.locator("#btnCfgCancelInputForm").click();

      await page.getByRole("button", { name: "Carpetas" }).first().click();
      await expect(page.locator("#cfgInputFoldersWrap")).toBeVisible();
      await saveEvidence(page, "09-admin-multi-carpetas.png");

      await page.locator('[data-config-step="revision"]').click();
      await expect(page.locator("#cfgReviewGrid")).toBeVisible();
      await saveEvidence(page, "10-admin-multi-revision.png");
      await page.locator("#btnCloseAdmRepModal").click();
      await expect(page.locator("#adminReporteModal")).toBeHidden();

      await page.locator('.menu__item[data-tab="tab-dashboard"]').click();

      await page.getByRole("button", { name: "Nueva solicitud" }).click();
      await expect(page.getByRole("heading", { name: "Nueva solicitud" })).toBeVisible();
      await saveEvidence(page, "11-nueva-solicitud-inicial.png");

      await selectReporteBySearch(page, "RPT_EMAIL", "RPT_EMAIL_CLI_ASEG_AG");
      await expect(page.locator("#nuevaSolicitudModeBadge")).toContainText(/legacy/i);
      await expect(page.locator("#ruta_input_select")).toBeEnabled();
      await saveEvidence(page, "12-nueva-solicitud-legacy.png");

      const legacyInputSelected = await selectFirstNonEmptyOption(page.locator("#ruta_input_select"));
      if (legacyInputSelected) {
        await page.getByRole("button", { name: "Enviar" }).click();
        await expect(page.getByText("Solicitud enviada:", { exact: false })).toBeVisible();
        await expect(page.locator("#nuevaSolicitudModal")).toBeHidden();

        await page.locator('.menu__item[data-tab="tab-detalle"]').click();
        await expect(page.getByText("Ruta input legacy", { exact: false })).toBeVisible();
        await expect(page.getByText("Intentos y evidencia", { exact: false })).toBeVisible();
        await saveEvidence(page, "12b-detalle-legacy.png");

        await page.locator('.menu__item[data-tab="tab-dashboard"]').click();
        await page.getByRole("button", { name: "Nueva solicitud" }).click();
        await expect(page.getByRole("heading", { name: "Nueva solicitud" })).toBeVisible();
      }

      await page.locator("#reporteComboboxTrigger").click();
      await expect(page.locator("#reporteComboboxDropdown")).toBeVisible();
      await expect(page.locator("#reporteComboboxList")).toContainText(multiInputReportCode);
      await page.locator("#reporteComboboxSearch").fill("sin coincidencias xyz");
      await expect(page.locator("#reporteComboboxList")).toContainText("No se encontraron reportes");
      await page.keyboard.press("Escape");
      await expect(page.locator("#reporteComboboxDropdown")).toBeHidden();

      await selectReporteBySearch(page, "transacciones", multiInputReportCode);
      await expect(page.locator("#nuevaSolicitudModeBadge")).toContainText(/multi[- ]?input/i);
      await expect(page.locator("#nuevaSolicitudInputsSection")).toBeVisible();
      await expect(page.locator("#ruta_input_select")).toBeDisabled();
      await expect(page.locator("#nuevaSolicitudInputsSection").getByText("movimientos salud", { exact: false })).toBeVisible();
      await expect(page.locator("#nuevaSolicitudInputsSection").getByText("movimientos ssgg", { exact: false })).toBeVisible();
      await expect(page.locator("#nuevaSolicitudInputsSection").getByText("periodo cierre", { exact: false })).toBeVisible();
      await expect(page.locator("#nuevaSolicitudInputsSection")).toContainText("Opcional");
      await saveEvidence(page, "13-nueva-solicitud-multi-input.png");

      await page.locator("#nuevaSolicitudInput_movimientos_salud").selectOption({ index: 1 });
      await expect(page.locator("#nuevaSolicitudInput_movimientos_ssgg")).toHaveValue("");
      await page.locator("#nuevaSolicitudInput_periodo_cierre").fill("202607");
      await saveEvidence(page, "14-multi-input-opcional-vacio.png");

      await page.getByRole("button", { name: "Enviar" }).click();
      await expect(page.getByText("Solicitud multi-input creada correctamente", { exact: false })).toBeVisible();
      await expect(page.locator("#nuevaSolicitudModal")).toBeHidden();

      const requestId = await page.locator("#detalleRequestId").inputValue();
      expect(requestId).toMatch(/^REQ_/);

      const detalle = await waitForDetalleWithPayload(page, requestId);
      const inputsEnviados = Array.isArray(detalle.inputs_enviados) ? detalle.inputs_enviados : [];
      const periodo = inputsEnviados.find((input) => input.codigo_input === optionalInputCode);
      expect(periodo).toBeTruthy();
      expect(periodo?.obligatorio).toBe(0);
      expect(periodo?.valor).toBeNull();
      expect(periodo?.ruta_archivo).toBeNull();
      expect(periodo?.metadata).toBeNull();

      const payloadPreview = (detalle.intentos_detalle || [])
        .map((attempt) => attempt.payload_preview)
        .find(Boolean) as {
          inputs?: Record<string, {
            obligatorio?: boolean;
            valor: string | null;
            ruta_archivo: string | null;
            metadata: Record<string, unknown> | null;
          }>;
          metadata?: {
            contract_version?: number;
          };
        } | undefined;
      expect(payloadPreview?.metadata?.contract_version).toBe(2);
      expect(payloadPreview?.inputs?.[optionalInputCode]).toEqual({
        tipo: "archivo",
        obligatorio: false,
        valor: null,
        ruta_archivo: null,
        metadata: null,
      });

      await expect(page.locator("#tbodyMis tr").first()).toContainText(multiInputReportCode);
      await saveEvidence(page, "15-multi-input-completo.png");

      await page.locator('.menu__item[data-tab="tab-detalle"]').click();
      await expect(page.getByText("Modo inputs", { exact: false })).toBeVisible();
      await expect(page.getByText("Inputs enviados", { exact: false })).toBeVisible();
      await expect(page.getByText("Intentos y evidencia", { exact: false })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Eventos" })).toBeVisible();
      await expect(page.locator("#detalleResumen")).toContainText(optionalInputCode);
      await saveEvidence(page, "17-detalle-multi-input.png");

      expect.soft(issues.pageErrors, "No deben existir page errors críticos en la navegación autenticada").toEqual([]);
      expect.soft(issues.failedRequests, "No deben existir respuestas 5xx críticas durante la navegación").toEqual([]);
    }
  });

  test("logout detiene polling autenticado y no muestra unauthorized repetido", async ({ page }) => {
    test.skip(!E2E_USER || !E2E_PASSWORD, "Faltan E2E_USER y/o E2E_PASSWORD para QA autenticado.");
    test.setTimeout(60_000);

    const unauthorizedResponses: string[] = [];

    page.on("response", async (response) => {
      if (response.status() === 401) {
        unauthorizedResponses.push(response.url());
      }
    });

    await loginAsAdmin(page);
    await expect(page.locator("#tbodyMis")).toBeVisible();
    await page.waitForTimeout(2_000);

    await page.locator("#btnLogout").click();
    await expect(page.getByRole("heading", { name: "Centro de Reportes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();

    await page.waitForTimeout(7_000);

    await expect(page.locator("#toastContainer")).not.toContainText(/Unauthorized/i);
    await expect(page.locator("#toastContainer")).not.toContainText(/sesion expirada|sesión expirada/i);
    expect.soft(unauthorizedResponses, "No deben aparecer respuestas 401 despues del logout manual.").toEqual([]);
  });
});
