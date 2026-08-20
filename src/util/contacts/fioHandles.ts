/** Previously used FIO handles (excludes inactive and non-FIO entries). */
export const filterRecentFioHandles = (
  addresses: Record<string, boolean>,
  search: string
): string[] => {
  const needle = search.trim().toLowerCase()
  const handles: string[] = []
  for (const address of Object.keys(addresses)) {
    if (!addresses[address]) continue
    if (!address.includes('@')) continue
    if (needle !== '' && !address.toLowerCase().includes(needle)) continue
    handles.push(address)
  }
  return handles.sort()
}
