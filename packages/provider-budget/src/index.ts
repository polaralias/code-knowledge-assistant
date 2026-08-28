import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CEILING_GBP = 20;
const SOFT_STOP_RATIO = 0.8;
const DEFAULT_RESERVATION_TTL_MS = 60 * 60 * 1_000;
const MAX_RESERVATION_TTL_MS = 24 * 60 * 60 * 1_000;
const RESERVATION_HASH = /^[a-f0-9]{64}$/u;
const RESERVATION_TOKEN = /^[0-9a-f-]{36}$/u;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type BudgetLedgerErrorCode =
  | "CONFIG_INVALID"
  | "AMOUNT_INVALID"
  | "COST_INVALID"
  | "RESERVATION_INVALID"
  | "RESERVATION_EXPIRED"
  | "RESERVATION_STATE_INVALID"
  | "BUDGET_SOFT_STOP"
  | "BUDGET_EXHAUSTED"
  | "STATE_IO_FAILED"
  | "STATE_CORRUPT"
  | "STATE_SCHEMA_INVALID"
  | "PUBLICATION_FAILED";

/** Public failures intentionally contain no persisted data, request body, or secret. */
export class BudgetLedgerError extends Error {
  readonly code: BudgetLedgerErrorCode;

  constructor(code: BudgetLedgerErrorCode) {
    super(code);
    this.name = "BudgetLedgerError";
    this.code = code;
  }
}

export type ProviderBudgetLedgerOptions = {
  root: string;
  monthlyCeilingGbp?: number;
  monthlyBudgetGbp?: number;
  reservationTtlMs?: number;
  ttlMs?: number;
  now?: () => Date;
};

export type BudgetReservation = {
  reservationId: string;
  month: string;
  reservedGbp: number;
  expiresAt: string;
};

export type BudgetStatus = {
  month: string;
  monthlyCeilingGbp: number;
  softStopGbp: number;
  spentGbp: number;
  reservedGbp: number;
  availableGbp: number;
};

export type BudgetCommitResult = { reservationId: string; state: "committed"; costGbp: number };
export type BudgetReleaseResult = { reservationId: string; state: "released" | "expired" };
export type BudgetExpiryResult = { expired: number; releasedGbp: number };

export type ProviderBudgetLedger = {
  reserve(input: { estimatedCostGbp: number } | number): Promise<BudgetReservation>;
  commit(reservationId: string, input: { measuredCostGbp: number } | number): Promise<BudgetCommitResult>;
  release(reservationId: string): Promise<BudgetReleaseResult>;
  expireAbandonedReservations(): Promise<BudgetExpiryResult>;
  status(): Promise<BudgetStatus>;
};

type StoredReservation = {
  status: "active" | "committed" | "released" | "expired";
  amount_gbp: number;
  cost_gbp: number | null;
  expires_at: string;
};
type StoredState = {
  schema_version: 1;
  month: string;
  spent_gbp: number;
  reservations: Record<string, StoredReservation>;
};

const locks = new Map<string, Promise<void>>();

function fail(code: BudgetLedgerErrorCode): never {
  throw new BudgetLedgerError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value: unknown): value is number {
  return finiteNonNegative(value) && value > 0;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) fail("STATE_SCHEMA_INVALID");
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) fail("STATE_SCHEMA_INVALID");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail("STATE_SCHEMA_INVALID");
  return value;
}

function month(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function hash(value: string): string {
  // A one-way digest means plaintext reservation IDs are never persisted.
  return createHash("sha256").update("code-knowledge-assistant/provider-budget/v1\0").update(value, "utf8").digest("hex");
}

function parseState(data: string): StoredState {
  let parsed: unknown;
  try { parsed = JSON.parse(data); } catch { fail("STATE_CORRUPT"); }
  if (!isRecord(parsed)) fail("STATE_SCHEMA_INVALID");
  exactKeys(parsed, ["schema_version", "month", "spent_gbp", "reservations"]);
  if (parsed.schema_version !== 1 || typeof parsed.month !== "string" || !MONTH.test(parsed.month)
    || !finiteNonNegative(parsed.spent_gbp) || !isRecord(parsed.reservations)) fail("STATE_SCHEMA_INVALID");
  const reservations: Record<string, StoredReservation> = {};
  for (const [id, candidate] of Object.entries(parsed.reservations)) {
    if (!RESERVATION_HASH.test(id) || !isRecord(candidate)) fail("STATE_SCHEMA_INVALID");
    exactKeys(candidate, ["status", "amount_gbp", "cost_gbp", "expires_at"]);
    if (!(candidate.status === "active" || candidate.status === "committed" || candidate.status === "released" || candidate.status === "expired")
      || !finitePositive(candidate.amount_gbp) || (candidate.cost_gbp !== null && !finiteNonNegative(candidate.cost_gbp))) fail("STATE_SCHEMA_INVALID");
    const expiresAt = timestamp(candidate.expires_at);
    if (candidate.status === "committed" && candidate.cost_gbp === null) fail("STATE_SCHEMA_INVALID");
    if (candidate.status !== "committed" && candidate.cost_gbp !== null) fail("STATE_SCHEMA_INVALID");
    reservations[id] = {
      status: candidate.status,
      amount_gbp: candidate.amount_gbp,
      cost_gbp: candidate.cost_gbp,
      expires_at: expiresAt,
    };
  }
  return { schema_version: 1, month: parsed.month, spent_gbp: parsed.spent_gbp, reservations };
}

function emptyState(currentMonth: string): StoredState {
  return { schema_version: 1, month: currentMonth, spent_gbp: 0, reservations: {} };
}

function validateOptions(options: ProviderBudgetLedgerOptions): { root: string; ceiling: number; ttl: number; now: () => Date } {
  if (!isRecord(options) || typeof options.root !== "string" || options.root.length === 0) fail("CONFIG_INVALID");
  const ceiling = options.monthlyCeilingGbp ?? options.monthlyBudgetGbp ?? DEFAULT_CEILING_GBP;
  if (!finitePositive(ceiling)) fail("CONFIG_INVALID");
  const ttl = options.reservationTtlMs ?? options.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAX_RESERVATION_TTL_MS) fail("CONFIG_INVALID");
  const now = options.now ?? (() => new Date());
  if (typeof now !== "function") fail("CONFIG_INVALID");
  return { root: path.resolve(options.root), ceiling, ttl, now };
}

async function readState(file: string, currentMonth: string): Promise<StoredState> {
  try {
    const content = await readFile(file, "utf8");
    const state = parseState(content);
    return state.month === currentMonth ? state : emptyState(currentMonth);
  } catch (cause) {
    if (cause instanceof BudgetLedgerError) throw cause;
    if (cause instanceof Error && "code" in cause && (cause as NodeJS.ErrnoException).code === "ENOENT") return emptyState(currentMonth);
    fail("STATE_IO_FAILED");
  }
}

async function writeState(file: string, state: StoredState, root: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(root, { recursive: true });
    await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    fail("PUBLICATION_FAILED");
  }
}

function currentDate(now: () => Date): Date {
  let value: Date;
  try { value = now(); } catch { fail("STATE_IO_FAILED"); }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("STATE_CORRUPT");
  return new Date(value.getTime());
}

function activeReserved(state: StoredState): number {
  return Object.values(state.reservations)
    .filter((reservation) => reservation.status === "active")
    .reduce((total, reservation) => total + reservation.amount_gbp, 0);
}

function expireInState(state: StoredState, now: Date): BudgetExpiryResult {
  let expired = 0;
  let releasedGbp = 0;
  for (const reservation of Object.values(state.reservations)) {
    if (reservation.status === "active" && Date.parse(reservation.expires_at) <= now.getTime()) {
      reservation.status = "expired";
      expired += 1;
      releasedGbp += reservation.amount_gbp;
    }
  }
  return { expired, releasedGbp };
}

export class FileSystemProviderBudgetLedger implements ProviderBudgetLedger {
  readonly root: string;
  private readonly ceiling: number;
  private readonly ttl: number;
  private readonly now: () => Date;

  constructor(options: ProviderBudgetLedgerOptions) {
    const configured = validateOptions(options);
    this.root = configured.root;
    this.ceiling = configured.ceiling;
    this.ttl = configured.ttl;
    this.now = configured.now;
  }

  private file(): string { return path.join(this.root, "provider-budget-ledger.json"); }

  private async transaction<T>(operation: (state: StoredState, now: Date) => { value: T; changed: boolean } | Promise<{ value: T; changed: boolean }>): Promise<T> {
    const previous = locks.get(this.root) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    locks.set(this.root, current);
    await previous;
    try {
      const now = currentDate(this.now);
      const state = await readState(this.file(), month(now));
      const result = await operation(state, now);
      if (result.changed) await writeState(this.file(), state, this.root);
      return result.value;
    } finally {
      release();
      if (locks.get(this.root) === current) locks.delete(this.root);
    }
  }

  async reserve(input: { estimatedCostGbp: number } | number): Promise<BudgetReservation> {
    const amount = typeof input === "number" ? input : isRecord(input) ? input.estimatedCostGbp : undefined;
    if (!finitePositive(amount)) fail("AMOUNT_INVALID");
    if (amount > this.ceiling) fail("BUDGET_EXHAUSTED");
    return this.transaction((state, now) => {
      expireInState(state, now);
      const spent = state.spent_gbp;
      const reserved = activeReserved(state);
      const aggregate = spent + reserved;
      const candidate = aggregate + amount;
      if (aggregate >= this.ceiling || candidate > this.ceiling) fail("BUDGET_EXHAUSTED");
      if (aggregate >= this.ceiling * SOFT_STOP_RATIO || candidate >= this.ceiling * SOFT_STOP_RATIO) fail("BUDGET_SOFT_STOP");
      const reservationId = randomUUID();
      state.reservations[hash(reservationId)] = {
        status: "active", amount_gbp: amount, cost_gbp: null,
        expires_at: new Date(now.getTime() + this.ttl).toISOString(),
      };
      return {
        value: {
          reservationId,
          month: state.month,
          reservedGbp: amount,
          expiresAt: state.reservations[hash(reservationId)]!.expires_at,
        },
        changed: true,
      };
    });
  }

  async commit(reservationId: string, input: { measuredCostGbp: number } | number): Promise<BudgetCommitResult> {
    if (typeof reservationId !== "string" || !RESERVATION_TOKEN.test(reservationId)) fail("RESERVATION_INVALID");
    const cost = typeof input === "number" ? input : isRecord(input) ? input.measuredCostGbp : undefined;
    if (!finiteNonNegative(cost)) fail("COST_INVALID");
    await this.expireAbandonedReservations();
    return this.transaction<BudgetCommitResult>((state) => {
      const reservation = state.reservations[hash(reservationId)];
      if (!reservation) fail("RESERVATION_INVALID");
      if (reservation.status === "committed") {
        if (reservation.cost_gbp !== cost) fail("RESERVATION_STATE_INVALID");
        return { value: { reservationId, state: "committed", costGbp: cost }, changed: false };
      }
      if (reservation.status === "expired") fail("RESERVATION_EXPIRED");
      if (reservation.status !== "active") fail("RESERVATION_STATE_INVALID");
      if (cost > reservation.amount_gbp) fail("COST_INVALID");
      reservation.status = "committed";
      reservation.cost_gbp = cost;
      state.spent_gbp += cost;
      return { value: { reservationId, state: "committed", costGbp: cost }, changed: true };
    });
  }

  async release(reservationId: string): Promise<BudgetReleaseResult> {
    if (typeof reservationId !== "string" || !RESERVATION_TOKEN.test(reservationId)) fail("RESERVATION_INVALID");
    await this.expireAbandonedReservations();
    return this.transaction<BudgetReleaseResult>((state) => {
      const reservation = state.reservations[hash(reservationId)];
      if (!reservation) fail("RESERVATION_INVALID");
      if (reservation.status === "released") return { value: { reservationId, state: "released" }, changed: false };
      if (reservation.status === "expired") return { value: { reservationId, state: "expired" }, changed: false };
      if (reservation.status !== "active") fail("RESERVATION_STATE_INVALID");
      reservation.status = "released";
      return { value: { reservationId, state: "released" }, changed: true };
    });
  }

  async expireAbandonedReservations(): Promise<BudgetExpiryResult> {
    return this.transaction((state, now) => {
      const result = expireInState(state, now);
      return { value: result, changed: result.expired > 0 };
    });
  }

  async status(): Promise<BudgetStatus> {
    return this.transaction((state, now) => {
      const expired = expireInState(state, now);
      const reservedGbp = activeReserved(state);
      return {
        value: {
          month: state.month,
          monthlyCeilingGbp: this.ceiling,
          softStopGbp: this.ceiling * SOFT_STOP_RATIO,
          spentGbp: state.spent_gbp,
          reservedGbp,
          availableGbp: Math.max(0, this.ceiling - state.spent_gbp - reservedGbp),
        },
        changed: expired.expired > 0,
      };
    });
  }
}

export function createProviderBudgetLedger(options: ProviderBudgetLedgerOptions): ProviderBudgetLedger {
  return new FileSystemProviderBudgetLedger(options);
}

export const createFileSystemProviderBudgetLedger = createProviderBudgetLedger;
