import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { extractFormFields } from "../browser/extractFormFields";
import { fillForm } from "../browser/fillForm";
import { loadUserProfile } from "../config/userProfile";
import { mapFieldsWithConfidence } from "../llm/mapFields";

type ExpectedPayload = Record<string, string | boolean>;

const expectedPayload: ExpectedPayload = {
  best_inbox: "aarav.mehta@example.com",
  primary_line: "+91 9876543210",
  organization: "Nimbus Automation",
  current_seat: "Product Engineer",
  base: "17 Residency Lane",
  market: "Pune",
  territory: "Maharashtra",
  zone: "411001",
  geo: "India",
  profile: "https://www.linkedin.com/in/aaravmehta",
  source: "https://aaravmehta.dev",
  next_touch: "Email",
  context: "Interested in testing AI-powered browser automation flows.",
  ok_to_proceed: "yes",
};

function formatFailures(payload: ExpectedPayload): string[] {
  return Object.entries(expectedPayload)
    .filter(([key, value]) => payload[key] !== value)
    .map(([key, value]) => `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(payload[key])}`);
}

async function main(): Promise<void> {
  const formPath = path.resolve(process.cwd(), "demo", "llm-crm.html");
  const profilePath = path.resolve(process.cwd(), "data", "profile.json");
  const url = pathToFileURL(formPath).toString();
  const profile = await loadUserProfile(profilePath);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const {
      fields: extractedFields,
      extractionSource,
      report: extractionReport,
      htmlAdequacyReport,
      deferredLlmExtraction,
    } = await extractFormFields(page);

    const {
      mappedValues,
      report: mappingReport,
      fields,
    } = await mapFieldsWithConfidence(extractedFields, profile, extractionReport, {
      formContext: "Ambiguous CRM intake form",
      page,
      deferredLlmExtraction,
    });

    const filledEntries = await fillForm(page, fields, mappedValues);

    await page.getByRole("button", { name: /submit/i }).click();
    await page.locator("#result.visible").waitFor({ state: "visible" });
    const rawPayload = await page.locator("#resultData").innerText();
    const payload = JSON.parse(rawPayload) as ExpectedPayload;
    const failures = formatFailures(payload);

    console.log(`Ambiguous CRM scenario page: ${url}`);
    console.log(`Extracted fields: ${fields.length}`);
    console.log(`Field extraction source: ${extractionSource}`);
    console.log(`Extraction confidence: ${extractionReport.overallScore.toFixed(2)}`);
    console.log(
      `HTML adequacy: ${htmlAdequacyReport.htmlAdequacyScore.toFixed(2)} (${htmlAdequacyReport.recommendedFallback})`
    );
    console.log(`Mapping confidence: ${mappingReport.overallScore.toFixed(2)}`);
    console.log("Mapping decisions:");
    console.table(
      mappingReport.fieldReports.map((report) => ({
        label: report.label,
        method: report.method,
        mappedKey: report.mappedKey ?? "",
        mappedValue: report.mappedValue ?? "",
        score: report.score.toFixed(2),
        shouldUseLLM: report.shouldUseLLM,
      }))
    );
    console.log("Filled fields:");
    console.table(filledEntries.map((entry) => ({ label: entry.label, value: entry.value })));

    if (failures.length > 0) {
      console.error("Ambiguous CRM scenario failed:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("Ambiguous CRM scenario passed: submitted payload matches expected demo data.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
