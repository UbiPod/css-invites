import { randomBytes } from 'node:crypto';
import type { KeyValueStorage } from '@solid/community-server';
import { BadRequestHttpError, ForbiddenHttpError, getLoggerFor } from '@solid/community-server';
import { generateInviteCode, hashInviteCode, normalizeInviteCode } from './InviteCode';

/**
 * A stored invite. The code itself is never stored, only its hash (the storage key).
 */
export interface Invite {
  /** Short public identifier, used to list and revoke the invite. */
  id: string;
  note?: string;
  createdAt: string;
  createdBy?: string;
  /** ISO date after which the invite no longer works. */
  expiresAt?: string;
  /** How many more accounts may be created with this invite. */
  usesLeft: number;
  /** Account IDs created with this invite. */
  usedBy: string[];
  revoked?: boolean;
  /** Set for invites created from configured or environment seed codes. */
  seeded?: boolean;
}

export interface CreateInviteOptions {
  note?: string;
  uses?: number;
  expiresInDays?: number;
  createdBy?: string;
}

/** All invites, keyed by the SHA-256 hash of their code. */
export interface InviteTable {
  [hash: string]: Invite;
}

const TABLE_KEY = 'table';

/**
 * Keeps invite codes in a {@link KeyValueStorage}, as one table keyed by the SHA-256 hash of each code.
 * One entry, rather than one per invite, means listing never has to iterate CSS's internal storage
 * (which iterates everything under `/.internal/` and can deadlock on CSS's locks).
 *
 * All mutations go through one in-process queue, so two sign-ups racing for the last use
 * of a code cannot both succeed. This assumes a single CSS process, which is the default.
 */
export class InviteStore {
  protected readonly logger = getLoggerFor(this);

  private readonly storage: KeyValueStorage<string, InviteTable>;
  private readonly seedCodes: string[];
  private seeding?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param storage - Where invites are kept.
   * @param seedCodes - Codes that should always exist as single-use invites, for bootstrapping the first account.
   *   Codes in the `INVITES_SEED_CODES` environment variable (comma separated) are added to these.
   */
  public constructor(storage: KeyValueStorage<string, InviteTable>, seedCodes: string[] = []) {
    this.storage = storage;
    const fromEnv = (process.env.INVITES_SEED_CODES ?? '').split(',');
    this.seedCodes = [ ...seedCodes, ...fromEnv ].map(normalizeInviteCode).filter((code): boolean => code.length > 0);
  }

  /**
   * Creates a new invite and returns its code. The code cannot be recovered later.
   */
  public async create(options: CreateInviteOptions = {}): Promise<{ code: string; invite: Invite }> {
    const uses = options.uses ?? 1;
    if (!Number.isInteger(uses) || uses < 1 || uses > 1000) {
      throw new BadRequestHttpError('uses must be an integer from 1 to 1000.');
    }
    const days = options.expiresInDays;
    if (days !== undefined && (typeof days !== 'number' || !(days > 0) || days > 3650)) {
      throw new BadRequestHttpError('expiresInDays must be a number from 0 to 3650.');
    }
    const code = generateInviteCode();
    const invite: Invite = {
      id: randomBytes(4).toString('hex'),
      note: typeof options.note === 'string' ? options.note.slice(0, 200) : undefined,
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy,
      expiresAt: days === undefined ? undefined : new Date(Date.now() + days * 86_400_000).toISOString(),
      usesLeft: uses,
      usedBy: [],
    };
    await this.serial(async(): Promise<void> => {
      const table = await this.load();
      table[hashInviteCode(code)] = invite;
      await this.storage.set(TABLE_KEY, table);
    });
    return { code, invite };
  }

  /**
   * All invites, newest first.
   */
  public async list(): Promise<Invite[]> {
    await this.ensureSeeded();
    const invites = Object.values(await this.load());
    return invites.sort((a, b): number => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Revokes the invite with the given ID. Returns false if there is none.
   */
  public async revoke(id: string): Promise<boolean> {
    await this.ensureSeeded();
    return this.serial(async(): Promise<boolean> => {
      const table = await this.load();
      const key = Object.keys(table).find((hash): boolean => table[hash].id === id);
      if (!key) {
        return false;
      }
      table[key] = { ...table[key], revoked: true };
      await this.storage.set(TABLE_KEY, table);
      return true;
    });
  }

  /**
   * Runs `create` (the account creation) only if `code` is currently valid,
   * then records the resulting account against the invite and uses it up.
   * Nothing is used up if `create` throws.
   */
  public async redeem(code: string, create: () => Promise<string>): Promise<string> {
    await this.ensureSeeded();
    return this.serial(async(): Promise<string> => {
      const key = hashInviteCode(code);
      const table = await this.load();
      const invite = table[key];
      const problem = this.problemWith(invite);
      if (problem) {
        throw new ForbiddenHttpError(problem);
      }
      const accountId = await create();
      table[key] = { ...invite!, usesLeft: invite!.usesLeft - 1, usedBy: [ ...invite!.usedBy, accountId ]};
      await this.storage.set(TABLE_KEY, table);
      this.logger.info(`Invite ${invite!.id} used to create account ${accountId}`);
      return accountId;
    });
  }

  private problemWith(invite?: Invite): string | undefined {
    if (!invite || invite.revoked) {
      return 'This invite code is not valid.';
    }
    if (invite.usesLeft < 1) {
      return 'This invite code has already been used.';
    }
    if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
      return 'This invite code has expired.';
    }
    return undefined;
  }

  private async ensureSeeded(): Promise<void> {
    this.seeding ??= this.serial(async(): Promise<void> => {
      const table = await this.load();
      let changed = false;
      for (const code of this.seedCodes) {
        const key = hashInviteCode(code);
        if (!table[key]) {
          changed = true;
          table[key] = {
            id: randomBytes(4).toString('hex'),
            note: 'seed code',
            createdAt: new Date().toISOString(),
            usesLeft: 1,
            usedBy: [],
            seeded: true,
          };
        }
      }
      if (changed) {
        await this.storage.set(TABLE_KEY, table);
      }
    });
    return this.seeding;
  }

  private async load(): Promise<InviteTable> {
    return { ...await this.storage.get(TABLE_KEY) };
  }

  private async serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch((): void => undefined);
    return result;
  }
}
