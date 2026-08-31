import { describe, expect, it, vi } from "vitest";
import { LogMailer, RESEND_MAX_BATCH, ResendMailer } from "./resend";
import type { Message } from "./types";

function msg(to: string): Message {
  return { to, subject: "s", html: "<p>h</p>", text: "t" };
}

function okResponse(ids: string[]): Response {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ResendMailer", () => {
  it("posts one batch with the key, the sender and both body parts", async () => {
    const fetchImpl = vi.fn(async () => okResponse(["id_1", "id_2"]));
    const mailer = new ResendMailer({
      apiKey: "re_test",
      from: "L <n@example.com>",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const out = await mailer.sendBatch([msg("a@example.com"), msg("b@example.com")]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails/batch");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");

    const body = JSON.parse(init.body as string);
    expect(body).toHaveLength(2);
    expect(body[0].from).toBe("L <n@example.com>");
    expect(body[0].to).toEqual(["a@example.com"]);
    // Both parts, always — an HTML-only message scores badly with spam filters.
    expect(body[0].html).toBe("<p>h</p>");
    expect(body[0].text).toBe("t");

    expect(out).toEqual([
      { providerId: "id_1", error: null },
      { providerId: "id_2", error: null },
    ]);
  });

  /** Ids come back positionally, which is what lets a batch still log per person. */
  it("returns one result per message, in order", async () => {
    const fetchImpl = vi.fn(async () => okResponse(["x", "y", "z"]));
    const mailer = new ResendMailer({
      apiKey: "k",
      from: "f",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await mailer.sendBatch(["a", "b", "c"].map(msg));
    expect(out.map((r) => r.providerId)).toEqual(["x", "y", "z"]);
  });

  it("still returns one result per message when the provider omits ids", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    const mailer = new ResendMailer({
      apiKey: "k",
      from: "f",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await mailer.sendBatch([msg("a"), msg("b")]);
    // The send succeeded; we simply cannot attribute an id. Not an error.
    expect(out).toEqual([
      { providerId: null, error: null },
      { providerId: null, error: null },
    ]);
  });

  /**
   * A refused chunk THROWS rather than returning per-recipient errors, because
   * nothing was sent — and a log row written for it would suppress the retry.
   */
  it("throws when the whole batch is refused, and carries the reason", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("API key not authorized for this domain", { status: 403 }),
    );
    const mailer = new ResendMailer({
      apiKey: "k",
      from: "f",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(mailer.sendBatch([msg("a")])).rejects.toThrow(/403.*not authorized/s);
  });

  it("chunks past the provider's batch limit rather than sending one huge request", async () => {
    const fetchImpl = vi.fn(async () => okResponse([]));
    const mailer = new ResendMailer({
      apiKey: "k",
      from: "f",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const many = Array.from({ length: RESEND_MAX_BATCH + 5 }, (_, i) => msg(`u${i}@e.com`));
    const out = await mailer.sendBatch(many);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(RESEND_MAX_BATCH + 5);
  });

  it("sends nothing at all for an empty list", async () => {
    const fetchImpl = vi.fn(async () => okResponse([]));
    const mailer = new ResendMailer({
      apiKey: "k",
      from: "f",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await mailer.sendBatch([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("LogMailer", () => {
  it("reports success for every message without touching the network", async () => {
    const out = await new LogMailer().sendBatch([msg("a"), msg("b")]);
    expect(out).toEqual([
      { providerId: null, error: null },
      { providerId: null, error: null },
    ]);
  });
});
