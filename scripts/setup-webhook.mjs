const workerUrl = process.env.WORKER_URL?.replace(/\/+$/u, "");
const webhookSecret = process.env.WEBHOOK_SECRET;

if (!workerUrl || !webhookSecret) {
  console.error("Set WORKER_URL and WEBHOOK_SECRET in your local environment first.");
  process.exit(2);
}

const url = new URL(workerUrl);
if (url.protocol !== "https:") {
  console.error("WORKER_URL must use HTTPS.");
  process.exit(2);
}

const response = await fetch(`${workerUrl}/__setup`, {
  method: "POST",
  headers: { "x-setup-secret": webhookSecret },
});
const result = await response.json().catch(() => ({}));
if (!response.ok || !result.ok) {
  console.error("Webhook setup failed:", result.description ?? response.statusText);
  process.exit(1);
}
console.log("Telegram webhook registered successfully.");
