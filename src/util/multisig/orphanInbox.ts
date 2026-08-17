/**
 * Accept / complete / spend messages can arrive from relays before the
 * matching invite is stored. Keep them until ingestInvite can replay them.
 */
const orphanInbox = new Map<string, string[]>()

export const stashOrphanMultisigMessage = (
  proposalId: string,
  content: string
): void => {
  const existing = orphanInbox.get(proposalId) ?? []
  if (existing.includes(content)) return
  existing.push(content)
  orphanInbox.set(proposalId, existing)
}

export const takeOrphanMultisigMessages = (proposalId: string): string[] => {
  const queued = orphanInbox.get(proposalId) ?? []
  orphanInbox.delete(proposalId)
  return queued
}

export const clearOrphanInbox = (): void => {
  orphanInbox.clear()
}
