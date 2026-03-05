function splitKeyList(input: string | undefined): string[] {
  if (!input) {
    return []
  }
  return input
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getAllowedManimcatApiKeys(): string[] {
  const routed = splitKeyList(process.env.MANIMCAT_ROUTE_KEYS)
  const unique = new Set<string>([...routed])
  return Array.from(unique)
}

export function hasManimcatApiKey(token: string): boolean {
  if (!token) {
    return false
  }
  return getAllowedManimcatApiKeys().includes(token)
}
