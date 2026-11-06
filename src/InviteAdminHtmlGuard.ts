import type { InteractionHandlerInput, InteractionRoute, Representation } from '@solid/community-server';
import {
  APPLICATION_JSON,
  cleanPreferences,
  FoundHttpError,
  getTypeWeight,
  InteractionHandler,
  NotFoundHttpError,
  NotImplementedHttpError,
  TEXT_HTML,
} from '@solid/community-server';
import type { InviteAdmins } from './InviteAdmins';

/**
 * Sits in front of CSS's HTML views and keeps the invites page from being shown to anyone but admins:
 * a visitor who is not logged in is redirected to the login page,
 * and a logged-in account that is not an admin gets a 404, as if the page did not exist.
 *
 * For admins, and for every other request, it declines (`canHandle` throws)
 * so the next handler (CSS's HtmlViewHandler) renders the page as usual.
 */
export class InviteAdminHtmlGuard extends InteractionHandler {
  private readonly route: InteractionRoute;
  private readonly loginRoute: InteractionRoute;
  private readonly admins: InviteAdmins;

  /**
   * @param route - The invites route.
   * @param loginRoute - Where visitors who are not logged in are sent.
   * @param admins - Decides who is an admin.
   */
  public constructor(route: InteractionRoute, loginRoute: InteractionRoute, admins: InviteAdmins) {
    super();
    this.route = route;
    this.loginRoute = loginRoute;
    this.admins = admins;
  }

  public async canHandle({ operation, accountId }: InteractionHandlerInput): Promise<void> {
    if (operation.method !== 'GET' || !this.route.matchPath(operation.target.path)) {
      throw new NotImplementedHttpError('Not the invites page.');
    }
    const preferences = cleanPreferences(operation.preferences.type);
    if (getTypeWeight(APPLICATION_JSON, preferences) >= getTypeWeight(TEXT_HTML, preferences)) {
      throw new NotImplementedHttpError('Not an HTML request.');
    }
    if (await this.admins.adminWebId(accountId)) {
      throw new NotImplementedHttpError('Admins see the page.');
    }
  }

  public async handle({ accountId }: InteractionHandlerInput): Promise<Representation> {
    if (!accountId) {
      throw new FoundHttpError(this.loginRoute.getPath());
    }
    throw new NotFoundHttpError();
  }
}
