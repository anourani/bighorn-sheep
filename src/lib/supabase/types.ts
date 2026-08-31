/**
 * Hand-written database types mirroring supabase/migrations/0001_init.sql.
 * (In a real project you'd generate these with `supabase gen types typescript`.)
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          avatar_url: string | null;
          /** One of src/lib/profile/animals.ts — validated in the action, not by a constraint. */
          favorite_animal: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          first_name?: string;
          last_name?: string;
          avatar_url?: string | null;
          favorite_animal?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          avatar_url?: string | null;
          favorite_animal?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * Private per-user fields, split out of world-readable `profiles` in 0008.
       * RLS: readable by the owner and by admins of leagues the owner belongs to
       * (via is_admin_for_member); writable only by the owner. Queries against it
       * come back filtered, not erroring — select .in(...) a list of ids and you
       * receive only the rows you're entitled to.
       */
      profile_private: {
        Row: {
          id: string;
          /** Optional; free text, never parsed or dialled. */
          phone: string | null;
          /**
           * Added by 0015. Nothing in the app writes it yet — the SQL editor is
           * the escape hatch — and it is read only inside `reminder_due`, so no
           * .select() in the app names it. That matters: PostgREST raises 42703
           * on an unknown column rather than returning undefined, so naming it
           * before the migration lands would fail the whole query.
           */
          reminder_opt_out: boolean;
        };
        Insert: {
          id: string;
          phone?: string | null;
          reminder_opt_out?: boolean;
        };
        Update: {
          id?: string;
          phone?: string | null;
          reminder_opt_out?: boolean;
        };
        Relationships: [];
      };
      /**
       * One row per player who has closed their own account (0010). Written
       * only by close_own_account(): RLS is on and there is deliberately no
       * insert, update or delete policy, because 0001's "profiles update own"
       * shows why a `profiles.deleted_at` column would not have worked — RLS
       * cannot restrict which columns an update writes, so the locked-out
       * account could clear its own lockout with the anon key.
       *
       * Closing is not deleting. The profile, membership, picks and strikes all
       * survive so the standings board keeps its record of the season.
       */
      account_closures: {
        Row: {
          id: string;
          closed_at: string;
        };
        Insert: {
          id: string;
          closed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["account_closures"]["Insert"]>;
        Relationships: [];
      };
      /**
       * One row, upserted by the scheduled scorer — see migration 0011. RLS is
       * on with NO policies, so this is unreadable with the anon key and
       * reachable only through `feed_status_for_admin`; the writer is the
       * service role, which bypasses RLS.
       */
      feed_status: {
        Row: {
          singleton: boolean;
          /** Heartbeat — written on EVERY run, succeeded or not. */
          checked_at: string;
          status: "ok" | "error";
          detail: string;
          provider: string;
          season: number | null;
          /** Only advanced by a run that succeeded — never cleared by a failing one. */
          last_ok_at: string | null;
          games_upserted: number;
          members_updated: number;
          error: string | null;
        };
        Insert: {
          singleton?: boolean;
          checked_at?: string;
          status?: "ok" | "error";
          detail?: string;
          provider?: string;
          season?: number | null;
          last_ok_at?: string | null;
          games_upserted?: number;
          members_updated?: number;
          error?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["feed_status"]["Insert"]>;
        Relationships: [];
      };
      /**
       * One row per reminder email, appended by the send job — see migration
       * 0015. RLS is on with NO policies, so this is unreadable with the anon
       * key and reachable only through `reminder_status_for_admin`; the writer
       * is the service role via `record_reminder_send`.
       *
       * A partial unique index on (group, user, season, season_type, week)
       * where kind = 'pick' and status = 'sent' is what makes sending
       * idempotent. There is deliberately no equivalent for buy_in — its week
       * is null, nulls are distinct, and a debt has no natural period — so
       * those are throttled by an interval instead.
       */
      reminder_sends: {
        Row: {
          id: string;
          /** Groups the rows written by one click, for "sent 12, 4 minutes ago". */
          run_id: string;
          group_id: string;
          user_id: string;
          kind: "pick" | "buy_in";
          season: number;
          season_type: string;
          /** Null for buy_in. */
          week: number | null;
          status: "sent" | "failed";
          provider_id: string | null;
          error: string | null;
          sent_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          group_id: string;
          user_id: string;
          kind: "pick" | "buy_in";
          season: number;
          season_type?: string;
          week?: number | null;
          status: "sent" | "failed";
          provider_id?: string | null;
          error?: string | null;
          sent_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reminder_sends"]["Insert"]>;
        Relationships: [];
      };
      groups: {
        Row: {
          id: string;
          name: string;
          season: number;
          elimination_type: "single" | "two_time";
          tie_rule: "push" | "loss";
          invite_code: string;
          entry_closes_at: string;
          settings_locked_at: string | null;
          /**
           * What the pot costs, in cents, added in 0010. Writable only through
           * the set_group_buy_in RPC: `groups` DOES have an admin UPDATE policy,
           * but RLS cannot restrict which columns it writes, so a direct
           * .update() would be the first client write path to invite_code and
           * the rules columns as well.
           */
          buy_in_cents: number;
          site_fee_cents: number;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          season: number;
          elimination_type?: "single" | "two_time";
          tie_rule?: "push" | "loss";
          invite_code: string;
          entry_closes_at: string;
          settings_locked_at?: string | null;
          buy_in_cents?: number;
          site_fee_cents?: number;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["groups"]["Insert"]>;
        Relationships: [];
      };
      group_members: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          role: "admin" | "player";
          status: "alive" | "eliminated";
          strikes: number;
          eliminated_week: number | null;
          /**
           * Whether the admin has marked this member's league buy-in as paid.
           * Writable only through the set_member_buy_in RPC — group_members has
           * no UPDATE policy, so a direct .update() is silently a no-op.
           */
          buy_in_paid: boolean;
          buy_in_paid_at: string | null;
          /**
           * Whether the preseason practice round exists for this member — both
           * the weeks in their picker and their ability to pick one. Admin-set
           * through set_member_preseason (0011); same no-UPDATE-policy caveat as
           * buy_in_paid above.
           */
          show_preseason: boolean;
          joined_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          role?: "admin" | "player";
          status?: "alive" | "eliminated";
          strikes?: number;
          eliminated_week?: number | null;
          buy_in_paid?: boolean;
          buy_in_paid_at?: string | null;
          show_preseason?: boolean;
          joined_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["group_members"]["Insert"]>;
        Relationships: [];
      };
      games: {
        Row: {
          id: string;
          season: number;
          season_type: "pre" | "regular" | "post";
          week: number;
          kickoff: string;
          status: "scheduled" | "in_progress" | "delayed" | "final" | "postponed";
          home: string;
          away: string;
          home_score: number | null;
          away_score: number | null;
          status_detail: string | null;
          updated_at: string;
        };
        Insert: {
          id: string;
          season: number;
          season_type?: "pre" | "regular" | "post";
          week: number;
          kickoff: string;
          status?: "scheduled" | "in_progress" | "delayed" | "final" | "postponed";
          home: string;
          away: string;
          home_score?: number | null;
          away_score?: number | null;
          status_detail?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["games"]["Insert"]>;
        Relationships: [];
      };
      picks: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          season_type: "pre" | "regular" | "post";
          week: number;
          team_id: string;
          game_id: string;
          result: "win" | "loss" | "push" | "pending" | null;
          created_at: string;
          updated_at: string;
          locked_at: string | null;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          /** Defaults to 'regular' in the database (0006). */
          season_type?: "pre" | "regular" | "post";
          week: number;
          team_id: string;
          game_id: string;
          result?: "win" | "loss" | "push" | "pending" | null;
          created_at?: string;
          updated_at?: string;
          locked_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["picks"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      account_exists: { Args: { p_email: string }; Returns: boolean };
      /**
       * 0009: the published league's public board, for the signed-out landing
       * page. Zero-arg by design — an argument would make it a universal
       * standings reader for every league in the project. Returns SQL NULL
       * (→ `null` here) when no league is published.
       *
       * Typed loosely because the shape is nested JSON that the mapper in
       * `src/lib/league/public.ts` validates structurally anyway; a hand-written
       * row type here would be a second source of truth that can drift.
       */
      public_league_snapshot: { Args: Record<string, never>; Returns: unknown };
      is_group_member: { Args: { gid: string }; Returns: boolean };
      is_group_admin: { Args: { gid: string }; Returns: boolean };
      /** 0008: is the caller an admin of any league p_user_id belongs to? */
      is_admin_for_member: { Args: { p_user_id: string }; Returns: boolean };
      join_by_invite: {
        Args: { p_code: string };
        Returns: Database["public"]["Tables"]["groups"]["Row"];
      };
      create_group: {
        Args: {
          p_name: string;
          p_elimination_type?: "single" | "two_time";
          p_tie_rule?: "push" | "loss";
          p_season?: number;
          p_entry_closes_at?: string | null;
        };
        Returns: Database["public"]["Tables"]["groups"]["Row"];
      };
      hidden_pick_user_ids: {
        Args: { p_group_id: string; p_week: number };
        Returns: string[];
      };
      /**
       * Season-type-aware sibling of hidden_pick_user_ids, added in 0006. The
       * original is left in place because it has already run against real
       * databases; a distinct name also keeps supabase.rpc() unambiguous.
       */
      hidden_picks_for_week: {
        Args: { p_group_id: string; p_season_type: "pre" | "regular" | "post"; p_week: number };
        Returns: string[];
      };
      /**
       * Admin-only buy-in write, added in 0007. SECURITY DEFINER because
       * group_members has no UPDATE policy at all; the function re-checks
       * is_group_admin() itself and raises `not_admin` otherwise.
       *
       * 0010 redefined the body so buy_in_paid_at is stamped on every change
       * rather than only when p_paid is true — the account page prints
       * "UNPAID · Updated 10/21", which the old `else null` made unrenderable.
       * The signature is unchanged.
       */
      set_member_buy_in: {
        Args: { p_group_id: string; p_user_id: string; p_paid: boolean };
        Returns: Database["public"]["Tables"]["group_members"]["Row"];
      };
      /**
       * Admin-only write of what the pot costs (0010). Raises `not_admin`,
       * `bad_amount` on a negative, `group_not_found` on an unknown id.
       */
      set_group_buy_in: {
        Args: { p_group_id: string; p_buy_in_cents: number; p_site_fee_cents: number };
        Returns: Database["public"]["Tables"]["groups"]["Row"];
      };
      /**
       * Close the caller's own account (0010). Takes no argument by design —
       * it writes auth.uid(), so there is no id for a caller to substitute —
       * and is idempotent, so a retry after a dropped response is a no-op.
       */
      close_own_account: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["account_closures"]["Row"];
      };
      /**
       * Rename a league (0011). Deliberately NOT gated on settings_locked_at:
       * 0001's admin UPDATE policy refuses every `groups` write once the season
       * locks, which is what made a post-kickoff typo unfixable outside the SQL
       * editor. Raises `not_admin`, `name_required`, `name_too_long`,
       * `group_not_found`.
       */
      set_group_name: {
        Args: { p_group_id: string; p_name: string };
        Returns: Database["public"]["Tables"]["groups"]["Row"];
      };
      /**
       * Edit the rules (0011) — the counterpart to set_group_name, and the half
       * that DOES enforce the lock — on `settings_locked_at` OR
       * `entry_closes_at <= now()`, because nothing has ever written the former.
       * Raises `not_admin`, `bad_elimination_type`, `bad_tie_rule`,
       * `settings_locked`, `group_not_found`.
       */
      set_group_rules: {
        Args: { p_group_id: string; p_elimination_type: string; p_tie_rule: string };
        Returns: Database["public"]["Tables"]["groups"]["Row"];
      };
      /**
       * Admin-only write of a member's preseason access (0011). Raises
       * `not_admin`, `member_not_found`.
       */
      set_member_preseason: {
        Args: { p_group_id: string; p_user_id: string; p_show: boolean };
        Returns: Database["public"]["Tables"]["group_members"]["Row"];
      };
      /**
       * Admin-only removal of a player and their picks (0013). Refused once
       * `entry_closes_at` has passed, and never for an admin or for yourself.
       * Raises `not_admin`, `cannot_remove_self`, `group_not_found`,
       * `entry_closed`, `cannot_remove_admin`, `member_not_found`.
       */
      remove_member: {
        Args: { p_group_id: string; p_user_id: string };
        Returns: void;
      };
      /**
       * The scorer's write path (0011). Granted to `service_role` only — the
       * browser must never reach it. Kept here so the shape is documented.
       */
      record_feed_sync: {
        Args: {
          p_status: "ok" | "error";
          p_detail: string;
          p_provider: string;
          p_season: number | null;
          p_games_upserted?: number;
          p_members_updated?: number;
          p_error?: string | null;
        };
        Returns: Database["public"]["Tables"]["feed_status"]["Row"];
      };
      /**
       * The scorer's last-run record (0011). The group id proves the caller is
       * an admin; it does not select which row — there is only one.
       *
       * `unknown` rather than a shape, matching public_league_snapshot: it
       * returns jsonb `{ now, sync }`, where `sync` is null until the poller has
       * run. `now` is the DATABASE's clock, so "checked 3 minutes ago" cannot go
       * negative against a Netlify container's. Mapped by mapFeedStatus in
       * src/lib/league/feed.ts. Raises `not_admin`.
       */
      feed_status_for_admin: {
        Args: { p_group_id: string };
        Returns: unknown;
      };
      /**
       * Who is due a reminder, INCLUDING their email (0015). Granted to
       * `service_role` only — this is the one function in the project that
       * emits an address, and `reminder_status_for_admin` below is the
       * browser's view of the same definition with that column dropped.
       */
      reminder_due: {
        Args: {
          p_group_id: string;
          p_kind: "pick" | "buy_in";
          p_season: number;
          p_season_type?: string;
          p_week?: number | null;
          p_min_interval?: string;
        };
        Returns: {
          user_id: string;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          last_sent_at: string | null;
        }[];
      };
      /**
       * The admin drawer's read (0015). `unknown` rather than a shape, matching
       * feed_status_for_admin: it returns jsonb `{ now, season, seasonType,
       * week, pick, buyIn }`, and `now` is the DATABASE's clock so "reminded 2
       * hours ago" cannot go negative. Mapped by mapReminderStatus in
       * src/lib/league/reminders.ts. Raises `not_admin`.
       */
      reminder_status_for_admin: {
        Args: {
          p_group_id: string;
          p_season: number;
          p_season_type?: string;
          p_week?: number | null;
        };
        Returns: unknown;
      };
      /**
       * The send log's write path (0015). Granted to `service_role` only.
       * `on conflict do nothing` against the partial unique index, so a retry
       * after a crash is a no-op rather than an error.
       */
      record_reminder_send: {
        Args: {
          p_run_id: string;
          p_group_id: string;
          p_user_id: string;
          p_kind: "pick" | "buy_in";
          p_season: number;
          p_season_type?: string;
          p_week?: number | null;
          p_status?: "sent" | "failed";
          p_provider_id?: string | null;
          p_error?: string | null;
        };
        Returns: undefined;
      };
      invite_preview: {
        Args: { p_code: string };
        Returns: {
          name: string;
          season: number;
          entry_open: boolean;
          member_count: number;
          elimination_type: "single" | "two_time";
          tie_rule: "push" | "loss";
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
