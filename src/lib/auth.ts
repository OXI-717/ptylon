import jwt from 'jsonwebtoken';

const JWT_EXPIRY = '7d';

// Plain password — single-user system behind nginx basic_auth
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('FATAL: JWT_SECRET env var is required');
  return secret;
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (!AUTH_PASSWORD) return false;
  // Constant-time comparison to prevent timing attacks
  if (password.length !== AUTH_PASSWORD.length) return false;
  let result = 0;
  for (let i = 0; i < password.length; i++) {
    result |= password.charCodeAt(i) ^ AUTH_PASSWORD.charCodeAt(i);
  }
  return result === 0;
}

export function signToken(): string {
  return jwt.sign({ user: 'admin', iat: Date.now() }, jwtSecret(), { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, jwtSecret());
    return true;
  } catch {
    return false;
  }
}
