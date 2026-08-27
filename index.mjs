import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true
});

const context = await browser.newContext();

await context.addCookies([
  {
    name: "auth_token",
    value: process.env.AUTH_TOKEN,
    domain: ".x.com",
    path: "/",
    secure: true
  },
  {
    name: "ct0",
    value: process.env.CT0,
    domain: ".x.com",
    path: "/",
    secure: true
  }
]);

const page = await context.newPage();

console.log("Открываем X...");

await page.goto("https://x.com/home", {
  waitUntil: "domcontentloaded",
  timeout: 60000
});

await page.waitForTimeout(5000);

console.log("URL:", page.url());

const tweets = await page.locator("article").evaluateAll(articles => {
  const result = [];
  const seen = new Set();

  for (const article of articles) {
    const link = article.querySelector('a[href*="/status/"]');

    if (!link) continue;

    const match = link.href.match(/\/status\/(\d+)/);

    if (!match) continue;

    const id = match[1];

    if (seen.has(id)) continue;

    seen.add(id);

    const text = article.innerText.trim();

    result.push({
      id,
      url: `https://x.com/i/status/${id}`,
      text
    });
  }

  return result;
});

console.log("Найдено твитов:", tweets.length);

if (tweets.length === 0) {
  console.log("Твиты не найдены.");
  await browser.close();
  process.exit(0);
}

const tweet = tweets[0];

console.log("Отправляем твит:", tweet.id);
console.log("Ссылка:", tweet.url);

const message =
  `🐦 Новый твит\n\n` +
  `${tweet.text}\n\n` +
  `🔗 ${tweet.url}`;

const telegramUrl =
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

const response = await fetch(telegramUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: message,
    disable_web_page_preview: false
  })
});

const result = await response.json();

console.log("Telegram status:", response.status);
console.log("Telegram result:", JSON.stringify(result, null, 2));

await browser.close();
