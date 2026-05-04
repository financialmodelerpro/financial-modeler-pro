/**
 * assetStrategyHelp.ts, M1.11/M2.
 *
 * Plain-English help copy for the Asset Strategy block on the Build
 * Program tab. Strategy is the single most important per-asset decision
 * driving revenue (Sell vs Lease vs Operate behave very differently in
 * Module 2 cash flow), so the labels need real tooltips, not just enum
 * names.
 */

export const ASSET_STRATEGY_HELP: Record<string, string> = {
  primaryStrategy:
    'How this asset makes money. Develop and Sell turns built area into one-time sales revenue. Develop and Lease holds the asset and earns rent over the operations period. Develop and Operate runs it as a business (hotel, serviced apartments) with daily revenue per key. Pick the dominant strategy here; if a portion of the asset uses a different model, set the Secondary strategy and a split percentage.',
  primaryStrategyPct:
    'Share of this asset that follows the Primary strategy. Defaults to 100. Reduce when the asset is split (e.g. 70 percent sold, 30 percent leased) and use Secondary for the remainder. The two should sum to 100.',
  secondaryStrategy:
    'Optional second strategy when an asset mixes revenue models. Leave blank for a pure-strategy asset (most common). Common pattern: a residential tower that sells most units but holds back a few for long-term lease.',
  secondaryStrategyPct:
    'Share of this asset that follows the Secondary strategy. Active only when Secondary strategy is set. Should sum to 100 with Primary percentage.',
  zone:
    'Optional sub-area inside this plot (e.g. Tower A vs Tower B on a single plot). Leave blank to keep the asset bound only to the plot. Zones are useful when one plot hosts multiple assets and you want to track which physical wing each asset occupies.',
  gfaOverride:
    'Manual override for this asset Gross Floor Area. Leave blank to let the platform derive it from the plot envelope and allocation percentage. Use the override only when you know the exact GFA from architectural drawings.',
};
