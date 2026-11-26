import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BACKEND = resolve(__dirname, "../../backend");
const PYTHON = [join(BACKEND, ".venv/bin/python"), join(BACKEND, ".venv/Scripts/python.exe")].find(existsSync);

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

export class Browser {
  cookies = new Map<string, string>();
}

export class Server {
  private child!: ChildProcess;
  private output = "";
  private active = new Browser();
  private realFetch = globalThis.fetch;
  dataDir = "";
  base = "";

  async start(extraEnv: Record<string, string> = {}): Promise<void> {
    if (!PYTHON) throw new Error("backend/.venv is missing: run scripts/start.py once first");
    const port = await freePort();
    this.dataDir = mkdtempSync(join(tmpdir(), "ams-e2e-"));
    this.base = `http://localhost:${port}`;
    this.child = spawn(PYTHON, ["-m", "ams"], {
      cwd: BACKEND,
      env: { ...process.env, PYTHONPATH: BACKEND, AMS_DATA_DIR: this.dataDir, AMS_PORT: String(port), ...extraEnv },
    });
    this.child.stdout?.on("data", (chunk) => (this.output += chunk));
    this.child.stderr?.on("data", (chunk) => (this.output += chunk));

    globalThis.fetch = async (input, init) => {
      const browser = this.active;
      const headers = new Headers(init?.headers);
      if (browser.cookies.size) headers.set("cookie", [...browser.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
      const response = await this.realFetch(this.base + String(input), { ...init, headers });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
        if (value === "" || value === '""') browser.cookies.delete(name);
        else browser.cookies.set(name, value);
      }
      return response;
    };

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await this.realFetch(`${this.base}/api/health`)).ok) return;
      } catch {
      }
      await new Promise((wait) => setTimeout(wait, 100));
    }
    throw new Error(`Server did not start:\n${this.output}`);
  }

  use(browser: Browser): void {
    this.active = browser;
  }

  file(name: string): string {
    return readFileSync(join(this.dataDir, name), "utf8").trim();
  }

  async lastCode(address: string): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const mails = this.output.split("--- e-mail (AMS_EMAIL_DEBUG) to ").filter((mail) => mail.startsWith(address));
      const code = mails.at(-1)?.match(/verification code is: (\d{6})/)?.[1];
      if (code) return code;
      await new Promise((wait) => setTimeout(wait, 50));
    }
    throw new Error(`No e-mail was sent to ${address}`);
  }

  mailCount(): number {
    return this.output.split("--- e-mail (AMS_EMAIL_DEBUG) to ").length - 1;
  }

  stop(): void {
    globalThis.fetch = this.realFetch;
    this.child?.kill();
    rmSync(this.dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
