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
    PostgrestVersion: "14.17"
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
      account_deletions: {
        Row: {
          deleted_at: string
          roles: string[]
          summary: Json
          user_id: string
        }
        Insert: {
          deleted_at?: string
          roles?: string[]
          summary?: Json
          user_id: string
        }
        Update: {
          deleted_at?: string
          roles?: string[]
          summary?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_acks: {
        Row: {
          acked_at: string
          acked_by: string
          entity_id: string
          kind: string
          note: string | null
        }
        Insert: {
          acked_at?: string
          acked_by: string
          entity_id: string
          kind: string
          note?: string | null
        }
        Update: {
          acked_at?: string
          acked_by?: string
          entity_id?: string
          kind?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_acks_acked_by_fkey"
            columns: ["acked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
          booking_ref: string | null
          cancel_reason: string | null
          cancellation_policy: Json | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          currency: string
          id: string
          num_sessions: number
          order_id: string | null
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
          booking_ref?: string | null
          cancel_reason?: string | null
          cancellation_policy?: Json | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency: string
          id?: string
          num_sessions: number
          order_id?: string | null
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
          booking_ref?: string | null
          cancel_reason?: string | null
          cancellation_policy?: Json | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          num_sessions?: number
          order_id?: string | null
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
            foreignKeyName: "bookings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
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
      calendar_feed_tokens: {
        Row: {
          created_at: string
          last_seen_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_seen_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feed_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
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
          icon?: string | null
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
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivery: Database["public"]["Enums"]["contact_delivery_status"]
          delivery_error: string | null
          email: string
          handled_at: string | null
          id: string
          ip: unknown
          message: string
          name: string
          sender_id: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivery?: Database["public"]["Enums"]["contact_delivery_status"]
          delivery_error?: string | null
          email: string
          handled_at?: string | null
          id?: string
          ip?: unknown
          message: string
          name: string
          sender_id?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivery?: Database["public"]["Enums"]["contact_delivery_status"]
          delivery_error?: string | null
          email?: string
          handled_at?: string | null
          id?: string
          ip?: unknown
          message?: string
          name?: string
          sender_id?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reports: {
        Row: {
          conversation_id: string
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          reason: string
          reporter_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          reason: string
          reporter_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          reason?: string
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reports_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reports_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          blocked_at: string | null
          blocked_reason: string | null
          created_at: string
          id: string
          last_message_at: string | null
          student_id: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          student_id: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          student_id?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      late_payment_refunds: {
        Row: {
          amount: number
          booking_id: string | null
          booking_status: Database["public"]["Enums"]["booking_status"] | null
          created_at: string
          currency: string
          event_id: string | null
          id: string
          order_id: string | null
          order_status: Database["public"]["Enums"]["order_status"] | null
          provider: string
          provider_payment_id: string
          provider_refund_id: string | null
          reason: string
        }
        Insert: {
          amount: number
          booking_id?: string | null
          booking_status?: Database["public"]["Enums"]["booking_status"] | null
          created_at?: string
          currency: string
          event_id?: string | null
          id?: string
          order_id?: string | null
          order_status?: Database["public"]["Enums"]["order_status"] | null
          provider?: string
          provider_payment_id: string
          provider_refund_id?: string | null
          reason: string
        }
        Update: {
          amount?: number
          booking_id?: string | null
          booking_status?: Database["public"]["Enums"]["booking_status"] | null
          created_at?: string
          currency?: string
          event_id?: string | null
          id?: string
          order_id?: string | null
          order_status?: Database["public"]["Enums"]["order_status"] | null
          provider?: string
          provider_payment_id?: string
          provider_refund_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "late_payment_refunds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_payment_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          body: string
          booking_id: string | null
          conversation_id: string
          created_at: string
          expires_at: string | null
          id: string
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body: string
          booking_id?: string | null
          conversation_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body?: string
          booking_id?: string | null
          conversation_id?: string
          created_at?: string
          expires_at?: string | null
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
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
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
          read_at: string | null
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
          read_at?: string | null
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
          read_at?: string | null
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
      orders: {
        Row: {
          created_at: string
          currency: string
          id: string
          lines_fingerprint: string
          provider: string
          provider_payment_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency: string
          id?: string
          lines_fingerprint: string
          provider: string
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          lines_fingerprint?: string
          provider?: string
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_student_id_fkey"
            columns: ["student_id"]
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
          booking_id: string
          event_id: string
          processed_at: string
        }
        Insert: {
          booking_id: string
          event_id: string
          processed_at?: string
        }
        Update: {
          booking_id?: string
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
      product_availability_rules: {
        Row: {
          created_at: string
          product_id: string
          rule_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          rule_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_availability_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_availability_rules_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "availability_rules"
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
          auto_accept_bookings: boolean
          cancellation_policy: Json | null
          created_at: string
          currency: string
          description: string | null
          faqs: Json
          id: string
          image_path: string | null
          language: string | null
          level: Database["public"]["Enums"]["teaching_level"] | null
          outcome: string | null
          package_num_sessions: number | null
          price_amount: number
          pricing_model: Database["public"]["Enums"]["pricing_model"]
          search_text: string | null
          search_vector: unknown
          session_duration_min: number | null
          slug: string | null
          status: Database["public"]["Enums"]["product_status"]
          title: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          auto_accept_bookings?: boolean
          cancellation_policy?: Json | null
          created_at?: string
          currency: string
          description?: string | null
          faqs?: Json
          id?: string
          image_path?: string | null
          language?: string | null
          level?: Database["public"]["Enums"]["teaching_level"] | null
          outcome?: string | null
          package_num_sessions?: number | null
          price_amount: number
          pricing_model: Database["public"]["Enums"]["pricing_model"]
          search_text?: string | null
          search_vector?: unknown
          session_duration_min?: number | null
          slug?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          title: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          auto_accept_bookings?: boolean
          cancellation_policy?: Json | null
          created_at?: string
          currency?: string
          description?: string | null
          faqs?: Json
          id?: string
          image_path?: string | null
          language?: string | null
          level?: Database["public"]["Enums"]["teaching_level"] | null
          outcome?: string | null
          package_num_sessions?: number | null
          price_amount?: number
          pricing_model?: Database["public"]["Enums"]["pricing_model"]
          search_text?: string | null
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
          primary_goal: string | null
          referral_code: string | null
          stripe_customer_id: string | null
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
          primary_goal?: string | null
          referral_code?: string | null
          stripe_customer_id?: string | null
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
          primary_goal?: string | null
          referral_code?: string | null
          stripe_customer_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      refund_requests: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error: string | null
          payment_id: string
          processed_at: string | null
          provider: string
          provider_payment_id: string | null
          provider_refund_id: string | null
          reason: string
          status: Database["public"]["Enums"]["refund_request_status"]
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          currency: string
          id?: string
          idempotency_key: string
          last_attempt_at?: string | null
          last_error?: string | null
          payment_id: string
          processed_at?: string | null
          provider: string
          provider_payment_id?: string | null
          provider_refund_id?: string | null
          reason: string
          status?: Database["public"]["Enums"]["refund_request_status"]
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          last_attempt_at?: string | null
          last_error?: string | null
          payment_id?: string
          processed_at?: string | null
          provider?: string
          provider_payment_id?: string | null
          provider_refund_id?: string | null
          reason?: string
          status?: Database["public"]["Enums"]["refund_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          author_display: string | null
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
          author_display?: string | null
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
          author_display?: string | null
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
      session_recording_consents: {
        Row: {
          created_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_recording_consents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_recording_consents_user_id_fkey"
            columns: ["user_id"]
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
          recordings_purged_at: string | null
          sequence_no: number | null
          session_ref: string | null
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
          recordings_purged_at?: string | null
          sequence_no?: number | null
          session_ref?: string | null
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
          recordings_purged_at?: string | null
          sequence_no?: number | null
          session_ref?: string | null
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
      terms_acceptances: {
        Row: {
          accepted_at: string
          id: string
          locale: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          locale: string
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          id?: string
          locale?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "terms_acceptances_user_id_fkey"
            columns: ["user_id"]
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
          faqs: Json
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
          faqs?: Json
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
          faqs?: Json
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
      tutor_views: {
        Row: {
          class_views: number
          first_viewed_at: string
          last_viewed_at: string
          tutor_id: string
          user_id: string
          views: number
        }
        Insert: {
          class_views?: number
          first_viewed_at?: string
          last_viewed_at?: string
          tutor_id: string
          user_id: string
          views?: number
        }
        Update: {
          class_views?: number
          first_viewed_at?: string
          last_viewed_at?: string
          tutor_id?: string
          user_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "tutor_views_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "tutor_profiles"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "tutor_views_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "tutors_public"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "tutor_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      tutors_public: {
        Row: {
          approval_status:
            | Database["public"]["Enums"]["tutor_approval_status"]
            | null
          avatar_path: string | null
          bio: string | null
          display_name: string | null
          headline: string | null
          price_currency: string | null
          price_from: number | null
          profile_id: string | null
          rating_avg: number | null
          rating_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_deletion_blockers: { Args: { p_user_id: string }; Returns: Json }
      admin_bookings_by_category: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      admin_conversation_reports: {
        Args: { p_limit?: number; p_pendientes?: boolean }
        Returns: {
          blocked_at: string
          blocked_reason: string
          conversation_id: string
          created_at: string
          handled_at: string
          handled_by: string
          handled_by_name: string
          id: string
          last_message_at: string
          message_count: number
          pair_bought: boolean
          reason: string
          reported_id: string
          reported_name: string
          reporter_id: string
          reporter_is_tutor: boolean
          reporter_name: string
        }[]
      }
      admin_gmv_weekly: { Args: { p_weeks?: number }; Returns: Json }
      admin_report_thread: {
        Args: { p_limit?: number; p_report_id: string }
        Returns: {
          attachment_name: string
          body: string
          created_at: string
          from_reporter: boolean
          id: string
          sender_id: string
          sender_name: string
        }[]
      }
      admin_stats: { Args: { p_from?: string; p_to?: string }; Returns: Json }
      afinidad_peso_reciente: { Args: { p_cuando: string }; Returns: number }
      anonymize_account: { Args: { p_user_id: string }; Returns: Json }
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
      calendar_feed: { Args: { p_token: string }; Returns: Json }
      calendar_feed_token: { Args: never; Returns: string }
      cancel_booking: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      close_expired_sessions: { Args: never; Returns: Json }
      complete_session: { Args: { p_session_id: string }; Returns: string }
      confirm_order_payment: {
        Args: { p_event_id?: string; p_order_id: string; p_success?: boolean }
        Returns: Json
      }
      confirm_payment: {
        Args: { p_booking_id: string; p_event_id?: string; p_success?: boolean }
        Returns: string
      }
      confirm_simulated_order_payment: {
        Args: { p_order_id: string; p_success?: boolean }
        Returns: Json
      }
      confirm_simulated_payment: {
        Args: { p_booking_id: string; p_success?: boolean }
        Returns: string
      }
      conversation_of_booking: {
        Args: { p_booking_id: string }
        Returns: string
      }
      country_from_timezone: { Args: { p_tz: string }; Returns: string }
      create_booking: {
        Args: { p_product_id: string; p_slots: string[] }
        Returns: string
      }
      create_booking_line: {
        Args: { p_product_id: string; p_slots: string[]; p_student: string }
        Returns: string
      }
      create_order: { Args: { p_lines: Json }; Returns: string }
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
      enqueue_refund: {
        Args: {
          p_amount: number
          p_key: string
          p_payment_id: string
          p_reason: string
        }
        Returns: undefined
      }
      expire_stale_bookings: {
        Args: { p_acceptance_cutoff?: string; p_payment_cutoff?: string }
        Returns: Json
      }
      f_unaccent: { Args: { "": string }; Returns: string }
      find_open_order: { Args: { p_lines: Json }; Returns: string }
      gen_calendar_feed_token: { Args: never; Returns: string }
      generar_referencia_reserva: { Args: never; Returns: string }
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
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: string
      }
      mark_notification: {
        Args: { p_id: string; p_ok: boolean }
        Returns: undefined
      }
      mask_person_name: { Args: { p_name: string }; Returns: string }
      my_calendar_feed_token: { Args: never; Returns: string }
      my_conversations: {
        Args: never
        Returns: {
          blocked_at: string
          can_chat: boolean
          has_booking: boolean
          id: string
          last_booking_id: string
          last_message_at: string
          last_product_title: string
          other_avatar_path: string
          other_id: string
          other_is_tutor: boolean
          other_name: string
          product_count: number
          session_count: number
        }[]
      }
      open_conversation: { Args: { p_tutor_id: string }; Returns: string }
      order_lines_fingerprint: { Args: { p_lines: Json }; Returns: string }
      pair_booking_stats: {
        Args: { p_student_id: string; p_tutor_id: string }
        Returns: {
          has_booking: boolean
          product_count: number
          session_count: number
        }[]
      }
      pair_can_chat: {
        Args: { p_student_id: string; p_tutor_id: string }
        Returns: boolean
      }
      pair_has_booking: {
        Args: { p_student_id: string; p_tutor_id: string }
        Returns: boolean
      }
      pending_email_notifications: {
        Args: { p_limit?: number }
        Returns: {
          email: string
          id: string
          nombre: string
          payload: Json
          template: string
          type: string
        }[]
      }
      process_notifications: { Args: never; Returns: Json }
      process_scheduled_payouts: { Args: never; Returns: Json }
      purge_contact_messages: { Args: never; Returns: number }
      purge_expired_messages: { Args: never; Returns: Json }
      purge_tutor_views: { Args: never; Returns: Json }
      record_terms_acceptance: {
        Args: { p_locale?: string; p_version: string }
        Returns: undefined
      }
      record_tutor_view: {
        Args: { p_origen?: string; p_tutor_id: string }
        Returns: boolean
      }
      recording_allowed: { Args: { p_session_id: string }; Returns: boolean }
      refund_payment: {
        Args: { p_amount?: number; p_payment_id: string }
        Returns: Json
      }
      refunds_backlog: { Args: never; Returns: Json }
      report_conversation: {
        Args: { p_conversation_id: string; p_reason: string }
        Returns: string
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
      revoke_calendar_feed_token: { Args: never; Returns: boolean }
      run_payout_batch: { Args: { p_retention_days?: number }; Returns: Json }
      search_product_ids_fuzzy: {
        Args: { p_limit?: number; p_q: string }
        Returns: {
          id: string
        }[]
      }
      send_conversation_message: {
        Args: { p_body: string; p_conversation_id: string }
        Returns: string
      }
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
      session_live_window: {
        Args: { p_end: string; p_start: string }
        Returns: unknown
      }
      set_conversation_blocked: {
        Args: {
          p_blocked: boolean
          p_conversation_id: string
          p_reason?: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      student_tutor_affinity: {
        Args: { p_limit?: number }
        Returns: {
          avatar_path: string
          compras: number
          display_name: string
          headline: string
          mi_nota: number
          rating_avg: number
          rating_count: number
          score: number
          sesiones: number
          tutor_id: string
          ultima_vez: string
          vistas: number
          vistas_clase: number
        }[]
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
        Args: {
          p_booking_id: string
          p_comment?: string
          p_rating: number
          p_sign?: boolean
        }
        Returns: string
      }
      tutor_balance: { Args: { p_retention_days?: number }; Returns: Json }
      tutor_response_time: { Args: { p_tutor_id: string }; Returns: number }
      tutor_students: {
        Args: { p_student_id?: string }
        Returns: {
          avatar_path: string
          full_name: string
          student_id: string
          timezone: string
        }[]
      }
      tutor_teaching_record: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          alumnos_distintos: number
          aprobado: boolean
          impartidas: number
          no_shows: number
          primera_clase: string
          tutor_id: string
          tutor_nombre: string
          ultima_clase: string
        }[]
      }
      unread_conversation_counts: {
        Args: never
        Returns: {
          conversation_id: string
          last_message_at: string
          unread: number
        }[]
      }
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
      contact_delivery_status: "pending" | "sent" | "failed"
      document_status: "pending" | "approved" | "rejected" | "draft"
      identity_verification_status:
        | "not_submitted"
        | "pending"
        | "approved"
        | "rejected"
      notification_status: "pending" | "sent" | "failed"
      order_status: "pending_payment" | "paid" | "cancelled"
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
      refund_request_status: "pending" | "refunded" | "skipped" | "failed"
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
      contact_delivery_status: ["pending", "sent", "failed"],
      document_status: ["pending", "approved", "rejected", "draft"],
      identity_verification_status: [
        "not_submitted",
        "pending",
        "approved",
        "rejected",
      ],
      notification_status: ["pending", "sent", "failed"],
      order_status: ["pending_payment", "paid", "cancelled"],
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
      refund_request_status: ["pending", "refunded", "skipped", "failed"],
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
