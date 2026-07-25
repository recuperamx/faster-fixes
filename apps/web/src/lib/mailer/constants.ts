// RECUPERA FORK PATCH: the sender domain was derived from DOMAIN_NAME, which is
// also the app's public origin (it feeds Better Auth `trustedOrigins`). Those
// are two different things: a self-hosted instance is very often reachable on a
// domain that is NOT a verified sender in Resend — e.g. *.up.railway.app. When
// they diverge Resend rejects every send, and because sign-up sets
// `requireEmailVerification: true`, the verification mail never arrives and the
// account can never log in.
//
// MAIL_DOMAIN sets the sender domain independently, falling back to DOMAIN_NAME
// so upstream behaviour is unchanged when it is not provided.
const MAIL_DOMAIN = process.env.MAIL_DOMAIN ?? process.env.DOMAIN_NAME;

export const NO_REPLY_EMAIL = `noreply@${MAIL_DOMAIN}`;
export const SENDER_EMAIL = `contact@${MAIL_DOMAIN}`;
