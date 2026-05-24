import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";

type NavLink = {
  href: string;
  label: string;
};

type Feature = {
  index: string;
  title: string;
  body: string;
};

const brandMarkSrc = "/curion-mark.png";
const installHref = "./install.html";
const homeHref = "./index.html";

const homeNavLinks: NavLink[] = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#preview", label: "Preview" },
  { href: installHref, label: "Install" }
];

const installNavLinks: NavLink[] = [
  { href: `${homeHref}#features`, label: "Features" },
  { href: `${homeHref}#how-it-works`, label: "How it works" },
  { href: `${homeHref}#preview`, label: "Preview" },
  { href: "#install-steps", label: "Steps" }
];

const features: Feature[] = [
  {
    index: "01",
    title: "Automatic form filling",
    body: "Common fields are completed from your stored profile with a single action."
  },
  {
    index: "02",
    title: "Context-aware autofill",
    body: "Labels, placeholders, and page structure guide how each answer is chosen."
  },
  {
    index: "03",
    title: "Time saving",
    body: "Repetitive applications, onboarding forms, and profiles move faster."
  },
  {
    index: "04",
    title: "Secure local data usage",
    body: "Your saved context stays explicit, reviewable, and easy to update."
  }
];

const processSteps = [
  {
    step: "1",
    title: "Save your data once",
    body: "Add the reusable details you want Curion to reference across forms."
  },
  {
    step: "2",
    title: "AI detects forms",
    body: "Curion reads field labels, inputs, and layout signals from the current page."
  },
  {
    step: "3",
    title: "Automatically fills intelligently",
    body: "Confident fields are filled, while uncertain matches stay available for review."
  }
];

const installHighlights = [
  {
    label: "ZIP",
    title: "Download the package",
    body: "Get the latest Curion extension bundle from the install page."
  },
  {
    label: "DEV",
    title: "Enable Developer mode",
    body: "Open Chrome extensions and turn on the developer toggle."
  },
  {
    label: "LOAD",
    title: "Load unpacked",
    body: "Select the extracted Curion folder and start using the popup."
  }
];

const installSteps = [
  {
    step: "1",
    title: "Download the ZIP",
    body: "Use the download button on this page and save the Curion package."
  },
  {
    step: "2",
    title: "Unzip the package",
    body: (
      <>
        Extract it so you have a normal folder containing <code>manifest.json</code>.
      </>
    )
  },
  {
    step: "3",
    title: "Open Chrome extensions",
    body: (
      <>
        Open a new tab and go to <code>chrome://extensions</code>.
      </>
    )
  },
  {
    step: "4",
    title: "Enable Developer mode",
    body: "Turn on the Developer mode switch in the top-right of the extensions page."
  },
  {
    step: "5",
    title: "Click Load unpacked",
    body: (
      <>
        In Chrome Extensions, click <strong className="chrome-action">Load unpacked</strong>,
        select the extracted Curion folder, then confirm the extension appears in Chrome.
      </>
    )
  },
  {
    step: "6",
    title: "Set up your profile",
    body: "Pin Curion, open Options, add your saved metadata, then use the popup on form pages."
  }
];

const postInstallItems = [
  {
    title: "Options",
    body: "Add your profile fields, backend profile user ID, and fill behavior."
  },
  {
    title: "Scan",
    body: "Open any form page and use the Curion popup to detect fields."
  },
  {
    title: "Review",
    body: "Fill confident matches and review uncertain fields before submitting."
  }
];

const savedContextRows = [
  ["Name", "Satya Narayan Verma"],
  ["Email", "satya@example.com"],
  ["Role", "Automation engineer"],
  ["Address", "Primary saved address"]
];

const detectedRows = [
  ["Full name", "Filled", "is-complete"],
  ["Email address", "Filled", "is-complete"],
  ["Company", "Review", "is-review"],
  ["Mailing address", "Filled", "is-complete"]
];

function extensionDownloadHref() {
  const localHosts = new Set(["", "localhost", "127.0.0.1"]);

  if (window.location.protocol === "file:") {
    return "./curion-extension.zip";
  }

  if (localHosts.has(window.location.hostname)) {
    return "/curion-extension.zip";
  }

  return "/api/extension/download";
}

function useRevealOnScroll() {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");

    if (!("IntersectionObserver" in window)) {
      targets.forEach((element) => {
        element.classList.add("is-visible");
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14 }
    );

    targets.forEach((element) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);
}

function Header({ links, brandHref }: { links: NavLink[]; brandHref: string }) {
  return (
    <header className="site-header" aria-label="Primary navigation">
      <a className="brand" href={brandHref} aria-label="Curion home">
        <img className="brand-mark" src={brandMarkSrc} alt="" aria-hidden="true" />
        <span>Curion</span>
      </a>
      <nav className="nav-links" aria-label="Page sections">
        {links.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <p>Made with love by Satya Narayan Verma</p>
      <div className="social-links" aria-label="Social links">
        <a href="https://x.com/satyaxtwt" target="_blank" rel="noreferrer">
          X
        </a>
        <a href="https://www.linkedin.com/in/satyanvm/" target="_blank" rel="noreferrer">
          LinkedIn
        </a>
      </div>
    </footer>
  );
}

function ButtonLink({
  href,
  children,
  variant = "primary",
  download
}: {
  href: string;
  children: string;
  variant?: "primary" | "secondary";
  download?: string;
}) {
  return (
    <a className={`button button-${variant}`} href={href} download={download}>
      {children}
    </a>
  );
}

function HomePage() {
  useRevealOnScroll();

  return (
    <>
      <Header links={homeNavLinks} brandHref="#top" />
      <main id="top">
        <section className="hero section-shell">
          <div className="hero-copy">
            <p className="eyebrow">Browser extension for precise autofill</p>
            <h1>Curion</h1>
            <p className="hero-tagline">
              Curion fills forms for you using the context you have already saved,
              so every repetitive field becomes one click closer to done.
            </p>
            <div className="hero-actions" aria-label="Primary actions">
              <ButtonLink href={installHref}>Install Extension</ButtonLink>
              <ButtonLink href="#how-it-works" variant="secondary">
                How it works
              </ButtonLink>
            </div>
          </div>
          <HeroVisual />
        </section>

        <FeatureBand />
        <ProcessSection />
        <PreviewBand />
        <HomeInstallSection />
      </main>
      <Footer />
    </>
  );
}

function HeroVisual() {
  return (
    <div className="hero-visual" aria-label="Curion extension filling a form preview">
      <div className="browser-frame">
        <div className="browser-bar" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <div className="address">forms.example/apply</div>
        </div>
        <div className="browser-content">
          <form className="mock-form" aria-label="Example application form">
            <div className="form-head">
              <span>Application details</span>
              <span className="status-pill">Curion active</span>
            </div>
            <label>
              Full name
              <span className="filled-field">Satya Narayan Verma</span>
            </label>
            <label>
              Email
              <span className="filled-field">satya@example.com</span>
            </label>
            <label>
              Company
              <span className="filled-field muted-fill">Waiting for confirmation</span>
            </label>
            <label>
              Address
              <span className="filled-field">Saved home address</span>
            </label>
          </form>

          <aside className="extension-panel" aria-label="Curion extension panel">
            <div className="panel-title">
              <span>Curion</span>
              <span className="signal-dot" aria-hidden="true"></span>
            </div>
            <div className="context-block">
              <p>Saved context</p>
              <span>Name, email, address, work profile</span>
            </div>
            <div className="field-list" aria-label="Autofill status">
              <span>
                <strong>4</strong> fields detected
              </span>
              <span>
                <strong>3</strong> ready to fill
              </span>
              <span>
                <strong>1</strong> needs review
              </span>
            </div>
            <button className="mini-button" type="button">
              Fill verified fields
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FeatureBand() {
  return (
    <section className="feature-band" id="features" aria-labelledby="features-title">
      <div className="section-shell split-heading">
        <div>
          <p className="eyebrow">Built for repeat forms</p>
          <h2 id="features-title">Fast autofill without giving up control.</h2>
        </div>
        <p>
          Curion keeps the workflow compact: detect fields, map saved context,
          fill what is confident, and leave uncertain details visible for review.
        </p>
      </div>
      <div className="section-shell feature-grid">
        {features.map((feature) => (
          <article key={feature.index} className="feature-row reveal-on-scroll" data-reveal>
            <span className="feature-index">{feature.index}</span>
            <div>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProcessSection() {
  return (
    <section className="section-shell process-section" id="how-it-works" aria-labelledby="process-title">
      <p className="eyebrow">How it works</p>
      <h2 id="process-title">A direct extension workflow.</h2>
      <div className="process-track">
        {processSteps.map((item) => (
          <article key={item.step} className="reveal-on-scroll" data-reveal>
            <span>{item.step}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PreviewBand() {
  return (
    <section className="preview-band" id="preview" aria-labelledby="preview-title">
      <div className="section-shell preview-layout">
        <div className="preview-copy">
          <p className="eyebrow">Extension preview</p>
          <h2 id="preview-title">Saved context applied where the form actually needs it.</h2>
          <p>
            The extension panel stays narrow and practical. It shows source context,
            match confidence, and the exact fields Curion is ready to complete.
          </p>
        </div>
        <div
          className="autofill-preview reveal-on-scroll"
          aria-label="Detailed Curion autofill mockup"
          data-reveal
        >
          <div className="preview-toolbar">
            <span>Checkout profile</span>
            <span>Review mode</span>
          </div>
          <div className="preview-grid">
            <div className="context-card">
              <h3>Saved user context</h3>
              <dl>
                {savedContextRows.map(([term, value]) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="detected-card">
              <h3>Detected form fields</h3>
              {detectedRows.map(([label, state, className]) => (
                <div key={label} className={`detected-row ${className}`}>
                  <span>{label}</span>
                  <strong>{state}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HomeInstallSection() {
  return (
    <section className="section-shell install-section" id="install" aria-labelledby="install-title">
      <div className="install-copy">
        <p className="eyebrow">Install Curion</p>
        <h2 id="install-title">Open the guided install page for the ZIP and setup steps.</h2>
        <p>
          Curion is installed manually as an unpacked Chrome extension. The install
          page gives you the package download and the exact browser steps.
        </p>
        <div className="hero-actions" aria-label="Installation actions">
          <ButtonLink href={installHref}>Open Install Page</ButtonLink>
          <ButtonLink href={`${installHref}#install-steps`} variant="secondary">
            View Steps
          </ButtonLink>
        </div>
      </div>
      <div className="install-highlights" aria-label="Install flow summary">
        {installHighlights.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function InstallPage() {
  const downloadHref = extensionDownloadHref();

  return (
    <>
      <Header links={installNavLinks} brandHref={homeHref} />
      <main id="top" className="install-page">
        <section className="section-shell install-hero">
          <div className="install-hero-copy">
            <a className="back-link" href={homeHref}>
              Back to Curion
            </a>
            <p className="eyebrow">Manual Chrome install</p>
            <h1>Install Curion</h1>
            <p className="hero-tagline">
              Download the extension package, unzip it, then load the extracted
              folder from Chrome extensions.
            </p>
            <div className="hero-actions" aria-label="Download actions">
              <ButtonLink href={downloadHref} download="curion-extension.zip">
                Download Extension ZIP
              </ButtonLink>
              <ButtonLink href="#install-steps" variant="secondary">
                Read Steps
              </ButtonLink>
            </div>
          </div>
          <DownloadPanel downloadHref={downloadHref} />
        </section>

        <InstallGuide />
        <PostInstallSection />
      </main>
      <Footer />
    </>
  );
}

function DownloadPanel({ downloadHref }: { downloadHref: string }) {
  return (
    <aside className="download-panel" aria-label="Extension package details">
      <div className="package-icon" aria-hidden="true">
        <img src={brandMarkSrc} alt="" />
      </div>
      <div>
        <p className="package-label">Package</p>
        <h2>curion-extension.zip</h2>
      </div>
      <dl className="package-meta">
        <div>
          <dt>Browser</dt>
          <dd>Chrome or Chromium</dd>
        </div>
        <div>
          <dt>Install type</dt>
          <dd>Load unpacked</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd>Manual package refresh</dd>
        </div>
      </dl>
      <ButtonLink href={downloadHref} variant="secondary" download="curion-extension.zip">
        Download ZIP
      </ButtonLink>
    </aside>
  );
}

function InstallGuide() {
  return (
    <section className="install-guide-band" id="install-steps" aria-labelledby="install-steps-title">
      <div className="section-shell install-guide-layout">
        <div className="install-guide-copy">
          <p className="eyebrow">Setup steps</p>
          <h2 id="install-steps-title">Load the extension unpacked.</h2>
          <p>
            Chrome needs the extracted folder, not the ZIP file itself. Keep that
            folder somewhere stable so the extension can keep loading.
          </p>
        </div>
        <ol className="install-steps" aria-label="Chrome install steps">
          {installSteps.map((item) => (
            <li key={item.step} className="install-step install-page-step">
              <span>{item.step}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function PostInstallSection() {
  return (
    <section className="section-shell post-install-section" aria-labelledby="post-install-title">
      <div>
        <p className="eyebrow">After install</p>
        <h2 id="post-install-title">Use it from the extension popup.</h2>
      </div>
      <div className="post-install-grid">
        {postInstallItems.map((item) => (
          <article key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function App() {
  const page = document.body.dataset.page === "install" ? "install" : "home";
  return page === "install" ? <InstallPage /> : <HomePage />;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Curion root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
