import { Page } from "playwright";
import { ExtractionConfidenceReport, FormField, HtmlAdequacyReport } from "../types/types";

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

type DomAdequacyMetrics = {
  nativeControlCount: number;
  associatedLabelCount: number;
  ariaLabelCount: number;
  readableNameCount: number;
  readableIdCount: number;
  readablePlaceholderCount: number;
  machineGeneratedAttributeCount: number;
  customWidgetCount: number;
  meaningfulVisibleTextCount: number;
};

function isMachineLike(text: string): boolean {
  return /(ctl\d+|field[_-]?\d+|input[_-]?\d+|q\d+|[a-f0-9]{8,})/i.test(text);
}

async function collectDomAdequacyMetrics(page: Page): Promise<DomAdequacyMetrics> {
  return page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select"
      )
    ).filter((element) => {
      const type = (element.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "file"].includes(type)) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    const isReadable = (text: string | null): boolean => {
      if (!text) return false;
      const normalized = text.trim();
      if (!normalized) return false;
      return /^[a-z0-9][a-z0-9\s/()_-]{2,}$/i.test(normalized);
    };

    const isMachineLikeValue = (text: string | null): boolean => {
      if (!text) return false;
      return /(ctl\d+|field[_-]?\d+|input[_-]?\d+|q\d+|[a-f0-9]{8,})/i.test(text.trim());
    };

    const metrics: DomAdequacyMetrics = {
      nativeControlCount: controls.length,
      associatedLabelCount: 0,
      ariaLabelCount: 0,
      readableNameCount: 0,
      readableIdCount: 0,
      readablePlaceholderCount: 0,
      machineGeneratedAttributeCount: 0,
      customWidgetCount: 0,
      meaningfulVisibleTextCount: 0,
    };

    for (const control of controls) {
      if (control.labels?.length || control.closest("label")) {
        metrics.associatedLabelCount += 1;
      }

      if (control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) {
        metrics.ariaLabelCount += 1;
      }

      const name = control.getAttribute("name");
      const id = control.getAttribute("id");
      const placeholder = control.getAttribute("placeholder");

      if (isReadable(name)) metrics.readableNameCount += 1;
      if (isReadable(id)) metrics.readableIdCount += 1;
      if (isReadable(placeholder)) metrics.readablePlaceholderCount += 1;

      if (isMachineLikeValue(name) || isMachineLikeValue(id)) {
        metrics.machineGeneratedAttributeCount += 1;
      }

      const nearbyText = [
        control.labels?.[0]?.textContent ?? "",
        control.closest("label")?.textContent ?? "",
        control.parentElement?.textContent ?? "",
        control.previousElementSibling?.textContent ?? "",
      ]
        .join(" ")
        .trim();

      if (isReadable(nearbyText) && nearbyText.length >= 4) {
        metrics.meaningfulVisibleTextCount += 1;
      }
    }

    metrics.customWidgetCount =
      document.querySelectorAll(
        '[role="combobox"], [role="textbox"], [contenteditable="true"], canvas, svg'
      ).length;

    return metrics;
  });
}

export async function calculateHtmlAdequacy(
  page: Page,
  fields: FormField[],
  extractionReport: ExtractionConfidenceReport
): Promise<HtmlAdequacyReport> {
  const metrics = await collectDomAdequacyMetrics(page);
  const controlCount = Math.max(metrics.nativeControlCount, fields.length, 1);

  const strongSemanticCoverage = clamp(
    (metrics.associatedLabelCount + metrics.ariaLabelCount) / controlCount
  );
  const readableAttributeCoverage = clamp(
    (metrics.readableNameCount + metrics.readableIdCount + metrics.readablePlaceholderCount) /
      (controlCount * 1.5)
  );
  const machineGeneratedAttributeRatio = clamp(metrics.machineGeneratedAttributeCount / controlCount);
  const customWidgetSuspicion = clamp(metrics.customWidgetCount / controlCount);
  const visibleTextCoverage = clamp(metrics.meaningfulVisibleTextCount / controlCount);

  let score = 0;
  score += extractionReport.overallScore * 0.3;
  score += strongSemanticCoverage * 0.28;
  score += readableAttributeCoverage * 0.18;
  score += visibleTextCoverage * 0.14;
  score += clamp(1 - machineGeneratedAttributeRatio) * 0.06;
  score += clamp(1 - customWidgetSuspicion) * 0.04;
  const overallScore = clamp(score);

  const reasons: string[] = [];
  const weaknesses: string[] = [];

  if (strongSemanticCoverage >= 0.55) {
    reasons.push("HTML exposes enough label and accessibility relationships");
  } else {
    weaknesses.push("Label/accessibility relationships are sparse in the HTML");
  }

  if (readableAttributeCoverage >= 0.5) {
    reasons.push("Attributes like name/id/placeholder are human-readable");
  } else {
    weaknesses.push("Field attributes are not descriptive enough");
  }

  if (visibleTextCoverage >= 0.45) {
    reasons.push("Nearby DOM text provides semantic clues");
  } else {
    weaknesses.push("Visible DOM text around controls is weak");
  }

  if (machineGeneratedAttributeRatio >= 0.35) {
    weaknesses.push("Many field attributes look machine-generated");
  }

  if (customWidgetSuspicion >= 0.45) {
    weaknesses.push("The page appears to rely heavily on custom widgets or visual rendering");
  }

  let recommendedFallback: HtmlAdequacyReport["recommendedFallback"] = "none";
  if (overallScore >= 0.72 && extractionReport.shouldUseLLM) {
    recommendedFallback = "llm-html";
  } else if (overallScore >= 0.5 && extractionReport.shouldUseLLM) {
    recommendedFallback = "dom-repair";
  } else if (overallScore < 0.5 && extractionReport.shouldUseLLM) {
    recommendedFallback = "vision";
  }

  return {
    overallScore,
    recommendedFallback,
    reasons,
    weaknesses,
    nativeControlCount: metrics.nativeControlCount,
    strongSemanticCoverage,
    readableAttributeCoverage,
    machineGeneratedAttributeRatio,
    customWidgetSuspicion,
    hasMeaningfulVisibleText: visibleTextCoverage >= 0.4,
  };
}
