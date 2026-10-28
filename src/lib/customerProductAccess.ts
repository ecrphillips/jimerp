export interface ProductAccessSetting {
  product_id: string;
  visible: boolean;
  orderable: boolean;
  case_only: boolean;
}

export function productAccessState(productId: string, settings: ProductAccessSetting[], cases: { id: string; case_lot_product_id: string | null; is_active: boolean }[]) {
  const setting = settings.find(s => s.product_id === productId);
  const heldForCase = cases.some(c => c.is_active && c.case_lot_product_id === productId && settings.some(s => s.product_id === c.id && s.case_only));
  const visible = setting?.visible ?? true;
  return { visible, orderable: visible && (setting?.orderable ?? true) && !heldForCase, caseOnly: setting?.case_only ?? false, heldForCase };
}