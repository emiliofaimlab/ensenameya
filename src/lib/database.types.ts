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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      availability_exceptions: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          id: string
          reason: string | null
          start_time: string | null
          tutor_id: string
          type: Database["public"]["Enums"]["availability_exception_type"]
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          reason?: string | null
          start_time?: string | null
          tutor_id: string
          type: Database["public"]["Enums"]["availability_exception_type"]
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          reason?: string | null
          start_time?: string | null
          tutor_id?: string
          type?: Database["public"]["Enums"]["availability_exception_type"]
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          start_time: string
          tutor_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          is_active?: boolean
          start_time: string
          tutor_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          is_active?: boolean
          start_time?: string
          tutor_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancellation_policy: Json | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          currency: string
          id: string
          num_sessions: number
          payee_country: string | null
          payer_country: string | null
          pricing_model: Database["public"]["Enums"]["pricing_model"]
          product_id: string
          session_duration_min: number
          status: Database["public"]["Enums"]["booking_status"]
          student_id: string
          subtotal_amount: number
          tier_split_pct: number
          total_amount: number
          tutor_id: string
          updated_at: string
        }
        Insert: {
          cancellation_policy?: Json | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency: string
          id?: string
          num_sessions: number
          payee_country?: string | null
          payer_country?: string | null
          pricing_model: Database["public"]["Enums"]["pricing_model"]
          product_id: string
          session_duration_min: number
          status?: Database["public"]["Enums"]["booking_status"]
          student_id: string
          subtotal_amount: number
          tier_split_pct: number
          total_amount: number
          tutor_id: string
          updated_at?: string
        }
        Update: {
          cancellation_policy?: Json | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          num_sessions?: number
          payee_country?: string | null
          payer_country?: string | null
          pricing_model?: Database["public"]["Enums"]["pricing_model"]
          product_id?: string
          session_duration_min?: number
          status?: Database["public"]["Enums"]["booking_status"]
          student_id?: string
          subtotal_amount?: number
          tier_split_pct?: number
          total_amount?: number
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          body: string
          booking_id: string
          created_at: string
          expires_at: string
          id: string
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body: string
          booking_id: string
          created_at?: string
          expires_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body?: string
          booking_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: string
          created_at: string
          id: string
          idempotency_key: string
          payload: Json
          recipient_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          template: string
          type: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          idempotency_key: string
          payload?: Json
          recipient_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template: string
          type: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          payload?: Json
          recipient_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          brand: string | null
          created_at: string
          id: string
          last4: string | null
          profile_id: string
          provider: string
          provider_token: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          id?: string
          last4?: string | null
          profile_id: string
          provider: string
          provider_token: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          id?: string
          last4?: string | null
          profile_id?: string
          provider?: string
          provider_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_routing_rules: {
        Row: {
          charge_provider: string
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          payee_country: string
          payer_country: string | null
          payout_provider: string
          priority: number
          updated_at: string
        }
        Insert: {
          charge_provider: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          payee_country: string
          payer_country?: string | null
          payout_provider: string
          priority?: number
          updated_at?: string
        }
        Update: {
          charge_provider?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          payee_country?: string
          payer_country?: string | null
          payout_provider?: string
          priority?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_webhook_events: {
        Row: {
          booking_id: string | null
          event_id: string
          processed_at: string
        }
        Insert: {
          booking_id?: string | null
          event_id: string
          processed_at?: string
        }
        Update: {
          booking_id?: string | null
          event_id?: string
          processed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_webhook_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          booking_id: string
          created_at: string
          currency: string
          failed_at: string | null
          fx_rate: number | null
          gross_amount: number
          id: string
          paid_at: string | null
          payee_country: string | null
          payer_country: string | null
          platform_fee_amount: number
          provider: string | null
          provider_metadata: Json | null
          provider_payment_id: string | null
          refunded_amount: number
          settlement_currency: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tier_split_pct: number
          tutor_net_amount: number
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          currency: string
          failed_at?: string | null
          fx_rate?: number | null
          gross_amount: number
          id?: string
          paid_at?: string | null
          payee_country?: string | null
          payer_country?: string | null
          platform_fee_amount: number
          provider?: string | null
          provider_metadata?: Json | null
          provider_payment_id?: string | null
          refunded_amount?: number
          settlement_currency?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tier_split_pct: number
          tutor_net_amount: number
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          currency?: string
          failed_at?: string | null
          fx_rate?: number | null
          gross_amount?: number
          id?: string
          paid_at?: string | null
          payee_country?: string | null
          payer_country?: string | null
          platform_fee_amount?: number
          provider?: string | null
          provider_metadata?: Json | null
          provider_payment_id?: string | null
          refunded_amount?: number
          settlement_currency?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tier_split_pct?: number
          tutor_net_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_items: {
        Row: {
          amount: number
          created_at: string
          id: string
          payment_id: string
          payout_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          payment_id: string
          payout_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payment_id?: string
          payout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_items_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          created_at: string
          currency: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          paid_at: string | null
          provider: string | null
          provider_metadata: Json | null
          provider_payout_id: string | null
          retention_until: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["payout_status"]
          tutor_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          paid_at?: string | null
          provider?: string | null
          provider_metadata?: Json | null
          provider_payout_id?: string | null
          retention_until?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          tutor_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          paid_at?: string | null
          provider?: string | null
          provider_metadata?: Json | null
          provider_payout_id?: string | null
          retention_until?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          product_id: string
        }
        Insert: {
          category_id: string
          product_id: string
        }
        Update: {
          category_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          cancellation_policy: Json | null
          created_at: string
          currency: string
          description: string | null
          id: string
          image_path: string | null
          outcome: string | null
          package_num_sessions: number | null
          price_amount: number
          pricing_model: Database["public"]["Enums"]["pricing_model"]
          search_vector: unknown
          session_duration_min: number | null
          slug: string | null
          status: Database["public"]["Enums"]["product_status"]
          title: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          cancellation_policy?: Json | null
          created_at?: string
          currency: string
          description?: string | null
          id?: string
          image_path?: string | null
          outcome?: string | null
          package_num_sessions?: number | null
          price_amount: number
          pricing_model: Database["public"]["Enums"]["pricing_model"]
          search_vector?: unknown
          session_duration_min?: number | null
          slug?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          title: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          cancellation_policy?: Json | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_path?: string | null
          outcome?: string | null
          package_num_sessions?: number | null
          price_amount?: number
          pricing_model?: Database["public"]["Enums"]["pricing_model"]
          search_vector?: unknown
          session_duration_min?: number | null
          slug?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          title?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          full_name: string | null
          id: string
          onboarding_complete: boolean
          phone: string | null
          referral_code: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          onboarding_complete?: boolean
          phone?: string | null
          referral_code?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          onboarding_complete?: boolean
          phone?: string | null
          referral_code?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          booking_id: string
          comment: string | null
          created_at: string
          id: string
          product_id: string
          rating: number
          student_id: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          comment?: string | null
          created_at?: string
          id?: string
          product_id: string
          rating: number
          student_id: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          product_id?: string
          rating?: number
          student_id?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          access_closes_at: string | null
          access_opens_at: string | null
          booking_id: string
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          daily_room_name: string | null
          daily_room_url: string | null
          end_at: string
          id: string
          sequence_no: number | null
          start_at: string
          status: Database["public"]["Enums"]["session_status"]
          student_id: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          access_closes_at?: string | null
          access_opens_at?: string | null
          booking_id: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          daily_room_name?: string | null
          daily_room_url?: string | null
          end_at: string
          id?: string
          sequence_no?: number | null
          start_at: string
          status?: Database["public"]["Enums"]["session_status"]
          student_id: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          access_closes_at?: string | null
          access_opens_at?: string | null
          booking_id?: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          daily_room_name?: string | null
          daily_room_url?: string | null
          end_at?: string
          id?: string
          sequence_no?: number | null
          start_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          student_id?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_interests: {
        Row: {
          category_id: string
          student_id: string
        }
        Insert: {
          category_id: string
          student_id: string
        }
        Update: {
          category_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_interests_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_interests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_categories: {
        Row: {
          category_id: string
          tutor_id: string
        }
        Insert: {
          category_id: string
          tutor_id: string
        }
        Update: {
          category_id?: string
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_categories_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_materials: {
        Row: {
          created_at: string
          file_name: string
          id: string
          product_id: string | null
          size_bytes: number
          storage_path: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          product_id?: string | null
          size_bytes: number
          storage_path: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          product_id?: string | null
          size_bytes?: number
          storage_path?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_materials_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_profiles: {
        Row: {
          approval_notes: string | null
          approval_status: Database["public"]["Enums"]["tutor_approval_status"]
          approved_at: string | null
          auto_accept_bookings: boolean
          avatar_path: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          headline: string | null
          identity_verification_status: Database["public"]["Enums"]["identity_verification_status"]
          profile_id: string
          rating_avg: number | null
          rating_count: number
          search_text: string | null
          socials: Json
          teaching_level: Database["public"]["Enums"]["teaching_level"] | null
          tier_id: string | null
          updated_at: string
        }
        Insert: {
          approval_notes?: string | null
          approval_status?: Database["public"]["Enums"]["tutor_approval_status"]
          approved_at?: string | null
          auto_accept_bookings?: boolean
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          headline?: string | null
          identity_verification_status?: Database["public"]["Enums"]["identity_verification_status"]
          profile_id: string
          rating_avg?: number | null
          rating_count?: number
          search_text?: string | null
          socials?: Json
          teaching_level?: Database["public"]["Enums"]["teaching_level"] | null
          tier_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_notes?: string | null
          approval_status?: Database["public"]["Enums"]["tutor_approval_status"]
          approved_at?: string | null
          auto_accept_bookings?: boolean
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          headline?: string | null
          identity_verification_status?: Database["public"]["Enums"]["identity_verification_status"]
          profile_id?: string
          rating_avg?: number | null
          rating_count?: number
          search_text?: string | null
          socials?: Json
          teaching_level?: Database["public"]["Enums"]["teaching_level"] | null
          tier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_profiles_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tutor_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_tiers: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          split_pct: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          split_pct: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          split_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_documents: {
        Row: {
          created_at: string
          doc_type: string
          id: string
          link_url: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string | null
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          id?: string
          link_url?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          id?: string
          link_url?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_documents_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_bookings_by_category: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      admin_gmv_weekly: { Args: { p_weeks?: number }; Returns: Json }
      admin_stats: { Args: { p_from?: string; p_to?: string }; Returns: Json }
      assign_tutor_tier: {
        Args: { p_tier_id: string; p_tutor_id: string }
        Returns: string
      }
      build_payout_for_tutor: {
        Args: {
          p_retention_days: number
          p_status?: Database["public"]["Enums"]["payout_status"]
          p_tutor_id: string
        }
        Returns: string
      }
      cancel_booking: { Args: { p_booking_id: string }; Returns: Json }
      close_expired_sessions: { Args: never; Returns: Json }
      complete_session: { Args: { p_session_id: string }; Returns: string }
      confirm_payment: {
        Args: { p_booking_id: string; p_event_id?: string; p_success?: boolean }
        Returns: string
      }
      country_from_timezone: { Args: { p_tz: string }; Returns: string }
      create_booking: {
        Args: { p_product_id: string; p_slots: string[] }
        Returns: string
      }
      enqueue_notification: {
        Args: {
          p_channel: string
          p_key: string
          p_payload: Json
          p_recipient: string
          p_template: string
          p_type: string
        }
        Returns: undefined
      }
      expire_stale_bookings: {
        Args: { p_acceptance_cutoff?: string; p_payment_cutoff?: string }
        Returns: Json
      }
      f_unaccent: { Args: { "": string }; Returns: string }
      get_available_slots: {
        Args: { p_from?: string; p_product_id: string; p_to?: string }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      home_stats: { Args: never; Returns: Json }
      home_testimonials: {
        Args: { p_limit?: number }
        Returns: {
          author: string
          comment: string
          context: string
          id: string
          rating: number
        }[]
      }
      join_session: { Args: { p_session_id: string }; Returns: Json }
      manage_payout: {
        Args: { p_action: string; p_payout_id: string }
        Returns: string
      }
      process_notifications: { Args: never; Returns: Json }
      process_scheduled_payouts: { Args: never; Returns: Json }
      purge_expired_messages: { Args: never; Returns: Json }
      refund_payment: {
        Args: { p_amount?: number; p_payment_id: string }
        Returns: Json
      }
      request_withdrawal: {
        Args: { p_retention_days?: number }
        Returns: string
      }
      respond_booking: {
        Args: { p_accept: boolean; p_booking_id: string }
        Returns: string
      }
      review_document: {
        Args: { p_approve: boolean; p_doc_id: string; p_notes?: string }
        Returns: string
      }
      review_tutor: {
        Args: { p_approve: boolean; p_reason?: string; p_tutor_id: string }
        Returns: string
      }
      run_payout_batch: { Args: { p_retention_days?: number }; Returns: Json }
      send_message: {
        Args: {
          p_attachment_name?: string
          p_attachment_path?: string
          p_attachment_size?: number
          p_body: string
          p_booking_id: string
        }
        Returns: string
      }
      session_access_window: {
        Args: { p_end: string; p_start: string }
        Returns: unknown
      }
      submit_document: {
        Args: {
          p_doc_type: string
          p_draft?: boolean
          p_link_url?: string
          p_storage_path?: string
        }
        Returns: string
      }
      submit_documents_for_review: { Args: never; Returns: string }
      submit_review: {
        Args: { p_booking_id: string; p_comment?: string; p_rating: number }
        Returns: string
      }
      tutor_balance: { Args: { p_retention_days?: number }; Returns: Json }
    }
    Enums: {
      app_role: "alumno" | "tutor" | "admin"
      availability_exception_type: "block" | "open"
      booking_status:
        | "pending_payment"
        | "pending_acceptance"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "refunded"
      document_status: "pending" | "approved" | "rejected" | "draft"
      identity_verification_status:
        | "not_submitted"
        | "pending"
        | "approved"
        | "rejected"
      notification_status: "pending" | "sent" | "failed"
      payment_status:
        | "pending"
        | "authorized"
        | "paid"
        | "failed"
        | "partially_refunded"
        | "refunded"
      payout_status:
        | "pending"
        | "scheduled"
        | "processing"
        | "paid"
        | "failed"
        | "on_hold"
      pricing_model: "per_session" | "per_hour" | "per_package"
      product_status: "draft" | "active" | "paused" | "archived"
      session_status:
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
      teaching_level: "basico" | "intermedio" | "avanzado"
      tutor_approval_status: "pending" | "approved" | "rejected" | "suspended"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["alumno", "tutor", "admin"],
      availability_exception_type: ["block", "open"],
      booking_status: [
        "pending_payment",
        "pending_acceptance",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "refunded",
      ],
      document_status: ["pending", "approved", "rejected", "draft"],
      identity_verification_status: [
        "not_submitted",
        "pending",
        "approved",
        "rejected",
      ],
      notification_status: ["pending", "sent", "failed"],
      payment_status: [
        "pending",
        "authorized",
        "paid",
        "failed",
        "partially_refunded",
        "refunded",
      ],
      payout_status: [
        "pending",
        "scheduled",
        "processing",
        "paid",
        "failed",
        "on_hold",
      ],
      pricing_model: ["per_session", "per_hour", "per_package"],
      product_status: ["draft", "active", "paused", "archived"],
      session_status: [
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      teaching_level: ["basico", "intermedio", "avanzado"],
      tutor_approval_status: ["pending", "approved", "rejected", "suspended"],
    },
  },
} as const
