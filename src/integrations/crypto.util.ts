import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Symmetric encryption + HMAC helpers for OAuth tokens and state.
 *
 * Why: integration access/refresh tokens grant access to a customer's
 * external workspace. Storing them as plaintext in `integration_connections`
 * means a DB leak hands attackers live tokens. AES-256-GCM encryption with a
 * versioned ciphertext envelope lets us rotate keys later by bumping the
 * version prefix. The same master key derives a separate HMAC subkey for
 * signing OAuth `state`, which prevents anyone from forging a state that
 * survives the controller's identity check.
 *
 * Behaviour without `CREDENTIAL_ENCRYPTION_KEY` set: encrypt() returns the
 * plaintext unchanged so local dev keeps working, but logs a warning once.
 * decrypt() always handles both encrypted ("v1:...") and plaintext values
 * so existing rows in dev/staging continue to work after the upgrade.
 */

const ENC_VERSION = 'v1';
const HMAC_VERSION = 'h1';
const TOKEN_DOMAIN = 'taurus:integration-token';
const STATE_DOMAIN = 'taurus:oauth-state';

let warnedNoKey = false;

function masterKey(): Buffer | null {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    if (!warnedNoKey) {
      // eslint-disable-next-line no-console
      console.warn(
        '[integrations/crypto] CREDENTIAL_ENCRYPTION_KEY missing or <32 chars — tokens stored as plaintext and OAuth state is unsigned. Set it before public launch.',
      );
      warnedNoKey = true;
    }
    return null;
  }
  return Buffer.from(raw, 'utf-8');
}

function deriveSubkey(domain: string): Buffer | null {
  const k = masterKey();
  if (!k) return null;
  return createHash('sha256').update(domain).update(k).digest();
}

// ── Token at-rest encryption ───────────────────────────────

export function encryptToken(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext ?? null;
  const key = deriveSubkey(TOKEN_DOMAIN);
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_VERSION}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

export function decryptToken(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') return stored ?? null;
  if (!stored.startsWith(`${ENC_VERSION}:`)) {
    // Plaintext (legacy or dev mode without key) — return as-is.
    return stored;
  }
  const key = deriveSubkey(TOKEN_DOMAIN);
  if (!key) {
    // Encrypted ciphertext but no key — refuse to silently fail.
    throw new Error(
      'Encrypted integration token found but CREDENTIAL_ENCRYPTION_KEY is missing or invalid',
    );
  }
  const [, ivB64, tagB64, ctB64] = stored.split(':');
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf-8');
}

// ── OAuth state signing ───────────────────────────────────

export interface OAuthStatePayload {
  orgId: string;
  userId: string;
  provider: string;
  /** Optional provider-specific environment hint (e.g. Salesforce sandbox) */
  env?: string;
  /** Random nonce so two simultaneous flows for the same provider differ */
  nonce: string;
  /** Unix ms when this state stops being accepted */
  exp: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes — covers the OAuth round-trip with margin

export function issueOAuthState(payload: Omit<OAuthStatePayload, 'nonce' | 'exp'> & { ttlMs?: number }): string {
  const full: OAuthStatePayload = {
    orgId: payload.orgId,
    userId: payload.userId,
    provider: payload.provider,
    ...(payload.env ? { env: payload.env } : {}),
    nonce: randomBytes(12).toString('base64url'),
    exp: Date.now() + (payload.ttlMs ?? DEFAULT_TTL_MS),
  };

  const body = Buffer.from(JSON.stringify(full), 'utf-8').toString('base64url');
  const key = deriveSubkey(STATE_DOMAIN);
  if (!key) {
    // Dev-mode fallback: unsigned, but tagged so verifyOAuthState can detect.
    return `${HMAC_VERSION}:dev:${body}`;
  }
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `${HMAC_VERSION}:${sig}:${body}`;
}

export function verifyOAuthState(raw: string): OAuthStatePayload {
  // Tolerate the legacy plain-base64 JSON shape so in-flight callbacks during
  // deploy don't break. Once all clients are upgraded we can remove this.
  if (!raw.startsWith(`${HMAC_VERSION}:`)) {
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
      if (parsed.orgId && parsed.userId && parsed.provider) {
        return {
          orgId: parsed.orgId,
          userId: parsed.userId,
          provider: parsed.provider,
          env: parsed.env,
          nonce: 'legacy',
          exp: Date.now() + DEFAULT_TTL_MS, // legacy states have no expiry; treat as fresh
        };
      }
    } catch {
      /* fall through */
    }
    throw new Error('OAuth state is malformed');
  }

  const [, sig, body] = raw.split(':');
  const key = deriveSubkey(STATE_DOMAIN);

  if (sig !== 'dev') {
    if (!key) {
      throw new Error(
        'Signed OAuth state received but CREDENTIAL_ENCRYPTION_KEY is missing',
      );
    }
    const expected = createHmac('sha256', key).update(body).digest('base64url');
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('OAuth state signature mismatch');
    }
  }

  let parsed: OAuthStatePayload;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
  } catch {
    throw new Error('OAuth state body is malformed');
  }

  if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
    throw new Error('OAuth state has expired — please retry connecting');
  }
  return parsed;
}
