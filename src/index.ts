import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractFormFields } from "./browser/extractFormFields";
import { fillForm } from "./browser/fillForm";
import { openPage } from "./browser/openPage";
import { loadUserProfile, resolveProfilePath } from "./config/userProfile";
import { mapFieldsWithConfidence } from "./llm/mapFields";

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

async function main(): Promise<void> {
  const rawTarget = process.argv[2];
  const rawProfilePath = process.argv[3];
  const url = resolveTarget(rawTarget);
  const profile = await loadUserProfile(rawProfilePath);
  const resolvedProfilePath = resolveProfilePath(rawProfilePath);

  const { browser, page } = await openPage(url);

  try {
    console.log(`Opening: ${url}`);
    console.log(`Using profile: ${resolvedProfilePath}`);

    const { fields, extractionSource, report: extractionReport } = await extractFormFields(page);
    console.log(`Field extraction source: ${extractionSource}`);
    console.log(`Extraction confidence: ${extractionReport.overallScore.toFixed(2)}`);
    console.log("Detected fields:");
    console.table(
      fields.map((field) => ({
        label: field.label,
        labelSource: field.labelSource,
        type: field.type,
        selector: field.selector,
      }))
    );

    const { mappedValues, report: mappingReport } = await mapFieldsWithConfidence(
      fields,
      profile,
      extractionReport
    );
    console.log(`Mapping confidence: ${mappingReport.overallScore.toFixed(2)}`);
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
