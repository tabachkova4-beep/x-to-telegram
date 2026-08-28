import { chromium } from "playwright";
import fs from "fs";

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


// =====================================================
// ПРОКРУЧИВАЕМ ЛЕНТ
// =====================================================

console.log("Прокручиваем ленту...");

for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(1500);

  console.log(`Прокрутка ${i + 1}/8`);
}


// =====================================================
// СОБИРАЕМ ТВИТЫ
// =====================================================

console.log("Собираем твиты...");

const tweets = await page.locator("article").evaluateAll(articles => {
  const result = [];
  const seen = new Set();

  for (const article of articles) {

    const text = article.innerText.trim();

    if (!text) continue;


    // -------------------------------------------------
    // УБИРАЕМ РЕКЛАМУ
    // -------------------------------------------------

    const lowerText = text.toLowerCase();

    const isAd =
      lowerText.includes("promoted") ||
      lowerText.includes("реклама") ||
      lowerText.includes("sponsored") ||
      lowerText.includes("advertisement");

    if (isAd) {
      continue;
    }


    // -------------------------------------------------
    // ID ТВИТА
    // -------------------------------------------------

    const links = Array.from(
      article.querySelectorAll('a[href*="/status/"]')
    );

    let tweetId = null;

    for (const link of links) {
      const match = link.href.match(/\/status\/(\d+)/);

      if (match) {
        tweetId = match[1];
        break;
      }
    }

    if (!tweetId) continue;

    if (seen.has(tweetId)) continue;

    seen.add(tweetId);


    // -------------------------------------------------
    // КАРТИНКИ
    // -------------------------------------------------

    const images = [];

    const imgElements = Array.from(
      article.querySelectorAll("img")
    );

    for (const img of imgElements) {

      const src =
        img.src ||
        img.getAttribute("src");

      if (!src) continue;

      if (
        src.includes("profile_images") ||
        src.includes("emoji") ||
        src.includes("twimg.com/emoji")
      ) {
        continue;
      }

      if (
        src.includes("pbs.twimg.com/media") ||
        src.includes("pbs.twimg.com/amplify_video_thumb")
      ) {
        if (!images.includes(src)) {
          images.push(src);
        }
      }
    }


    // -------------------------------------------------
    // ВНЕШНИЕ ССЫЛКИ
    // -------------------------------------------------

    const externalLinks = [];

    const allLinks = Array.from(
      article.querySelectorAll("a[href]")
    );

    for (const link of allLinks) {

      let href = link.href;

      if (!href) continue;

      if (
        href.includes("x.com") ||
        href.includes("twitter.com") ||
        href.includes("t.co")
      ) {
        continue;
      }

      if (
        href.startsWith("javascript:") ||
        href.startsWith("#")
      ) {
        continue;
      }

      if (!externalLinks.includes(href)) {
        externalLinks.push(href);
      }
    }


    // -------------------------------------------------
    // ВИДЕО
    // -------------------------------------------------

    const hasVideo =
      article.querySelector("video") !== null ||
      article.querySelector('[data-testid="videoPlayer"]') !== null;


    result.push({
      id: tweetId,

      url: `https://x.com/i/status/${tweetId}`,

      text,

      images,

      externalLinks,

      hasVideo
    });
  }

  return result;
});


console.log("Найдено твитов:", tweets.length);


// =====================================================
// ЗАГРУЖАЕМ УЖЕ ОТПРАВЛЕННЫЕ
// =====================================================

let sentTweets = [];

if (fs.existsSync("sent.json")) {
  try {
    sentTweets = JSON.parse(
      fs.readFileSync("sent.json", "utf8")
    );
  } catch {
    sentTweets = [];
  }
}

const sentSet = new Set(sentTweets);


// =====================================================
// ОСТАВЛЯЕМ ТОЛЬКО НОВЫЕ
// =====================================================

const newTweets = tweets.filter(
  tweet => !sentSet.has(tweet.id)
);

console.log("Новых твитов:", newTweets.length);


// =====================================================
// TELEGRAM
// =====================================================

const telegramUrl =
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;


// =====================================================
// ОТПРАВКА
// =====================================================

for (const tweet of newTweets) {

  console.log("Отправляем твит:", tweet.id);
  console.log("Ссылка:", tweet.url);


  // ---------------------------------------------------
  // ТЕКСТ
  // ---------------------------------------------------

  let message =
    `🐦 Новый твит\n\n` +
    `${tweet.text}\n\n`;


  // Добавляем внешние ссылки,
  // если они не отображаются нормально в тексте

  if (tweet.externalLinks.length > 0) {

    message += "\n🔗 Ссылки:\n";

    for (const link of tweet.externalLinks.slice(0, 5)) {
      message += `${link}\n`;
    }
  }


  message += `\n🔗 ${tweet.url}`;


  // Telegram ограничивает сообщение 4096 символами
  if (message.length > 4000) {
    message = message.slice(0, 3950) + "\n\n…" + `\n🔗 ${tweet.url}`;
  }


  // ---------------------------------------------------
  // КАРТИНКИ
  // ---------------------------------------------------

  if (tweet.images.length > 0) {

    console.log(
      "Изображений:",
      tweet.images.length
    );

    for (let i = 0; i < tweet.images.length; i++) {

      const imageUrl = tweet.images[i];

      const photoResponse = await fetch(
        `${telegramUrl}/sendPhoto`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,

            photo: imageUrl,

            caption:
              i === 0
                ? message.slice(0, 1024)
                : undefined,

            disable_notification: false
          })
        }
      );

      const photoResult =
        await photoResponse.json();

      console.log(
        "Telegram sendPhoto:",
        photoResponse.status
      );

      if (!photoResult.ok) {
        console.log(
          "Ошибка Telegram:",
          JSON.stringify(photoResult)
        );
      }
    }

  } else {

    // -------------------------------------------------
    // ОБЫЧНЫЙ ТЕКСТ / ВИДЕО / ССЫЛКА
    // -------------------------------------------------

    const response = await fetch(
      `${telegramUrl}/sendMessage`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,

          text: message,

          disable_web_page_preview: false
        })
      }
    );

    const result =
      await response.json();

    console.log(
      "Telegram sendMessage:",
      response.status
    );

    if (!result.ok) {
      console.log(
        "Ошибка Telegram:",
        JSON.stringify(result)
      );
    }
  }


  // ---------------------------------------------------
  // ЗАПОМИНАЕМ ТВИТ
  // ---------------------------------------------------

  sentSet.add(tweet.id);

  sentTweets.push(tweet.id);


  // Небольшая пауза между отправками
  await new Promise(
    resolve => setTimeout(resolve, 500)
  );
}


// =====================================================
// СОХРАНЯЕМ SENT.JSON
// =====================================================

fs.writeFileSync(
  "sent.json",
  JSON.stringify(
    Array.from(sentSet),
    null,
    2
  )
);

console.log(
  "Сохранено отправленных твитов:",
  sentSet.size
);


await browser.close();
