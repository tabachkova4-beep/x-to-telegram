import { XClient } from "x-agent-sdk";

const x = new XClient({
  authToken: process.env.AUTH_TOKEN,
  ct0: process.env.CT0
});

try {
  const result = await x.homeTimelinePage(20);

  console.log("Тип результата:", typeof result);
  console.log("Ключи результата:", Object.keys(result || {}));
  console.log("Количество items:", result?.items?.length ?? "нет items");
  console.log("Есть cursor:", !!result?.cursor);

  if (result?.items?.length) {
    console.log("Первый элемент — ключи:", Object.keys(result.items[0] || {}));
  }
} catch (error) {
  console.error("ОШИБКА X:");
  console.error(error?.message || error);
}
