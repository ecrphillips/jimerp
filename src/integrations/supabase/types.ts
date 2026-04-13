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
      account_locations: {
        Row: {
          account_id: string
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          location_code: string
          location_name: string
          qbo_billing_entity: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location_code: string
          location_name: string
          qbo_billing_entity?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location_code?: string
          location_name?: string
          qbo_billing_entity?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_locations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_user_locations: {
        Row: {
          account_user_id: string
          created_at: string
          id: string
          location_id: string
        }
        Insert: {
          account_user_id: string
          created_at?: string
          id?: string
          location_id: string
        }
        Update: {
          account_user_id?: string
          created_at?: string
          id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_user_locations_account_user_id_fkey"
            columns: ["account_user_id"]
            isOneToOne: false
            referencedRelation: "account_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_user_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "account_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      account_users: {
        Row: {
          account_id: string
          can_book_roaster: boolean
          can_invite_users: boolean
          can_manage_locations: boolean
          can_place_orders: boolean
          created_at: string
          id: string
          is_active: boolean
          is_owner: boolean
          location_access: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          can_book_roaster?: boolean
          can_invite_users?: boolean
          can_manage_locations?: boolean
          can_place_orders?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          is_owner?: boolean
          location_access?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          can_book_roaster?: boolean
          can_invite_users?: boolean
          can_manage_locations?: boolean
          can_place_orders?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          is_owner?: boolean
          location_access?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_users_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_code: string | null
          account_name: string
          billing_address: string | null
          billing_contact_name: string | null
          billing_email: string | null
          billing_phone: string | null
          coroast_certified: boolean
          coroast_certified_by: string | null
          coroast_certified_date: string | null
          coroast_joined_date: string | null
          coroast_tier: string | null
          created_at: string
          id: string
          is_active: boolean
          notes_internal: string | null
          programs: string[]
          relationship_id: string | null
          updated_at: string
        }
        Insert: {
          account_code?: string | null
          account_name: string
          billing_address?: string | null
          billing_contact_name?: string | null
          billing_email?: string | null
          billing_phone?: string | null
          coroast_certified?: boolean
          coroast_certified_by?: string | null
          coroast_certified_date?: string | null
          coroast_joined_date?: string | null
          coroast_tier?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes_internal?: string | null
          programs?: string[]
          relationship_id?: string | null
          updated_at?: string
        }
        Update: {
          account_code?: string | null
          account_name?: string
          billing_address?: string | null
          billing_contact_name?: string | null
          billing_email?: string | null
          billing_phone?: string | null
          coroast_certified?: boolean
          coroast_certified_by?: string | null
          coroast_certified_date?: string | null
          coroast_joined_date?: string | null
          coroast_tier?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes_internal?: string | null
          programs?: string[]
          relationship_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value_json: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value_json?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value_json?: Json
        }
        Relationships: []
      }
      client_allowed_products: {
        Row: {
          client_id: string
          created_at: string
          id: string
          product_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          product_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_allowed_products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_allowed_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      client_locations: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_active: boolean
          location_code: string
          name: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          location_code: string
          name: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          location_code?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_locations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          follow_up_by: string | null
          id: string
          note_text: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by: string
          follow_up_by?: string | null
          id?: string
          note_text: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          follow_up_by?: string | null
          id?: string
          note_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          billing_contact_name: string | null
          billing_email: string | null
          case_only: boolean
          case_size: number | null
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
          case_only?: boolean
          case_size?: number | null
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
          case_only?: boolean
          case_size?: number | null
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
      coroast_billing_periods: {
        Row: {
          account_id: string | null
          base_fee: number
          created_at: string
          exceeded_6hrs: boolean
          id: string
          included_hours: number
          is_closed: boolean
          member_id: string
          overage_rate_per_hr: number
          period_end: string
          period_start: string
          prorated_base_fee: number | null
          proration_note: string | null
          tier_snapshot: Database["public"]["Enums"]["coroast_tier"]
          upgrade_nudge_sent: boolean
        }
        Insert: {
          account_id?: string | null
          base_fee: number
          created_at?: string
          exceeded_6hrs?: boolean
          id?: string
          included_hours: number
          is_closed?: boolean
          member_id: string
          overage_rate_per_hr: number
          period_end: string
          period_start: string
          prorated_base_fee?: number | null
          proration_note?: string | null
          tier_snapshot: Database["public"]["Enums"]["coroast_tier"]
          upgrade_nudge_sent?: boolean
        }
        Update: {
          account_id?: string | null
          base_fee?: number
          created_at?: string
          exceeded_6hrs?: boolean
          id?: string
          included_hours?: number
          is_closed?: boolean
          member_id?: string
          overage_rate_per_hr?: number
          period_end?: string
          period_start?: string
          prorated_base_fee?: number | null
          proration_note?: string | null
          tier_snapshot?: Database["public"]["Enums"]["coroast_tier"]
          upgrade_nudge_sent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "coroast_billing_periods_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_billing_periods_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_bookings: {
        Row: {
          account_id: string | null
          billing_period_id: string
          booking_date: string
          cancellation_fee_amt: number | null
          cancellation_waived: boolean
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          duration_hours: number | null
          end_time: string
          id: string
          is_prime_time: boolean
          member_id: string
          notes_internal: string | null
          notes_member: string | null
          recurring_block_id: string | null
          reminder_sent_at: string | null
          start_time: string
          status: Database["public"]["Enums"]["coroast_booking_status"]
          updated_at: string
          waive_reason: string | null
        }
        Insert: {
          account_id?: string | null
          billing_period_id: string
          booking_date: string
          cancellation_fee_amt?: number | null
          cancellation_waived?: boolean
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          duration_hours?: number | null
          end_time: string
          id?: string
          is_prime_time?: boolean
          member_id: string
          notes_internal?: string | null
          notes_member?: string | null
          recurring_block_id?: string | null
          reminder_sent_at?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["coroast_booking_status"]
          updated_at?: string
          waive_reason?: string | null
        }
        Update: {
          account_id?: string | null
          billing_period_id?: string
          booking_date?: string
          cancellation_fee_amt?: number | null
          cancellation_waived?: boolean
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          duration_hours?: number | null
          end_time?: string
          id?: string
          is_prime_time?: boolean
          member_id?: string
          notes_internal?: string | null
          notes_member?: string | null
          recurring_block_id?: string | null
          reminder_sent_at?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["coroast_booking_status"]
          updated_at?: string
          waive_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coroast_bookings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_bookings_billing_period_id_fkey"
            columns: ["billing_period_id"]
            isOneToOne: false
            referencedRelation: "coroast_billing_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_bookings_recurring_block_fkey"
            columns: ["recurring_block_id"]
            isOneToOne: false
            referencedRelation: "coroast_recurring_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_hour_ledger: {
        Row: {
          account_id: string | null
          billing_period_id: string
          booking_id: string | null
          created_at: string
          created_by: string | null
          entry_type: Database["public"]["Enums"]["coroast_ledger_entry_type"]
          hours_delta: number
          id: string
          member_id: string
          notes: string
        }
        Insert: {
          account_id?: string | null
          billing_period_id: string
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          entry_type: Database["public"]["Enums"]["coroast_ledger_entry_type"]
          hours_delta: number
          id?: string
          member_id: string
          notes?: string
        }
        Update: {
          account_id?: string | null
          billing_period_id?: string
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          entry_type?: Database["public"]["Enums"]["coroast_ledger_entry_type"]
          hours_delta?: number
          id?: string
          member_id?: string
          notes?: string
        }
        Relationships: [
          {
            foreignKeyName: "coroast_hour_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_hour_ledger_billing_period_id_fkey"
            columns: ["billing_period_id"]
            isOneToOne: false
            referencedRelation: "coroast_billing_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_hour_ledger_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "coroast_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_hour_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_invoices: {
        Row: {
          account_id: string | null
          base_fee: number
          billing_period_id: string
          created_at: string
          created_by: string | null
          id: string
          included_hours: number
          included_pallets: number
          member_id: string
          notes: string | null
          overage_charge: number
          overage_hours: number
          overage_rate: number
          paid_pallets: number
          pallet_rate: number
          period_end: string
          period_start: string
          storage_charge: number
          tier_snapshot: string
          total_amount: number
          used_hours: number
        }
        Insert: {
          account_id?: string | null
          base_fee: number
          billing_period_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          included_hours: number
          included_pallets?: number
          member_id: string
          notes?: string | null
          overage_charge?: number
          overage_hours?: number
          overage_rate: number
          paid_pallets?: number
          pallet_rate?: number
          period_end: string
          period_start: string
          storage_charge?: number
          tier_snapshot: string
          total_amount: number
          used_hours: number
        }
        Update: {
          account_id?: string | null
          base_fee?: number
          billing_period_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          included_hours?: number
          included_pallets?: number
          member_id?: string
          notes?: string | null
          overage_charge?: number
          overage_hours?: number
          overage_rate?: number
          paid_pallets?: number
          pallet_rate?: number
          period_end?: string
          period_start?: string
          storage_charge?: number
          tier_snapshot?: string
          total_amount?: number
          used_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "coroast_invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_invoices_billing_period_id_fkey"
            columns: ["billing_period_id"]
            isOneToOne: false
            referencedRelation: "coroast_billing_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_invoices_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_loring_blocks: {
        Row: {
          block_date: string
          block_type: Database["public"]["Enums"]["coroast_loring_block_type"]
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          notes: string | null
          recurring_series_id: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          block_date: string
          block_type?: Database["public"]["Enums"]["coroast_loring_block_type"]
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          notes?: string | null
          recurring_series_id?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          block_date?: string
          block_type?: Database["public"]["Enums"]["coroast_loring_block_type"]
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          notes?: string | null
          recurring_series_id?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      coroast_member_checklist: {
        Row: {
          account_id: string | null
          completed: boolean
          completed_by: string | null
          completed_date: string | null
          created_at: string
          id: string
          item_number: number
          member_id: string | null
          qbo_billing_address: boolean
          qbo_billing_contact: boolean
          qbo_company_name: boolean
          qbo_credit_card: boolean
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          completed?: boolean
          completed_by?: string | null
          completed_date?: string | null
          created_at?: string
          id?: string
          item_number: number
          member_id?: string | null
          qbo_billing_address?: boolean
          qbo_billing_contact?: boolean
          qbo_company_name?: boolean
          qbo_credit_card?: boolean
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          completed?: boolean
          completed_by?: string | null
          completed_date?: string | null
          created_at?: string
          id?: string
          item_number?: number
          member_id?: string | null
          qbo_billing_address?: boolean
          qbo_billing_contact?: boolean
          qbo_company_name?: boolean
          qbo_credit_card?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coroast_member_checklist_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_member_checklist_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_member_notes: {
        Row: {
          created_at: string
          created_by: string
          id: string
          member_id: string
          note_text: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          member_id: string
          note_text: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          member_id?: string
          note_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "coroast_member_notes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_members: {
        Row: {
          business_name: string
          certified: boolean
          certified_by: string | null
          certified_date: string | null
          client_id: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          joined_date: string
          notes_internal: string | null
          tier: Database["public"]["Enums"]["coroast_tier"]
          updated_at: string
        }
        Insert: {
          business_name: string
          certified?: boolean
          certified_by?: string | null
          certified_date?: string | null
          client_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          joined_date?: string
          notes_internal?: string | null
          tier?: Database["public"]["Enums"]["coroast_tier"]
          updated_at?: string
        }
        Update: {
          business_name?: string
          certified?: boolean
          certified_by?: string | null
          certified_date?: string | null
          client_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          joined_date?: string
          notes_internal?: string | null
          tier?: Database["public"]["Enums"]["coroast_tier"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coroast_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_recurring_blocks: {
        Row: {
          created_at: string
          created_by: string | null
          day_of_week: Database["public"]["Enums"]["coroast_recurring_day"]
          effective_from: string
          effective_until: string | null
          end_time: string
          id: string
          is_active: boolean
          member_id: string
          notes: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          day_of_week: Database["public"]["Enums"]["coroast_recurring_day"]
          effective_from: string
          effective_until?: string | null
          end_time: string
          id?: string
          is_active?: boolean
          member_id: string
          notes?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          day_of_week?: Database["public"]["Enums"]["coroast_recurring_day"]
          effective_from?: string
          effective_until?: string | null
          end_time?: string
          id?: string
          is_active?: boolean
          member_id?: string
          notes?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coroast_recurring_blocks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_storage_allocations: {
        Row: {
          account_id: string | null
          billing_period_id: string
          created_at: string
          id: string
          included_pallets: number
          member_id: string
          paid_pallets: number
          pallets_in_use: number
          rate_per_add_pallet: number
          release_notes: string | null
          release_requested: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          billing_period_id: string
          created_at?: string
          id?: string
          included_pallets?: number
          member_id: string
          paid_pallets?: number
          pallets_in_use?: number
          rate_per_add_pallet: number
          release_notes?: string | null
          release_requested?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          billing_period_id?: string
          created_at?: string
          id?: string
          included_pallets?: number
          member_id?: string
          paid_pallets?: number
          pallets_in_use?: number
          rate_per_add_pallet?: number
          release_notes?: string | null
          release_requested?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coroast_storage_allocations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_storage_allocations_billing_period_id_fkey"
            columns: ["billing_period_id"]
            isOneToOne: false
            referencedRelation: "coroast_billing_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_storage_allocations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
      }
      coroast_waiver_log: {
        Row: {
          account_id: string | null
          booking_id: string
          created_at: string
          fee_amount_waived: number
          id: string
          member_id: string
          waive_reason: string | null
          waived_by: string | null
        }
        Insert: {
          account_id?: string | null
          booking_id: string
          created_at?: string
          fee_amount_waived: number
          id?: string
          member_id: string
          waive_reason?: string | null
          waived_by?: string | null
        }
        Update: {
          account_id?: string | null
          booking_id?: string
          created_at?: string
          fee_amount_waived?: number
          id?: string
          member_id?: string
          waive_reason?: string | null
          waived_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coroast_waiver_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_waiver_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "coroast_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coroast_waiver_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
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
      feedback_submissions: {
        Row: {
          admin_note: string | null
          category: string
          created_at: string
          created_by: string
          id: string
          message: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_note?: string | null
          category: string
          created_at?: string
          created_by: string
          id?: string
          message: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_note?: string | null
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          message?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
      green_contract_notes: {
        Row: {
          contract_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "green_contract_notes_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "green_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      green_contracts: {
        Row: {
          bag_size_kg: number | null
          category: Database["public"]["Enums"]["green_coffee_category"]
          contracted_price_currency: string | null
          contracted_price_per_kg: number | null
          contracted_price_usd: number | null
          created_at: string
          created_by: string | null
          crop_year: string | null
          id: string
          internal_contract_number: string | null
          lot_identifier: string | null
          name: string
          notes: string | null
          num_bags: number | null
          origin: string | null
          origin_country: string | null
          producer: string | null
          region: string | null
          sample_id: string | null
          status: Database["public"]["Enums"]["contract_status"]
          total_kg: number | null
          updated_at: string
          variety: string | null
          vendor_contract_number: string | null
          vendor_id: string | null
          warehouse_location: string | null
        }
        Insert: {
          bag_size_kg?: number | null
          category: Database["public"]["Enums"]["green_coffee_category"]
          contracted_price_currency?: string | null
          contracted_price_per_kg?: number | null
          contracted_price_usd?: number | null
          created_at?: string
          created_by?: string | null
          crop_year?: string | null
          id?: string
          internal_contract_number?: string | null
          lot_identifier?: string | null
          name: string
          notes?: string | null
          num_bags?: number | null
          origin?: string | null
          origin_country?: string | null
          producer?: string | null
          region?: string | null
          sample_id?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          total_kg?: number | null
          updated_at?: string
          variety?: string | null
          vendor_contract_number?: string | null
          vendor_id?: string | null
          warehouse_location?: string | null
        }
        Update: {
          bag_size_kg?: number | null
          category?: Database["public"]["Enums"]["green_coffee_category"]
          contracted_price_currency?: string | null
          contracted_price_per_kg?: number | null
          contracted_price_usd?: number | null
          created_at?: string
          created_by?: string | null
          crop_year?: string | null
          id?: string
          internal_contract_number?: string | null
          lot_identifier?: string | null
          name?: string
          notes?: string | null
          num_bags?: number | null
          origin?: string | null
          origin_country?: string | null
          producer?: string | null
          region?: string | null
          sample_id?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          total_kg?: number | null
          updated_at?: string
          variety?: string | null
          vendor_contract_number?: string | null
          vendor_id?: string | null
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "green_contracts_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "green_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "green_contracts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "green_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      green_inventory_snapshots: {
        Row: {
          book_value_per_kg: number | null
          created_at: string
          created_by: string | null
          id: string
          kg_on_hand: number
          lot_id: string
          snapshot_date: string
          total_book_value: number | null
        }
        Insert: {
          book_value_per_kg?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          kg_on_hand: number
          lot_id: string
          snapshot_date: string
          total_book_value?: number | null
        }
        Update: {
          book_value_per_kg?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          kg_on_hand?: number
          lot_id?: string
          snapshot_date?: string
          total_book_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "green_inventory_snapshots_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "green_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      green_lot_consumption_log: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kg_consumed: number
          lot_id: string
          notes: string | null
          roasted_batch_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kg_consumed: number
          lot_id: string
          notes?: string | null
          roasted_batch_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kg_consumed?: number
          lot_id?: string
          notes?: string | null
          roasted_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "green_lot_consumption_log_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "green_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "green_lot_consumption_log_roasted_batch_id_fkey"
            columns: ["roasted_batch_id"]
            isOneToOne: false
            referencedRelation: "roasted_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      green_lot_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lot_id: string
          note: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lot_id: string
          note: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lot_id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "green_lot_notes_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "green_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      green_lot_roast_group_links: {
        Row: {
          created_at: string
          id: string
          lot_id: string
          pct_of_lot: number | null
          roast_group: string
        }
        Insert: {
          created_at?: string
          id?: string
          lot_id: string
          pct_of_lot?: number | null
          roast_group: string
        }
        Update: {
          created_at?: string
          id?: string
          lot_id?: string
          pct_of_lot?: number | null
          roast_group?: string
        }
        Relationships: [
          {
            foreignKeyName: "green_lot_roast_group_links_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "green_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "green_lot_roast_group_links_roast_group_fkey"
            columns: ["roast_group"]
            isOneToOne: false
            referencedRelation: "roast_groups"
            referencedColumns: ["roast_group"]
          },
        ]
      }
      green_lots: {
        Row: {
          arrival_snoozed_until: string | null
          available_to_members: boolean
          bag_size_kg: number
          bags_released: number
          book_value_per_kg: number | null
          carrier: string | null
          carry_fees_cad: number | null
          carry_fees_confirmed_at: string | null
          carry_fees_confirmed_by: string | null
          carry_fees_is_usd: boolean
          carry_fees_usd: number | null
          carry_fees_usd_confirmed_at: string | null
          carry_fees_usd_confirmed_by: string | null
          contract_id: string | null
          costing_complete: boolean
          costing_completed_at: string | null
          costing_status: string
          created_at: string
          created_by: string | null
          duties_cad: number | null
          duties_cad_confirmed_at: string | null
          duties_cad_confirmed_by: string | null
          duties_confirmed_at: string | null
          duties_confirmed_by: string | null
          estimated_days_to_consume: number | null
          exceptions_noted: boolean
          exceptions_notes: string | null
          expected_delivery_date: string | null
          financing_apr: number | null
          freight_cad: number | null
          freight_cad_confirmed_at: string | null
          freight_cad_confirmed_by: string | null
          freight_confirmed_at: string | null
          freight_confirmed_by: string | null
          freight_is_usd: boolean
          fx_rate: number | null
          fx_rate_confirmed_at: string | null
          fx_rate_confirmed_by: string | null
          handling_cad: number | null
          handling_cad_confirmed_at: string | null
          handling_cad_confirmed_by: string | null
          id: string
          importer_payment_terms_days: number | null
          invoice_amount_cad: number | null
          invoice_amount_usd: number | null
          invoice_amount_usd_confirmed_at: string | null
          invoice_amount_usd_confirmed_by: string | null
          invoice_confirmed_at: string | null
          invoice_confirmed_by: string | null
          invoice_is_usd: boolean
          kg_on_hand: number
          kg_received: number | null
          lot_fx_rate: number | null
          lot_fx_rate_confirmed_at: string | null
          lot_fx_rate_confirmed_by: string | null
          lot_identifier: string | null
          lot_number: string
          market_value_per_kg: number | null
          member_facing_notes: string | null
          member_markup_pct: number | null
          notes_internal: string | null
          other_costs_cad: number | null
          other_costs_confirmed_at: string | null
          other_costs_confirmed_by: string | null
          other_costs_description: string | null
          po_number: string | null
          received_date: string | null
          status: string
          transaction_fees_cad: number | null
          transaction_fees_cad_confirmed_at: string | null
          transaction_fees_cad_confirmed_by: string | null
          transaction_fees_confirmed_at: string | null
          transaction_fees_confirmed_by: string | null
          updated_at: string
          vendor_invoice_number: string | null
          vendor_release_communicated_at: string | null
          vendor_release_communicated_by: string | null
          warehouse_location: string | null
        }
        Insert: {
          arrival_snoozed_until?: string | null
          available_to_members?: boolean
          bag_size_kg: number
          bags_released: number
          book_value_per_kg?: number | null
          carrier?: string | null
          carry_fees_cad?: number | null
          carry_fees_confirmed_at?: string | null
          carry_fees_confirmed_by?: string | null
          carry_fees_is_usd?: boolean
          carry_fees_usd?: number | null
          carry_fees_usd_confirmed_at?: string | null
          carry_fees_usd_confirmed_by?: string | null
          contract_id?: string | null
          costing_complete?: boolean
          costing_completed_at?: string | null
          costing_status?: string
          created_at?: string
          created_by?: string | null
          duties_cad?: number | null
          duties_cad_confirmed_at?: string | null
          duties_cad_confirmed_by?: string | null
          duties_confirmed_at?: string | null
          duties_confirmed_by?: string | null
          estimated_days_to_consume?: number | null
          exceptions_noted?: boolean
          exceptions_notes?: string | null
          expected_delivery_date?: string | null
          financing_apr?: number | null
          freight_cad?: number | null
          freight_cad_confirmed_at?: string | null
          freight_cad_confirmed_by?: string | null
          freight_confirmed_at?: string | null
          freight_confirmed_by?: string | null
          freight_is_usd?: boolean
          fx_rate?: number | null
          fx_rate_confirmed_at?: string | null
          fx_rate_confirmed_by?: string | null
          handling_cad?: number | null
          handling_cad_confirmed_at?: string | null
          handling_cad_confirmed_by?: string | null
          id?: string
          importer_payment_terms_days?: number | null
          invoice_amount_cad?: number | null
          invoice_amount_usd?: number | null
          invoice_amount_usd_confirmed_at?: string | null
          invoice_amount_usd_confirmed_by?: string | null
          invoice_confirmed_at?: string | null
          invoice_confirmed_by?: string | null
          invoice_is_usd?: boolean
          kg_on_hand?: number
          kg_received?: number | null
          lot_fx_rate?: number | null
          lot_fx_rate_confirmed_at?: string | null
          lot_fx_rate_confirmed_by?: string | null
          lot_identifier?: string | null
          lot_number: string
          market_value_per_kg?: number | null
          member_facing_notes?: string | null
          member_markup_pct?: number | null
          notes_internal?: string | null
          other_costs_cad?: number | null
          other_costs_confirmed_at?: string | null
          other_costs_confirmed_by?: string | null
          other_costs_description?: string | null
          po_number?: string | null
          received_date?: string | null
          status?: string
          transaction_fees_cad?: number | null
          transaction_fees_cad_confirmed_at?: string | null
          transaction_fees_cad_confirmed_by?: string | null
          transaction_fees_confirmed_at?: string | null
          transaction_fees_confirmed_by?: string | null
          updated_at?: string
          vendor_invoice_number?: string | null
          vendor_release_communicated_at?: string | null
          vendor_release_communicated_by?: string | null
          warehouse_location?: string | null
        }
        Update: {
          arrival_snoozed_until?: string | null
          available_to_members?: boolean
          bag_size_kg?: number
          bags_released?: number
          book_value_per_kg?: number | null
          carrier?: string | null
          carry_fees_cad?: number | null
          carry_fees_confirmed_at?: string | null
          carry_fees_confirmed_by?: string | null
          carry_fees_is_usd?: boolean
          carry_fees_usd?: number | null
          carry_fees_usd_confirmed_at?: string | null
          carry_fees_usd_confirmed_by?: string | null
          contract_id?: string | null
          costing_complete?: boolean
          costing_completed_at?: string | null
          costing_status?: string
          created_at?: string
          created_by?: string | null
          duties_cad?: number | null
          duties_cad_confirmed_at?: string | null
          duties_cad_confirmed_by?: string | null
          duties_confirmed_at?: string | null
          duties_confirmed_by?: string | null
          estimated_days_to_consume?: number | null
          exceptions_noted?: boolean
          exceptions_notes?: string | null
          expected_delivery_date?: string | null
          financing_apr?: number | null
          freight_cad?: number | null
          freight_cad_confirmed_at?: string | null
          freight_cad_confirmed_by?: string | null
          freight_confirmed_at?: string | null
          freight_confirmed_by?: string | null
          freight_is_usd?: boolean
          fx_rate?: number | null
          fx_rate_confirmed_at?: string | null
          fx_rate_confirmed_by?: string | null
          handling_cad?: number | null
          handling_cad_confirmed_at?: string | null
          handling_cad_confirmed_by?: string | null
          id?: string
          importer_payment_terms_days?: number | null
          invoice_amount_cad?: number | null
          invoice_amount_usd?: number | null
          invoice_amount_usd_confirmed_at?: string | null
          invoice_amount_usd_confirmed_by?: string | null
          invoice_confirmed_at?: string | null
          invoice_confirmed_by?: string | null
          invoice_is_usd?: boolean
          kg_on_hand?: number
          kg_received?: number | null
          lot_fx_rate?: number | null
          lot_fx_rate_confirmed_at?: string | null
          lot_fx_rate_confirmed_by?: string | null
          lot_identifier?: string | null
          lot_number?: string
          market_value_per_kg?: number | null
          member_facing_notes?: string | null
          member_markup_pct?: number | null
          notes_internal?: string | null
          other_costs_cad?: number | null
          other_costs_confirmed_at?: string | null
          other_costs_confirmed_by?: string | null
          other_costs_description?: string | null
          po_number?: string | null
          received_date?: string | null
          status?: string
          transaction_fees_cad?: number | null
          transaction_fees_cad_confirmed_at?: string | null
          transaction_fees_cad_confirmed_by?: string | null
          transaction_fees_confirmed_at?: string | null
          transaction_fees_confirmed_by?: string | null
          updated_at?: string
          vendor_invoice_number?: string | null
          vendor_release_communicated_at?: string | null
          vendor_release_communicated_by?: string | null
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "green_lots_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "green_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      green_purchase_lines: {
        Row: {
          bag_size_kg: number
          bags: number
          category: string | null
          created_at: string
          crop_year: string | null
          display_order: number
          id: string
          lot_id: string | null
          lot_identifier: string | null
          notes: string | null
          origin_country: string | null
          price_per_lb_usd: number | null
          producer: string | null
          purchase_id: string
          region: string | null
          variety: string | null
          warehouse_location: string | null
        }
        Insert: {
          bag_size_kg?: number
          bags?: number
          category?: string | null
          created_at?: string
          crop_year?: string | null
          display_order?: number
          id?: string
          lot_id?: string | null
          lot_identifier?: string | null
          notes?: string | null
          origin_country?: string | null
          price_per_lb_usd?: number | null
          producer?: string | null
          purchase_id: string
          region?: string | null
          variety?: string | null
          warehouse_location?: string | null
        }
        Update: {
          bag_size_kg?: number
          bags?: number
          category?: string | null
          created_at?: string
          crop_year?: string | null
          display_order?: number
          id?: string
          lot_id?: string | null
          lot_identifier?: string | null
          notes?: string | null
          origin_country?: string | null
          price_per_lb_usd?: number | null
          producer?: string | null
          purchase_id?: string
          region?: string | null
          variety?: string | null
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "green_purchase_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "green_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "green_purchase_lines_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "green_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      green_purchases: {
        Row: {
          created_at: string
          created_by: string | null
          due_date: string | null
          fx_rate: number | null
          fx_rate_is_cad: boolean
          id: string
          invoice_date: string | null
          invoice_number: string | null
          notes: string | null
          paid_at: string | null
          shared_carry_usd: number
          shared_freight_usd: number
          shared_other_label: string | null
          shared_other_usd: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          fx_rate?: number | null
          fx_rate_is_cad?: boolean
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          paid_at?: string | null
          shared_carry_usd?: number
          shared_freight_usd?: number
          shared_other_label?: string | null
          shared_other_usd?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          fx_rate?: number | null
          fx_rate_is_cad?: boolean
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          paid_at?: string | null
          shared_carry_usd?: number
          shared_freight_usd?: number
          shared_other_label?: string | null
          shared_other_usd?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "green_purchases_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "green_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      green_sample_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string
          sample_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          sample_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          sample_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "green_sample_notes_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "green_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      green_sample_roast_profile_links: {
        Row: {
          created_at: string
          id: string
          roast_group: string
          sample_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          roast_group: string
          sample_id: string
        }
        Update: {
          created_at?: string
          id?: string
          roast_group?: string
          sample_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "green_sample_roast_profile_links_roast_group_fkey"
            columns: ["roast_group"]
            isOneToOne: false
            referencedRelation: "roast_groups"
            referencedColumns: ["roast_group"]
          },
          {
            foreignKeyName: "green_sample_roast_profile_links_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "green_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      green_samples: {
        Row: {
          bag_size_kg: number | null
          category: Database["public"]["Enums"]["green_coffee_category"]
          created_at: string
          created_by: string | null
          crop_year: string | null
          id: string
          indicative_price_currency: string | null
          indicative_price_usd: number | null
          name: string
          num_bags: number | null
          origin: string | null
          producer: string | null
          region: string | null
          rejected_reason: string | null
          related_lot_id: string | null
          same_coffee_as_previous: boolean | null
          sample_relationship: string | null
          score: number | null
          status: Database["public"]["Enums"]["sample_status"]
          tasting_notes: string | null
          updated_at: string
          variety: string | null
          vendor_id: string | null
          warehouse_location: string | null
        }
        Insert: {
          bag_size_kg?: number | null
          category: Database["public"]["Enums"]["green_coffee_category"]
          created_at?: string
          created_by?: string | null
          crop_year?: string | null
          id?: string
          indicative_price_currency?: string | null
          indicative_price_usd?: number | null
          name: string
          num_bags?: number | null
          origin?: string | null
          producer?: string | null
          region?: string | null
          rejected_reason?: string | null
          related_lot_id?: string | null
          same_coffee_as_previous?: boolean | null
          sample_relationship?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["sample_status"]
          tasting_notes?: string | null
          updated_at?: string
          variety?: string | null
          vendor_id?: string | null
          warehouse_location?: string | null
        }
        Update: {
          bag_size_kg?: number | null
          category?: Database["public"]["Enums"]["green_coffee_category"]
          created_at?: string
          created_by?: string | null
          crop_year?: string | null
          id?: string
          indicative_price_currency?: string | null
          indicative_price_usd?: number | null
          name?: string
          num_bags?: number | null
          origin?: string | null
          producer?: string | null
          region?: string | null
          rejected_reason?: string | null
          related_lot_id?: string | null
          same_coffee_as_previous?: boolean | null
          sample_relationship?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["sample_status"]
          tasting_notes?: string | null
          updated_at?: string
          variety?: string | null
          vendor_id?: string | null
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "green_samples_related_lot_id_fkey"
            columns: ["related_lot_id"]
            isOneToOne: false
            referencedRelation: "green_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "green_samples_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "green_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      green_vendor_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "green_vendor_notes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "green_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      green_vendors: {
        Row: {
          abbreviation: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payment_terms_days: number | null
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payment_terms_days?: number | null
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payment_terms_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_system_generated: boolean
          notes: string | null
          order_id: string | null
          product_id: string | null
          quantity_kg: number | null
          quantity_units: number | null
          roast_group: string | null
          transaction_type: Database["public"]["Enums"]["inventory_transaction_type"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_system_generated?: boolean
          notes?: string | null
          order_id?: string | null
          product_id?: string | null
          quantity_kg?: number | null
          quantity_units?: number | null
          roast_group?: string | null
          transaction_type: Database["public"]["Enums"]["inventory_transaction_type"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_system_generated?: boolean
          notes?: string | null
          order_id?: string | null
          product_id?: string | null
          quantity_kg?: number | null
          quantity_units?: number | null
          roast_group?: string | null
          transaction_type?: Database["public"]["Enums"]["inventory_transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_date_audit_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          field_name: string
          id: string
          new_value: string | null
          notes: string | null
          old_value: string | null
          order_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          notes?: string | null
          old_value?: string | null
          order_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          notes?: string | null
          old_value?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_date_audit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
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
      order_notifications: {
        Row: {
          client_name: string
          created_at: string
          id: string
          order_id: string
          order_number: string
          read_by: string[] | null
          work_deadline: string | null
        }
        Insert: {
          client_name: string
          created_at?: string
          id?: string
          order_id: string
          order_number: string
          read_by?: string[] | null
          work_deadline?: string | null
        }
        Update: {
          client_name?: string
          created_at?: string
          id?: string
          order_id?: string
          order_number?: string
          read_by?: string[] | null
          work_deadline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          account_id: string | null
          account_location_id: string | null
          client_id: string | null
          client_notes: string | null
          client_po: string | null
          created_at: string
          created_by_admin: boolean
          created_by_user_id: string | null
          delivery_method: Database["public"]["Enums"]["delivery_method"]
          id: string
          internal_ops_notes: string | null
          invoiced: boolean
          location_id: string | null
          manually_deprioritized: boolean
          notify_email_error: string | null
          notify_email_sent_at: string | null
          order_number: string
          packed: boolean
          requested_ship_date: string | null
          roasted: boolean
          ship_display_order: number | null
          shipped_or_ready: boolean
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          work_deadline: string | null
          work_deadline_at: string | null
        }
        Insert: {
          account_id?: string | null
          account_location_id?: string | null
          client_id?: string | null
          client_notes?: string | null
          client_po?: string | null
          created_at?: string
          created_by_admin?: boolean
          created_by_user_id?: string | null
          delivery_method?: Database["public"]["Enums"]["delivery_method"]
          id?: string
          internal_ops_notes?: string | null
          invoiced?: boolean
          location_id?: string | null
          manually_deprioritized?: boolean
          notify_email_error?: string | null
          notify_email_sent_at?: string | null
          order_number: string
          packed?: boolean
          requested_ship_date?: string | null
          roasted?: boolean
          ship_display_order?: number | null
          shipped_or_ready?: boolean
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          work_deadline?: string | null
          work_deadline_at?: string | null
        }
        Update: {
          account_id?: string | null
          account_location_id?: string | null
          client_id?: string | null
          client_notes?: string | null
          client_po?: string | null
          created_at?: string
          created_by_admin?: boolean
          created_by_user_id?: string | null
          delivery_method?: Database["public"]["Enums"]["delivery_method"]
          id?: string
          internal_ops_notes?: string | null
          invoiced?: boolean
          location_id?: string | null
          manually_deprioritized?: boolean
          notify_email_error?: string | null
          notify_email_sent_at?: string | null
          order_number?: string
          packed?: boolean
          requested_ship_date?: string | null
          roasted?: boolean
          ship_display_order?: number | null
          shipped_or_ready?: boolean
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          work_deadline?: string | null
          work_deadline_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_account_location_id_fkey"
            columns: ["account_location_id"]
            isOneToOne: false
            referencedRelation: "account_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "client_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_types: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
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
          account_id: string | null
          bag_size_g: number
          client_id: string | null
          created_at: string
          format: Database["public"]["Enums"]["product_format"]
          grams_per_unit: number | null
          grind_options: Database["public"]["Enums"]["grind_option"][] | null
          id: string
          internal_packaging_notes: string | null
          is_active: boolean
          is_perennial: boolean
          pack_display_order: number | null
          packaging_type_id: string | null
          packaging_variant:
            | Database["public"]["Enums"]["packaging_variant"]
            | null
          product_name: string
          roast_group: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          bag_size_g: number
          client_id?: string | null
          created_at?: string
          format?: Database["public"]["Enums"]["product_format"]
          grams_per_unit?: number | null
          grind_options?: Database["public"]["Enums"]["grind_option"][] | null
          id?: string
          internal_packaging_notes?: string | null
          is_active?: boolean
          is_perennial?: boolean
          pack_display_order?: number | null
          packaging_type_id?: string | null
          packaging_variant?:
            | Database["public"]["Enums"]["packaging_variant"]
            | null
          product_name: string
          roast_group?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          bag_size_g?: number
          client_id?: string | null
          created_at?: string
          format?: Database["public"]["Enums"]["product_format"]
          grams_per_unit?: number | null
          grind_options?: Database["public"]["Enums"]["grind_option"][] | null
          id?: string
          internal_packaging_notes?: string | null
          is_active?: boolean
          is_perennial?: boolean
          pack_display_order?: number | null
          packaging_type_id?: string | null
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
            foreignKeyName: "products_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_packaging_type_id_fkey"
            columns: ["packaging_type_id"]
            isOneToOne: false
            referencedRelation: "packaging_types"
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
      prospect_notes: {
        Row: {
          created_at: string
          created_by: string
          follow_up_by: string | null
          id: string
          note_text: string
          prospect_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          follow_up_by?: string | null
          id?: string
          note_text: string
          prospect_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          follow_up_by?: string | null
          id?: string
          note_text?: string
          prospect_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_notes_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          business_name: string
          contact_info: string | null
          contact_name: string | null
          converted: boolean
          converted_to_account_id: string | null
          converted_to_client_id: string | null
          converted_to_member_id: string | null
          created_at: string
          created_by: string
          id: string
          stage: Database["public"]["Enums"]["prospect_stage"]
          stream: Database["public"]["Enums"]["prospect_stream"]
          updated_at: string
        }
        Insert: {
          business_name: string
          contact_info?: string | null
          contact_name?: string | null
          converted?: boolean
          converted_to_account_id?: string | null
          converted_to_client_id?: string | null
          converted_to_member_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          stage?: Database["public"]["Enums"]["prospect_stage"]
          stream?: Database["public"]["Enums"]["prospect_stream"]
          updated_at?: string
        }
        Update: {
          business_name?: string
          contact_info?: string | null
          contact_name?: string | null
          converted?: boolean
          converted_to_account_id?: string | null
          converted_to_client_id?: string | null
          converted_to_member_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          stage?: Database["public"]["Enums"]["prospect_stage"]
          stream?: Database["public"]["Enums"]["prospect_stream"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_converted_to_account_id_fkey"
            columns: ["converted_to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_converted_to_client_id_fkey"
            columns: ["converted_to_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_converted_to_member_id_fkey"
            columns: ["converted_to_member_id"]
            isOneToOne: false
            referencedRelation: "coroast_members"
            referencedColumns: ["id"]
          },
        ]
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
      roast_group_components: {
        Row: {
          component_roast_group: string
          created_at: string
          default_lot_id: string | null
          display_order: number
          id: string
          parent_roast_group: string
          pct: number
        }
        Insert: {
          component_roast_group: string
          created_at?: string
          default_lot_id?: string | null
          display_order?: number
          id?: string
          parent_roast_group: string
          pct: number
        }
        Update: {
          component_roast_group?: string
          created_at?: string
          default_lot_id?: string | null
          display_order?: number
          id?: string
          parent_roast_group?: string
          pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "roast_group_components_component_roast_group_fkey"
            columns: ["component_roast_group"]
            isOneToOne: false
            referencedRelation: "roast_groups"
            referencedColumns: ["roast_group"]
          },
          {
            foreignKeyName: "roast_group_components_default_lot_id_fkey"
            columns: ["default_lot_id"]
            isOneToOne: false
            referencedRelation: "green_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_group_components_parent_roast_group_fkey"
            columns: ["parent_roast_group"]
            isOneToOne: false
            referencedRelation: "roast_groups"
            referencedColumns: ["roast_group"]
          },
        ]
      }
      roast_group_inventory_levels: {
        Row: {
          fg_kg: number
          roast_group: string
          updated_at: string
          updated_by: string | null
          wip_kg: number
        }
        Insert: {
          fg_kg?: number
          roast_group: string
          updated_at?: string
          updated_by?: string | null
          wip_kg?: number
        }
        Update: {
          fg_kg?: number
          roast_group?: string
          updated_at?: string
          updated_by?: string | null
          wip_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "roast_group_inventory_levels_roast_group_fkey"
            columns: ["roast_group"]
            isOneToOne: true
            referencedRelation: "roast_groups"
            referencedColumns: ["roast_group"]
          },
        ]
      }
      roast_group_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note_text: string
          roast_group: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note_text: string
          roast_group: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note_text?: string
          roast_group?: string
        }
        Relationships: [
          {
            foreignKeyName: "roast_group_notes_roast_group_fkey"
            columns: ["roast_group"]
            isOneToOne: false
            referencedRelation: "roast_groups"
            referencedColumns: ["roast_group"]
          },
        ]
      }
      roast_groups: {
        Row: {
          blend_name: string | null
          blend_type: string | null
          created_at: string
          cropster_profile_ref: string | null
          default_roaster: Database["public"]["Enums"]["default_roaster"]
          display_name: string
          display_order: number | null
          expected_yield_loss_pct: number
          is_active: boolean
          is_blend: boolean
          is_seasonal: boolean
          notes: string | null
          origin: string | null
          roast_group: string
          roast_group_code: string
          standard_batch_kg: number
          updated_at: string
        }
        Insert: {
          blend_name?: string | null
          blend_type?: string | null
          created_at?: string
          cropster_profile_ref?: string | null
          default_roaster?: Database["public"]["Enums"]["default_roaster"]
          display_name: string
          display_order?: number | null
          expected_yield_loss_pct?: number
          is_active?: boolean
          is_blend?: boolean
          is_seasonal?: boolean
          notes?: string | null
          origin?: string | null
          roast_group: string
          roast_group_code: string
          standard_batch_kg?: number
          updated_at?: string
        }
        Update: {
          blend_name?: string | null
          blend_type?: string | null
          created_at?: string
          cropster_profile_ref?: string | null
          default_roaster?: Database["public"]["Enums"]["default_roaster"]
          display_name?: string
          display_order?: number | null
          expected_yield_loss_pct?: number
          is_active?: boolean
          is_blend?: boolean
          is_seasonal?: boolean
          notes?: string | null
          origin?: string | null
          roast_group?: string
          roast_group_code?: string
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
          consumed_by_blend_at: string | null
          created_at: string
          created_by: string | null
          cropster_batch_id: string | null
          id: string
          notes: string | null
          planned_for_blend_roast_group: string | null
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
          consumed_by_blend_at?: string | null
          created_at?: string
          created_by?: string | null
          cropster_batch_id?: string | null
          id?: string
          notes?: string | null
          planned_for_blend_roast_group?: string | null
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
          consumed_by_blend_at?: string | null
          created_at?: string
          created_by?: string | null
          cropster_batch_id?: string | null
          id?: string
          notes?: string | null
          planned_for_blend_roast_group?: string | null
          planned_output_kg?: number | null
          roast_group?: string
          status?: Database["public"]["Enums"]["roasted_batch_status"]
          target_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roasted_batches_planned_for_blend_roast_group_fkey"
            columns: ["planned_for_blend_roast_group"]
            isOneToOne: false
            referencedRelation: "roast_groups"
            referencedColumns: ["roast_group"]
          },
        ]
      }
      ship_picks: {
        Row: {
          id: string
          order_id: string
          order_line_item_id: string
          units_picked: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          order_id: string
          order_line_item_id: string
          units_picked?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          order_line_item_id?: string
          units_picked?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ship_picks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_picks_order_line_item_id_fkey"
            columns: ["order_line_item_id"]
            isOneToOne: true
            referencedRelation: "order_line_items"
            referencedColumns: ["id"]
          },
        ]
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
      decrement_lot_kg: {
        Args: { p_kg: number; p_lot_id: string }
        Returns: undefined
      }
      delete_client_safe: {
        Args: { p_client_id: string; p_force?: boolean }
        Returns: Json
      }
      delete_order_safe: {
        Args: { p_force?: boolean; p_order_id: string }
        Returns: Json
      }
      delete_product_safe: {
        Args: { p_force?: boolean; p_product_id: string }
        Returns: Json
      }
      delete_roast_group_safe: {
        Args: { p_force?: boolean; p_roast_group: string }
        Returns: Json
      }
      dev_reset_master_data: { Args: never; Returns: Json }
      dev_reset_test_day: { Args: never; Returns: Json }
      dev_test_reset: { Args: never; Returns: undefined }
      dev_test_seed_minimal: { Args: never; Returns: undefined }
      get_client_delete_preflight: {
        Args: { p_client_id: string }
        Returns: Json
      }
      get_order_delete_preflight: {
        Args: { p_order_id: string }
        Returns: Json
      }
      get_product_delete_preflight: {
        Args: { p_product_id: string }
        Returns: Json
      }
      get_roast_group_delete_preflight: {
        Args: { p_roast_group: string }
        Returns: Json
      }
      get_user_client_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      nextval_text: { Args: { seq_name: string }; Returns: number }
    }
    Enums: {
      app_role: "ADMIN" | "OPS" | "CLIENT"
      board_source: "MATCHSTICK" | "FUNK" | "NOSMOKE"
      contract_status: "ACTIVE" | "DEPLETED" | "CANCELLED"
      coroast_booking_status:
        | "CONFIRMED"
        | "CANCELLED_CHARGED"
        | "CANCELLED_WAIVED"
        | "CANCELLED_FREE"
        | "COMPLETED"
        | "NO_SHOW"
      coroast_ledger_entry_type:
        | "BOOKING_CONFIRMED"
        | "BOOKING_RETURNED"
        | "MANUAL_CREDIT"
        | "MANUAL_DEBIT"
      coroast_loring_block_type:
        | "INTERNAL_PRODUCTION"
        | "MAINTENANCE"
        | "CLOSED"
        | "OTHER"
      coroast_recurring_day:
        | "MON"
        | "TUE"
        | "WED"
        | "THU"
        | "FRI"
        | "SAT"
        | "SUN"
      coroast_tier: "ACCESS" | "GROWTH" | "MEMBER" | "PRODUCTION"
      default_roaster: "SAMIAC" | "LORING" | "EITHER"
      delivery_method: "PICKUP" | "DELIVERY" | "COURIER"
      exception_event_type:
        | "DESTONER_SPILL"
        | "BIN_MIX_SAME"
        | "BIN_MIX_DIFFERENT"
        | "WIP_ADJUSTMENT"
        | "DECONSTRUCT"
        | "OTHER"
      green_coffee_category:
        | "BLENDER"
        | "SINGLE_ORIGIN"
        | "MICRO_LOT"
        | "HYPER_PREMIUM"
      grind_option: "WHOLE_BEAN" | "ESPRESSO" | "FILTER"
      inventory_transaction_type:
        | "ROAST_OUTPUT"
        | "PACK_CONSUME_WIP"
        | "PACK_PRODUCE_FG"
        | "SHIP_CONSUME_FG"
        | "ADJUSTMENT"
        | "LOSS"
      lot_status:
        | "EN_ROUTE"
        | "RECEIVED"
        | "COSTING_INCOMPLETE"
        | "COSTING_COMPLETE"
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
      prospect_stage:
        | "AWARE"
        | "CONTACTED"
        | "CONVERSATION"
        | "AGREEMENT_SENT"
        | "ONBOARDED"
      prospect_stream: "CO_ROAST" | "CONTRACT" | "BOTH" | "INDUSTRY_CONTACT"
      roasted_batch_status: "PLANNED" | "ROASTED"
      roaster_machine: "SAMIAC" | "LORING"
      sample_status: "PENDING" | "APPROVED" | "REJECTED"
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
      contract_status: ["ACTIVE", "DEPLETED", "CANCELLED"],
      coroast_booking_status: [
        "CONFIRMED",
        "CANCELLED_CHARGED",
        "CANCELLED_WAIVED",
        "CANCELLED_FREE",
        "COMPLETED",
        "NO_SHOW",
      ],
      coroast_ledger_entry_type: [
        "BOOKING_CONFIRMED",
        "BOOKING_RETURNED",
        "MANUAL_CREDIT",
        "MANUAL_DEBIT",
      ],
      coroast_loring_block_type: [
        "INTERNAL_PRODUCTION",
        "MAINTENANCE",
        "CLOSED",
        "OTHER",
      ],
      coroast_recurring_day: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      coroast_tier: ["ACCESS", "GROWTH", "MEMBER", "PRODUCTION"],
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
      green_coffee_category: [
        "BLENDER",
        "SINGLE_ORIGIN",
        "MICRO_LOT",
        "HYPER_PREMIUM",
      ],
      grind_option: ["WHOLE_BEAN", "ESPRESSO", "FILTER"],
      inventory_transaction_type: [
        "ROAST_OUTPUT",
        "PACK_CONSUME_WIP",
        "PACK_PRODUCE_FG",
        "SHIP_CONSUME_FG",
        "ADJUSTMENT",
        "LOSS",
      ],
      lot_status: [
        "EN_ROUTE",
        "RECEIVED",
        "COSTING_INCOMPLETE",
        "COSTING_COMPLETE",
      ],
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
      prospect_stage: [
        "AWARE",
        "CONTACTED",
        "CONVERSATION",
        "AGREEMENT_SENT",
        "ONBOARDED",
      ],
      prospect_stream: ["CO_ROAST", "CONTRACT", "BOTH", "INDUSTRY_CONTACT"],
      roasted_batch_status: ["PLANNED", "ROASTED"],
      roaster_machine: ["SAMIAC", "LORING"],
      sample_status: ["PENDING", "APPROVED", "REJECTED"],
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
