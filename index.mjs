import { chromium } from "playwright";
import fs from "fs";

// =====================================================
// НАСТРОЙКИ
// =====================================================

const MAX_TWEETS_PER_RUN = 10;
const SCROLL_COUNT = 6;
const SCROLL_DISTANCE = 1800;
const SCROLL_WAIT = 2500;

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
// ОБЩИЙ СПИСОК ТВИТОВ
// =====================================================

const allTweets = new Map();

// =====================================================
// СБОР ТВИТОВ
// =====================================================

async function collectTweets() {

  const tweets = await page.locator("article").evaluateAll(articles => {

    const result = [];

    for (const article of articles) {

      const text = article.innerText.trim();

      if (!text) continue;

      // =================================================
      // УБИРАЕМ РЕКЛАМУ
      // =================================================

      const lowerText = text.toLowerCase();

      const isAd =
        lowerText.includes("promoted") ||
        lowerText.includes("sponsored") ||
        lowerText.includes("advertisement") ||
        lowerText.includes("реклама");

      if (isAd) continue;

      // =================================================
      // ID ТВИТА
      // =================================================

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

      // =================================================
      // КАРТИНКИ
      // =================================================

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

      // =================================================
      // ВНЕШНИЕ ССЫЛКИ
      // =================================================

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

      // =================================================
      // ВИДЕО
      // =================================================

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

  // ===================================================
  // ДОБАВЛЯЕМ В ОБЩИЙ СПИСОК
  // ===================================================

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
// ПРОКРУТКА
// =====================================================

console.log("Прокручиваем ленту...");

for (let i = 0; i < SCROLL_COUNT; i++) {

  await page.mouse.wheel(
    0,
    SCROLL_DISTANCE
  );

  await page.waitForTimeout(
    SCROLL_WAIT
  );

  console.log(
    `Прокрутка ${i + 1}/${SCROLL_COUNT}`
  );

  await collectTweets();
}

// =====================================================
// ФИНАЛЬНЫЙ СПИСОК
// =====================================================

const tweets = Array.from(
  allTweets.values()
);

console.log(
  "Всего найдено уникальных твитов:",
  tweets.length
);

// =====================================================
// SENT.JSON
// =====================================================

let sentTweets = [];

if (fs.existsSync("sent.json")) {

  try {

    sentTweets = JSON.parse(
      fs.readFileSync(
        "sent.json",
        "utf8"
      )
    );

  } catch {

    sentTweets = [];
  }
}

const sentSet = new Set(sentTweets);

// =====================================================
// НОВЫЕ ТВИТЫ
// =====================================================

const newTweets = tweets.filter(
  tweet => !sentSet.has(tweet.id)
);

console.log(
  "Новых твитов:",
  newTweets.length
);

// =====================================================
// ОГРАНИЧИВАЕМ КОЛИЧЕСТВО
// =====================================================

const tweetsToSend =
  newTweets.slice(
    0,
    MAX_TWEETS_PER_RUN
  );

console.log(
  "Будет отправлено:",
  tweetsToSend.length
);

// =====================================================
// TELEGRAM
// =====================================================

const telegramUrl =
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// =====================================================
// ПАУЗА
// =====================================================

async function sleep(ms) {

  await new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

// =====================================================
// ОТПРАВКА ЗАПРОСА В TELEGRAM
// С ОБРАБОТКОЙ 429
// =====================================================

async function telegramRequest(
  endpoint,
  body
) {

  while (true) {

    const response = await fetch(
      `${telegramUrl}/${endpoint}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify(body)
      }
    );

    const result =
      await response.json();

    console.log(
      `Telegram ${endpoint}:`,
      response.status
    );

    // ===============================================
    // УСПЕШНО
    // ===============================================

    if (result.ok) {

      return {
        ok: true,
        result
      };
    }

    // ===============================================
    // RATE LIMIT
    // ===============================================

    if (
      response.status === 429 ||
      result.error_code === 429
    ) {

      const retryAfter =
        Number(
          result.parameters?.retry_after
        ) || 30;

      console.log(
        `Telegram ограничил частоту. Ждём ${retryAfter} секунд...`
      );

      await sleep(
        (retryAfter + 1) * 1000
      );

      console.log(
        "Повторяем отправку..."
      );

      continue;
    }

    // ===============================================
    // ДРУГАЯ ОШИБКА
    // ===============================================

    console.log(
      "Ошибка Telegram:",
      JSON.stringify(result)
    );

    return {
      ok: false,
      result
    };
  }
}

// =====================================================
// ОТПРАВКА ТВИТОВ
// =====================================================

for (const tweet of tweetsToSend) {

  console.log("");
  console.log(
    "Отправляем твит:",
    tweet.id
  );

  console.log(
    "Ссылка:",
    tweet.url
  );

  // ===================================================
  // ФОРМИРУЕМ ТЕКСТ
  // ===================================================

  let message =
    `🐦 Новый твит\n\n` +
    `${tweet.text}\n\n`;

  // ===================================================
  // ВНЕШНИЕ ССЫЛКИ
  // ===================================================

  if (
    tweet.externalLinks.length > 0
  ) {

    message +=
      "🔗 Ссылки:\n";

    for (
      const link of
      tweet.externalLinks.slice(0, 5)
    ) {

      message +=
        `${link}\n`;
    }

    message += "\n";
  }

  // ===================================================
  // ССЫЛКА НА ТВИТ
  // ===================================================

  message +=
    `🔗 ${tweet.url}`;

  // ===================================================
  // ЛИМИТ TELEGRAM
  // ===================================================

  if (message.length > 4000) {

    message =
      message.slice(0, 3950) +
      "\n\n…" +
      `\n🔗 ${tweet.url}`;
  }

  let tweetSentSuccessfully = true;

  // ===================================================
  // КАРТИНКИ
  // ===================================================

  if (tweet.images.length > 0) {

    console.log(
      "Изображений:",
      tweet.images.length
    );

    for (
      let i = 0;
      i < tweet.images.length;
      i++
    ) {

      const imageUrl =
        tweet.images[i];

      const result =
        await telegramRequest(
          "sendPhoto",
          {
            chat_id:
              process.env.TELEGRAM_CHAT_ID,

            photo:
              imageUrl,

            caption:
              i === 0
                ? message.slice(0, 1024)
                : undefined,

            disable_notification:
              false
          }
        );

      if (!result.ok) {

        tweetSentSuccessfully = false;

        break;
      }

      // Небольшая пауза между картинками
      await sleep(700);
    }

  } else {

    // =================================================
    // ТЕКСТ / ВИДЕО / ССЫЛКА
    // =================================================

    const result =
      await telegramRequest(
        "sendMessage",
        {
          chat_id:
            process.env.TELEGRAM_CHAT_ID,

          text:
            message,

          disable_web_page_preview:
            false
        }
      );

    if (!result.ok) {

      tweetSentSuccessfully = false;
    }
  }

  // ===================================================
  // СОХРАНЯЕМ ID ТОЛЬКО ЕСЛИ УСПЕШНО ОТПРАВЛЕН
  // ===================================================

  if (tweetSentSuccessfully) {

    sentSet.add(
      tweet.id
    );

    console.log(
      "Твит успешно отправлен:",
      tweet.id
    );

  } else {

    console.log(
      "Твит НЕ был сохранён как отправленный:",
      tweet.id
    );
  }

  // ===================================================
  // ПАУЗА МЕЖДУ ТВИТАМИ
  // ===================================================

  await sleep(1000);
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

// =====================================================
// ЗАКРЫВАЕМ БРАУЗЕР
// =====================================================

await browser.close();
