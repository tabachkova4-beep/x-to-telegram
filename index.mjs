import { chromium } from "playwright";
import fs from "fs";

const SENT_FILE = "sent.json";

// Загружаем список уже отправленных твитов
let sentTweets = [];

if (fs.existsSync(SENT_FILE)) {
  try {
    sentTweets = JSON.parse(fs.readFileSync(SENT_FILE, "utf8"));
  } catch {
    sentTweets = [];
  }
}

const sentSet = new Set(sentTweets);

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

// Отбираем только те твиты, которых ещё нет в списке отправленных
const newTweets = tweets.filter(tweet => !sentSet.has(tweet.id));

console.log("Новых твитов:", newTweets.length);

if (newTweets.length === 0) {
  console.log("Новых твитов нет.");
  await browser.close();
  process.exit(0);
}

// Отправляем от старых к новым
for (const tweet of newTweets.reverse()) {
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
  console.log(
    "Telegram result:",
    JSON.stringify(result, null, 2)
  );

  // Запоминаем твит только если Telegram действительно его принял
  if (result.ok) {
    sentSet.add(tweet.id);
  } else {
    console.error("Telegram не принял твит:", tweet.id);
  }
}

// Храним последние 500 ID, чтобы файл не разрастался бесконечно
const updatedSentTweets = [...sentSet].slice(-500);

fs.writeFileSync(
  SENT_FILE,
  JSON.stringify(updatedSentTweets, null, 2)
);

console.log(
  "Сохранено отправленных твитов:",
  updatedSentTweets.length
);

await browser.close();
