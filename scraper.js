const { chromium } = require("playwright");
const fs = require("fs");
const https = require("https");

const STATE_FILE = "state.json";
const URL = "https://www.coalindia.in/career-cil/jobs-coal-india/recruitment-of-management-trainee-through-computer-based-cbt-26/";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function normalize(items) {
  const unique = new Map();
  for (const item of items) {
    const text = item.text.replace(/\s+/g, " ").trim();
    const href = item.href.trim();
    if (text && href) unique.set(`${href}|${text}`, { text, href });
  }
  return [...unique.values()].sort((a, b) =>
    `${a.href}|${a.text}`.localeCompare(`${b.href}|${b.text}`)
  );
}

function compare(previous, current) {
  const oldMap = new Map(previous.map(i => [i.href, i.text]));
  const newItems = [];
  for (const item of current) {
    if (!oldMap.has(item.href)) newItems.push(item);
  }
  return newItems;
}

function sendTelegram(message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "HTML" });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    locale: "en-IN",
  });
  const page = await context.newPage();

  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });

    // Grab all links on the page
    const links = await page.$$eval("a[href]", els =>
      els.map(a => ({ text: a.innerText, href: a.href }))
         .filter(i => i.text.trim().length > 3)
    );

    const current = normalize(links);

    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));
      console.log(`Baseline saved with ${current.length} items.`);
      await sendTelegram(`✅ <b>CIL Tracker Started</b>\nMonitoring ${current.length} links on the page.`);
    } else {
      const previous = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      const newItems = compare(previous, current);

      if (newItems.length > 0) {
        const msg = `🔔 <b>CIL Update Detected!</b>\n\n` +
          newItems.map(i => `📄 <a href="${i.href}">${i.text}</a>`).join("\n\n");
        await sendTelegram(msg);
        console.log(`Sent notification for ${newItems.length} new item(s).`);
        fs.writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));
      } else {
        console.log("No changes detected.");
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
    await sendTelegram(`⚠️ <b>CIL Tracker Error</b>\n${err.message}`);
  } finally {
    await browser.close();
  }
})();