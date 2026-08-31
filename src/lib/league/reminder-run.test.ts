import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { runReminderSend } from "./reminder-run";
import type { Mailer, Message, SendResult } from "../mail/types";

/**
 * A stand-in for the service-role client: enough of `.rpc` to answer
 * `reminder_due` and record every `record_reminder_send` call for inspection.
 * There is no jsdom or Supabase in this suite, and the behaviour worth pinning
 * here is the decision-making rather than the SQL — 0015's own guarantees are
 * verified against a real Postgres instead.
 */
function fakeClient(due: Record<string, unknown>[], opts: { dueError?: string } = {}) {
  const writes: Record<string, unknown>[] = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "reminder_due") {
        if (opts.dueError) return { data: null, error: { message: opts.dueError } };
        return { data: due, error: null };
      }
      if (fn === "record_reminder_send") {
        writes.push(args);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    }),
  } as unknown as SupabaseClient<Database>;
  return { client, writes };
}

function row(id: string, email: string | null, first = "Ada") {
  return { user_id: id, first_name: first, last_name: "B", email, last_sent_at: null };
}

class CapturingMailer implements Mailer {
  readonly name = "capture";
  sent: Message[] = [];
  constructor(private readonly behaviour: (m: Message[]) => SendResult[] = (m) =>
    m.map(() => ({ providerId: "p", error: null }))) {}
  async sendBatch(messages: Message[]): Promise<SendResult[]> {
    this.sent.push(...messages);
    return this.behaviour(messages);
  }
}

class ThrowingMailer implements Mailer {
  readonly name = "throwing";
  async sendBatch(): Promise<SendResult[]> {
    throw new Error("Resend responded 403");
  }
}

const BASE = {
  groupId: "g1",
  kind: "pick" as const,
  season: 2026,
  week: 5,
  leagueName: "Sheep with Glasses",
  buyInCents: 5000,
  deadlineIso: "2026-10-05T20:15:00Z",
  partiallyStarted: false,
  appUrl: "https://sheepwithglasses.com",
  now: new Date("2026-10-01T12:00:00Z"),
};

describe("runReminderSend", () => {
  it("mails everyone due when no selection is given, and logs one row each", async () => {
    const { client, writes } = fakeClient([row("u1", "a@e.com"), row("u2", "b@e.com")]);
    const mailer = new CapturingMailer();

    const out = await runReminderSend(client, { ...BASE, mailer });

    expect(out.httpStatus).toBe(200);
    expect(out.body.sent).toBe(2);
    expect(mailer.sent.map((m) => m.to)).toEqual(["a@e.com", "b@e.com"]);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.p_status).toBe("sent");
    expect(writes[0]?.p_week).toBe(5);
  });

  /**
   * The rule that keeps per-recipient tickboxes from becoming an open relay:
   * ids only ever filter the database's answer.
   */
  it("narrows to the ticked selection", async () => {
    const { client } = fakeClient([row("u1", "a@e.com"), row("u2", "b@e.com")]);
    const mailer = new CapturingMailer();
    await runReminderSend(client, { ...BASE, mailer, userIds: ["u2"] });
    expect(mailer.sent.map((m) => m.to)).toEqual(["b@e.com"]);
  });

  it("cannot WIDEN past what the database said was due", async () => {
    // A hand-rolled POST naming a member who has since picked, or who was never
    // due, reaches nobody: reminder_due is the authoritative set.
    const { client, writes } = fakeClient([row("u1", "a@e.com")]);
    const mailer = new CapturingMailer();
    const out = await runReminderSend(client, {
      ...BASE,
      mailer,
      userIds: ["someone-else", "u999"],
    });
    expect(mailer.sent).toHaveLength(0);
    expect(writes).toHaveLength(0);
    expect(out.body.detail).toBe("nobody-due");
    expect(out.httpStatus).toBe(200);
  });

  it("skips a member with no address rather than failing the run", async () => {
    const { client } = fakeClient([row("u1", null), row("u2", "b@e.com")]);
    const mailer = new CapturingMailer();
    const out = await runReminderSend(client, { ...BASE, mailer });
    expect(mailer.sent.map((m) => m.to)).toEqual(["b@e.com"]);
    expect(out.body.sent).toBe(1);
  });

  /**
   * The dry run's whole promise. Writing the log here would burn 0015's
   * idempotence keys and silently suppress the real send afterwards.
   */
  it("renders and reports on a dry run but writes NOTHING", async () => {
    const { client, writes } = fakeClient([row("u1", "a@e.com"), row("u2", "b@e.com")]);
    const mailer = new CapturingMailer();
    const out = await runReminderSend(client, { ...BASE, mailer, dryRun: true });

    expect(out.body.detail).toBe("dry-run");
    expect(out.body.wouldSend).toBe(2);
    expect(out.body.sent).toBe(0);
    expect(writes).toHaveLength(0);
  });

  /**
   * A refused chunk sent nothing, so a log row for it would suppress a retry
   * for people who never got an email.
   */
  it("writes no rows when the provider refuses the batch, and reports 502", async () => {
    const { client, writes } = fakeClient([row("u1", "a@e.com")]);
    const out = await runReminderSend(client, { ...BASE, mailer: new ThrowingMailer() });

    expect(out.httpStatus).toBe(502);
    expect(out.body.detail).toBe("provider");
    expect(out.body.sent).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("records a per-recipient failure as failed, so it can be retried", async () => {
    const { client, writes } = fakeClient([row("u1", "a@e.com"), row("u2", "b@e.com")]);
    const mailer = new CapturingMailer((m) =>
      m.map((x, i) => (i === 0 ? { providerId: null, error: "bounced" } : { providerId: "p", error: null })),
    );
    const out = await runReminderSend(client, { ...BASE, mailer });

    expect(out.body.sent).toBe(1);
    expect(out.body.failed).toBe(1);
    expect(writes.map((w) => w.p_status)).toEqual(["failed", "sent"]);
    expect(writes[0]?.p_error).toBe("bounced");
  });

  it("never lets a log-write failure fail the send", async () => {
    const writes: Record<string, unknown>[] = [];
    const client = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        if (fn === "reminder_due") return { data: [row("u1", "a@e.com")], error: null };
        writes.push(args);
        // 0015 not applied: the function does not exist.
        return { data: null, error: { message: "schema cache", code: "PGRST202" } };
      }),
    } as unknown as SupabaseClient<Database>;

    const out = await runReminderSend(client, { ...BASE, mailer: new CapturingMailer() });
    expect(out.httpStatus).toBe(200);
    expect(out.body.sent).toBe(1);
  });

  it("reports a due-read failure without sending anything", async () => {
    const { client } = fakeClient([], { dueError: "permission denied" });
    const mailer = new CapturingMailer();
    const out = await runReminderSend(client, { ...BASE, mailer });
    expect(out.httpStatus).toBe(500);
    expect(out.body.detail).toBe("due-read");
    expect(mailer.sent).toHaveLength(0);
  });

  it("refuses a pick send with no week, since there is nothing to talk about", async () => {
    const { client } = fakeClient([row("u1", "a@e.com")]);
    const mailer = new CapturingMailer();
    const out = await runReminderSend(client, { ...BASE, mailer, week: null });
    expect(out.body.detail).toBe("no-week");
    expect(mailer.sent).toHaveLength(0);
  });

  it("says so when no mailer is configured, rather than throwing", async () => {
    const { client } = fakeClient([row("u1", "a@e.com")]);
    // No `mailer` and no RESEND_API_KEY in the test env → getMailer() is null.
    const out = await runReminderSend(client, { ...BASE, mailer: undefined });
    expect(out.httpStatus).toBe(500);
    expect(out.body.detail).toBe("mail-unconfigured");
  });

  describe("buy-in reminders", () => {
    it("log a null week, so the pick index cannot collide with them", async () => {
      const { client, writes } = fakeClient([row("u1", "a@e.com")]);
      const mailer = new CapturingMailer();
      await runReminderSend(client, { ...BASE, kind: "buy_in", week: null, mailer });
      expect(writes[0]?.p_week).toBeNull();
      expect(writes[0]?.p_kind).toBe("buy_in");
    });

    it("point at the account page, where the money is", async () => {
      const { client } = fakeClient([row("u1", "a@e.com")]);
      const mailer = new CapturingMailer();
      await runReminderSend(client, { ...BASE, kind: "buy_in", week: null, mailer });
      expect(mailer.sent[0]?.text).toContain("https://sheepwithglasses.com/app/account");
    });

    it("send a buy-in even while a pick week is open, week untouched", async () => {
      const { client, writes } = fakeClient([row("u1", "a@e.com")]);
      const mailer = new CapturingMailer();
      // week: 5 is passed but the kind is buy_in — the week must not be logged.
      await runReminderSend(client, { ...BASE, kind: "buy_in", mailer });
      expect(writes[0]?.p_week).toBeNull();
    });
  });

  it("points a pick reminder at the picks page", async () => {
    const { client } = fakeClient([row("u1", "a@e.com")]);
    const mailer = new CapturingMailer();
    await runReminderSend(client, { ...BASE, mailer });
    expect(mailer.sent[0]?.text).toContain("https://sheepwithglasses.com/app");
  });
});
