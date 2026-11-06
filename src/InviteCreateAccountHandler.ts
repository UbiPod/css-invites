import type {
  AccountStore,
  CookieStore,
  JsonInteractionHandlerInput,
  JsonRepresentation,
  LoginOutputType,
} from '@solid/community-server';
import { BadRequestHttpError, CreateAccountHandler } from '@solid/community-server';
import type { InviteStore } from './InviteStore';

/**
 * A drop-in replacement for CSS's {@link CreateAccountHandler} that only creates an account
 * when the request body carries a valid `inviteCode`.
 */
export class InviteCreateAccountHandler extends CreateAccountHandler {
  private readonly inviteStore: InviteStore;

  public constructor(accountStore: AccountStore, cookieStore: CookieStore, inviteStore: InviteStore) {
    super(accountStore, cookieStore);
    this.inviteStore = inviteStore;
  }

  public async login(input?: JsonInteractionHandlerInput): Promise<JsonRepresentation<LoginOutputType>> {
    const body = input?.json as { inviteCode?: unknown } | undefined;
    const code = typeof body?.inviteCode === 'string' ? body.inviteCode.trim() : '';
    if (!code) {
      throw new BadRequestHttpError('An invite code is required to create an account on this server.');
    }
    const accountId = await this.inviteStore.redeem(code, async(): Promise<string> => {
      const result = await super.login();
      return result.json.accountId;
    });
    return { json: { accountId }};
  }
}
