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

    await openAdminReportConfigurator(page, "RPT_TRANSACCIONES_LIMPIAS");
    await saveEvidence(page, "06-admin-multi-datos.png");

    await page.locator('[data-config-step="rutas"]').click();
    await expect(page.locator("#cfgInputModeBadge")).toContainText(/multi-input/i);
    await expect(page.locator("#cfgTbodyInputs")).toContainText("movimientos_salud");
    await saveEvidence(page, "07-admin-multi-rutas.png");

    await page.getByRole("button", { name: "Editar" }).first().click();
    await expect(page.locator("#cfgInputFormWrap")).toBeVisible();
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

    const reporteSelect = page.locator("#reporte");
    await reporteSelect.selectOption("RPT_EMAIL_CLI_ASEG_AG");
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

    await reporteSelect.selectOption("RPT_TRANSACCIONES_LIMPIAS");
    await expect(page.locator("#nuevaSolicitudModeBadge")).toContainText(/multi[- ]?input/i);
    await expect(page.locator("#nuevaSolicitudInputsSection")).toBeVisible();
    await expect(page.locator("#ruta_input_select")).toBeDisabled();
    await expect(page.locator("#nuevaSolicitudInputsSection").getByText("movimientos salud", { exact: false })).toBeVisible();
    await expect(page.locator("#nuevaSolicitudInputsSection").getByText("movimientos ssgg", { exact: false })).toBeVisible();
    await expect(page.locator("#nuevaSolicitudInputsSection").getByText("periodo cierre", { exact: false })).toBeVisible();
    await saveEvidence(page, "13-nueva-solicitud-multi-input.png");

    await page.locator("#nuevaSolicitudInput_periodo_cierre").fill("202613");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.locator("#nuevaSolicitudError_periodo_cierre")).toContainText("mes entre 01 y 12");
    await saveEvidence(page, "14-validacion-periodo-invalido.png");

    await page.locator("#nuevaSolicitudInput_movimientos_salud").selectOption({ index: 1 });
    await page.locator("#nuevaSolicitudInput_movimientos_ssgg").selectOption({ index: 1 });
    await page.locator("#nuevaSolicitudInput_periodo_cierre").fill("202607");
    await saveEvidence(page, "15-multi-input-completo.png");

    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Solicitud multi-input creada correctamente", { exact: false })).toBeVisible();
    await expect(page.locator("#nuevaSolicitudModal")).toBeHidden();

    await expect(page.locator("#tbodyMis tr").first()).toContainText("RPT_TRANSACCIONES_LIMPIAS");
    await saveEvidence(page, "16-mis-solicitudes-refrescado.png");

    await page.locator('.menu__item[data-tab="tab-detalle"]').click();
    await expect(page.getByText("Modo inputs", { exact: false })).toBeVisible();
    await expect(page.getByText("Inputs enviados", { exact: false })).toBeVisible();
    await expect(page.getByText("Intentos y evidencia", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Eventos" })).toBeVisible();
    await saveEvidence(page, "17-detalle-multi-input.png");

    expect.soft(issues.pageErrors, "No deben existir page errors críticos en la navegación autenticada").toEqual([]);
    expect.soft(issues.failedRequests, "No deben existir respuestas 5xx críticas durante la navegación").toEqual([]);
  });
});
