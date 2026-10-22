const isUrlCharacter = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return code > 0x20 && code !== 0x7f;
};

/** Pull the first sign-in link out of CLI output that may wrap it in terminal escapes. */
export const extractAuthorizeUrl = (text: string): string | undefined => {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf("https://", searchFrom);
    if (start === -1) return undefined;
    let end = start;
    while (end < text.length && isUrlCharacter(text.charAt(end))) end += 1;
    const candidate = text.slice(start, end);
    if (candidate.includes("/oauth/authorize")) return candidate;
    searchFrom = end;
  }
  return undefined;
};

/** Hide OAuth parameters and token-shaped values before CLI output reaches a log or the UI. */
export const redactCliAuthOutput = (text: string): string =>
  text
    // eslint-disable-next-line no-control-regex -- terminal escapes wrap the link the CLI prints
    .replace(/\u001b\][^\u0007]*\u0007|\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/(https:\/\/[^\s?]+)\?\S*/g, "$1?<redacted>")
    .replace(/[A-Za-z0-9_-]{32,}(?:[#.][A-Za-z0-9_-]{8,})*/g, "<redacted>");
