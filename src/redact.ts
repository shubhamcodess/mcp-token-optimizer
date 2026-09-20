import type { Config } from "./config.js";

const BUILTIN: { name: string; re: RegExp }[] = [
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "github-fine-grained", re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { name: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "private-key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g },
];

export interface RedactResult {
  text: string;
  findings: Record<string, number>;
}

export function makeRedactor(cfg: Config) {
  const extra = cfg.redaction.extraPatterns.map((p) => ({ name: p.name, re: new RegExp(p.regex, "g") }));
  const patterns = [...BUILTIN, ...extra];
  return (text: string): RedactResult => {
    if (cfg.redaction.mode === "off") return { text, findings: {} };
    const findings: Record<string, number> = {};
    let out = text;
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      out = out.replace(re, () => {
        findings[name] = (findings[name] ?? 0) + 1;
        return cfg.redaction.mode === "redact" ? `[REDACTED:${name}]` : "$&";
      });
    }
    // "detect" mode must not alter text ("$&" above is a replacer-function return, so restore explicitly)
    return { text: cfg.redaction.mode === "redact" ? out : text, findings };
  };
}
