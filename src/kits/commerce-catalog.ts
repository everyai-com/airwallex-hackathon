/**
 * Synthetic merchant catalog for the Agentic Commerce kits (9-10).
 *
 * The merchant-side Agentic Commerce surface — catalog, product-search tool,
 * hosted checkout — is enablement-gated (see submission/enablement-requests.md).
 * Until access lands, these deterministic modules stand in for it exactly like
 * the mock transport stands in for the Airwallex REST APIs. Everything here is
 * pure: the same catalog backs demos, kits and tests.
 */

import { round2 } from '../core/money.js';

export interface ShippingOption {
  code: 'STANDARD' | 'EXPEDITED';
  priceUsd: number;
  etaDays: number;
}

export interface Product {
  sku: string;
  name: string;
  description: string;
  category: string;
  merchant: string;
  priceUsd: number;
  rating: number;
  inStock: boolean;
  shipping: ShippingOption[];
}

/** A purchasable combination: one listing, one fulfillment choice, one quantity. */
export interface PurchaseOffer {
  sku: string;
  name: string;
  merchant: string;
  quantity: number;
  unitPriceUsd: number;
  shippingCode: ShippingOption['code'];
  shippingUsd: number;
  totalUsd: number;
  etaDays: number;
  rating: number;
  currency: 'USD';
}

export type ProductSort = 'price_asc' | 'rating_desc';

export interface ProductQuery {
  text?: string;
  category?: string;
  merchant?: string;
  maxPriceUsd?: number;
  inStockOnly?: boolean;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  items: Product[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const ship = (
  standardPrice: number,
  standardEta: number,
  expeditedPrice: number,
  expeditedEta: number,
): ShippingOption[] => [
  { code: 'STANDARD', priceUsd: standardPrice, etaDays: standardEta },
  { code: 'EXPEDITED', priceUsd: expeditedPrice, etaDays: expeditedEta },
];

interface BaseProduct {
  key: string;
  name: string;
  description: string;
  category: string;
  merchant: string;
  priceUsd: number;
  rating: number;
  shipping: ShippingOption[];
  /** 0 keeps the listing as a single row (used by the espresso-machine storyline). */
  variants: number;
}

const ESPRESSO_MACHINE = 'Semi-automatic espresso machine with a commercial steam wand.';

const BASE_PRODUCTS: BaseProduct[] = [
  // Espresso machines — single listings, the kit 9 storyline.
  {
    key: 'GAGGIA-EVO-CREMACO',
    name: 'Gaggia Classic Evo Pro',
    description: ESPRESSO_MACHINE,
    category: 'Espresso Machines',
    merchant: 'CremaCo',
    priceUsd: 449,
    rating: 4.6,
    shipping: ship(0, 4, 15, 2),
    variants: 0,
  },
  {
    key: 'GAGGIA-EVO-ROAST',
    name: 'Gaggia Classic Evo Pro',
    description: ESPRESSO_MACHINE,
    category: 'Espresso Machines',
    merchant: 'RoastWorks',
    priceUsd: 469,
    rating: 4.6,
    shipping: ship(0, 3, 15, 2),
    variants: 0,
  },
  {
    key: 'BREVILLE-BAMBINO',
    name: 'Breville Bambino Plus',
    description: 'Compact espresso machine with automatic milk texturing.',
    category: 'Espresso Machines',
    merchant: 'BeanCo',
    priceUsd: 499.95,
    rating: 4.7,
    shipping: ship(0, 3, 25, 2),
    variants: 0,
  },
  {
    key: 'DELONGHI-DEDICA',
    name: "De'Longhi Dedica Arte",
    description: 'Slim espresso machine with a professional steam wand.',
    category: 'Espresso Machines',
    merchant: 'BeanCo',
    priceUsd: 299,
    rating: 4.4,
    shipping: ship(0, 3, 18, 2),
    variants: 0,
  },
  {
    key: 'BREVILLE-BARISTA',
    name: 'Breville Barista Express',
    description: 'Espresso machine with an integrated conical burr grinder.',
    category: 'Espresso Machines',
    merchant: 'BeanCo',
    priceUsd: 699.95,
    rating: 4.8,
    shipping: ship(0, 3, 25, 2),
    variants: 0,
  },
  {
    key: 'RANCILIO-SILVIA',
    name: 'Rancilio Silvia Pro X',
    description: 'Dual-boiler espresso machine with PID temperature control.',
    category: 'Espresso Machines',
    merchant: 'CremaCo',
    priceUsd: 1890,
    rating: 4.9,
    shipping: ship(0, 5, 35, 2),
    variants: 0,
  },
  // Grinders
  {
    key: 'ENCORE-ESP',
    name: 'Baratza Encore ESP',
    description: 'Espresso grinder with 40 mm conical burrs and 20 settings.',
    category: 'Grinders',
    merchant: 'RoastWorks',
    priceUsd: 199,
    rating: 4.5,
    shipping: ship(0, 4, 12, 2),
    variants: 4,
  },
  {
    key: 'DF64-GEN2',
    name: 'DF64 Gen 2',
    description: 'Single-dose espresso grinder with 64 mm flat burrs.',
    category: 'Grinders',
    merchant: 'RoastWorks',
    priceUsd: 349,
    rating: 4.7,
    shipping: ship(0, 4, 14, 2),
    variants: 4,
  },
  {
    key: 'MIGNON-SPEC',
    name: 'Eureka Mignon Specialita',
    description: 'Stepless espresso grinder with 55 mm burrs and silent operation.',
    category: 'Grinders',
    merchant: 'CremaCo',
    priceUsd: 429,
    rating: 4.8,
    shipping: ship(0, 4, 15, 2),
    variants: 4,
  },
  {
    key: 'FELLOW-OPUS',
    name: 'Fellow Opus',
    description: 'All-purpose grinder tuned for espresso and pour-over.',
    category: 'Grinders',
    merchant: 'BeanCo',
    priceUsd: 195,
    rating: 4.3,
    shipping: ship(0, 3, 12, 2),
    variants: 4,
  },
  {
    key: 'TIMEMORE-C3',
    name: 'Timemore Chestnut C3 Pro',
    description: 'Hand grinder with stainless steel conical burrs for espresso.',
    category: 'Grinders',
    merchant: 'BeanCo',
    priceUsd: 89,
    rating: 4.2,
    shipping: ship(0, 3, 10, 2),
    variants: 4,
  },
  // Brewers
  {
    key: 'STAGG-EKG',
    name: 'Fellow Stagg EKG',
    description: 'Gooseneck electric kettle with PID temperature control.',
    category: 'Brewers',
    merchant: 'RoastWorks',
    priceUsd: 165,
    rating: 4.7,
    shipping: ship(0, 4, 12, 2),
    variants: 4,
  },
  {
    key: 'HARIO-V60-KIT',
    name: 'Hario V60 Craft Kit',
    description: 'Pour-over brewer kit with dripper, server and filters.',
    category: 'Brewers',
    merchant: 'BeanCo',
    priceUsd: 45,
    rating: 4.4,
    shipping: ship(0, 3, 10, 2),
    variants: 4,
  },
  {
    key: 'AEROPRESS',
    name: 'AeroPress Original',
    description: 'Portable immersion brewer for espresso-style coffee.',
    category: 'Brewers',
    merchant: 'BeanCo',
    priceUsd: 39.95,
    rating: 4.6,
    shipping: ship(0, 3, 10, 2),
    variants: 4,
  },
  {
    key: 'CHEMEX-6C',
    name: 'Chemex Classic 6-Cup',
    description: 'Pour-over brewer with a borosilicate glass body.',
    category: 'Brewers',
    merchant: 'CremaCo',
    priceUsd: 52,
    rating: 4.5,
    shipping: ship(0, 4, 12, 2),
    variants: 4,
  },
  {
    key: 'MOCCAMASTER',
    name: 'Technivorm Moccamaster KBGV',
    description: 'Filter coffee brewer with copper boiling element.',
    category: 'Brewers',
    merchant: 'CremaCo',
    priceUsd: 359,
    rating: 4.8,
    shipping: ship(0, 5, 18, 2),
    variants: 4,
  },
  {
    key: 'HARIO-SWITCH',
    name: 'Hario Switch',
    description: 'Immersion pour-over brewer with a glass switch.',
    category: 'Brewers',
    merchant: 'BeanCo',
    priceUsd: 60,
    rating: 4.5,
    shipping: ship(0, 3, 10, 2),
    variants: 4,
  },
  // Accessories
  {
    key: 'ACAIA-PEARL',
    name: 'Acaia Pearl S',
    description: 'Coffee scale with 0.1 g resolution and flow-rate display.',
    category: 'Accessories',
    merchant: 'CremaCo',
    priceUsd: 260,
    rating: 4.8,
    shipping: ship(0, 4, 14, 2),
    variants: 4,
  },
  {
    key: 'NORMCORE-TAMPER',
    name: 'Normcore V4 Tamper',
    description: 'Spring-loaded espresso tamper with a leveling base.',
    category: 'Accessories',
    merchant: 'RoastWorks',
    priceUsd: 45,
    rating: 4.6,
    shipping: ship(0, 3, 10, 2),
    variants: 4,
  },
  {
    key: 'WDT-TOOL',
    name: 'WDT Distribution Tool',
    description: 'Needle distribution tool for even espresso extraction.',
    category: 'Accessories',
    merchant: 'RoastWorks',
    priceUsd: 25,
    rating: 4.4,
    shipping: ship(0, 3, 8, 2),
    variants: 4,
  },
  {
    key: 'MONTY-PITCHER',
    name: 'Fellow Monty Milk Pitcher',
    description: '12 oz milk pitcher for latte art.',
    category: 'Accessories',
    merchant: 'BeanCo',
    priceUsd: 30,
    rating: 4.3,
    shipping: ship(0, 3, 8, 2),
    variants: 4,
  },
  {
    key: 'PUCK-SCREEN',
    name: 'Puck Screen Set',
    description: 'Stainless steel mesh screens for cleaner espresso shots.',
    category: 'Accessories',
    merchant: 'BeanCo',
    priceUsd: 18,
    rating: 4.2,
    shipping: ship(0, 3, 8, 2),
    variants: 4,
  },
  {
    key: 'KNOCK-BOX',
    name: 'Breville Knock Box',
    description: 'Espresso knock box with a removable stainless bar.',
    category: 'Accessories',
    merchant: 'CremaCo',
    priceUsd: 35,
    rating: 4.1,
    shipping: ship(0, 4, 10, 2),
    variants: 4,
  },
  // Filters & care
  {
    key: 'V60-FILTERS',
    name: 'Hario V60 Filters (100)',
    description: 'Tabbed paper filters for V60 pour-over brewing.',
    category: 'Filters & Care',
    merchant: 'BeanCo',
    priceUsd: 12,
    rating: 4.5,
    shipping: ship(0, 3, 8, 1),
    variants: 4,
  },
  {
    key: 'AEROPRESS-FILTERS',
    name: 'AeroPress Micro-Filters (350)',
    description: 'Paper micro-filters for the AeroPress brewer.',
    category: 'Filters & Care',
    merchant: 'BeanCo',
    priceUsd: 9,
    rating: 4.6,
    shipping: ship(0, 3, 8, 1),
    variants: 4,
  },
  {
    key: 'CLEANING-TABS',
    name: 'Espresso Cleaning Tablets',
    description: 'Backflush cleaning tablets for home espresso equipment.',
    category: 'Filters & Care',
    merchant: 'RoastWorks',
    priceUsd: 15,
    rating: 4.4,
    shipping: ship(0, 3, 8, 1),
    variants: 4,
  },
  {
    key: 'DESCALER',
    name: 'Descaler Solution',
    description: 'Descaling solution for espresso appliance boilers.',
    category: 'Filters & Care',
    merchant: 'CremaCo',
    priceUsd: 18,
    rating: 4.3,
    shipping: ship(0, 4, 9, 1),
    variants: 4,
  },
  // Coffee
  {
    key: 'ESPRESSO-BLEND',
    name: 'Single-Origin Espresso Blend 1 kg',
    description: 'Whole-bean blend roasted for espresso.',
    category: 'Coffee',
    merchant: 'RoastWorks',
    priceUsd: 38,
    rating: 4.8,
    shipping: ship(0, 4, 10, 1),
    variants: 4,
  },
  {
    key: 'DECAF-BLEND',
    name: 'Decaf Espresso Blend 500 g',
    description: 'Swiss-water decaf whole-bean blend.',
    category: 'Coffee',
    merchant: 'RoastWorks',
    priceUsd: 22,
    rating: 4.3,
    shipping: ship(0, 4, 10, 1),
    variants: 4,
  },
  {
    key: 'HOUSE-BLEND',
    name: 'House Blend 1 kg',
    description: 'Everyday whole-bean blend for filter and espresso.',
    category: 'Coffee',
    merchant: 'BeanCo',
    priceUsd: 28,
    rating: 4.5,
    shipping: ship(0, 3, 9, 1),
    variants: 4,
  },
  {
    key: 'FILTER-SAMPLER',
    name: 'Filter Roast Sampler',
    description: 'Four 250 g bags of single-origin filter roasts.',
    category: 'Coffee',
    merchant: 'CremaCo',
    priceUsd: 34,
    rating: 4.6,
    shipping: ship(0, 4, 10, 1),
    variants: 4,
  },
];

const FINISH_STYLES = ['Graphite', 'Stainless', 'Matte Black', 'Limited Edition'];
const ROAST_STYLES = ['Light Roast', 'Medium Roast', 'Dark Roast', 'Decaf'];
const FINISH_BUMPS = [0, 5, 8, 15];
const ROAST_BUMPS = [0, 0, 1, 2];

function styleCode(style: string): string {
  return style
    .split(' ')
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

/** 106 deterministic products across six categories. */
export function buildCatalog(): Product[] {
  const products: Product[] = [];
  let variantIndex = 0;

  for (const base of BASE_PRODUCTS) {
    if (base.variants === 0) {
      products.push({
        sku: base.key,
        name: base.name,
        description: base.description,
        category: base.category,
        merchant: base.merchant,
        priceUsd: round2(base.priceUsd),
        rating: base.rating,
        inStock: true,
        shipping: base.shipping,
      });
      continue;
    }

    const isCoffee = base.category === 'Coffee';
    const styles = isCoffee ? ROAST_STYLES : FINISH_STYLES;
    const bumps = isCoffee ? ROAST_BUMPS : FINISH_BUMPS;

    for (let index = 0; index < base.variants; index += 1) {
      const style = styles[index] ?? styles[0]!;
      const bump = bumps[index] ?? 0;
      variantIndex += 1;
      products.push({
        sku: `${base.key}-${styleCode(style)}`,
        name: `${base.name} — ${style}`,
        description: isCoffee
          ? `${base.description} ${style} profile.`
          : `${base.description} ${style} finish.`,
        category: base.category,
        merchant: base.merchant,
        priceUsd: round2(base.priceUsd + bump),
        rating: base.rating,
        inStock: variantIndex % 17 !== 0,
        shipping: base.shipping,
      });
    }
  }

  return products;
}

/**
 * The merchant product-search tool contract: text tokens must all match, the
 * structured filters narrow further, and results page deterministically.
 */
export function searchProducts(products: Product[], query: ProductQuery = {}): SearchResult {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 20)));
  const tokens = (query.text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  let matches = products.filter((product) => {
    const haystack =
      `${product.name} ${product.description} ${product.category} ${product.merchant}`.toLowerCase();
    if (!tokens.every((token) => haystack.includes(token))) return false;
    if (query.category && product.category !== query.category) return false;
    if (query.merchant && product.merchant !== query.merchant) return false;
    if (query.maxPriceUsd !== undefined && product.priceUsd > query.maxPriceUsd) return false;
    if (query.inStockOnly && !product.inStock) return false;
    return true;
  });

  if (query.sort === 'price_asc') {
    matches = [...matches].sort(
      (a, b) => a.priceUsd - b.priceUsd || a.sku.localeCompare(b.sku),
    );
  } else if (query.sort === 'rating_desc') {
    matches = [...matches].sort(
      (a, b) => b.rating - a.rating || a.priceUsd - b.priceUsd,
    );
  }

  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;

  return {
    items: matches.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages,
  };
}

/** Price one listing + fulfillment choice into a deliverable offer. */
export function buildOffer(
  product: Product,
  shippingCode: ShippingOption['code'],
  quantity = 1,
): PurchaseOffer {
  const option = product.shipping.find((entry) => entry.code === shippingCode);
  if (!option) throw new Error(`${product.sku} has no ${shippingCode} shipping option.`);
  const unitPriceUsd = round2(product.priceUsd);
  const shippingUsd = round2(option.priceUsd);
  return {
    sku: product.sku,
    name: product.name,
    merchant: product.merchant,
    quantity,
    unitPriceUsd,
    shippingCode: option.code,
    shippingUsd,
    totalUsd: round2(unitPriceUsd * quantity + shippingUsd),
    etaDays: option.etaDays,
    rating: product.rating,
    currency: 'USD',
  };
}

/** One offer per shipping option, for every listing in a search result. */
export function offersFrom(
  products: Product[],
  quantity = 1,
): PurchaseOffer[] {
  return products.flatMap((product) =>
    product.shipping.map((option) => buildOffer(product, option.code, quantity)),
  );
}
