import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicNetworkAddress,
  normalizeFortiGateBaseUrl,
  normalizeHttpsServiceBaseUrl,
  normalizePublicHttpsUrl,
  readResponseText,
  resolveAllowedPublicAddress,
  safeFilenameSegment
} from "./network-safety";

test("maakt remote hostnamen onschadelijk voor bestandsopslag", () => {
  const segment = safeFilenameSegment("../../klant\\firewall:name", "fortigate");
  assert.equal(segment, "klant-firewall-name");
  assert.equal(segment.includes(".."), false);
  assert.equal(segment.includes("/"), false);
  assert.equal(segment.includes("\\"), false);
});

test("FortiGate transport vereist HTTPS en certificaatcontrole", () => {
  assert.throws(() => normalizeFortiGateBaseUrl("http://10.0.0.1", 443, true), /HTTPS/i);
  assert.throws(() => normalizeFortiGateBaseUrl("https://10.0.0.1", 443, false), /certificaatcontrole/i);
  assert.throws(() => normalizeFortiGateBaseUrl("https://127.0.0.1", 443, true), /verboden/i);
  assert.throws(() => normalizeFortiGateBaseUrl("https://[::ffff:127.0.0.1]", 443, true), /verboden/i);
  assert.equal(normalizeFortiGateBaseUrl("https://10.0.0.1", 8443, true).toString(), "https://10.0.0.1:8443/");
});

test("integratie-URL blijft op het servicedomein", () => {
  assert.equal(
    normalizeHttpsServiceBaseUrl("https://api.eu.itglue.com", "https://api.itglue.com", "IT Glue", ["itglue.com"]),
    "https://api.eu.itglue.com"
  );
  assert.throws(
    () => normalizeHttpsServiceBaseUrl("https://example.test", "https://api.itglue.com", "IT Glue", ["itglue.com"]),
    /servicedomein/i
  );
});

test("breekt te grote externe responsen af", async () => {
  const response = new Response("1234567890");
  await assert.rejects(() => readResponseText(response, 5), /limiet/i);
});

test("bestandssegmenten begrenzen lengte, unicode en gereserveerde apparaatnamen", () => {
  assert.equal(safeFilenameSegment("  Fóó / Bar  ", "fallback"), "Foo-Bar");
  assert.equal(safeFilenameSegment("CON", "fallback"), "_CON");
  assert.equal(safeFilenameSegment("...", "fallback"), "fallback");
  assert.equal(safeFilenameSegment("a".repeat(200), "fallback", 32).length, 32);
});

test("FortiGate URL weigert credentials, paden, queries en lokale adressen", () => {
  assert.throws(() => normalizeFortiGateBaseUrl("https://user:pass@10.0.0.1", 443, true), /inloggegevens/i);
  assert.throws(() => normalizeFortiGateBaseUrl("https://10.0.0.1/api", 443, true), /pad/i);
  assert.throws(() => normalizeFortiGateBaseUrl("https://10.0.0.1?token=x", 443, true), /querystring/i);
  assert.throws(() => normalizeFortiGateBaseUrl("https://localhost", 443, true), /lokale host/i);
  assert.throws(() => normalizeFortiGateBaseUrl("https://169.254.10.20", 443, true), /verboden/i);
  assert.throws(() => normalizeFortiGateBaseUrl("https://10.0.0.1", 65536, true), /poort/i);
});

test("integratie-URL voorkomt deceptieve hosts en embedded credentials", () => {
  assert.throws(
    () => normalizeHttpsServiceBaseUrl("https://itglue.com.evil.example", "https://api.itglue.com", "IT Glue", ["itglue.com"]),
    /servicedomein/i
  );
  assert.throws(
    () => normalizeHttpsServiceBaseUrl("https://user:pass@api.itglue.com", "https://api.itglue.com", "IT Glue", ["itglue.com"]),
    /gebruikersnaam/i
  );
  assert.throws(
    () => normalizeHttpsServiceBaseUrl("http://api.itglue.com", "https://api.itglue.com", "IT Glue", ["itglue.com"]),
    /HTTPS/i
  );
});

test("publieke webhook-URLs blokkeren lokale, prive- en gereserveerde netwerken", () => {
  assert.throws(() => normalizePublicHttpsUrl("http://hooks.example.com/backup"), /HTTPS/i);
  assert.throws(() => normalizePublicHttpsUrl("https://localhost/backup"), /lokale host/i);
  assert.throws(() => normalizePublicHttpsUrl("https://127.0.0.1/backup"), /verboden/i);
  assert.throws(() => normalizePublicHttpsUrl("https://10.20.30.40/backup"), /verboden/i);
  assert.throws(() => normalizePublicHttpsUrl("https://172.16.1.1/backup"), /verboden/i);
  assert.throws(() => normalizePublicHttpsUrl("https://192.168.1.1/backup"), /verboden/i);
  assert.throws(() => normalizePublicHttpsUrl("https://[fc00::1]/backup"), /verboden/i);
  assert.throws(() => normalizePublicHttpsUrl("https://user:pass@8.8.8.8/backup"), /inloggegevens/i);
  assert.doesNotThrow(() => normalizePublicHttpsUrl("https://8.8.8.8/backup?tenant=one"));
  assert.doesNotThrow(() => assertPublicNetworkAddress("2606:4700:4700::1111"));
});

test("DNS-resolutie weigert een host zodra een antwoord naar een intern adres wijst", async () => {
  await assert.rejects(
    () =>
      resolveAllowedPublicAddress("hooks.example.com", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 }
      ]),
    /verboden/i
  );
});

test("DNS-resolutie levert uitsluitend een vooraf gecontroleerd publiek pin-adres", async () => {
  let calls = 0;
  const result = await resolveAllowedPublicAddress("hooks.example.com", async (hostname) => {
    calls += 1;
    assert.equal(hostname, "hooks.example.com");
    return [{ address: "93.184.216.34", family: 4 }];
  });
  assert.deepEqual(result, { address: "93.184.216.34", family: 4 });
  assert.equal(calls, 1);
});
