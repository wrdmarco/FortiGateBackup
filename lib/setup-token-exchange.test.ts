import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/lib/db";
import {
  exchangeSetupToken,
  hashOneTimeToken,
  setupTokenCookieOptions,
  setupTokenIsValid
} from "@/lib/setup-token";

test("setup-token wordt atomair omgewisseld en het oorspronkelijke token wordt direct ongeldig", async () => {
  const rawToken = `setup-exchange-${process.pid}-${Date.now()}-${"x".repeat(40)}`;

  try {
    await prisma.setupToken.deleteMany();
    await prisma.setupToken.create({
      data: {
        tokenHash: hashOneTimeToken(rawToken),
        expires: new Date(Date.now() + 60_000)
      }
    });

    const attempts = await Promise.all([exchangeSetupToken(rawToken), exchangeSetupToken(rawToken)]);
    const exchanged = attempts.filter((value): value is string => Boolean(value));

    assert.equal(exchanged.length, 1);
    assert.equal(await setupTokenIsValid(rawToken), false);
    assert.equal(await setupTokenIsValid(exchanged[0]), true);
    assert.equal((await prisma.setupToken.findFirstOrThrow()).tokenHash, hashOneTimeToken(exchanged[0]));
  } finally {
    await prisma.setupToken.deleteMany();
  }
});

test("setup-cookie is afgeschermd tegen scripts en cross-site formulierverzoeken", () => {
  const options = setupTokenCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "strict");
  assert.equal(options.path, "/");
  assert.ok(options.maxAge > 0);
});
