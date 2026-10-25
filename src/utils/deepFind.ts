export interface Hit {
  path: string;
  value: unknown;
}

/**
 * Walk any JSON-ish structure and return every node where `match` says yes.
 * Aura responses are deeply nested (actions[0].returnValue....) and the exact
 * shape isn't documented, so asserting on "somewhere in here there's an 006 id"
 * is more honest than hardcoding a path I haven't seen.
 */
export function deepFind(
  node: unknown,
  match: (key: string, value: unknown) => boolean,
  path = '$',
  out: Hit[] = [],
): Hit[] {
  if (Array.isArray(node)) {
    node.forEach((v, i) => deepFind(v, match, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const p = `${path}.${k}`;
      if (match(k, v)) out.push({ path: p, value: v });
      deepFind(v, match, p, out);
    }
  }
  return out;
}

/** every string value that looks like a salesforce id with the given 3 char key prefix */
export function findIdsByPrefix(node: unknown, prefix: string): Hit[] {
  const re = new RegExp(`^${prefix}[A-Za-z0-9]{15}$`);
  return deepFind(node, (_k, v) => typeof v === 'string' && re.test(v));
}
