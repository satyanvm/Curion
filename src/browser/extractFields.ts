import { Page } from "playwright";
import { FieldType, FormField } from "../types/types";

type RawField = {
  label: string;
  selector: string;
  type: string;
  name?: string;
  placeholder?: string;
  tagName: string;
  options?: string[];
};

function normalizeFieldType(type: string, tagName: string): FieldType {
  const normalizedTag = tagName.toLowerCase();
  const normalizedType = type.toLowerCase();

  if (normalizedTag === "textarea") return "textarea";
  if (normalizedTag === "select") return "select";
  if (normalizedType === "checkbox") return "checkbox";
  if (normalizedType === "radio") return "radio";
  if (normalizedType === "email") return "email";
  if (normalizedType === "tel") return "tel";
  if (normalizedType === "number") return "number";
  if (normalizedType === "password") return "password";
  if (normalizedType === "text" || normalizedType === "") return "text";

  return "unknown";
}

export async function extractFields(page: Page): Promise<FormField[]> {
  const rawFields = await page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select"
      )
    );

    const makeSelector = (element: Element): string => {
      const id = element.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;

      const name = element.getAttribute("name");
      if (name) return `${element.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;

      const placeholder = element.getAttribute("placeholder");
      if (placeholder) {
        return `${element.tagName.toLowerCase()}[placeholder="${placeholder.replace(/"/g, '\\"')}"]`;
      }

      const dataTestId = element.getAttribute("data-testid");
      if (dataTestId) {
        return `${element.tagName.toLowerCase()}[data-testid="${dataTestId.replace(/"/g, '\\"')}"]`;
      }

      let current: Element | null = element;
      const parts: string[] = [];

      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === current?.tagName
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            part += `:nth-of-type(${index})`;
          }
        }
        parts.unshift(part);
        current = current.parentElement;
      }

      return parts.join(" > ");
    };

    const readLabel = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel) return ariaLabel;

      const ariaLabelledBy = element.getAttribute("aria-labelledby");
      if (ariaLabelledBy) {
        const labelText = ariaLabelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (labelText) return labelText;
      }

      if (element.labels?.length) {
        const text = Array.from(element.labels)
          .map((label) => label.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }

      const parentLabel = element.closest("label");
      const parentLabelText = parentLabel?.textContent?.trim();
      if (parentLabelText) return parentLabelText;

      const placeholder = element.getAttribute("placeholder")?.trim();
      if (placeholder) return placeholder;

      const name = element.getAttribute("name")?.trim();
      if (name) return name;

      const id = element.getAttribute("id")?.trim();
      if (id) return id;

      return "";
    };

    const visibleFields = elements.filter((element) => {
      const type = (element.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "file"].includes(type)) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    return visibleFields.map((element) => {
      const tagName = element.tagName.toLowerCase();
      const type = element.getAttribute("type") || tagName;
      const options =
        tagName === "select"
          ? Array.from((element as HTMLSelectElement).options)
              .map((option) => option.textContent?.trim() ?? "")
              .filter(Boolean)
          : undefined;

      return {
        label: readLabel(element),
        selector: makeSelector(element),
        type,
        name: element.getAttribute("name") ?? undefined,
        placeholder: element.getAttribute("placeholder") ?? undefined,
        tagName,
        options,
      };
    });
  });

  const deduped = new Map<string, FormField>();

  for (const rawField of rawFields as RawField[]) {
    if (!rawField.label || !rawField.selector) continue;

    const field: FormField = {
      label: rawField.label,
      selector: rawField.selector,
      type: normalizeFieldType(rawField.type, rawField.tagName),
      name: rawField.name,
      placeholder: rawField.placeholder,
      tagName: rawField.tagName,
      options: rawField.options,
    };

    const key = `${field.selector}:${field.label}`;
    deduped.set(key, field);
  }

  return Array.from(deduped.values());
}
