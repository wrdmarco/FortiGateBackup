type HealthOptions = {
  url: string;
  initialDelayMs: number;
  retries: number;
  retryDelayMs: number;
  timeoutMs: number;
};

const defaults: HealthOptions = {
  url: "http://127.0.0.1:3000/api/health",
  initialDelayMs: 0,
  retries: 1,
  retryDelayMs: 2000,
  timeoutMs: 5000
};

function usage() {
  return [
    "Usage: pnpm run health -- [options]",
    "  --url <url>",
    "  --initial-delay-ms <milliseconds>",
    "  --retries <attempts>",
    "  --retry-delay-ms <milliseconds>",
    "  --timeout-ms <milliseconds>"
  ].join("\n");
}

function optionValue(args: string[], index: number) {
  const argument = args[index];
  const equalsIndex = argument.indexOf("=");
  if (equalsIndex >= 0) {
    return { name: argument.slice(0, equalsIndex), value: argument.slice(equalsIndex + 1), consumed: 1 };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
  return { name: argument, value, consumed: 2 };
}

function integerOption(name: string, value: string, minimum: number, maximum: number) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseOptions(args: string[]): HealthOptions {
  const options = { ...defaults };
  for (let index = 0; index < args.length; ) {
    if (args[index] === "--") {
      index += 1;
      continue;
    }
    if (args[index] === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (!args[index].startsWith("--")) throw new Error(`Unknown argument: ${args[index]}`);
    const parsed = optionValue(args, index);
    index += parsed.consumed;

    switch (parsed.name) {
      case "--url": {
        const url = new URL(parsed.value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error("--url must use http or https.");
        }
        options.url = url.toString();
        break;
      }
      case "--initial-delay-ms":
        options.initialDelayMs = integerOption(parsed.name, parsed.value, 0, 600_000);
        break;
      case "--retries":
        options.retries = integerOption(parsed.name, parsed.value, 1, 300);
        break;
      case "--retry-delay-ms":
        options.retryDelayMs = integerOption(parsed.name, parsed.value, 0, 60_000);
        break;
      case "--timeout-ms":
        options.timeoutMs = integerOption(parsed.name, parsed.value, 100, 60_000);
        break;
      default:
        throw new Error(`Unknown option: ${parsed.name}`);
    }
  }
  return options;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function check(url: string, timeoutMs: number) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = (await response.json()) as { status?: unknown };
  if (body.status !== "ok") throw new Error(`unexpected response: ${JSON.stringify(body)}`);
}

let options: HealthOptions;
try {
  options = parseOptions(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid health check options.");
  console.error(usage());
  process.exit(2);
}

if (options.initialDelayMs > 0) {
  console.log(`Waiting ${options.initialDelayMs}ms before the first health check.`);
  await wait(options.initialDelayMs);
}

let lastError = "unknown error";
for (let attempt = 1; attempt <= options.retries; attempt += 1) {
  try {
    await check(options.url, options.timeoutMs);
    console.log("ok");
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : "unknown error";
    if (attempt < options.retries) {
      console.error(`Health check attempt ${attempt}/${options.retries} failed: ${lastError}`);
      if (options.retryDelayMs > 0) await wait(options.retryDelayMs);
    }
  }
}

console.error(`Health check failed after ${options.retries} attempt(s) for ${options.url}: ${lastError}`);
process.exit(1);

export {};
