import { Page } from "playwright";
import { FieldType, FormField, LabelSource } from "../types/types";

type RepairCandidate = {
  text: string;
  source: LabelSource | "aria-describedby" | "nearby-text" | "fieldset-legend" | "container-text";
};

type FieldSnapshot = {
  selector: string;
  tagName: string;
  type: string;
  label: string;
  labelSource: LabelSource;
  name?: string;
  placeholder?: string;
  id?: string;
  dataTestId?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  associatedLabelText?: string;
  parentLabelText?: string;
  previousSiblingText?: string;
  nearbyText?: string;
  fieldsetLegendText?: string;
  containerText?: string;
  selectCount: number;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanupLabel(text: string): string {
  return normalizeWhitespace(text)
    .replace(/^[\s:*-]+|[\s:*-]+$/g, "")
    .replace(/\s*[:|>]\s*$/g, "");
}

function isMachineLike(text: string): boolean {
  return /(ctl\d+|field[_-]?\d+|input[_-]?\d+|q\d+|[a-f0-9]{8,})/i.test(text);
}

function isGenericOnly(text: string): boolean {
  return /^(required|optional|submit|save|continue|next|ok|\*+)$/i.test(text);
}

function looksLikeNoise(text: string): boolean {
  const stripped = text.replace(/[^a-z0-9]/gi, "");
  if (!stripped) return true;
  const alphaCount = (stripped.match(/[a-z]/gi) || []).length;
  const digitCount = (stripped.match(/\d/g) || []).length;
  return alphaCount === 0 || digitCount > alphaCount * 2;
}

function isReadableLabel(text: string): boolean {
  if (!text) return false;
  const normalized = cleanupLabel(text);
  if (!normalized || normalized.length > 80) return false;
  if (isGenericOnly(normalized) || isMachineLike(normalized) || looksLikeNoise(normalized)) return false;
  return /^[a-z0-9][a-z0-9\s/()&.,'_-]{1,}$/i.test(normalized);
}

function labelScore(text: string, source: RepairCandidate["source"]): number {
  if (!isReadableLabel(text)) return 0;

  let score = 0.5;
  if (source === "aria-label" || source === "aria-labelledby") score += 0.35;
  else if (source === "label") score += 0.3;
  else if (source === "parent-label") score += 0.18;
  else if (source === "fieldset-legend") score += 0.16;
  else if (source === "aria-describedby" || source === "nearby-text") score += 0.1;
  else if (source === "container-text") score += 0.05;
  return score;
}

function isStrongLabelSource(source: LabelSource): boolean {
  return source === "label" || source === "aria-label" || source === "aria-labelledby";
}

function inferFieldType(field: FormField, label: string): FieldType {
  if (["textarea", "select", "checkbox", "radio"].includes(field.type)) {
    return field.type;
  }

  if (field.type !== "text" && field.type !== "unknown") {
    return field.type;
  }

  const haystack = [label, field.name ?? "", field.placeholder ?? ""]
    .join(" ")
    .toLowerCase();

  if (/password/.test(haystack)) return "password";
  if (/(email|e-mail)/.test(haystack)) return "email";
  if (/(phone|mobile|tel|telephone)/.test(haystack)) return "tel";
  if (/(website|url|linkedin|link-in)/.test(haystack)) return "url";

  return field.type;
}

function selectorCandidates(snapshot: FieldSnapshot): string[] {
  const candidates: string[] = [];
  const tag = snapshot.tagName.toLowerCase();

  if (snapshot.id) candidates.push(`#${snapshot.id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1")}`);
  if (snapshot.name) candidates.push(`${tag}[name="${snapshot.name.replace(/"/g, '\\"')}"]`);
  if (snapshot.dataTestId) candidates.push(`${tag}[data-testid="${snapshot.dataTestId.replace(/"/g, '\\"')}"]`);
  if (snapshot.placeholder) candidates.push(`${tag}[placeholder="${snapshot.placeholder.replace(/"/g, '\\"')}"]`);
  if (snapshot.ariaLabel) candidates.push(`${tag}[aria-label="${snapshot.ariaLabel.replace(/"/g, '\\"')}"]`);

  return candidates;
}

async function countMatches(page: Page, selector: string): Promise<number> {
  try {
    return await page.locator(selector).count();
  } catch {
    return 0;
  }
}

async function resolveBetterSelector(page: Page, snapshot: FieldSnapshot): Promise<string | null> {
  const originalCount = snapshot.selectCount;
  if (originalCount === 0) return null;
  if (originalCount === 1) return snapshot.selector;

  for (const candidate of selectorCandidates(snapshot)) {
    if ((await countMatches(page, candidate)) === 1) {
      return candidate;
    }
  }

  return snapshot.selector;
}

function chooseBestLabel(field: FormField, snapshot: FieldSnapshot): { label: string; source: LabelSource } {
  const currentLabel = cleanupLabel(field.label);
  const currentScore = labelScore(currentLabel, field.labelSource as RepairCandidate["source"]);
  const currentStrong = isStrongLabelSource(field.labelSource);

  const candidates: RepairCandidate[] = [
    { text: snapshot.ariaLabel ?? "", source: "aria-label" },
    { text: snapshot.ariaLabelledBy ?? "", source: "aria-labelledby" },
    { text: snapshot.associatedLabelText ?? "", source: "label" },
    { text: snapshot.parentLabelText ?? "", source: "parent-label" },
    { text: snapshot.previousSiblingText ?? "", source: "nearby-text" },
    { text: snapshot.nearbyText ?? "", source: "nearby-text" },
    { text: snapshot.fieldsetLegendText ?? "", source: "fieldset-legend" },
    { text: snapshot.containerText ?? "", source: "container-text" },
    { text: snapshot.ariaDescribedBy ?? "", source: "aria-describedby" },
    { text: field.placeholder ?? "", source: "placeholder" },
    { text: field.name ?? "", source: "name" },
    { text: snapshot.id ?? "", source: "id" },
  ];

  let bestLabel = currentLabel;
  let bestSource = field.labelSource;
  let bestScore = currentScore;

  for (const candidate of candidates) {
    const text = cleanupLabel(candidate.text);
    if (!isReadableLabel(text)) continue;
    const score = labelScore(text, candidate.source);

    const shouldReplace =
      score > bestScore + 0.12 ||
      (!currentStrong && score >= bestScore && bestLabel.length <= 2) ||
      (!currentStrong && !isReadableLabel(bestLabel) && score >= 0.58);

    if (shouldReplace) {
      bestLabel = text;
      bestSource =
        candidate.source === "aria-label" ||
        candidate.source === "aria-labelledby" ||
        candidate.source === "label"
          ? candidate.source
          : "parent-label";
      bestScore = score;
    }
  }

  return {
    label: bestLabel || currentLabel,
    source: bestSource,
  };
}

async function inspectField(page: Page, field: FormField): Promise<FieldSnapshot | null> {
  const count = await page.locator(field.selector).count();
  if (count === 0) return null;

  return page.locator(field.selector).first().evaluate((element, payload) => {
    const { originalSelector, selectorCount } = payload as {
      originalSelector: string;
      selectorCount: number;
    };
    const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const tagName = input.tagName.toLowerCase();
    const ariaLabel = input.getAttribute("aria-label")?.trim() || "";
    const ariaLabelledBy = input.getAttribute("aria-labelledby")?.trim() || "";
    const ariaDescribedBy = input.getAttribute("aria-describedby")?.trim() || "";
    const associatedLabelText = input.labels?.length
      ? Array.from(input.labels)
          .map((label) => label.textContent?.trim() ?? "")
          .join(" ")
          .trim()
      : "";
    const parentLabelText = input.closest("label")?.textContent?.trim() || "";
    const previousSiblingText = input.previousElementSibling?.textContent?.trim() || "";
    const nearbyText = Array.from(
      input.parentElement?.querySelectorAll("span, div, p, th, td") ?? []
    )
      .map((node) => node.textContent?.trim() ?? "")
      .filter((text) => text && text !== input.textContent?.trim())
      .join(" ")
      .trim();
    const fieldsetLegendText =
      input.closest("fieldset")?.querySelector("legend")?.textContent?.trim() || "";
    const containerText = input.parentElement?.textContent?.trim() || "";

    const ariaDescribedByText = ariaDescribedBy
      ? ariaDescribedBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim()
      : "";

    return {
      selector: input.id ? `#${input.id}` : originalSelector,
      tagName,
      type: input.getAttribute("type") || tagName,
      label: "",
      labelSource: "id",
      name: input.getAttribute("name") || undefined,
      placeholder: input.getAttribute("placeholder") || undefined,
      id: input.getAttribute("id") || undefined,
      dataTestId: input.getAttribute("data-testid") || undefined,
      ariaLabel: ariaLabel || undefined,
      ariaLabelledBy: ariaLabelledBy
        ? ariaLabelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .join(" ")
            .trim() || undefined
        : undefined,
      ariaDescribedBy: ariaDescribedByText || undefined,
      associatedLabelText: associatedLabelText || undefined,
      parentLabelText: parentLabelText || undefined,
      previousSiblingText: previousSiblingText || undefined,
      nearbyText: nearbyText || undefined,
      fieldsetLegendText: fieldsetLegendText || undefined,
      containerText: containerText || undefined,
      selectCount: selectorCount,
    } satisfies FieldSnapshot;
  }, { originalSelector: field.selector, selectorCount: count });
}

export async function repairDomFields(page: Page, fields: FormField[]): Promise<FormField[]> {
  const repaired: FormField[] = [];

  for (const field of fields) {
    const snapshot = await inspectField(page, field);
    if (!snapshot) continue;

    const labelChoice = chooseBestLabel(field, snapshot);
    const selector = await resolveBetterSelector(page, snapshot);
    if (!selector) continue;

    const repairedField: FormField = {
      ...field,
      label: labelChoice.label,
      labelSource: labelChoice.source,
      selector,
      type: inferFieldType(field, labelChoice.label),
    };

    repaired.push(repairedField);
  }

  return repaired;
}
