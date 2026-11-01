// Additional authenticated data for encrypted values (see tokenCrypto.js). Binding a ciphertext to
// its owner means a value copied onto another record fails to decrypt.

export const tokenAad = (workspaceId, facebookUserId) =>
  `fb-user-token:${workspaceId}:${facebookUserId}`;

export const pageTokenAad = (workspaceId, pageId) => `fb-page-token:${workspaceId}:${pageId}`;
