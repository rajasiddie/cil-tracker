const { chromium } = require("playwright");
const fs = require("fs");
const https = require("https");

const URL =
  "https://www.coalindia.in/career-cil/jobs-coal-india/recruitment-of-management-trainee-through-computer-based-test-cbt-26/";

const STATE_FILE = "page_state.json";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const CHROME_PATH =
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : undefined;


async function fetchPage() {

  const browser = await chromium.launch({
  ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  headless: true
});

  try {

    const page = await browser.newPage();

    await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Give the page time to finish loading dynamic content
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {

      const links = [];

      document.querySelectorAll("a").forEach(a => {

        let text = (a.innerText || "")
          .replace(/\s+/g, " ")
          .trim();

        let href = a.href;

        if (!href) return;

        // Recruitment-related documents/links
        const isRelevant =
          href.includes("cloudfront.net") ||
          href.includes("digialm.com") ||
          /result|notice|recruitment|cbt|admit|advertisement|addendum|syllabus|facilitation|scribe|application|mock|faq|management trainee/i.test(text);

        if (!isRelevant) return;

        if (!text) {
          text = "(document/link)";
        }

        links.push({
          text,
          href
        });

      });

      return {
        title: document.title,
        links
      };

    });

    return data;

  } finally {

    await browser.close();

  }
}


function normalize(items) {

  const unique = new Map();

  for (const item of items) {

    const text = item.text
      .replace(/\s+/g, " ")
      .trim();

    const href = item.href.trim();

    const key = `${href}|${text}`;

    unique.set(key, {
      text,
      href
    });

  }

  return [...unique.values()].sort((a, b) =>
    `${a.href}|${a.text}`.localeCompare(
      `${b.href}|${b.text}`
    )
  );
}


function sendTelegram(message) {

  return new Promise((resolve, reject) => {

    const body = JSON.stringify({
      chat_id: CHAT_ID,
      text: message
    });

    const req = https.request({

      hostname: "api.telegram.org",

      path: `/bot${BOT_TOKEN}/sendMessage`,

      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }

    }, res => {

      let data = "";

      res.on("data", chunk => data += chunk);

      res.on("end", () => {

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(data));
        }

      });

    });

    req.on("error", reject);

    req.write(body);
    req.end();

  });

}


async function main() {

  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error("Telegram credentials missing.");
  }

  console.log("Checking CIL using Chrome...");

  const result = await fetchPage();

  const current = normalize(result.links);

  console.log(`Page title: ${result.title}`);
  console.log(`Found ${current.length} relevant items.`);

  // Never replace our state with an empty/failed result
  if (current.length === 0) {
    throw new Error(
      "CIL returned zero relevant items. NOT updating baseline."
    );
  }


  // First successful run
  if (!fs.existsSync(STATE_FILE)) {

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(current, null, 2)
    );

    console.log("Initial baseline saved.");

    return;
  }


  const previous = JSON.parse(
    fs.readFileSync(STATE_FILE, "utf8")
  );


  const oldMap = new Map(
    previous.map(item => [item.href, item.text])
  );


  const newItems = [];

  const changedItems = [];


  for (const item of current) {

    if (!oldMap.has(item.href)) {

      newItems.push(item);

    } else if (oldMap.get(item.href) !== item.text) {

      changedItems.push({
        before: oldMap.get(item.href),
        after: item.text,
        href: item.href
      });

    }

  }


  if (!newItems.length && !changedItems.length) {

    console.log("No change.");

    return;

  }


  let message =
    "🚨 CIL RECRUITMENT UPDATE\n\n";


  if (newItems.length) {

    message += "🆕 NEW ITEM(S):\n\n";

    for (const item of newItems) {

      message +=
        `📌 ${item.text}\n` +
        `${item.href}\n\n`;

    }

  }


  if (changedItems.length) {

    message += "✏️ CHANGED ITEM(S):\n\n";

    for (const item of changedItems) {

      message +=
        `📌 Before: ${item.before}\n` +
        `➡️ After: ${item.after}\n` +
        `${item.href}\n\n`;

    }

  }


  message +=
    `🔗 CIL page:\n${URL}`;


  await sendTelegram(message);


  // Only save the new state after Telegram succeeds
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(current, null, 2)
  );


  console.log("📱 Telegram alert sent.");

}


main().catch(err => {

  console.error("❌", err.message);

  process.exit(1);

});