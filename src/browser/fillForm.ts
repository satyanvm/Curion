import { Locator, Page } from "playwright";
import { FieldValueMap, FormField } from "../types/types";

async function resolveLocator(page: Page, field: FormField): Promise<Locator> {
  const byLabel = page.getByLabel(field.label, { exact: true });
  if ((await byLabel.count()) > 0) return byLabel.first();

  const selectorLocator = page.locator(field.selector);
  if ((await selectorLocator.count()) > 0) return selectorLocator.first();

  throw new Error(`Unable to resolve locator for field "${field.label}"`);
}

async function ensureValuePersisted(
  page: Page,
  field: FormField,
  locator: Locator,
  expectedValue: string
): Promise<void> {
  if (field.type === "select" || field.type === "checkbox" || field.type === "radio") {
    return;
  }

  const currentValue = await locator.inputValue().catch(() => "");
  if (currentValue === expectedValue) {
    return;
  }

  const selectorLocator = page.locator(field.selector).first();
  if ((await selectorLocator.count()) > 0) {
    await selectorLocator.fill(expectedValue);
    const selectorValue = await selectorLocator.inputValue().catch(() => "");
    if (selectorValue === expectedValue) {
      return;
    }
  }

  // Final fallback: set the DOM value directly and trigger events so the demo
  // still behaves like a user edit when Playwright's fill does not stick.
  await locator.evaluate((element, value) => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, expectedValue);
}

function normalizeChoice(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function checkRadioValue(page: Page, field: FormField, value: string): Promise<void> {
  const normalizedValue = normalizeChoice(value);
  const baseLocator = field.name
    ? page.locator(`input[type="radio"][name="${field.name.replace(/"/g, '\\"')}"]`)
    : page.locator(field.selector);
  const count = await baseLocator.count();

  for (let index = 0; index < count; index += 1) {
    const radio = baseLocator.nth(index);
    const metadata = await radio.evaluate((element) => {
      const input = element as HTMLInputElement;
      return {
        value: input.value,
        label: input.labels?.[0]?.textContent?.trim() || "",
        ariaLabel: input.getAttribute("aria-label") || "",
      };
    });
    const choices = [metadata.value, metadata.label, metadata.ariaLabel].map(normalizeChoice);
    if (choices.includes(normalizedValue)) {
      await radio.check();
      return;
    }
  }

  const shouldCheck = /^(true|yes|1|on|agree|accepted)$/i.test(value);
  if (shouldCheck) {
    await baseLocator.first().check();
  }
}

export async function fillForm(
  page: Page,
  fields: FormField[],
  mappedValues: FieldValueMap
): Promise<Array<{ label: string; value: string }>> {
  const filledEntries: Array<{ label: string; value: string }> = [];

  for (const field of fields) {
    const value = mappedValues[field.label];
    if (!value) continue;

    const locator = await resolveLocator(page, field);

    if (field.type === "select") {
      await locator.selectOption({ label: value }).catch(async () => {
        await locator.selectOption({ value });
      });
    } else if (field.type === "radio") {
      await checkRadioValue(page, field, value);
    } else if (field.type === "checkbox") {
      const shouldCheck = /^(true|yes|1|on)$/i.test(value);
      if (shouldCheck) {
        await locator.check();
      }
    } else {
      await locator.fill(value);
      await ensureValuePersisted(page, field, locator, value);
    }

    filledEntries.push({ label: field.label, value });
  }

  return filledEntries;
}
