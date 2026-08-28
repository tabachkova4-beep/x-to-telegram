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

// ЯВНО открываем Following
await page.goto("https://x.com/home", {
  waitUntil: "domcontentloaded",
  timeout: 60000
});

await page.waitForTimeout(5000);

// Переходим именно в Following через вкладку
const followingTab = page.getByText("Following", { exact: true }).first();

if (await followingTab.count()) {
  await followingTab.click();
  await page.waitForTimeout(3000);
}

console.log("URL:", page.url());


// Прокручиваем ленту несколько раз,
// чтобы X загрузил больше твитов
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(1500);
}

console.log("Собираем твиты...");


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


    // Убираем рекламные посты
    const lower = text.toLowerCase();

    if (
      lower.includes("promoted") ||
      lower.includes("promoted by") ||
      lower.includes("реклама") ||
      lower.includes("рекламируется")
    ) {
      continue;
    }


    // Собираем изображения
    const images = Array.from(
      article.querySelectorAll('img[src*="pbs.twimg.com/media"]')
    )
      .map(img => img.src)
      .filter(Boolean);


    // Собираем видео
    const videos = Array.from(
      article.querySelectorAll("video")
    )
      .map(video => {
        const source = video.querySelector("source");
        return source?.src || video.src || null;
      })
      .filter(Boolean);


    result.push({
      id,
      url: `https://x.com/i/status/${id}`,
      text,
      images,
      videos
    });
  }

  return result;
});


console.log("Найдено твитов:", tweets.length);


// Загружаем уже отправленные твиты
let sent = [];

try {
  const fs = await import("fs");

  if (fs.existsSync("sent.json")) {
    sent = JSON.parse(fs.readFileSync("sent.json", "utf8"));
  }
} catch (error) {
  console.log("Не удалось прочитать sent.json");
}


const sentSet = new Set(sent);

const newTweets = tweets.filter(tweet => !sentSet.has(tweet.id));

console.log("Новых твитов:", newTweets.length);


if (newTweets.length === 0) {
  console.log("Новых твитов нет.");
  await browser.close();
  process.exit(0);
}


// Telegram
const telegramUrl =
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;


for (const tweet of newTweets) {

  console.log("Отправляем твит:", tweet.id);
  console.log("Ссылка:", tweet.url);


  let caption =
    `🐦 Новый твит\n\n` +
    `${tweet.text}\n\n` +
    `🔗 ${tweet.url}`;


  // Telegram ограничивает подпись к фото 1024 символами
  if (caption.length > 1024) {
    caption = caption.substring(0, 1000) + "…";
  }


  // Если есть изображения — отправляем их
  if (tweet.images.length > 0) {

    console.log("Изображений:", tweet.images.length);

    for (let i = 0; i < tweet.images.length; i++) {

      const photoUrl = tweet.images[i];

      const response = await fetch(
        `${telegramUrl}/sendPhoto`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            photo: photoUrl,
            caption: i === 0 ? caption : undefined,
            disable_notification: false
          })
        }
      );

      console.log(
        "Telegram sendPhoto:",
        response.status
      );
    }

  } else {

    // Обычный твит без изображения
    const response = await fetch(
      `${telegramUrl}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: caption,
          disable_web_page_preview: false
        })
      }
    );

    console.log(
      "Telegram sendMessage:",
      response.status
    );
  }


  // Помечаем твит как отправленный
  sentSet.add(tweet.id);
}


// Сохраняем список отправленных
sent = Array.from(sentSet);

const fs = await import("fs");

fs.writeFileSync(
  "sent.json",
  JSON.stringify(sent, null, 2)
);


console.log(
  "Сохранено отправленных твитов:",
  sent.length
);


await browser.close();
