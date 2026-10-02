/** Shared demo constants for the starter kits. */

/**
 * transfers/create `reason` must be one of the documented enum values.
 * Source: Airwallex payout docs, "Create a transfer".
 */
export const TRANSFER_REASONS = {
  freight: 'freight',
  goodsPurchased: 'goods_purchased',
  professionalServices: 'professional_business_services',
  other: 'other_services',
} as const;

export type TransferReason = (typeof TRANSFER_REASONS)[keyof typeof TRANSFER_REASONS];
