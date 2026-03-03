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
  const single = splitKeyList(process.env.MANIMCAT_API_KEY)
  const multi = splitKeyList(process.env.MANIMCAT_API_KEYS)
  const unique = new Set<string>([...single, ...multi])
  return Array.from(unique)
}

export function hasManimcatApiKey(token: string): boolean {
  if (!token) {
    return false
  }
  return getAllowedManimcatApiKeys().includes(token)
}

