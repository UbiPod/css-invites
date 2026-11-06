import type {
  InteractionRoute,
  JsonInteractionHandlerInput,
  JsonRepresentation,
  JsonView,
  WebIdStore,
} from '@solid/community-server';
import {
  BadRequestHttpError,
  ForbiddenHttpError,
  JsonInteractionHandler,
  UnauthorizedHttpError,
} from '@solid/community-server';
import type { Invite, InviteStore } from './InviteStore';

/**
 * Lets invite admins list, create and revoke invites.
 *
 * - GET: `{ invites: [...], register }`
 * - POST `{ note?, uses?, expiresInDays? }`: creates an invite and returns `{ code, link, invite }`.
 *   The code is only ever shown in this response.
 * - POST `{ revoke: "<invite id>" }`: revokes an invite.
 *
 * The caller must be logged in to an account linked to one of the admin WebIDs.
 */
export class InviteAdminHandler extends JsonInteractionHandler implements JsonView {
  private readonly inviteStore: InviteStore;
  private readonly webIdStore: WebIdStore;
  private readonly registerRoute: InteractionRoute;
  private readonly adminWebIds: Set<string>;

  /**
   * @param inviteStore - Where invites are kept.
   * @param webIdStore - Used to find the WebIDs linked to the calling account.
   * @param registerRoute - The sign-up page, used to build invite links.
   * @param adminWebIds - WebIDs allowed to manage invites. Entries in the `INVITES_ADMIN_WEBIDS`
   *   environment variable (comma separated) are added to these.
   */
  public constructor(
    inviteStore: InviteStore,
    webIdStore: WebIdStore,
    registerRoute: InteractionRoute,
    adminWebIds: string[] = [],
  ) {
    super();
    this.inviteStore = inviteStore;
    this.webIdStore = webIdStore;
    this.registerRoute = registerRoute;
    const fromEnv = (process.env.INVITES_ADMIN_WEBIDS ?? '').split(',');
    this.adminWebIds = new Set([ ...adminWebIds, ...fromEnv ].map((id): string => id.trim()).filter(Boolean));
  }

  public async getView({ accountId }: JsonInteractionHandlerInput): Promise<JsonRepresentation> {
    await this.assertAdmin(accountId);
    const invites = await this.inviteStore.list();
    return { json: { invites: invites.map(publicInvite), register: this.registerRoute.getPath() }};
  }

  public async handle({ accountId, json }: JsonInteractionHandlerInput): Promise<JsonRepresentation> {
    const admin = await this.assertAdmin(accountId);
    const body = (json ?? {}) as Record<string, unknown>;

    if (body.revoke !== undefined) {
      if (typeof body.revoke !== 'string' || !await this.inviteStore.revoke(body.revoke)) {
        throw new BadRequestHttpError('No invite with that id.');
      }
      return { json: { revoked: body.revoke }};
    }

    const { code, invite } = await this.inviteStore.create({
      note: typeof body.note === 'string' ? body.note : undefined,
      uses: body.uses === undefined || body.uses === '' ? undefined : Number(body.uses),
      expiresInDays: body.expiresInDays === undefined || body.expiresInDays === '' ? undefined : Number(body.expiresInDays),
      createdBy: admin,
    });
    const link = `${this.registerRoute.getPath()}?invite=${encodeURIComponent(code)}`;
    return { json: { code, link, invite: publicInvite(invite) }};
  }

  /**
   * Returns the admin WebID of the calling account, or throws.
   */
  private async assertAdmin(accountId?: string): Promise<string> {
    if (!accountId) {
      throw new UnauthorizedHttpError('Log in to manage invites.');
    }
    const links = await this.webIdStore.findLinks(accountId);
    const admin = links.find(({ webId }): boolean => this.adminWebIds.has(webId));
    if (!admin) {
      throw new ForbiddenHttpError('This account is not an invite admin.');
    }
    return admin.webId;
  }
}

function publicInvite(invite: Invite): Record<string, string | number | boolean | string[]> {
  const result: Record<string, string | number | boolean | string[]> = {
    id: invite.id,
    createdAt: invite.createdAt,
    usesLeft: invite.usesLeft,
    usedBy: invite.usedBy,
    revoked: Boolean(invite.revoked),
  };
  for (const key of [ 'note', 'createdBy', 'expiresAt' ] as const) {
    if (invite[key]) {
      result[key] = invite[key]!;
    }
  }
  return result;
}
