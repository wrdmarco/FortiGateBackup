const url = process.env.HEALTH_URL ?? "http://127.0.0.1:3000/api/health";

const response = await fetch(url);
if (!response.ok) {
  console.error(`Health check failed with status ${response.status}`);
  process.exit(1);
}
const body = await response.json();
if (body.status !== "ok") {
  console.error(JSON.stringify(body));
  process.exit(1);
}
console.log("ok");

export {};
