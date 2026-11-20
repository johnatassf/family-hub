import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { captcha } from 'better-auth/plugins/captcha';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { audit } from './audit';
import { sendEmail } from './email';
import type { CoreEnv } from './env';
import { assertUserCanBeDeleted, deleteEmptyHouseholds, signupAllowed } from './households';
import { runUserDeletedHooks } from './modules';
import { AppError, normalizeEmail } from './util';

type WaitUntil = (promise: Promise<unknown>) => void;

const OTP_SUBJECT: Record<string, string> = {
  'sign-in': 'Seu código de acesso',
  'email-verification': 'Confirme seu e-mail',
  'forget-password': 'Código para redefinir sua senha',
  'change-email': 'Confirme a troca de e-mail',
};

async function findUserByEmail(db: D1Database, email: string) {
  return db
    .prepare(`SELECT id, COALESCE(twoFactorEnabled, 0) AS twoFactorEnabled FROM "user" WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<{ id: string; twoFactorEnabled: number }>();
}

/**
 * Entrega do código por e-mail com as travas de segurança:
 * - quem ativou 2FA não entra só com código de e-mail (seria um rebaixamento de segurança);
 * - e-mail sem conta e sem convite não recebe nada (sem revelar isso na resposta).
 */
async function deliverOtp(env: CoreEnv, email: string, otp: string, type: string) {
  const appName = env.APP_NAME ?? 'Família';
  if (type === 'sign-in') {
    const user = await findUserByEmail(env.DB, email);
    if (user?.twoFactorEnabled) {
      await sendEmail(env, {
        to: email,
        subject: `${appName}: login por código desativado`,
        text: `Alguém pediu um código de acesso para esta conta. Como ela tem verificação em duas etapas, entre com senha + app autenticador ou com o Google.\nSe não foi você, ignore este e-mail.`,
      });
      return;
    }
    if (!user && !(await signupAllowed(env, email))) return;
  }
  await sendEmail(env, {
    to: email,
    subject: `${appName}: ${OTP_SUBJECT[type] ?? 'Seu código'}`,
    text: `Seu código é ${otp}\n\nEle vale por 10 minutos. Não compartilhe este código com ninguém.\nSe não foi você que pediu, ignore este e-mail.`,
  });
}

export function createAuth(env: CoreEnv, waitUntil: WaitUntil) {
  const appName = env.APP_NAME ?? 'Família';
  const plugins = [
    twoFactor({ issuer: appName, allowPasswordless: true }),
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 3,
      storeOTP: 'hashed',
      sendVerificationOnSignUp: true,
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type }) {
        // Não aguardar: resposta igual com ou sem conta (evita enumeração e ataque de tempo).
        waitUntil(deliverOtp(env, email, otp, type).catch((e) => console.error('[email] falha ao enviar código', e)));
      },
    }),
  ];
  if (env.TURNSTILE_SECRET_KEY) {
    plugins.push(
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: env.TURNSTILE_SECRET_KEY,
        endpoints: [
          '/sign-up/email',
          '/sign-in/email',
          '/email-otp/send-verification-otp',
          '/email-otp/request-password-reset',
          '/forget-password/email-otp',
        ],
      }) as never,
    );
  }

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' as const } }
      : undefined;

  return betterAuth({
    appName,
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [new URL(env.APP_URL).origin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // Redefiniu a senha → derruba todas as sessões (quem roubou uma sessão perde o acesso).
      revokeSessionsOnPasswordReset: true,
    },
    socialProviders: google,
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    user: {
      deleteUser: {
        enabled: true,
        async beforeDelete(user) {
          try {
            await assertUserCanBeDeleted(env.DB, user.id);
            await runUserDeletedHooks(env, user.id);
          } catch (e) {
            if (e instanceof AppError) throw new APIError('BAD_REQUEST', { message: e.message });
            throw e;
          }
          await audit(env.DB, { userId: user.id, action: 'user.deleted' });
        },
        async afterDelete() {
          await deleteEmptyHouseholds(env.DB);
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 300, max: 5 },
        '/sign-in/email-otp': { window: 60, max: 5 },
        '/email-otp/send-verification-otp': { window: 300, max: 3 },
        '/email-otp/request-password-reset': { window: 300, max: 3 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'familia',
      useSecureCookies: env.APP_URL.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            if (!(await signupAllowed(env, user.email))) {
              throw new APIError('FORBIDDEN', { message: 'Cadastro só por convite. Peça um convite a alguém da sua família.' });
            }
          },
        },
      },
      session: {
        create: {
          async after(session) {
            await audit(env.DB, {
              userId: session.userId,
              action: 'auth.signed_in',
              ip: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null,
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email-otp') return;
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email : '';
        const user = email ? await findUserByEmail(env.DB, email) : null;
        if (user?.twoFactorEnabled) {
          throw new APIError('FORBIDDEN', {
            message: 'Esta conta tem verificação em duas etapas. Entre com senha + app autenticador ou com o Google.',
          });
        }
      }),
    },
    plugins,
  });
}

export type Auth = ReturnType<typeof createAuth>;
