import { spawn } from "node:child_process";
import { win32 } from "node:path";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CodexOpenSpec = { executable: string; args: string[]; windowsHide: boolean };

export function codexThreadUrl(threadId: string): string {
  if (threadId !== "new" && !THREAD_ID.test(threadId)) throw new Error(`Invalid Codex task ID: ${threadId}`);
  return `codex://threads/${threadId}`;
}

export function codexOpenSpec(
  threadId: string,
  targetPlatform = process.platform,
  systemRoot = process.env.SystemRoot ?? "C:\\Windows"
): CodexOpenSpec {
  const url = codexThreadUrl(threadId);
  if (targetPlatform === "darwin") return { executable: "/usr/bin/open", args: [url], windowsHide: false };
  if (targetPlatform === "win32") {
    const executable = win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return {
      executable,
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", `Start-Process -FilePath '${url}'`],
      windowsHide: true
    };
  }
  throw new Error(`Opening Codex links is unsupported on ${targetPlatform}.`);
}

export function codexFocusSpec(targetPlatform = process.platform, systemRoot = process.env.SystemRoot ?? "C:\\Windows"): CodexOpenSpec {
  if (targetPlatform === "darwin") return { executable: "/usr/bin/open", args: ["-b", "com.openai.codex"], windowsHide: false };
  if (targetPlatform === "win32") {
    const executable = win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return {
      executable,
      args: [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
        "Add-Type -AssemblyName Microsoft.VisualBasic; $process = Get-Process -Name ChatGPT -ErrorAction Stop | Select-Object -First 1; [Microsoft.VisualBasic.Interaction]::AppActivate($process.Id) | Out-Null"
      ],
      windowsHide: true
    };
  }
  throw new Error(`Focusing Codex is unsupported on ${targetPlatform}.`);
}

function runCodexSpec(spec: CodexOpenSpec, errorLabel: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, { windowsHide: spec.windowsHide, stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (data) => { errorOutput += String(data); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${errorLabel} (${code ?? "unknown"}): ${errorOutput.trim()}`));
    });
  });
}

export function openCodexThread(threadId: string): Promise<void> {
  return runCodexSpec(codexOpenSpec(threadId), "Codex link could not be opened");
}

export function focusCodexWindow(): Promise<void> {
  return runCodexSpec(codexFocusSpec(), "Codex window could not be focused");
}
