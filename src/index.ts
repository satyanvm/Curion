import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractFormFields } from "./browser/extractFormFields";
import { fillForm } from "./browser/fillForm";
import { openPage } from "./browser/openPage";
import { loadUserProfile, resolveProfilePath } from "./config/userProfile";
import { mapFieldsWithBackend } from "./backend/mapForm";

async function waitForReview(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question("Press ENTER to submit the form after review...");
  } finally {
    rl.close();
  }
}

function resolveTarget(inputUrl?: string): string {
  const demoTargets: Record<string, string> = {
    demo: "demo-form.html",
    "demo-all": "demo-form.html",
    "demo-missing-labels": "demo-missing-labels.html",
    "demo-attributes": "demo-attributes.html",
    "demo-dropdowns": "demo-dropdowns.html",
    crm: "crm.html",
  };

  if (!inputUrl || inputUrl in demoTargets) {
    const demoFile = demoTargets[inputUrl ?? "demo"];
    const demoPath = path.resolve(process.cwd(), "demo", demoFile);
    return pathToFileURL(demoPath).toString();
  }

  if (/^https?:\/\//i.test(inputUrl) || /^file:\/\//i.test(inputUrl)) {
    return inputUrl;
  }

  const localPath = path.resolve(process.cwd(), inputUrl);
  return pathToFileURL(localPath).toString();
}

function formatConfidence(value: number | undefined): string {
  return Number((value ?? 0).toFixed(2)).toFixed(2);
}

async function main(): Promise<void> {
  const rawTarget = process.argv[2];
  const rawProfilePath = process.argv[3];
  const url = resolveTarget(rawTarget);
  const formContext = rawTarget === "crm" ? "CRM lead intake form" : undefined;
  const profile = await loadUserProfile(rawProfilePath);
  const resolvedProfilePath = resolveProfilePath(rawProfilePath);

  const { browser, page } = await openPage(url);

  try {
    console.log(`Opening: ${url}`);
    console.log(`Using profile: ${resolvedProfilePath}`);

    const {
      fields: extractedFields,
      extractionSource,
      report: extractionReport,
      htmlAdequacyReport,
    } = await extractFormFields(page);
    console.log(`Field extraction source: ${extractionSource}`);
    console.log(`Extraction confidence: ${extractionReport.overallScore.toFixed(2)}`);
    console.log(
      `HTML adequacy: ${htmlAdequacyReport.overallScore.toFixed(2)} (${htmlAdequacyReport.recommendedFallback})`
    );
    console.log("Detected fields:");
    console.table(
      extractedFields.map((field) => ({
        label: field.label,
        labelSource: field.labelSource,
        type: field.type,
        selector: field.selector,
      }))
    );

    const backendResult = await mapFieldsWithBackend({
      fields: extractedFields,
      profile,
      goal: formContext ? `Fill this page with the ${formContext}.` : "Fill this page with the active Curion metadata.",
      url,
      title: rawTarget || "Form",
      html: await page.content(),
    });
    const mappedValues = backendResult.mappedValues;
    const fields = extractedFields;
    const mappingSource = backendResult.analysis.source || "backend";
    const mappingConfidence =
      backendResult.analysis.mappingReport?.overallScore ??
      backendResult.analysis.overallConfidence ??
      0;

    console.log(`Mapping source: ${mappingSource}`);
    console.log(`Mapping confidence: ${formatConfidence(mappingConfidence)}`);
    console.log("Mapped values:");
    console.table(mappedValues);

    const filledEntries = await fillForm(page, fields, mappedValues);
    console.log("Filled values:");
    console.table(filledEntries);

    await waitForReview();

    const submitButton = page.getByRole("button", { name: /submit/i });
    if ((await submitButton.count()) === 0) {
      throw new Error('No submit button found with role "button" and name matching /submit/i');
    }

    await submitButton.first().click();
    console.log("Form submitted.");
  } catch (error) {
    console.error("Failed to complete form filling:", error);
  } finally {
    // Leave the browser open briefly so the submission result is visible.
    await page.waitForTimeout(2000).catch(() => undefined);
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
