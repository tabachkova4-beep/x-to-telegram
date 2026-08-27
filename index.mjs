import { XClient } from "x-agent-sdk";

const x = new XClient({
  authToken: process.env.AUTH_TOKEN,
  ct0: process.env.CT0
});

const { items } = await x.homeTimelinePage(20);

console.log(`Получено твитов: ${items.length}`);

for (const tweet of items) {
  console.log(
    `@${tweet.author?.screen_name ?? tweet.author?.username ?? "unknown"}: ${tweet.text}`
  );
}
