/** F-17: the first seven characters of the commit this deployment was built from, or null locally. */
export function deployedCommit(env: Record<string, string | undefined> = process.env): string | null {
  const sha = (env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : null;
}
