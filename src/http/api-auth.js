import crypto from 'node:crypto';

function matchesToken(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;

  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

export function createApiAuth(expectedToken) {
  return function apiAuth(req, res, next) {
    // Authentication is opt-in locally. The ECS task sets API_AUTH_TOKEN.
    if (!expectedToken) return next();

    const authorization = req.get('authorization');
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    const providedToken = bearerToken ?? req.get('x-api-key');

    if (!matchesToken(providedToken, expectedToken)) {
      res.set('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'unauthorized' });
    }

    next();
  };
}
