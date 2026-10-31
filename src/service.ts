import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SERVICE_LABEL = "com.mto.serve";
export const SYSTEMD_UNIT = "mto-serve.service";

export interface ServiceOpts {
  node: string;
  cli: string;
  port: number;
  logPath: string;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function launchdPlist(o: ServiceOpts): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(o.node)}</string>
    <string>${xml(o.cli)}</string>
    <string>serve</string>
    <string>--port</string>
    <string>${o.port}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(o.logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(o.logPath)}</string>
</dict>
</plist>
`;
}

const quote = (s: string) => (/[\s"\\]/.test(s) ? `"${s.replace(/(["\\])/g, "\\$1")}"` : s);

export function systemdUnit(o: ServiceOpts): string {
  return `[Unit]
Description=MCP Token Optimizer (local daemon)
After=network.target

[Service]
ExecStart=${quote(o.node)} ${quote(o.cli)} serve --port ${o.port}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
}

export type Platform = "launchd" | "systemd" | "unsupported";
export const platformOf = (p: NodeJS.Platform = process.platform): Platform => (p === "darwin" ? "launchd" : p === "linux" ? "systemd" : "unsupported");

export const servicePath = (platform: Platform, home = homedir()): string =>
  platform === "launchd" ? join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`) : join(home, ".config", "systemd", "user", SYSTEMD_UNIT);

const run = (cmd: string, args: string[]): { ok: boolean; out: string } => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: String((e as { stderr?: string }).stderr ?? (e as Error).message) };
  }
};

/** Fixed commands only: no shell, arguments come from this file, never from user input. */
export function installService(o: ServiceOpts, platform = platformOf(), file = servicePath(platform)): { ok: boolean; message: string } {
  if (platform === "unsupported") return { ok: false, message: "mto service supports macOS (launchd) and Linux (systemd --user). On Windows run `mto serve` yourself." };
  mkdirSync(dirname(file), { recursive: true });
  mkdirSync(dirname(o.logPath), { recursive: true });
  writeFileSync(file, platform === "launchd" ? launchdPlist(o) : systemdUnit(o));
  if (platform === "launchd") {
    const uid = String(process.getuid?.() ?? 501);
    run("launchctl", ["bootout", `gui/${uid}/${SERVICE_LABEL}`]); // replace an older copy; fine if absent
    const r = run("launchctl", ["bootstrap", `gui/${uid}`, file]);
    return r.ok ? { ok: true, message: `installed and started (${file})` } : { ok: false, message: `wrote ${file} but launchctl failed: ${r.out.trim()}` };
  }
  run("systemctl", ["--user", "daemon-reload"]);
  const r = run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]);
  return r.ok ? { ok: true, message: `installed and started (${file})` } : { ok: false, message: `wrote ${file} but systemctl failed: ${r.out.trim()}` };
}

export function uninstallService(platform = platformOf(), file = servicePath(platform)): { ok: boolean; message: string } {
  if (platform === "unsupported") return { ok: false, message: "nothing to remove on this platform" };
  if (platform === "launchd") run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${SERVICE_LABEL}`]);
  else run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
  const had = existsSync(file);
  rmSync(file, { force: true });
  if (platform === "systemd") run("systemctl", ["--user", "daemon-reload"]);
  return { ok: true, message: had ? `stopped and removed ${file}` : "no service file found; nothing to remove" };
}

export function serviceStatus(platform = platformOf(), file = servicePath(platform)): { installed: boolean; running: boolean; file: string } {
  if (platform === "unsupported") return { installed: false, running: false, file: "" };
  const installed = existsSync(file);
  const running = platform === "launchd" ? run("launchctl", ["print", `gui/${process.getuid?.() ?? 501}/${SERVICE_LABEL}`]).ok : run("systemctl", ["--user", "is-active", "--quiet", SYSTEMD_UNIT]).ok;
  return { installed, running, file };
}
