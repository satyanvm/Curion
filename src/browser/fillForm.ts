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
    } else if (field.type === "checkbox" || field.type === "radio") {
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
