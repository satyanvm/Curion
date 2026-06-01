import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Page, chromium } from "playwright";
import { extractFormFields } from "../browser/extractFormFields";
import { fillForm } from "../browser/fillForm";
import { mapFieldsWithConfidence } from "../llm/mapFields";
import { UserProfile } from "../types/types";
import { alternateProfile, baseProfile } from "./generatedProfiles";

type Scenario = {
  name: string;
  html: string;
  profile: UserProfile;
  expectedPayload: Record<string, string>;
  expectsVision?: boolean;
};

type RunOptions = {
  headed: boolean;
  inspect: boolean;
  pauseMs: number;
  scenarioName?: string;
};

function envBoolean(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || ""));
}

function runOptions(): RunOptions {
  const inspect = process.argv.includes("--inspect-form") || envBoolean("INSPECT_FORM");
  const headed = inspect || process.argv.includes("--headed") || envBoolean("HEADED") || envBoolean("SHOW_FORMS");
  const pauseArg = process.argv.find((arg) => arg.startsWith("--pause-ms="));
  const scenarioArg = process.argv.find((arg) => arg.startsWith("--scenario="));
  const pauseMs = Number(
    pauseArg?.split("=")[1] ||
      process.env.FORM_TEST_PAUSE_MS ||
      (inspect ? 0 : headed ? 2500 : 0)
  );

  return {
    headed,
    inspect,
    pauseMs: Number.isFinite(pauseMs) ? Math.max(0, pauseMs) : 0,
    scenarioName: scenarioArg?.split("=")[1] || process.env.FORM_TEST_SCENARIO,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #111; }
      form { display: grid; gap: 14px; max-width: 560px; }
      label, .row, .visual-field { display: grid; gap: 6px; }
      input, textarea, select { font: inherit; padding: 8px 10px; border: 1px solid #999; border-radius: 4px; }
      button { width: max-content; padding: 8px 14px; }
      .visual-field::before { content: attr(data-label); font-weight: 700; }
      #result { display: none; white-space: pre-wrap; }
      #result.visible { display: block; }
      .curion-test-report { margin-top: 36px; margin-bottom: 160px; border-top: 2px solid #111; padding-top: 20px; padding-bottom: 80px; max-width: 980px; }
      .curion-test-report h2 { margin: 0 0 12px; font-size: 20px; }
      .curion-test-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
      .curion-test-panel { border: 1px solid #bbb; border-radius: 6px; padding: 12px; background: #fafafa; }
      .curion-test-panel.is-wide { grid-column: 1 / -1; }
      .curion-test-panel h3 { margin: 0 0 8px; font-size: 14px; }
      .curion-test-panel pre { margin: 0; overflow: auto; white-space: pre-wrap; font-size: 12px; }
      .curion-test-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .curion-test-table th, .curion-test-table td { border: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top; }
      .curion-test-table th { background: #eee; }
      .curion-test-status { margin: 0 0 12px; font-weight: 700; }
    </style>
  </head>
  <body>
    ${body}
    <pre id="result"></pre>
    <script>
      document.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget).entries());
        const result = document.getElementById("result");
        result.textContent = JSON.stringify(data, null, 2);
        result.classList.add("visible");
      });
    </script>
  </body>
</html>`;
}

async function writeReportToPage(
  page: Page,
  report: Record<string, unknown>
): Promise<void> {
  await page.evaluate((reportData) => {
    const existing = document.getElementById("curion-test-report");
    existing?.remove();

    const root = document.createElement("section");
    root.id = "curion-test-report";
    root.className = "curion-test-report";

    const title = document.createElement("h2");
    title.textContent = "Curion test report";

    const status = document.createElement("p");
    status.className = "curion-test-status";
    status.textContent = String(reportData.status || "");

    const grid = document.createElement("div");
    grid.className = "curion-test-grid";

    const addPanel = (heading: string, value: unknown) => {
      const panel = document.createElement("div");
      panel.className = "curion-test-panel";
      const h3 = document.createElement("h3");
      h3.textContent = heading;
      const pre = document.createElement("pre");
      pre.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      panel.append(h3, pre);
      grid.append(panel);
    };

    addPanel("Profile data used to fill this form", reportData.profile);
    addPanel("Filled values", reportData.mappedValues);
    addPanel("Confidence and sources", reportData.summary);

    const mappingPanel = document.createElement("div");
    mappingPanel.className = "curion-test-panel";
    mappingPanel.classList.add("is-wide");
    const mappingTitle = document.createElement("h3");
    mappingTitle.textContent = "Per-field decisions";
    const table = document.createElement("table");
    table.className = "curion-test-table";
    table.innerHTML = "<thead><tr><th>Field</th><th>Value</th><th>Method</th><th>Score</th><th>LLM?</th></tr></thead>";
    const tbody = document.createElement("tbody");
    const rows = Array.isArray(reportData.fieldReports) ? reportData.fieldReports : [];
    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "No per-field decisions were returned by the mapper.";
      tr.append(td);
      tbody.append(tr);
    }
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const value of [row.label, row.mappedValue || "", row.method, row.score, row.shouldUseLLM ? "yes" : "no"]) {
        const td = document.createElement("td");
        td.textContent = String(value ?? "");
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    mappingPanel.append(mappingTitle, table);
    grid.append(mappingPanel);

    root.append(title, status, grid);
    document.body.append(root);
    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant" as ScrollBehavior,
      });
    });
  }, report);
}

const scenarios: Scenario[] = [
  {
    name: "clear-labels-contact",
    profile: baseProfile,
    expectedPayload: {
      full_name: baseProfile.name,
      email: baseProfile.email,
      phone: baseProfile.phone,
      company: baseProfile.company,
      role: baseProfile.jobTitle,
      terms: "yes",
    },
    html: pageShell(
      "Clear labels contact form",
      `<form>
        <label>Full name<input name="full_name" autocomplete="name" /></label>
        <label>Email<input name="email" type="email" autocomplete="email" /></label>
        <label>Phone<input name="phone" type="tel" autocomplete="tel" /></label>
        <label>Company<input name="company" autocomplete="organization" /></label>
        <label>Job title<input name="role" /></label>
        <label><input name="terms" type="checkbox" value="yes" /> I agree to the terms</label>
        <button type="submit">Submit</button>
      </form>`
    ),
  },
  {
    name: "nearby-text-with-missing-labels",
    profile: alternateProfile,
    expectedPayload: {
      f_101: alternateProfile.name,
      f_102: alternateProfile.email,
      f_103: alternateProfile.city,
      f_104: alternateProfile.preferredContactMethod,
      f_105: alternateProfile.notes,
    },
    html: pageShell(
      "Missing labels with visible nearby text",
      `<form>
        <div class="row"><span>Applicant name</span><input id="ctl101" name="f_101" /></div>
        <div class="row"><span>Best email address</span><input id="ctl102" name="f_102" type="email" /></div>
        <div class="row"><span>City or market</span><input id="ctl103" name="f_103" /></div>
        <div class="row"><span>Preferred contact method</span><select id="ctl104" name="f_104"><option></option><option>Email</option><option>Phone</option></select></div>
        <div class="row"><span>Notes for onboarding</span><textarea id="ctl105" name="f_105"></textarea></div>
        <button type="submit">Submit</button>
      </form>`
    ),
  },
  {
    name: "ambiguous-crm-data",
    profile: baseProfile,
    expectedPayload: {
      primary_contact: baseProfile.name,
      inbox: baseProfile.email,
      seat: baseProfile.jobTitle,
      source: baseProfile.website,
      context: baseProfile.notes,
    },
    html: pageShell(
      "Ambiguous CRM intake",
      `<form>
        <label>Primary contact<input name="primary_contact" /></label>
        <label>Best inbox<input name="inbox" type="email" /></label>
        <label>Current seat<input name="seat" /></label>
        <label>Source URL<input name="source" type="url" /></label>
        <label>Context<textarea name="context"></textarea></label>
        <button type="submit">Submit</button>
      </form>`
    ),
  },
  {
    name: "css-visual-labels-vision",
    profile: alternateProfile,
    expectsVision: true,
    expectedPayload: {
      q1: alternateProfile.name,
      q2: alternateProfile.email,
      q3: alternateProfile.phone,
      q4: alternateProfile.company,
    },
    html: pageShell(
      "CSS visual labels",
      `<form>
        <div class="visual-field" data-label="Full name"><input id="a1f3c9e2" name="q1" /></div>
        <div class="visual-field" data-label="Email address"><input id="b2f3c9e2" name="q2" type="email" /></div>
        <div class="visual-field" data-label="Phone number"><input id="c3f3c9e2" name="q3" type="tel" /></div>
        <div class="visual-field" data-label="Company"><input id="d4f3c9e2" name="q4" /></div>
        <button type="submit">Submit</button>
      </form>`
    ),
  },
];

function payloadFailures(expected: Record<string, string>, actual: Record<string, string>): string[] {
  return Object.entries(expected)
    .filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`);
}

async function runScenario(root: string, scenario: Scenario, options: RunOptions): Promise<void> {
  const filePath = path.join(root, `${scenario.name}.html`);
  await fs.writeFile(filePath, scenario.html, "utf8");

  const browser = await chromium.launch({
    headless: !options.headed,
    slowMo: options.headed ? 120 : 0,
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  try {
    await page.goto(pathToFileURL(filePath).toString(), { waitUntil: "domcontentloaded" });
    if (options.pauseMs > 0) await sleep(options.pauseMs);

    const extracted = await extractFormFields(page);
    const mapping = await mapFieldsWithConfidence(extracted.fields, scenario.profile, extracted.report, {
      formContext: scenario.name,
      page,
      deferredLlmExtraction: extracted.deferredLlmExtraction,
    });

    await writeReportToPage(page, {
      status: "Mapped. Filling form next.",
      profile: scenario.profile,
      mappedValues: mapping.mappedValues,
      summary: {
        scenario: scenario.name,
        fieldCount: mapping.fields.length,
        extractionSource: extracted.extractionSource,
        extractionConfidence: extracted.report.overallScore.toFixed(2),
        htmlAdequacy: extracted.htmlAdequacyReport.htmlAdequacyScore.toFixed(2),
        htmlFallback: extracted.htmlAdequacyReport.recommendedFallback,
        mappingConfidence: mapping.report.overallScore.toFixed(2),
        llmUsedForExtraction: extracted.extractionSource.includes("llm") || extracted.extractionSource.includes("vision"),
        llmUsedForMapping: mapping.report.fieldReports.some((report) => report.method === "llm" || report.shouldUseLLM),
      },
      fieldReports: mapping.report.fieldReports.map((report) => ({
        label: report.label,
        mappedValue: report.mappedValue,
        method: report.method,
        score: report.score.toFixed(2),
        shouldUseLLM: report.shouldUseLLM,
      })),
    });

    if (options.pauseMs > 0) await sleep(options.pauseMs);
    const filledEntries = await fillForm(page, mapping.fields, mapping.mappedValues);
    await writeReportToPage(page, {
      status: "Form filled. Submitting next.",
      profile: scenario.profile,
      mappedValues: mapping.mappedValues,
      summary: {
        scenario: scenario.name,
        filledCount: filledEntries.length,
        extractionSource: extracted.extractionSource,
        extractionConfidence: extracted.report.overallScore.toFixed(2),
        mappingConfidence: mapping.report.overallScore.toFixed(2),
        llmUsedForExtraction: extracted.extractionSource.includes("llm") || extracted.extractionSource.includes("vision"),
        llmUsedForMapping: mapping.report.fieldReports.some((report) => report.method === "llm" || report.shouldUseLLM),
      },
      fieldReports: mapping.report.fieldReports.map((report) => ({
        label: report.label,
        mappedValue: report.mappedValue,
        method: report.method,
        score: report.score.toFixed(2),
        shouldUseLLM: report.shouldUseLLM,
      })),
    });
    if (options.pauseMs > 0) await sleep(options.pauseMs);

    await page.getByRole("button", { name: /submit/i }).click();
    await page.locator("#result.visible").waitFor({ state: "visible" });
    if (options.pauseMs > 0) await sleep(options.pauseMs);

    const payload = JSON.parse(await page.locator("#result").innerText()) as Record<string, string>;
    const failures = payloadFailures(scenario.expectedPayload, payload);
    await writeReportToPage(page, {
      status: failures.length > 0 ? "Submitted with mismatches." : "Submitted successfully. Browser will stay open.",
      profile: scenario.profile,
      mappedValues: mapping.mappedValues,
      summary: {
        scenario: scenario.name,
        submittedPayload: payload,
        filledCount: filledEntries.length,
        extractionSource: extracted.extractionSource,
        extractionConfidence: extracted.report.overallScore.toFixed(2),
        htmlAdequacy: extracted.htmlAdequacyReport.htmlAdequacyScore.toFixed(2),
        htmlFallback: extracted.htmlAdequacyReport.recommendedFallback,
        mappingConfidence: mapping.report.overallScore.toFixed(2),
        llmUsedForExtraction: extracted.extractionSource.includes("llm") || extracted.extractionSource.includes("vision"),
        llmUsedForMapping: mapping.report.fieldReports.some((report) => report.method === "llm" || report.shouldUseLLM),
        failures,
      },
      fieldReports: mapping.report.fieldReports.map((report) => ({
        label: report.label,
        mappedValue: report.mappedValue,
        method: report.method,
        score: report.score.toFixed(2),
        shouldUseLLM: report.shouldUseLLM,
      })),
    });

    console.log(
      [
        `${scenario.name}:`,
        `fields=${mapping.fields.length}`,
        `filled=${filledEntries.length}`,
        `extraction=${extracted.extractionSource}`,
        `mapping=${mapping.report.overallScore.toFixed(2)}`,
      ].join(" ")
    );

    if (scenario.expectsVision && extracted.extractionSource !== "dom+vision") {
      failures.push(`expected vision extraction, got ${extracted.extractionSource}`);
    }

    if (failures.length > 0) {
      throw new Error(`${scenario.name} failed\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    }
    if (options.inspect) {
      console.log(`Keeping browser open for scenario "${scenario.name}". Press Ctrl+C in the terminal when done.`);
      await new Promise(() => undefined);
    }
  } finally {
    if (!options.inspect) {
      await browser.close();
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY && !process.env.CURION_LLM_API_KEY) {
    throw new Error("OPENAI_API_KEY or CURION_LLM_API_KEY is required for generated LLM fallback scenarios");
  }

  process.env.CURION_BACKEND_API_URL = "local-openai";
  const options = runOptions();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "curion-generated-form-scenarios-"));
  console.log(`Generated scenario forms: ${root}`);
  if (options.headed) {
    console.log(`Showing forms in headed Chromium with ${options.pauseMs}ms pauses.`);
  }

  const selectedScenarios = options.inspect
    ? [scenarios.find((scenario) => scenario.name === options.scenarioName) || scenarios[0]]
    : options.scenarioName
      ? scenarios.filter((scenario) => scenario.name === options.scenarioName)
      : scenarios;

  for (const scenario of selectedScenarios) {
    await runScenario(root, scenario, options);
  }

  console.log(`Generated form scenarios passed: ${selectedScenarios.length}/${selectedScenarios.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
