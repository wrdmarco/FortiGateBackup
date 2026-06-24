type FirmwareStatus = "up-to-date" | "update-available" | "unknown";

export type FirmwareCheckResult = {
  status: FirmwareStatus;
  installedVersion: string | null;
  latestVersion: string | null;
  branch: string | null;
  checkedAt: string;
  sourceUrl: string | null;
  message: string;
};

const RELEASE_CACHE_TTL_MS = 1000 * 60 * 60;
const releaseCache = new Map<string, { value: FirmwareCheckResult; expiresAt: number }>();

export async function checkFortiOsFirmware(installedVersion?: string | null): Promise<FirmwareCheckResult> {
  const normalized = normalizeVersion(installedVersion);
  const checkedAt = new Date().toISOString();
  if (!normalized) {
    return {
      status: "unknown",
      installedVersion: installedVersion ?? null,
      latestVersion: null,
      branch: null,
      checkedAt,
      sourceUrl: null,
      message: "Geen firmwareversie bekend."
    };
  }

  const branch = firmwareBranch(normalized);
  if (!branch) {
    return {
      status: "unknown",
      installedVersion: normalized,
      latestVersion: null,
      branch: null,
      checkedAt,
      sourceUrl: null,
      message: "Firmwareversie kon niet aan een FortiOS branch gekoppeld worden."
    };
  }

  const cached = releaseCache.get(branch);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, installedVersion: normalized, checkedAt };
  }

  const sourceUrl = `https://docs.fortinet.com/product/fortigate/${branch}`;
  try {
    const latestVersion = await latestFortiOsVersion(sourceUrl, branch);
    const status = compareVersions(normalized, latestVersion) >= 0 ? "up-to-date" : "update-available";
    const value: FirmwareCheckResult = {
      status,
      installedVersion: normalized,
      latestVersion,
      branch,
      checkedAt,
      sourceUrl,
      message:
        status === "up-to-date"
          ? `FortiOS ${normalized} is actueel binnen branch ${branch}.`
          : `FortiOS ${latestVersion} is beschikbaar binnen branch ${branch}.`
    };
    releaseCache.set(branch, { value, expiresAt: Date.now() + RELEASE_CACHE_TTL_MS });
    return value;
  } catch (error) {
    return {
      status: "unknown",
      installedVersion: normalized,
      latestVersion: null,
      branch,
      checkedAt,
      sourceUrl,
      message: error instanceof Error ? error.message : "Online firmwarecheck is mislukt."
    };
  }
}

async function latestFortiOsVersion(sourceUrl: string, branch: string) {
  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": "FortiGateBackup firmware checker" },
    next: { revalidate: 3600 }
  });
  if (!response.ok) {
    throw new Error(`Fortinet docs gaf HTTP ${response.status} terug.`);
  }
  const html = await response.text();
  const releaseSection = html.match(/Release Information[\s\S]*?Release Notes([\s\S]*?)(?:Last updated|<\/body>)/i)?.[1] ?? html;
  const versions = Array.from(releaseSection.matchAll(new RegExp(`\\b${escapeRegExp(branch)}(?:\\.\\d+)?\\b`, "g")))
    .map((match) => normalizeVersion(match[0]))
    .filter((version): version is string => Boolean(version))
    .filter((version, index, all) => all.indexOf(version) === index)
    .sort(compareVersions)
    .reverse();
  if (!versions[0]) {
    throw new Error(`Geen FortiOS release notes gevonden voor branch ${branch}.`);
  }
  return versions[0];
}

function normalizeVersion(value?: string | null) {
  if (!value) return null;
  return value.match(/\d+(?:\.\d+){1,3}/)?.[0] ?? null;
}

function firmwareBranch(version: string) {
  const parts = version.split(".");
  if (parts.length < 2) return null;
  return `${parts[0]}.${parts[1]}`;
}

function compareVersions(a: string, b: string) {
  const left = a.split(".").map((part) => Number(part));
  const right = b.split(".").map((part) => Number(part));
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
