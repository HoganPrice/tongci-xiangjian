import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_URL || "http://127.0.0.1:4173/";
const chromePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const screenshotDir = path.resolve(process.cwd(), "../../work");

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});

const hostContext = await browser.newContext({
  viewport: { width: 1360, height: 960 },
  locale: "zh-CN",
});
const guestContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
});

const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const errors = [];

for (const [name, page] of [
  ["host", host],
  ["guest", guest],
]) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${name}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
}

try {
  await host.goto(baseUrl, { waitUntil: "networkidle" });
  const longNickname = "这是一个超过十二个字但应该完整保留的昵称";
  await host.getByLabel("你的昵称").fill(longNickname);
  assert.equal(await host.getByLabel("你的昵称").inputValue(), longNickname);
  await host.getByLabel("你的昵称").fill("小林");
  await host.getByRole("button", { name: "30 秒" }).click();
  await host.getByRole("button", { name: /创建房间/ }).click();
  await host.locator(".room-code-large").waitFor();
  const roomCode = (await host.locator(".room-code-large").innerText()).trim();
  assert.match(roomCode, /^[A-Z0-9]{6}$/);

  await guest.goto(`${baseUrl}?room=${roomCode}`, { waitUntil: "networkidle" });
  await guest.getByLabel("你的昵称").fill("小周");
  await guest.getByRole("button", { name: "加入房间" }).click();

  await host.getByText("小周", { exact: true }).waitFor({ timeout: 15000 });
  await host.getByRole("button", { name: "开始这一局" }).click();

  const longWord = "这是一个没有长度限制而且应该完整出现的很长的词";
  await host.locator("#word-input").fill(longWord);
  assert.equal(await host.locator("#word-input").inputValue(), longWord);
  await guest.locator("#word-input").fill("海");
  await host.locator("#word-input").press("Enter");
  await guest.locator("#word-input").press("Enter");

  await host.getByText("这一轮，擦肩而过").waitFor({ timeout: 15000 });
  await guest.getByText("这一轮，擦肩而过").waitFor({ timeout: 15000 });
  assert.equal(
    await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "long words should not create horizontal overflow on mobile",
  );

  await host.locator("#word-input").waitFor({ timeout: 12000 });
  await guest.locator("#word-input").waitFor({ timeout: 12000 });

  await host.locator("#word-input").fill("晚风");
  await guest.locator("#word-input").fill("晚风");
  await host.locator("#word-input").press("Enter");
  await guest.locator("#word-input").press("Enter");

  await host.getByText("第 2 轮 · 同词相见").waitFor({ timeout: 15000 });
  await guest.getByText("第 2 轮 · 同词相见").waitFor({ timeout: 15000 });
  await host.getByRole("heading", { name: "“晚风”" }).waitFor();
  await guest.getByRole("heading", { name: "“晚风”" }).waitFor();

  await host.screenshot({
    path: path.join(screenshotDir, "e2e-host-win.png"),
    fullPage: true,
  });
  await guest.screenshot({
    path: path.join(screenshotDir, "e2e-guest-win-mobile.png"),
    fullPage: true,
  });

  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode,
        rounds: 2,
        winnerWord: "晚风",
        hostConnection: await host.locator(".connection-badge").innerText(),
        guestConnection: await guest.locator(".connection-badge").innerText(),
        screenshots: [
          path.join(screenshotDir, "e2e-host-win.png"),
          path.join(screenshotDir, "e2e-guest-win-mobile.png"),
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
