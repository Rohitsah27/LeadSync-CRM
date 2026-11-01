// Permissions the Facebook Login for Business configuration must grant for lead retrieval to work.
// Which permissions are requested is set in the Meta App Dashboard; this list only verifies that
// the user actually granted them, because a successful login does not imply lead access.
export const REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_manage_ads',
  'leads_retrieval',
];

export function findMissingScopes(grantedScopes) {
  return REQUIRED_SCOPES.filter((scope) => !grantedScopes.includes(scope));
}
