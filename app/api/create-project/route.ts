import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateProjectRequest = {
  action?: "ensureStaticJs" | "deleteGeneratedProject";
  allowLegacyPayfixProject?: boolean;
  parentPath?: string;
  folderName?: string;
  targetPath?: string;
  stack?: string;
  prompt?: string;
  sourceMessage?: string;
};

const PAYFIX_GENERATED_MARKER = ".payfix-generated-project.json";

type ProjectFile = {
  file: string;
  content: string;
};

function slugify(value: string, fallback = "payfix-generated-app") {
  const slug = value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || fallback;
}

function inferProjectName(text: string) {
  const normalized = text.toLowerCase();
  if (/\blog\s*in|login|sign\s*up|signup|auth|authentication|register|registration\b/.test(normalized)) return "auth-page";
  if (/\binventory|stock|purchase order|sku|warehouse\b/.test(normalized)) return "inventory-dashboard";
  if (/\bcheckout|payment|payfix|terminal|transaction\b/.test(normalized)) return "payment-ops-dashboard";
  if (/\bmap|journey|flow|diagram|architecture\b/.test(normalized)) return "app-flow-map";
  if (/\bcrm|customer|sales|pipeline\b/.test(normalized)) return "crm-workspace";
  if (/\bbooking|calendar|schedule\b/.test(normalized)) return "booking-dashboard";
  return "sketch-to-app";
}

function inferTitle(text: string) {
  const normalized = text.toLowerCase();
  if (/\blog\s*in|login|sign\s*up|signup|auth|authentication|register|registration\b/.test(normalized)) return "Welcome Back";
  if (/\binventory|stock|purchase order|sku|warehouse\b/.test(normalized)) return "Inventory Command Center";
  if (/\bcheckout|payment|payfix|terminal|transaction\b/.test(normalized)) return "Payment Operations Hub";
  if (/\bmap|journey|flow|diagram|architecture\b/.test(normalized)) return "Application Flow Map";
  if (/\bcrm|customer|sales|pipeline\b/.test(normalized)) return "Customer Pipeline Studio";
  if (/\bbooking|calendar|schedule\b/.test(normalized)) return "Booking Control Room";
  return "Generated Product Workspace";
}

function isAuthProject(text: string) {
  return /\blog\s*in|login|sign\s*up|signup|auth|authentication|register|registration|forgot password|remember me\b/i.test(text);
}

function inferFeatures(text: string) {
  const normalized = text.toLowerCase();
  if (/\binventory|stock|purchase order|sku|warehouse\b/.test(normalized)) {
    return {
      cards: ["Total SKUs", "Low stock", "Incoming POs", "Stock value"],
      nav: ["Dashboard", "Inventory", "Purchase Orders", "Suppliers", "Reports"],
      alerts: ["Out of stock", "Reorder soon", "Late supplier ETA"],
      table: ["SKU", "Item", "On hand", "Incoming", "Reorder", "Status"],
    };
  }

  if (/\bcheckout|payment|payfix|terminal|transaction\b/.test(normalized)) {
    return {
      cards: ["Approved", "Declines", "Gateway latency", "Open cases"],
      nav: ["Overview", "Transactions", "Devices", "Webhooks", "Alerts"],
      alerts: ["Issuer decline spike", "Webhook retry", "Terminal offline"],
      table: ["Time", "Transaction", "Gateway", "Amount", "Status", "Action"],
    };
  }

  return {
    cards: ["Active items", "Needs review", "In progress", "Completed"],
    nav: ["Overview", "Workspace", "Tasks", "Reports", "Settings"],
    alerts: ["High priority", "Waiting on input", "Ready to ship"],
    table: ["Name", "Owner", "Priority", "Progress", "Status", "Action"],
  };
}

function dashboardMarkup(title: string, text: string) {
  const features = inferFeatures(text);
  const rows = [
    ["SKU-1048", "Core product", "128", "44", "80", "Healthy"],
    ["SKU-2201", "Fast mover", "18", "60", "30", "Reorder"],
    ["SKU-3340", "Seasonal item", "0", "24", "20", "Out"],
    ["SKU-4182", "Warehouse pick", "76", "0", "45", "Healthy"],
  ];

  return {
    title,
    cards: features.cards,
    nav: features.nav,
    alerts: features.alerts,
    table: features.table,
    rows,
  };
}

function authCopy(text: string) {
  const wantsSignup = /\bsign\s*up|signup|register|registration|create account\b/i.test(text);
  return {
    eyebrow: wantsSignup ? "Start your account" : "Secure access",
    title: wantsSignup ? "Create your account" : "Welcome back",
    subtitle: wantsSignup
      ? "Set up your workspace with a clean sign-up flow, social login options, and a focused onboarding panel."
      : "Sign in to continue to your workspace with a polished, responsive authentication screen.",
    primaryAction: wantsSignup ? "Create account" : "Sign in",
    secondaryAction: wantsSignup ? "Already have an account? Sign in" : "Need an account? Sign up",
    sideTitle: wantsSignup ? "Launch faster with a clean first impression." : "Everything important, one login away.",
    sideItems: ["Responsive auth layout", "Clear validation states", "Social sign-in ready", "Accessible form controls"],
  };
}

function authNextProjectFiles(title: string, text: string): ProjectFile[] {
  const copy = authCopy(text);
  return [
    {
      file: "package.json",
      content: JSON.stringify(
        {
          scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
          dependencies: {
            "@types/node": "latest",
            "@types/react": "latest",
            "@types/react-dom": "latest",
            next: "latest",
            react: "latest",
            "react-dom": "latest",
            typescript: "latest",
          },
          devDependencies: {},
        },
        null,
        2,
      ),
    },
    {
      file: "app/layout.tsx",
      content: `import "./globals.css";

export const metadata = {
  title: "${copy.title}",
  description: "Generated auth screen from a PayFix sketch.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    },
    {
      file: "app/page.tsx",
      content: `const benefits = ${JSON.stringify(copy.sideItems, null, 2)};

export default function Page() {
  return (
    <main className="authShell">
      <section className="brandPanel">
        <div className="brandMark">A</div>
        <div>
          <p className="eyebrow">${copy.eyebrow}</p>
          <h1>${copy.sideTitle}</h1>
          <p className="lead">${copy.subtitle}</p>
        </div>
        <div className="benefits">
          {benefits.map((item) => (
            <div key={item} className="benefit">
              <span />
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="formPanel">
        <div className="formCard">
          <p className="eyebrow">${copy.eyebrow}</p>
          <h2>${copy.title}</h2>
          <p className="muted">${copy.subtitle}</p>

          <div className="socialRow">
            <button>Google</button>
            <button>GitHub</button>
          </div>

          <div className="divider"><span>or use email</span></div>

          <form>
            ${/\bsign\s*up|signup|register|registration|create account\b/i.test(text) ? `<label>
              Full name
              <input placeholder="Alex Morgan" />
            </label>` : ""}
            <label>
              Email
              <input type="email" placeholder="you@example.com" />
            </label>
            <label>
              Password
              <input type="password" placeholder="••••••••" />
            </label>
            <div className="formMeta">
              <label className="check"><input type="checkbox" /> Remember me</label>
              <a href="#">Forgot password?</a>
            </div>
            <button className="primary" type="button">${copy.primaryAction}</button>
          </form>

          <button className="switcher">${copy.secondaryAction}</button>
        </div>
      </section>
    </main>
  );
}
`,
    },
    { file: "app/globals.css", content: authCss() },
    {
      file: "tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2017",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"],
        },
        null,
        2,
      ),
    },
    { file: "next.config.ts", content: "import type { NextConfig } from \"next\";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n" },
    { file: "README.md", content: `# ${copy.title}\n\nGenerated by PayFix from the current auth sketch/design handoff.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` },
  ];
}

function authCss() {
  return `* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #08111f; color: #0f172a; }
button, input { font: inherit; }
button { cursor: pointer; }
.authShell { min-height: 100vh; display: grid; grid-template-columns: minmax(320px, .9fr) minmax(360px, 1.1fr); background: radial-gradient(circle at 15% 20%, rgba(56,189,248,.28), transparent 30%), linear-gradient(135deg, #07111f 0%, #0e1b2d 46%, #edf5ff 46%, #f8fbff 100%); }
.brandPanel { min-height: 100vh; padding: 44px; color: white; display: flex; flex-direction: column; justify-content: space-between; gap: 36px; }
.brandMark { width: 54px; height: 54px; display: grid; place-items: center; border-radius: 14px; background: #38bdf8; color: #07111f; font-weight: 950; font-size: 24px; box-shadow: 0 18px 40px rgba(56,189,248,.25); }
.eyebrow { margin: 0 0 12px; color: #0ea5e9; font-size: 12px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
.brandPanel .eyebrow { color: #7dd3fc; }
h1, h2 { margin: 0; line-height: 1; letter-spacing: 0; }
h1 { max-width: 620px; font-size: 56px; }
h2 { font-size: 34px; color: #0f172a; }
.lead { max-width: 560px; color: #cbd5e1; font-size: 17px; line-height: 1.7; font-weight: 650; }
.benefits { display: grid; gap: 12px; }
.benefit { display: flex; align-items: center; gap: 12px; color: #e2e8f0; font-weight: 800; }
.benefit span { width: 10px; height: 10px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 0 6px rgba(56,189,248,.12); }
.formPanel { display: grid; place-items: center; padding: 36px; }
.formCard { width: min(100%, 460px); border: 1px solid #dbeafe; border-radius: 8px; background: rgba(255,255,255,.92); padding: 34px; box-shadow: 0 24px 80px rgba(15,23,42,.16); backdrop-filter: blur(16px); }
.muted { margin: 12px 0 0; color: #64748b; line-height: 1.6; font-weight: 650; }
.socialRow { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; }
.socialRow button, .switcher { height: 44px; border: 1px solid #dbe3ef; border-radius: 8px; background: white; color: #0f172a; font-weight: 900; }
.divider { display: flex; align-items: center; gap: 12px; margin: 24px 0; color: #94a3b8; font-size: 12px; font-weight: 900; text-transform: uppercase; }
.divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: #e2e8f0; }
form { display: grid; gap: 16px; }
label { display: grid; gap: 7px; color: #334155; font-size: 13px; font-weight: 900; }
input { height: 46px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 13px; color: #0f172a; background: white; outline: none; }
input:focus { border-color: #0ea5e9; box-shadow: 0 0 0 4px rgba(14,165,233,.14); }
.formMeta { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.check { display: flex; grid-template-columns: none; grid-auto-flow: column; align-items: center; justify-content: start; color: #64748b; }
.check input { width: 16px; height: 16px; }
a { color: #0ea5e9; font-weight: 900; text-decoration: none; }
.primary { height: 48px; border: 0; border-radius: 8px; background: #0f172a; color: white; font-weight: 950; box-shadow: 0 14px 34px rgba(15,23,42,.24); }
.primary:hover { background: #1e293b; }
.switcher { margin-top: 16px; width: 100%; color: #2563eb; }
@media (max-width: 860px) {
  .authShell { grid-template-columns: 1fr; background: #f8fbff; }
  .brandPanel { min-height: auto; padding: 28px; background: #07111f; }
  h1 { font-size: 38px; }
  .formPanel { padding: 20px; }
  .formCard { padding: 24px; }
}
`;
}

function authViteProjectFiles(title: string, text: string): ProjectFile[] {
  const copy = authCopy(text);
  return [
    {
      file: "package.json",
      content: JSON.stringify(
        {
          scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
          dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", react: "latest", "react-dom": "latest" },
          devDependencies: {},
        },
        null,
        2,
      ),
    },
    { file: "index.html", content: `<!doctype html>\n<html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${copy.title}</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n` },
    {
      file: "src/main.jsx",
      content: `import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const benefits = ${JSON.stringify(copy.sideItems)};

function App() {
  return (
    <main className="authShell">
      <section className="brandPanel">
        <div className="brandMark">A</div>
        <div><p className="eyebrow">${copy.eyebrow}</p><h1>${copy.sideTitle}</h1><p className="lead">${copy.subtitle}</p></div>
        <div className="benefits">{benefits.map((item) => <div key={item} className="benefit"><span />{item}</div>)}</div>
      </section>
      <section className="formPanel">
        <div className="formCard">
          <p className="eyebrow">${copy.eyebrow}</p><h2>${copy.title}</h2><p className="muted">${copy.subtitle}</p>
          <div className="socialRow"><button>Google</button><button>GitHub</button></div>
          <div className="divider"><span>or use email</span></div>
          <form>
            ${/\bsign\s*up|signup|register|registration|create account\b/i.test(text) ? `<label>Full name<input placeholder="Alex Morgan" /></label>` : ""}
            <label>Email<input type="email" placeholder="you@example.com" /></label>
            <label>Password<input type="password" placeholder="••••••••" /></label>
            <div className="formMeta"><label className="check"><input type="checkbox" /> Remember me</label><a href="#">Forgot password?</a></div>
            <button className="primary" type="button">${copy.primaryAction}</button>
          </form>
          <button className="switcher">${copy.secondaryAction}</button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
`,
    },
    { file: "src/styles.css", content: authCss() },
    { file: "README.md", content: `# ${copy.title}\n\nGenerated by PayFix from the current auth sketch/design handoff.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` },
  ];
}

function authStaticProjectFiles(title: string, text: string): ProjectFile[] {
  const copy = authCopy(text);
  return [
    {
      file: "index.html",
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${copy.title}</title>
    <link rel="stylesheet" href="./styles.css" />
    <script defer src="./app.js"></script>
  </head>
  <body>
    <main class="authShell">
      <section class="brandPanel">
        <div class="brandMark">A</div>
        <div><p class="eyebrow">${copy.eyebrow}</p><h1>${copy.sideTitle}</h1><p class="lead">${copy.subtitle}</p></div>
        <div class="benefits">${copy.sideItems.map((item) => `<div class="benefit"><span></span>${item}</div>`).join("")}</div>
      </section>
      <section class="formPanel">
        <div class="formCard">
          <p class="eyebrow">${copy.eyebrow}</p><h2>${copy.title}</h2><p class="muted">${copy.subtitle}</p>
          <div class="socialRow"><button>Google</button><button>GitHub</button></div>
          <div class="divider"><span>or use email</span></div>
          <form>
            ${/\bsign\s*up|signup|register|registration|create account\b/i.test(text) ? `<label>Full name<input placeholder="Alex Morgan" /></label>` : ""}
            <label>Email<input type="email" placeholder="you@example.com" /></label>
            <label>Password<input type="password" placeholder="••••••••" /></label>
            <div class="formMeta"><label class="check"><input type="checkbox" /> Remember me</label><a href="#">Forgot password?</a></div>
            <button class="primary" type="button">${copy.primaryAction}</button>
          </form>
          <button class="switcher">${copy.secondaryAction}</button>
        </div>
      </section>
    </main>
  </body>
</html>
`,
    },
    { file: "styles.css", content: authCss() },
    { file: "app.js", content: staticInteractionJs() },
    { file: "README.md", content: `# ${copy.title}\n\nOpen \`index.html\` in your browser.\n` },
  ];
}

function staticInteractionJs() {
  return `const form = document.querySelector("form");
const primary = document.querySelector(".primary");
const switcher = document.querySelector(".switcher");

if (form) {
  form.addEventListener("submit", (event) => event.preventDefault());
}

if (primary) {
  primary.addEventListener("click", () => {
    primary.textContent = "Checking...";
    window.setTimeout(() => {
      primary.textContent = "Ready";
    }, 700);
  });
}

if (switcher) {
  switcher.addEventListener("click", () => {
    const title = document.querySelector("h2");
    if (!title) return;
    const isSignup = /create/i.test(title.textContent || "");
    title.textContent = isSignup ? "Welcome back" : "Create your account";
    switcher.textContent = isSignup ? "Need an account? Sign up" : "Already have an account? Sign in";
  });
}
`;
}

function nextProjectFiles(title: string, text: string): ProjectFile[] {
  const model = dashboardMarkup(title, text);

  return [
    {
      file: "package.json",
      content: JSON.stringify(
        {
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "next lint",
          },
          dependencies: {
            "@types/node": "latest",
            "@types/react": "latest",
            "@types/react-dom": "latest",
            next: "latest",
            react: "latest",
            "react-dom": "latest",
            typescript: "latest",
          },
          devDependencies: {},
        },
        null,
        2,
      ),
    },
    {
      file: "app/layout.tsx",
      content: `import "./globals.css";

export const metadata = {
  title: "${model.title}",
  description: "Generated from a PayFix sketch.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    },
    {
      file: "app/page.tsx",
      content: `const cards = ${JSON.stringify(model.cards, null, 2)};
const nav = ${JSON.stringify(model.nav, null, 2)};
const alerts = ${JSON.stringify(model.alerts, null, 2)};
const table = ${JSON.stringify(model.table, null, 2)};
const rows = ${JSON.stringify(model.rows, null, 2)};

export default function Page() {
  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">PF</div>
        {nav.map((item) => <button key={item}>{item}</button>)}
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p>Live workspace</p>
            <h1>${model.title}</h1>
          </div>
          <button className="primary">New item</button>
        </header>
        <section className="cards">
          {cards.map((card, index) => (
            <article key={card}>
              <span>{card}</span>
              <strong>{[1248, 17, 42, "$284k"][index]}</strong>
            </article>
          ))}
        </section>
        <section className="grid">
          <div className="panel chart">
            <div className="panelTitle">Stock movement</div>
            <div className="bars">{[42, 58, 31, 70, 64, 86, 78].map((height) => <i key={height} style={{ height: \`\${height}%\` }} />)}</div>
          </div>
          <div className="panel">
            <div className="panelTitle">Alerts</div>
            {alerts.map((alert) => <div className="alert" key={alert}>{alert}<button>Review</button></div>)}
          </div>
        </section>
        <section className="panel table">
          <div className="panelTitle">Inventory list</div>
          <div className="thead">{table.map((cell) => <span key={cell}>{cell}</span>)}</div>
          {rows.map((row) => <div className="trow" key={row[0]}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>)}
        </section>
      </section>
    </main>
  );
}
`,
    },
    {
      file: "app/globals.css",
      content: `* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; font-family: Inter, Arial, sans-serif; background: #eef3f8; color: #0f172a; }
button { font: inherit; cursor: pointer; }
.shell { min-height: 100vh; display: grid; grid-template-columns: 238px 1fr; }
.rail { background: #0f172a; color: white; padding: 24px 18px; display: flex; flex-direction: column; gap: 10px; }
.brand { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 8px; background: #22d3ee; color: #0f172a; font-weight: 900; margin-bottom: 20px; }
.rail button { height: 42px; border: 0; border-radius: 8px; background: transparent; color: #cbd5e1; text-align: left; padding: 0 12px; font-weight: 800; }
.rail button:first-of-type, .rail button:hover { background: rgba(255,255,255,.1); color: white; }
.workspace { padding: 26px; display: grid; gap: 18px; }
.topbar, .panel, .cards article { background: white; border: 1px solid #dbe3ef; border-radius: 8px; box-shadow: 0 8px 22px rgba(15,23,42,.06); }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 20px; }
.topbar p { margin: 0 0 4px; color: #64748b; font-weight: 800; text-transform: uppercase; font-size: 12px; }
h1 { margin: 0; font-size: 30px; }
.primary { border: 0; border-radius: 8px; background: #2563eb; color: white; padding: 11px 16px; font-weight: 900; }
.cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.cards article { padding: 16px; display: grid; gap: 8px; }
.cards span, .panelTitle { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
.cards strong { font-size: 28px; }
.grid { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; }
.panel { padding: 16px; }
.bars { height: 220px; display: flex; align-items: end; gap: 10px; padding-top: 20px; }
.bars i { flex: 1; border-radius: 6px 6px 0 0; background: linear-gradient(#22d3ee, #2563eb); }
.alert { margin-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; background: #f8fafc; font-weight: 800; }
.alert button { border: 0; border-radius: 8px; background: #e0f2fe; color: #075985; padding: 8px 10px; font-weight: 900; }
.table { overflow-x: auto; }
.thead, .trow { min-width: 760px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
.thead { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
.trow { font-weight: 800; }
@media (max-width: 860px) {
  .shell { grid-template-columns: 1fr; }
  .rail { min-height: auto; flex-direction: row; overflow-x: auto; }
  .brand { margin: 0; flex: 0 0 auto; }
  .rail button { flex: 0 0 auto; }
  .cards, .grid { grid-template-columns: 1fr; }
  .workspace { padding: 16px; }
}
`,
    },
    {
      file: "tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2017",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"],
        },
        null,
        2,
      ),
    },
    { file: "next.config.ts", content: "import type { NextConfig } from \"next\";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n" },
    { file: "README.md", content: `# ${model.title}\n\nGenerated by PayFix from a sketch/design handoff.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` },
  ];
}

function viteProjectFiles(title: string, text: string): ProjectFile[] {
  const model = dashboardMarkup(title, text);
  return [
    {
      file: "package.json",
      content: JSON.stringify(
        {
          scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
          dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", react: "latest", "react-dom": "latest" },
          devDependencies: {},
        },
        null,
        2,
      ),
    },
    { file: "index.html", content: "<!doctype html>\n<html><head><meta charset=\"UTF-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" /><title>" + model.title + "</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script></body></html>\n" },
    {
      file: "src/main.jsx",
      content: `import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const cards = ${JSON.stringify(model.cards)};
const nav = ${JSON.stringify(model.nav)};
const alerts = ${JSON.stringify(model.alerts)};

function App() {
  return (
    <main className="app">
      <aside>{nav.map((item) => <button key={item}>{item}</button>)}</aside>
      <section>
        <header><h1>${model.title}</h1><button>New item</button></header>
        <div className="cards">{cards.map((card, index) => <article key={card}><span>{card}</span><strong>{[1248,17,42,"$284k"][index]}</strong></article>)}</div>
        <div className="layout"><div className="panel graph">{[42,58,31,70,64,86,78].map((height) => <i key={height} style={{ height: height + "%" }} />)}</div><div className="panel">{alerts.map((alert) => <p key={alert}>{alert}<button>Review</button></p>)}</div></div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
`,
    },
    {
      file: "src/styles.css",
      content: `body { margin: 0; font-family: Inter, Arial, sans-serif; background: #eef3f8; color: #0f172a; }
.app { min-height: 100vh; display: grid; grid-template-columns: 230px 1fr; }
aside { background: #0f172a; padding: 24px; display: flex; flex-direction: column; gap: 10px; }
aside button, header button, p button { border: 0; border-radius: 8px; padding: 11px 14px; font-weight: 900; }
aside button { background: transparent; color: #cbd5e1; text-align: left; }
aside button:hover { background: rgba(255,255,255,.1); color: white; }
section { padding: 26px; display: grid; gap: 18px; }
header, article, .panel { background: white; border: 1px solid #dbe3ef; border-radius: 8px; box-shadow: 0 8px 22px rgba(15,23,42,.06); }
header { display: flex; align-items: center; justify-content: space-between; padding: 20px; }
h1 { margin: 0; font-size: 30px; }
header button { background: #2563eb; color: white; }
.cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
article, .panel { padding: 16px; }
article span { color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; }
article strong { display: block; margin-top: 8px; font-size: 28px; }
.layout { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; }
.graph { height: 250px; display: flex; align-items: end; gap: 10px; }
.graph i { flex: 1; border-radius: 6px 6px 0 0; background: linear-gradient(#22d3ee, #2563eb); }
p { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8fafc; border-radius: 8px; font-weight: 800; }
p button { background: #e0f2fe; color: #075985; }
@media (max-width: 860px) { .app, .cards, .layout { grid-template-columns: 1fr; } aside { flex-direction: row; overflow-x: auto; } }
`,
    },
    { file: "README.md", content: `# ${model.title}\n\nGenerated by PayFix from a sketch/design handoff.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` },
  ];
}

function staticProjectFiles(title: string, text: string): ProjectFile[] {
  const model = dashboardMarkup(title, text);
  return [
    {
      file: "index.html",
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${model.title}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="app">
      <aside>${model.nav.map((item) => `<button>${item}</button>`).join("")}</aside>
      <section>
        <header><h1>${model.title}</h1><button>New item</button></header>
        <div class="cards">${model.cards.map((card, index) => `<article><span>${card}</span><strong>${[1248, 17, 42, "$284k"][index]}</strong></article>`).join("")}</div>
        <div class="layout"><div class="panel graph"></div><div class="panel alerts"></div></div>
      </section>
    </main>
    <script src="./app.js"></script>
  </body>
</html>
`,
    },
    {
      file: "styles.css",
      content: viteProjectFiles(title, text).find((file) => file.file === "src/styles.css")?.content || "",
    },
    {
      file: "app.js",
      content: `document.querySelector(".graph").innerHTML = [42,58,31,70,64,86,78].map((height) => '<i style="height:' + height + '%"></i>').join("");
document.querySelector(".alerts").innerHTML = ${JSON.stringify(model.alerts)}.map((alert) => '<p>' + alert + '<button>Review</button></p>').join("");
`,
    },
    { file: "README.md", content: `# ${model.title}\n\nOpen \`index.html\` in your browser.\n` },
  ];
}

async function pathExists(value: string) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function looksLikeLegacyPayfixGeneratedProject(targetPath: string) {
  const readme = await readTextIfExists(path.resolve(targetPath, "README.md"));
  const indexHtml = await readTextIfExists(path.resolve(targetPath, "index.html"));
  const packageJson = await readTextIfExists(path.resolve(targetPath, "package.json"));
  const pageTsx = await readTextIfExists(path.resolve(targetPath, "app", "page.tsx"));
  const staticGenerated =
    Boolean(indexHtml) &&
    Boolean(await pathExists(path.resolve(targetPath, "styles.css"))) &&
    (/Generated by PayFix|Open `index\.html` in your browser/i.test(readme) || /authShell|class="app"|class="authShell"/i.test(indexHtml));
  const reactGenerated =
    /Generated by PayFix|Generated auth screen from a PayFix sketch|Generated from a PayFix sketch/i.test(`${readme}\n${packageJson}\n${pageTsx}`) &&
    (Boolean(packageJson) || Boolean(pageTsx));

  return staticGenerated || reactGenerated;
}

function parseBodyText(body: CreateProjectRequest) {
  return [body.prompt, body.sourceMessage].filter(Boolean).join("\n\n");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateProjectRequest;

    if (body.action === "deleteGeneratedProject") {
      const targetPath = path.resolve(String(body.targetPath || "").trim());
      if (!targetPath || !path.isAbsolute(targetPath)) {
        return Response.json({ ok: false, error: "Target project path is required." }, { status: 400 });
      }

      const markerPath = path.resolve(targetPath, PAYFIX_GENERATED_MARKER);
      if (!markerPath.startsWith(`${targetPath}${path.sep}`)) {
        return Response.json({ ok: false, error: "Invalid generated project path." }, { status: 400 });
      }

      const hasMarker = await pathExists(markerPath);
      const isLegacyPayfixProject =
        !hasMarker && body.allowLegacyPayfixProject
          ? await looksLikeLegacyPayfixGeneratedProject(targetPath)
          : false;

      if (!hasMarker && !isLegacyPayfixProject) {
        return Response.json(
          {
            ok: false,
            error: `Refusing to delete ${targetPath}. This folder does not contain the PayFix generated-project marker and does not look like a legacy PayFix-generated project.`,
          },
          { status: 409 },
        );
      }

      await fs.rm(targetPath, { recursive: true, force: true });

      return Response.json({
        ok: true,
        path: targetPath,
        folderName: path.basename(targetPath),
        files: [],
        runCommands: [],
        markdown: `GENERATED PROJECT DELETED

Deleted folder:
${targetPath}

PayFix deleted it because it ${hasMarker ? "contained the generated-project marker" : "matched a legacy PayFix-generated project created before markers existed"}.`,
      });
    }

    if (body.action === "ensureStaticJs") {
      const targetPath = path.resolve(String(body.targetPath || "").trim());
      if (!targetPath || !path.isAbsolute(targetPath)) {
        return Response.json({ ok: false, error: "Target project path is required." }, { status: 400 });
      }

      const indexPath = path.resolve(targetPath, "index.html");
      if (!indexPath.startsWith(`${targetPath}${path.sep}`)) {
        return Response.json({ ok: false, error: "Invalid static project path." }, { status: 400 });
      }

      if (!(await pathExists(indexPath))) {
        return Response.json({ ok: false, error: `index.html was not found in ${targetPath}` }, { status: 404 });
      }

      const appJsPath = path.resolve(targetPath, "app.js");
      await fs.writeFile(appJsPath, staticInteractionJs(), "utf8");

      const indexHtml = await fs.readFile(indexPath, "utf8");
      if (!/<script[^>]+app\.js/i.test(indexHtml)) {
        const updatedHtml = indexHtml.includes("</body>")
          ? indexHtml.replace("</body>", "    <script defer src=\"./app.js\"></script>\n  </body>")
          : `${indexHtml}\n<script defer src="./app.js"></script>\n`;
        await fs.writeFile(indexPath, updatedHtml, "utf8");
      }

      return Response.json({
        ok: true,
        path: targetPath,
        folderName: path.basename(targetPath),
        files: ["app.js", "index.html"],
        runCommands: ["Open index.html in a browser"],
        markdown: `STATIC JS ADDED

Path:
${targetPath}

Files updated:
- app.js
- index.html

Run:
- Open index.html in a browser`,
      });
    }

    const parentPath = String(body.parentPath || "").trim();

    if (!parentPath) {
      return Response.json({ ok: false, error: "Target parent path is required." }, { status: 400 });
    }

    if (!path.isAbsolute(parentPath)) {
      return Response.json({ ok: false, error: "Target parent path must be an absolute path." }, { status: 400 });
    }

    const text = parseBodyText(body);
    const folderName = slugify(body.folderName || inferProjectName(text));
    const resolvedParent = path.resolve(parentPath);
    const targetPath = path.resolve(resolvedParent, folderName);

    if (path.dirname(targetPath) !== resolvedParent) {
      return Response.json({ ok: false, error: "Folder name must stay inside the target parent path." }, { status: 400 });
    }

    await fs.mkdir(resolvedParent, { recursive: true });

    if (await pathExists(targetPath)) {
      const existing = await fs.readdir(targetPath);
      if (existing.length > 0) {
        return Response.json(
          { ok: false, error: `Folder already exists and is not empty: ${targetPath}` },
          { status: 409 },
        );
      }
    }

    const title = inferTitle(text);
    const stack = String(body.stack || "Next.js app").toLowerCase();
    const files = isAuthProject(text)
      ? stack.includes("static")
        ? authStaticProjectFiles(title, text)
        : stack.includes("vite")
          ? authViteProjectFiles(title, text)
          : authNextProjectFiles(title, text)
      : stack.includes("static")
        ? staticProjectFiles(title, text)
        : stack.includes("vite")
          ? viteProjectFiles(title, text)
          : nextProjectFiles(title, text);

    await fs.mkdir(targetPath, { recursive: true });
    for (const file of files) {
      const destination = path.resolve(targetPath, file.file);
      if (!destination.startsWith(`${targetPath}${path.sep}`) && destination !== targetPath) {
        throw new Error(`Refusing to write outside target folder: ${file.file}`);
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.content, "utf8");
    }

    await fs.writeFile(
      path.resolve(targetPath, PAYFIX_GENERATED_MARKER),
      JSON.stringify(
        {
          generatedBy: "PayFix AI",
          generatedAt: new Date().toISOString(),
          source: "create-project",
          title,
          stack: body.stack || "Next.js app",
        },
        null,
        2,
      ),
      "utf8",
    );

    const runCommands = stack.includes("static")
      ? ["Open index.html in a browser"]
      : [`cd ${targetPath}`, "npm install", "npm run dev"];

    return Response.json({
      ok: true,
      path: targetPath,
      folderName,
      files: files.map((file) => file.file),
      runCommands,
      markdown: `PROJECT CREATED

Path:
${targetPath}

Files created:
${files.map((file) => `- ${file.file}`).join("\n")}

Stack:
- ${body.stack || "Next.js app"}

Run:
${runCommands.map((command) => `- ${command}`).join("\n")}`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not create project.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
