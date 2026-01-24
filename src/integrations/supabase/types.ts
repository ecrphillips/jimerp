export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      andon_picks: {
        Row: {
          board: string
          id: string
          product_id: string
          target_date: string
          units_picked: number
          units_supplied: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          board: string
          id?: string
          product_id: string
          target_date: string
          units_picked?: number
          units_supplied?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          board?: string
          id?: string
          product_id?: string
          target_date?: string
          units_picked?: number
          units_supplied?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "andon_picks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          billing_contact_name: string | null
          billing_email: string | null
          client_code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes_internal: string | null
          shipping_address: string | null
          updated_at: string
        }
        Insert: {
          billing_contact_name?: string | null
          billing_email?: string | null
          client_code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes_internal?: string | null
          shipping_address?: string | null
          updated_at?: string
        }
        Update: {
          billing_contact_name?: string | null
          billing_email?: string | null
          client_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes_internal?: string | null
          shipping_address?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      external_demand: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity_units: number
          source: Database["public"]["Enums"]["board_source"]
          target_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity_units?: number
          source: Database["public"]["Enums"]["board_source"]
          target_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity_units?: number
          source?: Database["public"]["Enums"]["board_source"]
          target_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_demand_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      fg_inventory: {
        Row: {
          id: string
          notes: string | null
          product_id: string
          units_on_hand: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          notes?: string | null
          product_id: string
          units_on_hand?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          notes?: string | null
          product_id?: string
          units_on_hand?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fg_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      fg_inventory_log: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          product_id: string
          units_after: number
          units_delta: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id: string
          units_after: number
          units_delta: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          units_after?: number
          units_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "fg_inventory_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      green_coffee_lots: {
        Row: {
          created_at: string
          id: string
          kg_on_hand: number
          kg_received: number
          name: string
          notes_internal: string | null
          origin: string | null
          received_date: string | null
          supplier: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kg_on_hand?: number
          kg_received?: number
          name: string
          notes_internal?: string | null
          origin?: string | null
          received_date?: string | null
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kg_on_hand?: number
          kg_received?: number
          name?: string
          notes_internal?: string | null
          origin?: string | null
          received_date?: string | null
          supplier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      order_line_items: {
        Row: {
          created_at: string
          grind: Database["public"]["Enums"]["grind_option"] | null
          id: string
          line_notes: string | null
          order_id: string
          product_id: string
          quantity_units: number
          unit_price_locked: number
        }
        Insert: {
          created_at?: string
          grind?: Database["public"]["Enums"]["grind_option"] | null
          id?: string
          line_notes?: string | null
          order_id: string
          product_id: string
          quantity_units: number
          unit_price_locked: number
        }
        Update: {
          created_at?: string
          grind?: Database["public"]["Enums"]["grind_option"] | null
          id?: string
          line_notes?: string | null
          order_id?: string
          product_id?: string
          quantity_units?: number
          unit_price_locked?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_line_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          client_id: string
          client_notes: string | null
          client_po: string | null
          created_at: string
          created_by_admin: boolean
          created_by_user_id: string | null
          delivery_method: Database["public"]["Enums"]["delivery_method"]
          id: string
          internal_ops_notes: string | null
          invoiced: boolean
          order_number: string
          packed: boolean
          requested_ship_date: string | null
          roasted: boolean
          shipped_or_ready: boolean
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          client_id: string
          client_notes?: string | null
          client_po?: string | null
          created_at?: string
          created_by_admin?: boolean
          created_by_user_id?: string | null
          delivery_method?: Database["public"]["Enums"]["delivery_method"]
          id?: string
          internal_ops_notes?: string | null
          invoiced?: boolean
          order_number: string
          packed?: boolean
          requested_ship_date?: string | null
          roasted?: boolean
          shipped_or_ready?: boolean
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_notes?: string | null
          client_po?: string | null
          created_at?: string
          created_by_admin?: boolean
          created_by_user_id?: string | null
          delivery_method?: Database["public"]["Enums"]["delivery_method"]
          id?: string
          internal_ops_notes?: string | null
          invoiced?: boolean
          order_number?: string
          packed?: boolean
          requested_ship_date?: string | null
          roasted?: boolean
          shipped_or_ready?: boolean
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_runs: {
        Row: {
          created_at: string
          id: string
          kg_consumed: number
          notes: string | null
          product_id: string
          target_date: string
          units_packed: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kg_consumed?: number
          notes?: string | null
          product_id: string
          target_date: string
          units_packed?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kg_consumed?: number
          notes?: string | null
          product_id?: string
          target_date?: string
          units_packed?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packing_runs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list: {
        Row: {
          created_at: string
          currency: string
          effective_date: string
          id: string
          product_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          currency?: string
          effective_date?: string
          id?: string
          product_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          currency?: string
          effective_date?: string
          id?: string
          product_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_list_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_checkmarks: {
        Row: {
          bag_size_g: number
          created_at: string
          id: string
          pack_complete: boolean
          product_id: string
          roast_complete: boolean
          ship_complete: boolean
          ship_priority: Database["public"]["Enums"]["ship_priority"]
          target_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bag_size_g: number
          created_at?: string
          id?: string
          pack_complete?: boolean
          product_id: string
          roast_complete?: boolean
          ship_complete?: boolean
          ship_priority?: Database["public"]["Enums"]["ship_priority"]
          target_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bag_size_g?: number
          created_at?: string
          id?: string
          pack_complete?: boolean
          product_id?: string
          roast_complete?: boolean
          ship_complete?: boolean
          ship_priority?: Database["public"]["Enums"]["ship_priority"]
          target_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_checkmarks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_plan_items: {
        Row: {
          client_id: string
          created_at: string
          id: string
          ops_notes: string | null
          order_id: string
          product_id: string
          quantity_units: number
          status: Database["public"]["Enums"]["production_status"]
          target_date: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          ops_notes?: string | null
          order_id: string
          product_id: string
          quantity_units: number
          status?: Database["public"]["Enums"]["production_status"]
          target_date: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          ops_notes?: string | null
          order_id?: string
          product_id?: string
          quantity_units?: number
          status?: Database["public"]["Enums"]["production_status"]
          target_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_plan_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_plan_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_plan_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          bag_size_g: number
          client_id: string
          created_at: string
          format: Database["public"]["Enums"]["product_format"]
          grind_options: Database["public"]["Enums"]["grind_option"][] | null
          id: string
          internal_packaging_notes: string | null
          is_active: boolean
          is_perennial: boolean
          packaging_variant:
            | Database["public"]["Enums"]["packaging_variant"]
            | null
          product_name: string
          roast_group: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          bag_size_g: number
          client_id: string
          created_at?: string
          format?: Database["public"]["Enums"]["product_format"]
          grind_options?: Database["public"]["Enums"]["grind_option"][] | null
          id?: string
          internal_packaging_notes?: string | null
          is_active?: boolean
          is_perennial?: boolean
          packaging_variant?:
            | Database["public"]["Enums"]["packaging_variant"]
            | null
          product_name: string
          roast_group?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          bag_size_g?: number
          client_id?: string
          created_at?: string
          format?: Database["public"]["Enums"]["product_format"]
          grind_options?: Database["public"]["Enums"]["grind_option"][] | null
          id?: string
          internal_packaging_notes?: string | null
          is_active?: boolean
          is_perennial?: boolean
          packaging_variant?:
            | Database["public"]["Enums"]["packaging_variant"]
            | null
          product_name?: string
          roast_group?: string | null
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      roast_exception_events: {
        Row: {
          batch_id: string | null
          created_at: string
          created_by: string | null
          delta_output_kg: number
          delta_wip_kg: number
          event_type: Database["public"]["Enums"]["exception_event_type"]
          id: string
          metadata: Json
          notes: string
          roast_group: string
          target_date: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          delta_output_kg?: number
          delta_wip_kg?: number
          event_type: Database["public"]["Enums"]["exception_event_type"]
          id?: string
          metadata?: Json
          notes?: string
          roast_group: string
          target_date: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          delta_output_kg?: number
          delta_wip_kg?: number
          event_type?: Database["public"]["Enums"]["exception_event_type"]
          id?: string
          metadata?: Json
          notes?: string
          roast_group?: string
          target_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "roast_exception_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "roasted_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      roast_groups: {
        Row: {
          created_at: string
          default_roaster: Database["public"]["Enums"]["default_roaster"]
          expected_yield_loss_pct: number
          is_active: boolean
          notes: string | null
          roast_group: string
          standard_batch_kg: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_roaster?: Database["public"]["Enums"]["default_roaster"]
          expected_yield_loss_pct?: number
          is_active?: boolean
          notes?: string | null
          roast_group: string
          standard_batch_kg?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_roaster?: Database["public"]["Enums"]["default_roaster"]
          expected_yield_loss_pct?: number
          is_active?: boolean
          notes?: string | null
          roast_group?: string
          standard_batch_kg?: number
          updated_at?: string
        }
        Relationships: []
      }
      roasted_batches: {
        Row: {
          actual_output_kg: number
          assigned_roaster:
            | Database["public"]["Enums"]["roaster_machine"]
            | null
          created_at: string
          created_by: string | null
          cropster_batch_id: string | null
          id: string
          notes: string | null
          planned_output_kg: number | null
          roast_group: string
          status: Database["public"]["Enums"]["roasted_batch_status"]
          target_date: string
          updated_at: string
        }
        Insert: {
          actual_output_kg?: number
          assigned_roaster?:
            | Database["public"]["Enums"]["roaster_machine"]
            | null
          created_at?: string
          created_by?: string | null
          cropster_batch_id?: string | null
          id?: string
          notes?: string | null
          planned_output_kg?: number | null
          roast_group: string
          status?: Database["public"]["Enums"]["roasted_batch_status"]
          target_date: string
          updated_at?: string
        }
        Update: {
          actual_output_kg?: number
          assigned_roaster?:
            | Database["public"]["Enums"]["roaster_machine"]
            | null
          created_at?: string
          created_by?: string | null
          cropster_batch_id?: string | null
          id?: string
          notes?: string | null
          planned_output_kg?: number | null
          roast_group?: string
          status?: Database["public"]["Enums"]["roasted_batch_status"]
          target_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      source_board_products: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          product_id: string
          source: Database["public"]["Enums"]["board_source"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          product_id: string
          source: Database["public"]["Enums"]["board_source"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          product_id?: string
          source?: Database["public"]["Enums"]["board_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_board_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          client_id: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          client_id?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          client_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      wip_adjustments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kg_delta: number
          notes: string | null
          reason: Database["public"]["Enums"]["wip_adjustment_reason"]
          roast_group: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kg_delta: number
          notes?: string | null
          reason: Database["public"]["Enums"]["wip_adjustment_reason"]
          roast_group: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kg_delta?: number
          notes?: string | null
          reason?: Database["public"]["Enums"]["wip_adjustment_reason"]
          roast_group?: string
        }
        Relationships: []
      }
      wip_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          delta_kg: number
          entry_type: Database["public"]["Enums"]["wip_entry_type"]
          id: string
          metadata: Json
          notes: string
          related_batch_id: string | null
          related_product_id: string | null
          roast_group: string
          target_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta_kg: number
          entry_type: Database["public"]["Enums"]["wip_entry_type"]
          id?: string
          metadata?: Json
          notes?: string
          related_batch_id?: string | null
          related_product_id?: string | null
          roast_group: string
          target_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta_kg?: number
          entry_type?: Database["public"]["Enums"]["wip_entry_type"]
          id?: string
          metadata?: Json
          notes?: string
          related_batch_id?: string | null
          related_product_id?: string | null
          roast_group?: string
          target_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "wip_ledger_related_batch_id_fkey"
            columns: ["related_batch_id"]
            isOneToOne: false
            referencedRelation: "roasted_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wip_ledger_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_client: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      get_user_client_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "ADMIN" | "OPS" | "CLIENT"
      board_source: "MATCHSTICK" | "FUNK" | "NOSMOKE"
      default_roaster: "SAMIAC" | "LORING" | "EITHER"
      delivery_method: "PICKUP" | "DELIVERY" | "COURIER"
      exception_event_type:
        | "DESTONER_SPILL"
        | "BIN_MIX_SAME"
        | "BIN_MIX_DIFFERENT"
        | "WIP_ADJUSTMENT"
        | "DECONSTRUCT"
        | "OTHER"
      grind_option: "WHOLE_BEAN" | "ESPRESSO" | "FILTER"
      order_status:
        | "DRAFT"
        | "SUBMITTED"
        | "CONFIRMED"
        | "IN_PRODUCTION"
        | "READY"
        | "SHIPPED"
        | "CANCELLED"
      packaging_variant:
        | "RETAIL_250G"
        | "RETAIL_300G"
        | "RETAIL_340G"
        | "RETAIL_454G"
        | "CROWLER_200G"
        | "CROWLER_250G"
        | "CAN_125G"
        | "BULK_2LB"
        | "BULK_1KG"
        | "BULK_5LB"
        | "BULK_2KG"
      product_format: "WHOLE_BEAN" | "ESPRESSO" | "FILTER" | "OTHER"
      production_status:
        | "PLANNED"
        | "ROASTED"
        | "PACKED"
        | "STAGED"
        | "COMPLETE"
      roasted_batch_status: "PLANNED" | "ROASTED"
      roaster_machine: "SAMIAC" | "LORING"
      ship_priority: "NORMAL" | "TIME_SENSITIVE"
      wip_adjustment_reason:
        | "LOSS"
        | "COUNT_ADJUSTMENT"
        | "CONTAMINATION"
        | "OTHER"
      wip_entry_type:
        | "ROAST_OUTPUT"
        | "PACK_CONSUME"
        | "LOSS"
        | "ADJUSTMENT"
        | "REALLOCATE_IN"
        | "REALLOCATE_OUT"
        | "DECONSTRUCT_IN"
        | "DECONSTRUCT_OUT"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["ADMIN", "OPS", "CLIENT"],
      board_source: ["MATCHSTICK", "FUNK", "NOSMOKE"],
      default_roaster: ["SAMIAC", "LORING", "EITHER"],
      delivery_method: ["PICKUP", "DELIVERY", "COURIER"],
      exception_event_type: [
        "DESTONER_SPILL",
        "BIN_MIX_SAME",
        "BIN_MIX_DIFFERENT",
        "WIP_ADJUSTMENT",
        "DECONSTRUCT",
        "OTHER",
      ],
      grind_option: ["WHOLE_BEAN", "ESPRESSO", "FILTER"],
      order_status: [
        "DRAFT",
        "SUBMITTED",
        "CONFIRMED",
        "IN_PRODUCTION",
        "READY",
        "SHIPPED",
        "CANCELLED",
      ],
      packaging_variant: [
        "RETAIL_250G",
        "RETAIL_300G",
        "RETAIL_340G",
        "RETAIL_454G",
        "CROWLER_200G",
        "CROWLER_250G",
        "CAN_125G",
        "BULK_2LB",
        "BULK_1KG",
        "BULK_5LB",
        "BULK_2KG",
      ],
      product_format: ["WHOLE_BEAN", "ESPRESSO", "FILTER", "OTHER"],
      production_status: ["PLANNED", "ROASTED", "PACKED", "STAGED", "COMPLETE"],
      roasted_batch_status: ["PLANNED", "ROASTED"],
      roaster_machine: ["SAMIAC", "LORING"],
      ship_priority: ["NORMAL", "TIME_SENSITIVE"],
      wip_adjustment_reason: [
        "LOSS",
        "COUNT_ADJUSTMENT",
        "CONTAMINATION",
        "OTHER",
      ],
      wip_entry_type: [
        "ROAST_OUTPUT",
        "PACK_CONSUME",
        "LOSS",
        "ADJUSTMENT",
        "REALLOCATE_IN",
        "REALLOCATE_OUT",
        "DECONSTRUCT_IN",
        "DECONSTRUCT_OUT",
      ],
    },
  },
} as const
