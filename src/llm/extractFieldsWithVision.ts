import { Page } from "playwright";
import { FormField } from "../types/types";
import { parseLlmExtractedFields } from "./fieldParsing";
import { generateJsonWithOpenAI, isOpenAiConfigured } from "./openai";

type VisualCandidate = {
  selector: string;
  tagName: string;
  type: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  visibleText?: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  options?: string[];
};

async function collectVisualCandidates(page: Page): Promise<VisualCandidate[]> {
  return page.evaluate(() => {
    const makeSelector = (element: Element): string => {
      const id = element.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;

      const name = element.getAttribute("name");
      if (name) return `${element.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;

      const dataTestId = element.getAttribute("data-testid");
      if (dataTestId) {
        return `${element.tagName.toLowerCase()}[data-testid="${dataTestId.replace(/"/g, '\\"')}"]`;
      }

      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === current?.tagName
          );
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };

    const controls = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select"
      )
    ).filter((element) => {
      const type = (element.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "file", "image", "password", "search"].includes(type)) return false;
      if (element.disabled || ("readOnly" in element && element.readOnly)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
    });

    return controls.map((element) => {
      const rect = element.getBoundingClientRect();
      const parentText = element.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 160);
      const tagName = element.tagName.toLowerCase();
      return {
        selector: makeSelector(element),
        tagName,
        type: element.getAttribute("type") || tagName,
        name: element.getAttribute("name") || undefined,
        placeholder: element.getAttribute("placeholder") || undefined,
        ariaLabel: element.getAttribute("aria-label") || undefined,
        visibleText: parentText || undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        options:
          element instanceof HTMLSelectElement
            ? Array.from(element.options).map((option) => option.textContent?.trim() || "").filter(Boolean)
            : undefined,
      };
    });
  });
}

async function filterExistingSelectors(page: Page, fields: FormField[]): Promise<FormField[]> {
  const verified: FormField[] = [];
  for (const field of fields) {
    const count = await page.locator(field.selector).count().catch(() => 0);
    if (count > 0) verified.push(field);
  }
  return verified;
}

export async function extractFieldsWithVision(
  page: Page,
  currentFields: FormField[] = []
): Promise<FormField[]> {
  if (!isOpenAiConfigured()) {
    return [];
  }

  const candidates = await collectVisualCandidates(page);
  if (candidates.length === 0) {
    return [];
  }

  const screenshot = await page.screenshot({ type: "png", fullPage: true });
  const imageDataUrl = `data:image/png;base64,${screenshot.toString("base64")}`;

  try {
    const content = await generateJsonWithOpenAI(
      [
        "Repair form-field extraction using the screenshot and DOM candidate list.",
        "Return strict JSON with a top-level fields array.",
        "Use selectors from candidateControls whenever possible.",
        "Read labels from visible text in the screenshot, especially when HTML labels are missing or machine-generated.",
        "Only include fields that are visible, fillable user inputs."
      ].join(" "),
      {
        url: page.url(),
        title: await page.title().catch(() => ""),
        currentFields,
        candidateControls: candidates,
        expectedJsonShape: {
          fields: [
            {
              label: "Human readable visible label",
              selector: "CSS selector from candidateControls",
              type: "text|email|tel|url|select|textarea|checkbox|radio|number",
              name: "optional name attribute",
              placeholder: "optional placeholder",
              options: ["optional visible choices"]
            }
          ],
        },
      },
      { imageDataUrl }
    );

    const parsed = JSON.parse(content) as { fields?: Array<Record<string, unknown>> };
    return filterExistingSelectors(page, parseLlmExtractedFields(parsed.fields ?? []));
  } catch (error) {
    console.warn("Vision field extraction fallback failed:", error);
    return [];
  }
}
