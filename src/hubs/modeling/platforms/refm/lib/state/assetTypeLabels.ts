/**
 * assetTypeLabels.ts (2026-11-19)
 *
 * AN ASSET'S TYPE LABEL FOLLOWS ITS TYPE. `Asset.type` is a stored copy of the type's label and is what
 * `assetLabel` prints ("Phase 1, Branded Apartments"), while the label itself lives on `project.assetTypes`
 * (the Types and Standards tab). Renaming a type there changed the list and NOT the copies, so every line
 * name, the land table's type column, the sub-unit lines and the operating headings kept the old name
 * (v1.2: the type read "Branded Apartments" on the type tables and "Branded Villas" everywhere else).
 *
 * ONE RULE, used by the store's rename (`setAssetTypes`) and by the load-time settle (`settleModel`): an
 * asset whose `assetTypeId` is on the list takes that entry's label. An asset with no id, or an id the list
 * does not carry, keeps what it has (a label typed before the list existed is an answer, not a pointer).
 * It SETTLES: the input array comes back when nothing moves.
 *
 * No em dashes in this file.
 */
export function settleAssetTypeLabels<A extends { assetTypeId?: string; type?: string }>(
  assets: A[],
  assetTypes: ReadonlyArray<{ id: string; label: string }> | undefined,
): { assets: A[]; changed: boolean } {
  if (!assetTypes?.length) return { assets, changed: false };
  const byId = new Map(assetTypes.map((t) => [t.id, t.label]));
  let changed = false;
  const next = assets.map((a) => {
    const label = a.assetTypeId ? byId.get(a.assetTypeId) : undefined;
    if (label === undefined || label.trim() === '' || (a.type ?? '') === label) return a;
    changed = true;
    return { ...a, type: label };
  });
  return changed ? { assets: next, changed } : { assets, changed: false };
}
