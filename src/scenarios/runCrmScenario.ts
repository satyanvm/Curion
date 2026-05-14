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
  primary_contact: "Priya Shah",
  inbox: "priya.shah@acmecloud.io",
  line: "+91 9988776655",
  account: "Acme Cloud Systems",
  seat: "VP of Sales Operations",
  base: "42 Market Street",
  market: "Bengaluru",
  territory: "Karnataka",
  zone: "560001",
  geo: "India",
  profile: "https://www.linkedin.com/in/priyashah",
  source: "https://acmecloud.io",
  next_touch: "Email",
  context: "CRM demo lead interested in automating repetitive intake and qualification forms.",
  ok_to_proceed: "yes",
};

function formatFailures(payload: ExpectedPayload): string[] {
  return Object.entries(expectedPayload)
    .filter(([key, value]) => payload[key] !== value)
    .map(([key, value]) => `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(payload[key])}`);
}

async function main(): Promise<void> {
  const crmPath = path.resolve(process.cwd(), "demo", "crm.html");
  const profilePath = path.resolve(process.cwd(), "data", "crm-profile.json");
  const url = pathToFileURL(crmPath).toString();
  const profile = await loadUserProfile(profilePath);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const {
      fields,
      extractionSource,
      report: extractionReport,
      htmlAdequacyReport,
    } = await extractFormFields(page);
    const { mappedValues, report: mappingReport } = await mapFieldsWithConfidence(
      fields,
      profile,
      extractionReport,
      "CRM lead intake form"
    );
    const filledEntries = await fillForm(page, fields, mappedValues);

    await page.getByRole("button", { name: /submit/i }).click();
    await page.locator("#result.visible").waitFor({ state: "visible" });
    const rawPayload = await page.locator("#resultData").innerText();
    const payload = JSON.parse(rawPayload) as ExpectedPayload;
    const failures = formatFailures(payload);

    console.log(`CRM scenario page: ${url}`);
    console.log(`Extracted fields: ${fields.length}`);
    console.log(`Field extraction source: ${extractionSource}`);
    console.log(`Extraction confidence: ${extractionReport.overallScore.toFixed(2)}`);
    console.log(
      `HTML adequacy: ${htmlAdequacyReport.overallScore.toFixed(2)} (${htmlAdequacyReport.recommendedFallback})`
    );
    console.log(`Mapping confidence: ${mappingReport.overallScore.toFixed(2)}`);
    console.log(`Filled fields: ${filledEntries.length}`);
    console.table(
      filledEntries.map((entry) => ({
        label: entry.label,
        value: entry.value,
      }))
    );

    if (failures.length > 0) {
      console.error("CRM scenario failed:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("CRM scenario passed: submitted payload matches expected demo data.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
