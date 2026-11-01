import { MetaApiError } from './graphClient.js';

/**
 * Describes a failed Graph call in terms a user can act on. `status` is stored on the form and
 * shown in the app; the message never carries Facebook's raw error text.
 */
export function describeFailure(err) {
  if (!(err instanceof MetaApiError)) return { status: 'error', message: 'Something went wrong.' };

  switch (err.kind) {
    case 'auth':
      return {
        status: 'invalid',
        message: 'Facebook no longer accepts this Page’s access. Reconnect the Facebook account.',
      };
    case 'permission':
      return {
        status: 'permission',
        message:
          'Facebook denied access to this Page’s leads. Check that the Meta app has the leads_retrieval permission and that your Facebook account has lead access on the Page.',
      };
    case 'rate_limit':
      return {
        status: 'rate_limited',
        message: 'Facebook is limiting requests for this Page. Try again in a while.',
      };
    case 'unavailable':
      return { status: 'error', message: 'Facebook could not be reached. Try again shortly.' };
    default:
      return { status: 'error', message: 'Facebook rejected the request.' };
  }
}
