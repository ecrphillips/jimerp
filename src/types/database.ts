// Database types for Lite ERP

export type AppRole = 'ADMIN' | 'OPS' | 'CLIENT';
export type ProductFormat = 'WHOLE_BEAN' | 'ESPRESSO' | 'FILTER' | 'OTHER';
export type GrindOption = 'WHOLE_BEAN' | 'ESPRESSO' | 'FILTER';
export type OrderStatus = 'DRAFT' | 'SUBMITTED' | 'CONFIRMED' | 'IN_PRODUCTION' | 'READY' | 'SHIPPED' | 'CANCELLED';
export type DeliveryMethod = 'PICKUP' | 'DELIVERY' | 'COURIER';
export type ProductionStatus = 'PLANNED' | 'ROASTED' | 'PACKED' | 'STAGED' | 'COMPLETE';

export interface Client {
  id: string;
  name: string;
  billing_contact_name: string | null;
  billing_email: string | null;
  shipping_address: string | null;
  notes_internal: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  client_id: string | null;
}

export interface Profile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  client_id: string;
  product_name: string;
  sku: string | null;
  format: ProductFormat;
  bag_size_g: number;
  grind_options: GrindOption[];
  is_active: boolean;
  internal_packaging_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  client?: Client;
  current_price?: PriceListEntry;
}

export interface PriceListEntry {
  id: string;
  product_id: string;
  unit_price: number;
  currency: string;
  effective_date: string;
  created_at: string;
}

export interface GreenCoffeeLot {
  id: string;
  name: string;
  supplier: string | null;
  origin: string | null;
  received_date: string | null;
  kg_received: number;
  kg_on_hand: number;
  notes_internal: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  client_id: string;
  order_number: string;
  status: OrderStatus;
  requested_ship_date: string | null;
  delivery_method: DeliveryMethod;
  client_po: string | null;
  created_by_user_id: string | null;
  internal_ops_notes: string | null;
  client_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  client?: Client;
  line_items?: OrderLineItem[];
}

export interface OrderLineItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity_units: number;
  grind: GrindOption | null;
  unit_price_locked: number;
  line_notes: string | null;
  created_at: string;
  // Joined fields
  product?: Product;
}

export interface ProductionPlanItem {
  id: string;
  target_date: string;
  order_id: string;
  client_id: string;
  product_id: string;
  quantity_units: number;
  status: ProductionStatus;
  ops_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  order?: Order;
  client?: Client;
  product?: Product;
}

// Auth context types
export interface AuthUser {
  id: string;
  email: string;
  role: AppRole;
  clientId: string | null;
  profile: Profile | null;
}
