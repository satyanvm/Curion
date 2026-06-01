import { Page } from "playwright";
import { FieldType, FormField, LabelSource } from "../types/types";

type RawField = {
  label: string;
  labelSource: LabelSource;
  selector: string;
  type: string;
  name?: string;
  placeholder?: string;
  tagName: string;
  options?: string[];
  autocomplete?: string;
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
  if (normalizedType === "url") return "url";
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

    const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

    const cleanupLabel = (text: string | null | undefined): string => {
      return normalizeWhitespace(String(text ?? ""))
        .replace(/^[\s:*-]+|[\s:*-]+$/g, "")
        .replace(/\s*[:|>]\s*$/g, "");
    };

    const isMachineLike = (text: string): boolean =>
      /(ctl\d+|field[_-]?\d+|input[_-]?\d+|q\d+|[a-f0-9]{8,})/i.test(text);

    const isReadableLabel = (text: string | null | undefined): boolean => {
      const normalized = cleanupLabel(text);
      if (!normalized || normalized.length > 90) return false;
      if (/^(required|optional|submit|save|continue|next|ok|\*+)$/i.test(normalized)) return false;
      if (isMachineLike(normalized)) return false;
      return /^[a-z0-9][a-z0-9\s/()&.,'_-]{1,}$/i.test(normalized);
    };

    const labelFromAutocomplete = (value: string | null): string => {
      const normalized = String(value || "").toLowerCase();
      const labels: Record<string, string> = {
        name: "Full name",
        "given-name": "First name",
        "family-name": "Last name",
        email: "Email",
        tel: "Phone",
        organization: "Company",
        "street-address": "Address",
        "address-line1": "Address line 1",
        "address-line2": "Address line 2",
        "address-level2": "City",
        "address-level1": "State",
        "postal-code": "Postal code",
        country: "Country",
        "country-name": "Country",
        url: "Website",
      };
      return labels[normalized] || "";
    };

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

    const visibleText = (element: Element | null | undefined): string => {
      if (!element) return "";
      const clone = element.cloneNode(true) as Element;
      clone.querySelectorAll("input, textarea, select, button, script, style").forEach((node) => node.remove());
      return cleanupLabel(clone.textContent);
    };

    const tableHeaderText = (element: Element): string => {
      const cell = element.closest("td, th");
      const row = cell?.parentElement;
      if (!cell || !row) return "";

      const index = Array.from(row.children).indexOf(cell);
      const directHeader = row.children[index - 1]?.textContent;
      if (isReadableLabel(directHeader)) return cleanupLabel(directHeader);

      const table = element.closest("table");
      const header = table?.querySelector(`thead tr th:nth-child(${index + 1})`)?.textContent;
      return isReadableLabel(header) ? cleanupLabel(header) : "";
    };

    const nearbyTextCandidates = (
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    ): Array<{ text: string; source: LabelSource }> => {
      const candidates: Array<{ text: string; source: LabelSource }> = [];
      const describedBy = element.getAttribute("aria-describedby");
      if (describedBy) {
        const text = describedBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
        candidates.push({ text, source: "parent-label" });
      }

      candidates.push(
        { text: visibleText(element.previousElementSibling), source: "parent-label" },
        { text: visibleText(element.closest("fieldset")?.querySelector("legend")), source: "parent-label" },
        { text: tableHeaderText(element), source: "parent-label" }
      );

      let parent: Element | null = element.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        candidates.push({ text: visibleText(parent), source: "parent-label" });
        parent = parent.parentElement;
        depth += 1;
      }

      return candidates;
    };

    const readLabel = (
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    ): { label: string; labelSource: LabelSource } => {
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel) return { label: ariaLabel, labelSource: "aria-label" };

      const ariaLabelledBy = element.getAttribute("aria-labelledby");
      if (ariaLabelledBy) {
        const labelText = ariaLabelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (labelText) return { label: labelText, labelSource: "aria-labelledby" };
      }

      if (element.labels?.length) {
        const text = Array.from(element.labels)
          .map((label) => label.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (text) return { label: text, labelSource: "label" };
      }

      const parentLabel = element.closest("label");
      const parentLabelText = parentLabel?.textContent?.trim();
      if (parentLabelText) return { label: parentLabelText, labelSource: "parent-label" };

      const placeholder = element.getAttribute("placeholder")?.trim();
      if (placeholder) return { label: placeholder, labelSource: "placeholder" };

      for (const candidate of nearbyTextCandidates(element)) {
        const label = cleanupLabel(candidate.text);
        if (isReadableLabel(label)) return { label, labelSource: candidate.source };
      }

      const autocompleteLabel = labelFromAutocomplete(element.getAttribute("autocomplete"));
      if (autocompleteLabel) return { label: autocompleteLabel, labelSource: "name" };

      const name = element.getAttribute("name")?.trim();
      if (name) return { label: name, labelSource: "name" };

      const id = element.getAttribute("id")?.trim();
      if (id) return { label: id, labelSource: "id" };

      return { label: "", labelSource: "id" };
    };

    const intentText = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
      return [
        element.getAttribute("type"),
        element.getAttribute("role"),
        element.getAttribute("name"),
        element.getAttribute("id"),
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("autocomplete"),
        element.closest("search, [role='search'], nav, header")?.textContent,
      ]
        .join(" ")
        .toLowerCase();
    };

    const visibleFields = elements.filter((element) => {
      const type = (element.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "file", "image", "password", "search"].includes(type)) return false;
      if (element.disabled || ("readOnly" in element && element.readOnly)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (/(^|\s)(search|query|keyword|filter|coupon)(\s|$)/.test(intentText(element))) return false;
      return true;
    });

    return visibleFields.map((element) => {
      const labelResult = readLabel(element);
      const tagName = element.tagName.toLowerCase();
      const type = element.getAttribute("type") || tagName;
      const options =
        tagName === "select"
          ? Array.from((element as HTMLSelectElement).options)
              .map((option) => option.textContent?.trim() ?? "")
              .filter(Boolean)
          : (element.getAttribute("type") || "").toLowerCase() === "radio" && element.getAttribute("name")
            ? Array.from(
                document.querySelectorAll<HTMLInputElement>(
                  `input[type="radio"][name="${CSS.escape(element.getAttribute("name") || "")}"]`
                )
              )
                .map((radio) => {
                  const label = radio.labels?.[0]?.textContent?.trim();
                  return label || radio.value || radio.getAttribute("aria-label") || "";
                })
                .filter(Boolean)
            : undefined;

      return {
        label: labelResult.label,
        labelSource: labelResult.labelSource,
        selector: makeSelector(element),
        type,
        name: element.getAttribute("name") ?? undefined,
        placeholder: element.getAttribute("placeholder") ?? undefined,
        autocomplete: element.getAttribute("autocomplete") ?? undefined,
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
      labelSource: rawField.labelSource,
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
