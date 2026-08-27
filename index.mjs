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

    // Определяем рекламу
    const articleText = text.toLowerCase();

    const isAd =
      articleText.includes("promoted") ||
      articleText.includes("sponsored") ||
      articleText.includes("реклама") ||
      articleText.includes("рекламная");

    if (isAd) {
      console.log("Пропускаем рекламу:", id);
      continue;
    }

    // Собираем изображения
    const images = [];

    for (const img of article.querySelectorAll("img")) {
      const src = img.src;

      if (!src) continue;

      // Убираем аватарки и прочие мелкие картинки интерфейса
      if (
        src.includes("profile_images") ||
        src.includes("emoji") ||
        src.includes("abs.twimg.com")
      ) {
        continue;
      }

      if (!images.includes(src)) {
        images.push(src);
      }
    }

    // Собираем видео
    const videos = [];

    for (const video of article.querySelectorAll("video")) {
      const src = video.src;

      if (src && !videos.includes(src)) {
        videos.push(src);
      }
    }

    // Собираем ссылки из самого твита
    const urls = [];

    for (const a of article.querySelectorAll('a[href]')) {
      const href = a.href;

      if (!href) continue;

      if (
        href.startsWith("https://x.com/") &&
        href.includes("/status/")
      ) {
        continue;
      }

      if (
        href.startsWith("https://x.com/") ||
        href.startsWith("https://twitter.com/")
      ) {
        continue;
      }

      if (!urls.includes(href)) {
        urls.push(href);
      }
    }

    result.push({
      id,
      url: `https://x.com/i/status/${id}`,
      text,
      images,
      videos,
      urls
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

// Загружаем уже отправленные твиты
let sentIds = [];

try {
  const fs = await import("fs");

  if (fs.existsSync("sent.json")) {
    sentIds = JSON.parse(fs.readFileSync("sent.json", "utf8"));
  }
} catch {
  sentIds = [];
}

const newTweets = tweets.filter(tweet => !sentIds.includes(tweet.id));

console.log("Новых твитов:", newTweets.length);

if (newTweets.length === 0) {
  console.log("Новых твитов нет.");
  await browser.close();
  process.exit(0);
}

const telegramUrl =
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function telegram(method, body) {
  const response = await fetch(
    `${telegramUrl}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json();

  console.log(`Telegram ${method}:`, response.status);

  if (!result.ok) {
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

for (const tweet of newTweets) {
  console.log("Отправляем твит:", tweet.id);
  console.log("Ссылка:", tweet.url);

  let message = `🐦 Новый твит\n\n${tweet.text}`;

  if (tweet.urls.length > 0) {
    message += "\n\n🔗 Ссылки:\n";

    for (const url of tweet.urls) {
      message += `${url}\n`;
    }
  }

  message += `\n\n🔗 Твит: ${tweet.url}`;

  // Telegram ограничивает обычное сообщение 4096 символами
  if (message.length > 4096) {
    message = message.substring(0, 4050) + "\n\n…\n\n" + tweet.url;
  }

  // Если есть изображения — отправляем их
  if (tweet.images.length > 0) {
    console.log("Изображений:", tweet.images.length);

    for (let i = 0; i < tweet.images.length; i++) {
      const image = tweet.images[i];

      if (i === 0) {
        await telegram("sendPhoto", {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          photo: image,
          caption: message
        });
      } else {
        await telegram("sendPhoto", {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          photo: image
        });
      }
    }
  }

  // Если есть видео — отправляем их
  if (tweet.videos.length > 0) {
    console.log("Видео:", tweet.videos.length);

    for (const video of tweet.videos) {
      await telegram("sendVideo", {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        video,
        caption: tweet.images.length === 0 ? message : undefined
      });
    }
  }

  // Если медиа нет — обычное сообщение
  if (
    tweet.images.length === 0 &&
    tweet.videos.length === 0
  ) {
    await telegram("sendMessage", {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      disable_web_page_preview: false
    });
  }

  sentIds.push(tweet.id);
}

// Сохраняем ID
const fs = await import("fs");

fs.writeFileSync(
  "sent.json",
  JSON.stringify(sentIds, null, 2)
);

console.log("Сохранено отправленных твитов:", sentIds.length);

await browser.close();
