const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

async function stopTestServer(server) {
  if (server.exitCode !== null) return;
  const ended = new Promise(resolve => server.once("exit", resolve));
  process.kill(server.workerPid || server.pid);
  await ended;
}

async function browserFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boxing-frontend-test-"));
  const server = spawn(process.env.BOXING_COACH_PYTHON || "python", ["-B", "-u", "backend/server.py"], {
    env: { ...process.env, BOXING_COACH_DATA_MODE: "local", BOXING_COACH_DB_PATH: path.join(directory, "test.db"), BOXING_COACH_HOST: "127.0.0.1", BOXING_COACH_PORT: "0", BOXING_COACH_OPEN_BROWSER: "0" }, windowsHide: true,
  });
  let browser;
  async function close() {
    if (browser) await browser.close();
    await stopTestServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
  try {
    const url = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Readiness timeout")), 15000);
      server.once("error", error => { clearTimeout(timeout); reject(error); });
      server.once("exit", code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); });
      server.stdout.on("data", chunk => {
        output += chunk;
        const match = output.match(/BOXING_COACH_READY (.*)\r?\n/);
        if (match) { const ready = JSON.parse(match[1]); server.workerPid = ready.pid; clearTimeout(timeout); resolve(ready.url); }
      });
      server.stderr.on("data", () => {});
    });
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: "block" });
    const response = await context.request.post(`${url}/api/auth/signup`, { data: {
      role: "OWNER", username: "frontendtest", password: "TestOnly!123", password_confirm: "TestOnly!123", name: "합성 테스트 관리자", center_name: "합성 테스트 센터",
    } });
    if (response.status() !== 201) throw new Error(`Signup failed ${response.status()}`);
    const page = await context.newPage();
    async function login(suffix = "") {
      await page.goto(`${url}/${suffix}`);
      await page.locator('[name="username"]').fill("frontendtest");
      await page.locator('[name="password"]').fill("TestOnly!123");
      await page.locator("#authSubmit").click();
      await page.locator("#sidebar").waitFor({ state: "visible" });
    }
    return { page, context, url, login, close };
  } catch (error) { await close(); throw error; }
}
module.exports = { browserFixture, stopTestServer };
