import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";

// RECUPERA FORK PATCH: upstream resolved the app credentials at module scope,
// so importing this file with GITHUB_PRIVATE_KEY unset threw
// "Cannot read properties of undefined (reading 'replace')" and broke
// `next build` — even though the self-hosting docs list the GitHub App as
// optional. Resolve lazily so the module stays importable without the
// integration configured, and fail with a clear message only if it is used.
function getAppCredentials() {
  const appId = process.env.GITHUB_APP_ID;
  const rawPrivateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !rawPrivateKey) {
    throw new Error(
      "GitHub integration is not configured. Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY to enable it.",
    );
  }

  return { appId, privateKey: rawPrivateKey.replace(/\\n/g, "\n") };
}

export function getAppOctokit() {
  const { appId, privateKey } = getAppCredentials();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  });
}

export function getInstallationOctokit(installationId: number) {
  const { appId, privateKey } = getAppCredentials();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });
}
