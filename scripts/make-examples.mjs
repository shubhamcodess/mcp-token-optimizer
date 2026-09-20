// Generates deterministic, fully synthetic sample tool outputs under examples/.
// Nothing here is real data. Re-run any time: node scripts/make-examples.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
mkdirSync(out, { recursive: true });
const w = (name, text) => writeFileSync(join(out, name), text.endsWith("\n") ? text : text + "\n");

// ── 1. GitHub-style issue list: noisy REST JSON (nulls, hypermedia URLs, avatars, node ids)
const issues = Array.from({ length: 40 }, (_, i) => {
  const n = 1000 + i;
  const login = ["octo", "mona", "hubot", "ada"][i % 4];
  return {
    url: `https://api.github.com/repos/acme/widgets/issues/${n}`,
    repository_url: "https://api.github.com/repos/acme/widgets",
    labels_url: `https://api.github.com/repos/acme/widgets/issues/${n}/labels{/name}`,
    comments_url: `https://api.github.com/repos/acme/widgets/issues/${n}/comments`,
    events_url: `https://api.github.com/repos/acme/widgets/issues/${n}/events`,
    html_url: `https://github.com/acme/widgets/issues/${n}`,
    id: 5000000 + i,
    node_id: `I_kwDOAbCdEf${i}xYz`,
    number: n,
    title: `Widget ${i % 7} fails when config key ${["alpha", "beta", "gamma"][i % 3]} is missing`,
    user: {
      login,
      id: 100 + (i % 4),
      node_id: `MDQ6VXNlcjEw${i % 4}`,
      avatar_url: `https://avatars.githubusercontent.com/u/${100 + (i % 4)}?v=4`,
      gravatar_id: "",
      url: `https://api.github.com/users/${login}`,
      followers_url: `https://api.github.com/users/${login}/followers`,
      following_url: `https://api.github.com/users/${login}/following{/other_user}`,
      gists_url: `https://api.github.com/users/${login}/gists{/gist_id}`,
      starred_url: `https://api.github.com/users/${login}/starred{/owner}{/repo}`,
      subscriptions_url: `https://api.github.com/users/${login}/subscriptions`,
      organizations_url: `https://api.github.com/users/${login}/orgs`,
      repos_url: `https://api.github.com/users/${login}/repos`,
      events_url: `https://api.github.com/users/${login}/events{/privacy}`,
      received_events_url: `https://api.github.com/users/${login}/received_events`,
      type: "User",
      site_admin: false,
    },
    labels: i % 3 === 0 ? [{ id: 1, name: "bug", color: "d73a4a", default: true }] : [],
    state: i % 5 === 0 ? "closed" : "open",
    locked: false,
    assignee: null,
    assignees: [],
    milestone: null,
    comments: i % 6,
    created_at: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00Z`,
    updated_at: `2026-09-${String(1 + (i % 20)).padStart(2, "0")}T12:30:00Z`,
    closed_at: null,
    author_association: "CONTRIBUTOR",
    active_lock_reason: null,
    body: null,
    reactions: { url: `https://api.github.com/repos/acme/widgets/issues/${n}/reactions`, total_count: 0, "+1": 0, "-1": 0 },
    timeline_url: `https://api.github.com/repos/acme/widgets/issues/${n}/timeline`,
    performed_via_github_app: null,
    state_reason: null,
  };
});
w("github-issues.json", JSON.stringify(issues, null, 2));

// ── 2. Kubernetes-style describe: the SAME content appears in `describeText` and in `manifest` (dedupe target)
const props = Array.from({ length: 60 }, (_, i) => `cache.region${i}.maximum-size=${1000 + i * 50}`).join("\n");
const yaml = Array.from({ length: 30 }, (_, i) => `rule_${i}:\n  severity: ${["LOW", "HIGH"][i % 2]}\n  message: Check number ${i} failed for the given input`).join("\n");
const describeText = `Name:         demo-config\nNamespace:    team-a\nLabels:       app=demo\n\nData\n====\napp.properties:\n----\n${props}\n\nrules.yaml:\n----\n${yaml}\n\nEvents:  <none>`;
w(
  "k8s-configmap.json",
  JSON.stringify(
    {
      resourceType: "configmaps",
      name: "demo-config",
      describeText,
      manifest: { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "demo-config", namespace: "team-a", uid: "0f1e2d3c-aaaa-bbbb-cccc-1234567890ab" }, data: { "app.properties": props, "rules.yaml": yaml } },
      structured: { metadata: { name: "demo-config", namespace: "team-a", uid: "0f1e2d3c-aaaa-bbbb-cccc-1234567890ab" } },
    },
    null,
    2,
  ),
);

// ── 3. Long prose with headings and facts (summarization target)
const steps = ["Prepare", "Migrate", "Configure", "Deploy", "Verify", "Rollback", "Monitor", "Cleanup"];
let doc = "# Deploying billing-service v2.14.3 to production\n\nWe are thrilled to announce that, after extensive and careful consideration by many wonderful teams, the billing-service is ready for its next exciting milestone.\n\n";
steps.forEach((s, i) => {
  const n = i + 1;
  doc += `## Step ${n}: ${s}\n\nIt is generally very important to remember that this step is one of the most crucial parts of the overall process, and teams have historically found that taking their time pays dividends later on. Please do not rush, and feel free to reach out to the platform team with any questions whatsoever.\n\nFor step ${n}, run \`make step${n}\` from /srv/billing/deploy/step${n}.sh with BILLING_REGION=eu-west-${(i % 3) + 1}. The expected duration is ${10 * n} minutes and the job id will look like 7f3a9c2e-1b4d-4e8a-9c11-00aa22bb33c${n}. If exit code E${4000 + n} appears, retry once; if it appears twice, escalate to oncall via https://runbooks.example.com/billing/step${n}. Database migration 20260${n}15_add_invoice_index must complete first, with a timeout of ${30 * n} seconds.\n\nRemember that patience, communication, and diligence are the cornerstones of every successful deployment. Many teams before you have walked this road, and the road is well lit.\n\n`;
});
w("deploy-guide.md", doc);

// ── 4. Build log: ANSI colour, progress spam, repeated lines
let log = "[32m[INFO][0m starting build 4471\n";
for (let i = 0; i < 300; i++) log += "downloading dependency archive...\n";
log += "[33m[WARN][0m deprecated API used in module payments\n";
for (let i = 0; i < 200; i++) log += "  compiling module (cached)\n";
log += "[31m[ERROR][0m test suite failed: 3 failures in /srv/app/tests/payments.spec.ts (exit code 1)\n";
w("build.log", log);

// ── 5. Fake secrets for redaction tests (all obviously synthetic)
w(
  "secrets.txt",
  [
    "Deployment notes (SYNTHETIC values, safe to commit):",
    "aws_access_key_id = " + "AKIA" + "IOSFODNN7EXAMPLE",
    "github_token = " + "gh" + "p_" + "x".repeat(36),
    "slack = " + "xox" + "b-1234567890-abcdefghij",
    "jwt = " + "eyJ" + "hbGciOiJIUzI1NiJ9.eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
    "Authorization: Bearer " + "A".repeat(32),
    "",
    "Everything below is ordinary text about the release process. ".repeat(20),
  ].join("\n"),
);

// ── 6. HTML page
w(
  "page.html",
  `<!doctype html><html><head><title>Runbook</title><style>body{margin:0}.x{color:red}</style><script>window.dataLayer=[];function track(){/* lots of analytics */}</script></head><body>
<nav><a href="/home">Home</a> <a href="/docs">Docs</a></nav>
<div class="content"><h1>Restarting the payments worker</h1><p>Run <code>systemctl restart payments-worker</code> on host pay-01.internal, then check <a href="https://status.example.com/payments">the status page</a>.</p>
<ul>${Array.from({ length: 30 }, (_, i) => `<li>Checklist item ${i + 1}: verify queue depth below ${100 + i} on dashboard /d/payments/${i}</li>`).join("")}</ul></div>
<footer>${"Copyright Example Corp. All rights reserved. ".repeat(10)}</footer></body></html>`,
);

// ── 7. Source code (must never be summarized)
w(
  "source.ts",
  Array.from({ length: 120 }, (_, i) => `export function handler${i}(input: number, ctx: Ctx): number {\n  if (ctx.flags.has("f${i}")) {\n    return input * ${i + 2};\n  }\n  return input + ${i};\n}\n`).join("\n"),
);

// ── 8. A full MCP result that carries structuredContent (a contract: must stay untouched)
const rows = Array.from({ length: 25 }, (_, i) => ({ id: i, name: `row-${i}`, note: null, tags: [] }));
w("structured-result.json", JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ rows }, null, 2) }], structuredContent: { rows } }, null, 2));

console.log("wrote examples/ →", ["github-issues.json", "k8s-configmap.json", "deploy-guide.md", "build.log", "secrets.txt", "page.html", "source.ts", "structured-result.json"].join(", "));
