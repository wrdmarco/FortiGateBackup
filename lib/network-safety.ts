import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export const DEFAULT_EXTERNAL_TIMEOUT_MS = 20_000;
export const DEFAULT_TEXT_RESPONSE_LIMIT = 2 * 1024 * 1024;
export const DEFAULT_PUBLIC_RESPONSE_LIMIT = 512 * 1024;
const DEFAULT_PUBLIC_REDIRECT_LIMIT = 3;
const forbiddenFortiGateIpv4Addresses = new BlockList();
forbiddenFortiGateIpv4Addresses.addSubnet("0.0.0.0", 8, "ipv4");
forbiddenFortiGateIpv4Addresses.addSubnet("127.0.0.0", 8, "ipv4");
forbiddenFortiGateIpv4Addresses.addSubnet("169.254.0.0", 16, "ipv4");
forbiddenFortiGateIpv4Addresses.addSubnet("224.0.0.0", 4, "ipv4");
const forbiddenFortiGateIpv6Addresses = new BlockList();
forbiddenFortiGateIpv6Addresses.addAddress("::", "ipv6");
forbiddenFortiGateIpv6Addresses.addAddress("::1", "ipv6");
forbiddenFortiGateIpv6Addresses.addSubnet("::ffff:0:0", 96, "ipv6");
forbiddenFortiGateIpv6Addresses.addSubnet("fe80::", 10, "ipv6");
forbiddenFortiGateIpv6Addresses.addSubnet("ff00::", 8, "ipv6");

const forbiddenPublicIpv4Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  forbiddenPublicIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

const forbiddenPublicIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32]
] as const) {
  forbiddenPublicIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export type PublicAddressResolver = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

type PublicHttpsOptions = {
  timeoutMs?: number;
  maximumBytes?: number;
  maximumRedirects?: number;
  resolver?: PublicAddressResolver;
};

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_EXTERNAL_TIMEOUT_MS
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("Netwerktime-out moet groter dan nul zijn.");
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new Error(`Extern verzoek is na ${timeoutMs} ms afgebroken wegens een time-out.`, { cause: error });
    }
    throw error;
  }
}

/**
 * Performs an outbound HTTPS request with DNS pinning. Every redirect is
 * resolved and checked again so private-address redirects and DNS rebinding
 * cannot escape the public-network policy.
 */
export async function fetchPublicHttps(
  input: string | URL,
  init: RequestInit = {},
  options: PublicHttpsOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXTERNAL_TIMEOUT_MS;
  const maximumBytes = options.maximumBytes ?? DEFAULT_PUBLIC_RESPONSE_LIMIT;
  const maximumRedirects = options.maximumRedirects ?? DEFAULT_PUBLIC_REDIRECT_LIMIT;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("Netwerktime-out moet groter dan nul zijn.");
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) throw new Error("Responslimiet moet groter dan nul zijn.");
  if (!Number.isInteger(maximumRedirects) || maximumRedirects < 0 || maximumRedirects > 10) {
    throw new Error("Redirectlimiet moet tussen nul en tien liggen.");
  }

  let url = normalizePublicHttpsUrl(input);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await requestPinnedPublicHttps(
      url,
      { ...init, method, body, headers },
      { timeoutMs, maximumBytes, resolver: options.resolver }
    );
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirectCount >= maximumRedirects) {
      throw new Error(`Externe HTTPS-service overschreed de redirectlimiet van ${maximumRedirects}.`);
    }

    const previousOrigin = url.origin;
    url = normalizePublicHttpsUrl(new URL(location, url));
    if (url.origin !== previousOrigin) {
      throw new Error("Externe HTTPS-service probeerde naar een ander origin te redirecten.");
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      headers.delete("content-length");
      headers.delete("content-type");
    }
  }
}

export function normalizePublicHttpsUrl(input: string | URL) {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new Error("Externe HTTPS-URL is ongeldig.", { cause: error });
  }
  if (url.protocol !== "https:") throw new Error("Externe service vereist HTTPS.");
  if (url.username || url.password) throw new Error("Externe HTTPS-URL mag geen inloggegevens bevatten.");
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Externe HTTPS-URL verwijst naar een verboden lokale host.");
  }
  if (isIP(hostname)) assertPublicNetworkAddress(hostname);
  return url;
}

export async function resolveAllowedPublicAddress(
  hostname: string,
  resolver: PublicAddressResolver = resolvePublicDnsAddresses
) {
  const normalized = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")) {
    throw new Error("Externe host verwijst naar een verboden lokale host.");
  }
  if (isIP(normalized)) {
    assertPublicNetworkAddress(normalized);
    return { address: normalized, family: isIP(normalized) };
  }

  const addresses = await withDeadline(
    resolver(normalized),
    5_000,
    "Externe DNS-resolutie duurde langer dan 5000 ms."
  );
  if (!addresses.length) throw new Error("Externe hostnaam kon niet naar een IP-adres worden vertaald.");
  for (const item of addresses) {
    if (item.family !== 4 && item.family !== 6) throw new Error("Externe DNS-resolutie gaf een onbekende adresfamilie terug.");
    assertPublicNetworkAddress(item.address);
  }
  return addresses[0];
}

export function assertPublicNetworkAddress(address: string) {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const family = isIP(normalized);
  if (!family) throw new Error("Externe host gaf geen geldig IP-adres terug.");
  if (family === 4 && forbiddenPublicIpv4Addresses.check(normalized, "ipv4")) {
    throw new Error("Externe host verwijst naar een verboden prive-, lokale of gereserveerde IPv4-range.");
  }
  if (family === 6) {
    const firstHextet = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
    const globallyRoutable = firstHextet >= 0x2000 && firstHextet <= 0x3fff;
    if (!globallyRoutable || forbiddenPublicIpv6Addresses.check(normalized, "ipv6")) {
      throw new Error("Externe host verwijst naar een verboden prive-, lokale of gereserveerde IPv6-range.");
    }
  }
}

export async function readResponseBuffer(response: Response, maximumBytes = DEFAULT_TEXT_RESPONSE_LIMIT) {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) throw new Error("Responslimiet moet groter dan nul zijn.");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Externe respons overschrijdt de limiet van ${maximumBytes} bytes.`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("response-size-limit").catch(() => undefined);
      throw new Error(`Externe respons overschrijdt de limiet van ${maximumBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export async function readResponseText(response: Response, maximumBytes = DEFAULT_TEXT_RESPONSE_LIMIT) {
  return (await readResponseBuffer(response, maximumBytes)).toString("utf8");
}

export async function readResponseJson<T>(response: Response, maximumBytes = DEFAULT_TEXT_RESPONSE_LIMIT): Promise<T> {
  const text = await readResponseText(response, maximumBytes);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error("Externe service gaf geen geldige JSON-respons.", { cause: error });
  }
}

export function normalizeHttpsServiceBaseUrl(
  value: string,
  fallback: string,
  service: string,
  allowedDomains: string[]
) {
  const raw = value.trim() || fallback;
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (url.protocol !== "https:") throw new Error(`${service} vereist HTTPS.`);
  if (url.username || url.password) throw new Error(`${service} URL mag geen gebruikersnaam of wachtwoord bevatten.`);
  if (url.search || url.hash) throw new Error(`${service} basis-URL mag geen querystring of fragment bevatten.`);

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error(`${service} URL gebruikt geen toegestaan servicedomein.`);
  }
  return url.toString().replace(/\/+$/, "");
}

export function normalizeFortiGateBaseUrl(managementUrl: string, httpsPort: number, tlsVerify: boolean) {
  let url: URL;
  try {
    url = new URL(managementUrl);
  } catch (error) {
    throw new Error("FortiGate management-URL is ongeldig.", { cause: error });
  }
  if (url.protocol !== "https:") throw new Error("FortiGate API-verkeer vereist HTTPS.");
  if (!tlsVerify) throw new Error("FortiGate TLS-certificaatcontrole moet zijn ingeschakeld.");
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) {
    throw new Error("FortiGate HTTPS-poort moet tussen 1 en 65535 liggen.");
  }
  if (url.username || url.password) throw new Error("FortiGate management-URL mag geen inloggegevens bevatten.");
  if (url.search || url.hash) throw new Error("FortiGate management-URL mag geen querystring of fragment bevatten.");
  if (url.pathname && url.pathname !== "/") throw new Error("FortiGate management-URL mag geen pad bevatten.");

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("FortiGate management-URL verwijst naar een verboden lokale host.");
  }
  if (isIP(hostname)) assertAllowedFortiGateAddress(hostname);

  url.port = String(httpsPort);
  url.pathname = "/";
  return url;
}

export async function resolveAllowedFortiGateAddress(hostname: string) {
  const normalized = stripIpv6Brackets(hostname);
  if (isIP(normalized)) {
    assertAllowedFortiGateAddress(normalized);
    return { address: normalized, family: isIP(normalized) };
  }

  const addresses = await withDeadline(
    lookup(normalized, { all: true, verbatim: true }),
    5_000,
    "FortiGate DNS-resolutie duurde langer dan 5000 ms."
  );
  if (!addresses.length) throw new Error("FortiGate hostnaam kon niet worden vertaald naar een IP-adres.");
  for (const item of addresses) assertAllowedFortiGateAddress(item.address);
  return addresses[0];
}

export function pinnedLookup(address: string, family: number): LookupFunction {
  return (_hostname, _options, callback) => callback(null, address, family);
}

async function requestPinnedPublicHttps(
  url: URL,
  init: RequestInit,
  options: { timeoutMs: number; maximumBytes: number; resolver?: PublicAddressResolver }
) {
  const resolvedAddress = await resolveAllowedPublicAddress(url.hostname, options.resolver);
  const body = await requestBodyBuffer(init.body);
  const requestHeaders = Object.fromEntries(new Headers(init.headers).entries());

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(overallTimeout);
      init.signal?.removeEventListener("abort", abortRequest);
    };
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const req = httpsRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: requestHeaders,
        rejectUnauthorized: true,
        lookup: pinnedLookup(resolvedAddress.address, resolvedAddress.family),
        timeout: options.timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const declaredLength = Number(res.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > options.maximumBytes) {
          res.destroy(new Error(`Externe respons overschrijdt de limiet van ${options.maximumBytes} bytes.`));
          return;
        }
        res.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.byteLength;
          if (total > options.maximumBytes) {
            res.destroy(new Error(`Externe respons overschrijdt de limiet van ${options.maximumBytes} bytes.`));
            return;
          }
          chunks.push(buffer);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          cleanup();
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
            else if (value !== undefined) responseHeaders.set(name, String(value));
          }
          const responseBody = total ? Buffer.concat(chunks, total) : null;
          resolve(
            new Response(responseBody, {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage,
              headers: responseHeaders
            })
          );
        });
        res.on("error", finishWithError);
        res.on("aborted", () => finishWithError(new Error("Externe HTTPS-service brak de respons voortijdig af.")));
      }
    );
    const abortRequest = () => req.destroy(new Error("Extern HTTPS-verzoek is afgebroken."));
    req.on("timeout", () => req.destroy(new Error(`Extern HTTPS-verzoek is na ${options.timeoutMs} ms afgebroken.`)));
    req.on("error", finishWithError);
    if (init.signal?.aborted) {
      abortRequest();
      return;
    }
    init.signal?.addEventListener("abort", abortRequest, { once: true });
    const overallTimeout = setTimeout(abortRequest, options.timeoutMs);
    overallTimeout.unref();
    if (body) req.write(body);
    req.end();
  });
}

async function requestBodyBuffer(body: BodyInit | null | undefined) {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new Error("Dit type requestbody wordt niet ondersteund voor beveiligde externe HTTPS-verzoeken.");
}

async function resolvePublicDnsAddresses(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

export function safeFilenameSegment(value: string | null | undefined, fallback: string, maximumLength = 80) {
  const sanitize = (source: string) =>
    source
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, maximumLength)
      .replace(/[.-]+$/g, "");
  let result = sanitize(value?.trim() || "") || sanitize(fallback) || "fortigate";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result;
}

function assertAllowedFortiGateAddress(address: string) {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const family = isIP(normalized);
  if (
    (family === 4 && forbiddenFortiGateIpv4Addresses.check(normalized, "ipv4")) ||
    (family === 6 && forbiddenFortiGateIpv6Addresses.check(normalized, "ipv6"))
  ) {
    throw new Error("FortiGate host verwijst naar een verboden loopback, link-local, multicast of gereserveerd IP-adres.");
  }
}

function stripIpv6Brackets(value: string) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        timeout.unref();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
