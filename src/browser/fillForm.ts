import { Locator, Page } from "playwright";
import { FieldValueMap, FormField } from "../types/types";

async function resolveLocator(page: Page, field: FormField): Promise<Locator> {
  const byLabel = page.getByLabel(field.label, { exact: true });
  if ((await byLabel.count()) > 0) return byLabel.first();

  const selectorLocator = page.locator(field.selector);
  if ((await selectorLocator.count()) > 0) return selectorLocator.first();

  throw new Error(`Unable to resolve locator for field "${field.label}"`);
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
    }

    filledEntries.push({ label: field.label, value });
  }

  return filledEntries;
}
