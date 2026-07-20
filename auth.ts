import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import {
  cancelEntraLogin,
  completeEntraLogin,
  entraProviderId,
  readEntraLoginTransaction
} from "@/lib/entra-auth";
import { getEnv } from "@/lib/env";

const nextAuth = NextAuth(async (request) => {
  const transaction = await readEntraLoginTransaction(request);
  const configuration = transaction?.configuration;

  return {
    basePath: "/api/auth",
    secret: getEnv().NEXTAUTH_SECRET,
    trustHost: true,
    debug: false,
    pages: {
      signIn: "/login",
      error: "/login"
    },
    providers: configuration
      ? [
          MicrosoftEntraID({
            clientId: configuration.clientId,
            clientSecret: configuration.clientSecret,
            issuer: `https://login.microsoftonline.com/${encodeURIComponent(configuration.directoryTenantId)}/v2.0`,
            checks: ["state", "pkce", "nonce"],
            authorization: {
              params: {
                scope: "openid profile email",
                prompt: "select_account"
              }
            },
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name ?? null,
                email: profile.email ?? null,
                image: null
              };
            }
          })
        ]
      : [],
    callbacks: {
      async signIn({ account, profile }) {
        if (!transaction || !configuration || account?.provider !== entraProviderId) {
          if (transaction) await cancelEntraLogin(transaction, "provider_mismatch", "callback");
          return false;
        }

        const claims = profile as Record<string, unknown> | undefined;
        const completed = await completeEntraLogin(
          transaction,
          claims?.email ?? claims?.preferred_username ?? claims?.upn,
          claims?.tid
        );
        return completed ? "/" : false;
      },
      async redirect({ baseUrl }) {
        return new URL("/", baseUrl).toString();
      }
    }
  };
});

export const { auth, handlers, signIn } = nextAuth;
