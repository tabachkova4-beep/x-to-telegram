import { XClient } from "x-agent-sdk";

console.log("x-agent-sdk загружен");

const x = new XClient({
  authToken: process.env.AUTH_TOKEN,
  ct0: process.env.CT0
});

try {
  const result = await x.homeTimelinePage(20);

  console.log("Результат:", JSON.stringify(result, null, 2).slice(0, 5000));
} catch (error) {
  console.error("ОШИБКА:");
  console.error(error?.stack || error);
}
