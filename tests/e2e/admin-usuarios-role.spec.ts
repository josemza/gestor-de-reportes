import { expect, test } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:8037";
const E2E_USER = process.env.E2E_USER || "";
const E2E_PASSWORD = process.env.E2E_PASSWORD || "";

test("admin visualiza la accion Editar rol en usuarios", async ({ page }) => {
  test.skip(!E2E_USER || !E2E_PASSWORD, "Faltan E2E_USER y/o E2E_PASSWORD para QA autenticado.");

  await page.goto(BASE_URL);
  await page.locator("#loginUsername").fill(E2E_USER);
  await page.locator("#loginPassword").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^Entrar$/ }).click();

  await expect(page.getByRole("heading", { name: "Panel operativo" })).toBeVisible();
  await page.locator('.menu__item[data-tab="tab-usuarios"]').click();
  await expect(page.locator("#tbodyUsuarios")).toBeVisible();

  const editRoleButton = page.getByRole("button", { name: "Editar rol" }).first();
  await expect(editRoleButton).toBeVisible();
  await editRoleButton.click();

  await expect(page.locator("#adminUsuarioRoleModal")).toBeVisible();
  await expect(page.locator("#admEditarRolNuevo")).toBeVisible();
});
