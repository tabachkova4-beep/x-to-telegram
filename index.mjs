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

await page.waitForTimeout(6000);

console.log("URL:", page.url());


// =====================================================
// ОБЩИЙ СПИСОК НАЙДЕННЫХ ТВИТОВ
// =====================================================

const allTweets = new Map();


// =====================================================
// ФУНКЦИЯ СБОРА ТВИТОВ ИЗ ТЕКУЩЕЙ ЧАСТИ DOM
// =====================================================

async function collectTweets() {

  const tweets = await page.locator("article").evaluateAll(articles => {

    const result = [];

    for (const article of articles) {

      const text = article.innerText.trim();

      if (!text) continue;


      // -------------------------------------------------
      // УБИРАЕМ РЕКЛАМУ
      // -------------------------------------------------

      const lowerText = text.toLowerCase();

      const isAd =
        lowerText.includes("promoted") ||
        lowerText.includes("sponsored") ||
        lowerText.includes("advertisement") ||
        lowerText.includes("реклама");

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


      // -------------------------------------------------
      // КАРТИНКИ
      // -------------------------------------------------

      const images = [];

      for (const img of article.querySelectorAll("img")) {

        const src =
          img.src ||
          img.getAttribute("src");

        if (!src) continue;

        if (
          src.includes("profile_images") ||
          src.includes("/emoji/") ||
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

      for (const link of article.querySelectorAll("a[href]")) {

        const href = link.href;

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


  // ---------------------------------------------------
  // ДОБАВЛЯЕМ В ОБЩИЙ СПИСОК
  // ---------------------------------------------------

  for (const tweet of tweets) {

    if (!allTweets.has(tweet.id)) {
      allTweets.set(tweet.id, tweet);
    }
  }


  console.log(
    "Всего уникальных твитов собрано:",
    allTweets.size
  );
}


// =====================================================
// ПЕРВЫЙ СБОР
// =====================================================

console.log("Собираем первую часть ленты...");

await collectTweets();


// =====================================================
// ПРОКРУТКА + СБОР ПОСЛЕ КАЖДОЙ ПРОКРУТКИ
// =====================================================

console.log("Прокручиваем ленту...");

for (let i = 0; i < 12; i++) {

  await page.mouse.wheel(0, 1800);

  // Даём X время подгрузить новые твиты
  await page.waitForTimeout(2500);

  console.log(`Прокрутка ${i + 1}/12`);

  // ВАЖНО: собираем ДО следующей прокрутки
  await collectTweets();
}


// =====================================================
// ФИНАЛЬНЫЙ СПИСОК
// =====================================================

const tweets = Array.from(allTweets.values());

console.log(
  "Всего найдено уникальных твитов:",
  tweets.length
);


// =====================================================
// ЗАГРУЖАЕМ SENT.JSON
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

console.log(
  "Новых твитов:",
  newTweets.length
);


// =====================================================
// TELEGRAM
// =====================================================

const telegramUrl =
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;


// =====================================================
// ОТПРАВКА
// =====================================================

for (const tweet of newTweets) {

  console.log("");
  console.log("Отправляем твит:", tweet.id);
  console.log("Ссылка:", tweet.url);


  // ---------------------------------------------------
  // ТЕКСТ
  // ---------------------------------------------------

  let message =
    `🐦 Новый твит\n\n` +
    `${tweet.text}\n\n`;


  // Внешние ссылки
  if (tweet.externalLinks.length > 0) {

    message += "🔗 Ссылки:\n";

    for (const link of tweet.externalLinks.slice(0, 5)) {
      message += `${link}\n`;
    }

    message += "\n";
  }


  message += `🔗 ${tweet.url}`;


  // Ограничение Telegram
  if (message.length > 4000) {

    message =
      message.slice(0, 3950) +
      "\n\n…" +
      `\n🔗 ${tweet.url}`;
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

            chat_id:
              process.env.TELEGRAM_CHAT_ID,

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
    // ТЕКСТ / ВИДЕО / ССЫЛКА
    // -------------------------------------------------

    const response = await fetch(
      `${telegramUrl}/sendMessage`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({

          chat_id:
            process.env.TELEGRAM_CHAT_ID,

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
  // СОХРАНЯЕМ ID
  // ---------------------------------------------------

  sentSet.add(tweet.id);

  sentTweets.push(tweet.id);


  // Небольшая пауза
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

console.log("");
console.log(
  "Сохранено отправленных твитов:",
  sentSet.size
);


await browser.close();
