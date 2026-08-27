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

const title = await page.title();
console.log("Title:", title);

const articles = await page.locator("article").count();

console.log("Найдено постов:", articles);

const tweets = await page.locator('article a[href*="/status/"]').evaluateAll(
  links => {
    const result = [];
    const seen = new Set();

    for (const link of links) {
      const href = link.href;
      const match = href.match(/\/status\/(\d+)/);

      if (!match) continue;

      const id = match[1];

      if (seen.has(id)) continue;

      seen.add(id);

      result.push({
        id,
        url: href
      });
    }

    return result;
  }
);

console.log("Найдено уникальных твитов:", tweets.length);

for (const tweet of tweets.slice(0, 10)) {
  console.log(tweet.id, tweet.url);
}

await browser.close();
