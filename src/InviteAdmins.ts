import type { WebIdStore } from '@solid/community-server';

/**
 * Decides which accounts may manage invites: those linked to one of the admin WebIDs.
 */
export class InviteAdmins {
  private readonly webIdStore: WebIdStore;
  private readonly adminWebIds: Set<string>;

  /**
   * @param webIdStore - Used to find the WebIDs linked to an account.
   * @param adminWebIds - WebIDs allowed to manage invites. Entries in the `INVITES_ADMIN_WEBIDS`
   *   environment variable (comma separated) are added to these.
   */
  public constructor(webIdStore: WebIdStore, adminWebIds: string[] = []) {
    this.webIdStore = webIdStore;
    const fromEnv = (process.env.INVITES_ADMIN_WEBIDS ?? '').split(',');
    this.adminWebIds = new Set([ ...adminWebIds, ...fromEnv ].map((id): string => id.trim()).filter(Boolean));
  }

  /**
   * The admin WebID linked to the account, or undefined if the account is not an admin.
   */
  public async adminWebId(accountId?: string): Promise<string | undefined> {
    if (!accountId) {
      return undefined;
    }
    const links = await this.webIdStore.findLinks(accountId);
    return links.find(({ webId }): boolean => this.adminWebIds.has(webId))?.webId;
  }
}
