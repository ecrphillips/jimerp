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
      clients: {
        Row: {
          billing_contact_name: string | null
          billing_email: string | null
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
          created_by_user_id: string | null
          delivery_method: Database["public"]["Enums"]["delivery_method"]
          id: string
          internal_ops_notes: string | null
          order_number: string
          requested_ship_date: string | null
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          client_id: string
          client_notes?: string | null
          client_po?: string | null
          created_at?: string
          created_by_user_id?: string | null
          delivery_method?: Database["public"]["Enums"]["delivery_method"]
          id?: string
          internal_ops_notes?: string | null
          order_number: string
          requested_ship_date?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_notes?: string | null
          client_po?: string | null
          created_at?: string
          created_by_user_id?: string | null
          delivery_method?: Database["public"]["Enums"]["delivery_method"]
          id?: string
          internal_ops_notes?: string | null
          order_number?: string
          requested_ship_date?: string | null
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
          product_name: string
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
          product_name: string
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
          product_name?: string
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
      delivery_method: "PICKUP" | "DELIVERY" | "COURIER"
      grind_option: "WHOLE_BEAN" | "ESPRESSO" | "FILTER"
      order_status:
        | "DRAFT"
        | "SUBMITTED"
        | "CONFIRMED"
        | "IN_PRODUCTION"
        | "READY"
        | "SHIPPED"
        | "CANCELLED"
      product_format: "WHOLE_BEAN" | "ESPRESSO" | "FILTER" | "OTHER"
      production_status:
        | "PLANNED"
        | "ROASTED"
        | "PACKED"
        | "STAGED"
        | "COMPLETE"
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
      delivery_method: ["PICKUP", "DELIVERY", "COURIER"],
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
      product_format: ["WHOLE_BEAN", "ESPRESSO", "FILTER", "OTHER"],
      production_status: ["PLANNED", "ROASTED", "PACKED", "STAGED", "COMPLETE"],
    },
  },
} as const
