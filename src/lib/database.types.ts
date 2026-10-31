/**
 * Tipos do banco no formato gerado pelo Supabase CLI.
 * Escrito à mão na Fase 1 a partir das migrações; regenere com
 * `npm run db:types` depois de `supabase start` e substitua este arquivo.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type MemberRole = 'admin' | 'technician' | 'finance' | 'attendant'
export type MemberStatus = 'active' | 'suspended'
export type ClientKind = 'person' | 'company'
export type ContactChannel = 'whatsapp' | 'phone' | 'email'
export type ServiceMode = 'bench' | 'remote' | 'onsite'
export type OrderPriority = 'low' | 'normal' | 'high' | 'urgent'
export type OrderEventKind = 'created' | 'status' | 'assigned' | 'note' | 'updated'
export type OrderStage = 'open' | 'waiting' | 'working' | 'ready' | 'done' | 'stopped'
export type StockMovementKind =
  | 'purchase_in'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'supplier_return'
  | 'order_consume'
  | 'order_return'
export type PurchaseStatus = 'draft' | 'received' | 'canceled'
export type OrderItemKind = 'service' | 'part'
export type FinanceDirection = 'in' | 'out'
export type PaymentMethod = 'pix' | 'cash' | 'debit' | 'credit' | 'transfer' | 'boleto' | 'other'
export type FinanceAccountKind = 'cash' | 'bank' | 'digital'
export type FinanceStatus = 'open' | 'partial' | 'paid' | 'canceled'
export type WarrantyClaimStatus = 'open' | 'accepted' | 'denied' | 'resolved'
export type AppointmentKind = 'onsite' | 'remote' | 'dropoff' | 'pickup' | 'other'
export type DigitalKind = 'website' | 'ecommerce' | 'landing' | 'hosting' | 'domain' | 'email' | 'maintenance' | 'other'
export type DigitalStatus = 'planning' | 'development' | 'active' | 'paused' | 'canceled'
export type SignatureDocument = 'intake' | 'delivery'
export type SignatureRole = 'client' | 'company'
export type ContractStatus = 'active' | 'paused' | 'ended'
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'done' | 'no_show' | 'canceled'

type Timestamp = string

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string
          name: string
          legal_name: string | null
          tax_id: string | null
          email: string | null
          phone: string | null
          timezone: string
          currency: string
          intake_terms: string | null
          delivery_terms: string | null
          auto_billing_enabled: boolean
          auto_billing_days_ahead: number
          stalled_order_days: number
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: {
          auto_billing_enabled?: boolean
          auto_billing_days_ahead?: number
          stalled_order_days?: number
          intake_terms?: string | null
          delivery_terms?: string | null
          name?: string
          legal_name?: string | null
          tax_id?: string | null
          email?: string | null
          phone?: string | null
          timezone?: string
        }
        Relationships: []
      }
      profiles: {
        Row: { id: string; full_name: string | null; created_at: Timestamp; updated_at: Timestamp }
        Insert: never
        Update: { full_name?: string | null }
        Relationships: []
      }
      company_members: {
        Row: {
          id: string
          company_id: string
          user_id: string
          role: MemberRole
          status: MemberStatus
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'company_members_company_id_fkey'
            columns: ['company_id']
            isOneToOne: false
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
        ]
      }
      permissions: {
        Row: { key: string; module: string; description: string }
        Insert: never
        Update: never
        Relationships: []
      }
      role_permissions: {
        Row: { role: MemberRole; permission_key: string }
        Insert: never
        Update: never
        Relationships: []
      }
      member_permission_overrides: {
        Row: {
          member_id: string
          company_id: string
          permission_key: string
          granted: boolean
          created_by: string | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      audit_log: {
        Row: {
          id: number
          company_id: string
          actor_id: string | null
          action: string
          entity: string
          entity_id: string | null
          changes: Json
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      company_invitations: {
        Row: {
          id: string
          company_id: string
          email: string
          role: MemberRole
          invited_by: string | null
          expires_at: Timestamp
          accepted_at: Timestamp | null
          accepted_by: string | null
          revoked_at: Timestamp | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          company_id: string
          code: number
          kind: ClientKind
          name: string
          trade_name: string | null
          email: string | null
          phone: string | null
          whatsapp: string | null
          preferred_channel: ContactChannel | null
          zip_code: string | null
          street: string | null
          street_number: string | null
          complement: string | null
          district: string | null
          city: string | null
          state: string | null
          marketing_consent: boolean
          consent_updated_at: Timestamp | null
          has_tax_id: boolean
          search_text: string
          archived_at: Timestamp | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      client_sensitive: {
        Row: {
          client_id: string
          company_id: string
          tax_id: string | null
          internal_notes: string | null
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      equipment_types: {
        Row: { key: string; label: string; sort: number }
        Insert: never
        Update: never
        Relationships: []
      }
      equipment: {
        Row: {
          id: string
          company_id: string
          client_id: string
          code: number
          type: string
          manufacturer: string | null
          model: string | null
          serial_number: string | null
          asset_tag: string | null
          processor: string | null
          memory: string | null
          storage: string | null
          graphics: string | null
          operating_system: string | null
          condition_notes: string | null
          accessories: string[]
          search_text: string
          archived_at: Timestamp | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'equipment_company_id_client_id_fkey'
            columns: ['company_id', 'client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'equipment_type_fkey'
            columns: ['type']
            isOneToOne: false
            referencedRelation: 'equipment_types'
            referencedColumns: ['key']
          },
        ]
      }
      service_order_statuses: {
        Row: { key: string; label: string; stage: OrderStage; sort: number; is_final: boolean }
        Insert: never
        Update: never
        Relationships: []
      }
      service_order_transitions: {
        Row: { from_status: string; to_status: string; requires_reason: boolean }
        Insert: never
        Update: never
        Relationships: []
      }
      service_orders: {
        Row: {
          id: string
          company_id: string
          number: number
          client_id: string
          equipment_id: string | null
          mode: ServiceMode
          status: string
          priority: OrderPriority
          assigned_to: string | null
          reported_problem: string
          symptoms: string | null
          intake_condition: string | null
          intake_accessories: string[]
          device_password_note: string | null
          due_at: Timestamp | null
          received_at: Timestamp
          ready_at: Timestamp | null
          delivered_at: Timestamp | null
          closed_at: Timestamp | null
          warranty_of: string | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'service_orders_company_id_client_id_fkey'
            columns: ['company_id', 'client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'service_orders_company_id_equipment_id_fkey'
            columns: ['company_id', 'equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'service_orders_status_fkey'
            columns: ['status']
            isOneToOne: false
            referencedRelation: 'service_order_statuses'
            referencedColumns: ['key']
          },
        ]
      }
      service_order_events: {
        Row: {
          id: number
          company_id: string
          order_id: string
          kind: OrderEventKind
          from_status: string | null
          to_status: string | null
          reason: string | null
          note: string | null
          assigned_to: string | null
          actor_id: string | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      service_categories: {
        Row: { key: string; label: string; sort: number }
        Insert: never
        Update: never
        Relationships: []
      }
      service_catalog: {
        Row: {
          id: string
          company_id: string
          name: string
          category: string
          description: string | null
          price_cents: number
          cost_cents: number
          duration_minutes: number | null
          warranty_days: number | null
          conditions: string | null
          active: boolean
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: {
          company_id: string
          name: string
          category?: string
          description?: string | null
          price_cents?: number
          cost_cents?: number
          duration_minutes?: number | null
          warranty_days?: number | null
          conditions?: string | null
          active?: boolean
        }
        Update: {
          name?: string
          category?: string
          description?: string | null
          price_cents?: number
          cost_cents?: number
          duration_minutes?: number | null
          warranty_days?: number | null
          conditions?: string | null
          active?: boolean
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          id: string
          company_id: string
          name: string
          tax_id: string | null
          contact: string | null
          email: string | null
          phone: string | null
          website: string | null
          notes: string | null
          active: boolean
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: {
          company_id: string
          name: string
          tax_id?: string | null
          contact?: string | null
          email?: string | null
          phone?: string | null
          website?: string | null
          notes?: string | null
          active?: boolean
        }
        Update: {
          name?: string
          tax_id?: string | null
          contact?: string | null
          email?: string | null
          phone?: string | null
          website?: string | null
          notes?: string | null
          active?: boolean
        }
        Relationships: []
      }
      products: {
        Row: {
          id: string
          company_id: string
          sku: string
          name: string
          category: string | null
          manufacturer: string | null
          supplier_id: string | null
          unit: string
          cost_cents: number
          price_cents: number
          min_qty: number
          qty_on_hand: number
          tracks_serial: boolean
          warranty_days: number | null
          active: boolean
          search_text: string
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: {
          company_id: string
          sku: string
          name: string
          category?: string | null
          manufacturer?: string | null
          supplier_id?: string | null
          unit?: string
          cost_cents?: number
          price_cents?: number
          min_qty?: number
          tracks_serial?: boolean
          warranty_days?: number | null
          active?: boolean
        }
        Update: {
          sku?: string
          name?: string
          category?: string | null
          manufacturer?: string | null
          supplier_id?: string | null
          unit?: string
          price_cents?: number
          min_qty?: number
          tracks_serial?: boolean
          warranty_days?: number | null
          active?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'products_company_id_supplier_id_fkey'
            columns: ['company_id', 'supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
      stock_movements: {
        Row: {
          id: number
          company_id: string
          product_id: string
          kind: StockMovementKind
          qty: number
          direction: number
          unit_cost_cents: number
          balance_after: number
          serial_number: string | null
          reason: string | null
          order_id: string | null
          purchase_id: string | null
          actor_id: string | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      purchases: {
        Row: {
          id: string
          company_id: string
          number: number
          supplier_id: string
          status: PurchaseStatus
          invoice_number: string | null
          ordered_at: string
          received_at: Timestamp | null
          freight_cents: number
          notes: string | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'purchases_company_id_supplier_id_fkey'
            columns: ['company_id', 'supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
      purchase_items: {
        Row: {
          id: string
          company_id: string
          purchase_id: string
          product_id: string
          qty: number
          unit_cost_cents: number
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'purchase_items_company_id_purchase_id_fkey'
            columns: ['company_id', 'purchase_id']
            isOneToOne: false
            referencedRelation: 'purchases'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'purchase_items_company_id_product_id_fkey'
            columns: ['company_id', 'product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
      service_order_items: {
        Row: {
          id: string
          company_id: string
          order_id: string
          kind: OrderItemKind
          catalog_id: string | null
          product_id: string | null
          description: string
          qty: number
          unit_price_cents: number
          unit_cost_cents: number
          discount_cents: number
          serial_number: string | null
          warranty_days: number | null
          returned_at: Timestamp | null
          returned_reason: string | null
          added_by: string | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      finance_accounts: {
        Row: {
          id: string
          company_id: string
          name: string
          kind: FinanceAccountKind
          opening_balance_cents: number
          opening_date: string
          active: boolean
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: {
          company_id: string
          name: string
          kind?: FinanceAccountKind
          opening_balance_cents?: number
          opening_date?: string
          active?: boolean
        }
        Update: {
          name?: string
          kind?: FinanceAccountKind
          opening_balance_cents?: number
          opening_date?: string
          active?: boolean
        }
        Relationships: []
      }
      finance_categories: {
        Row: { id: string; company_id: string; name: string; direction: FinanceDirection; active: boolean; created_at: Timestamp }
        Insert: { company_id: string; name: string; direction: FinanceDirection; active?: boolean }
        Update: { name?: string; active?: boolean }
        Relationships: []
      }
      finance_entries: {
        Row: {
          id: string
          company_id: string
          number: number
          direction: FinanceDirection
          description: string
          category_id: string | null
          client_id: string | null
          supplier_id: string | null
          order_id: string | null
          purchase_id: string | null
          contract_id: string | null
          period_date: string | null
          amount_cents: number
          paid_cents: number
          issue_date: string
          due_date: string
          installment_no: number
          installment_count: number
          group_id: string
          notes: string | null
          canceled_at: Timestamp | null
          cancel_reason: string | null
          status: FinanceStatus
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'finance_entries_company_id_category_id_fkey'
            columns: ['company_id', 'category_id']
            isOneToOne: false
            referencedRelation: 'finance_categories'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'finance_entries_company_id_client_id_fkey'
            columns: ['company_id', 'client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'finance_entries_company_id_supplier_id_fkey'
            columns: ['company_id', 'supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'finance_entries_company_id_order_id_fkey'
            columns: ['company_id', 'order_id']
            isOneToOne: false
            referencedRelation: 'service_orders'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
      finance_payments: {
        Row: {
          id: string
          company_id: string
          entry_id: string
          account_id: string
          method: PaymentMethod
          amount_cents: number
          paid_at: string
          reversal_of: string | null
          notes: string | null
          actor_id: string | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'finance_payments_company_id_entry_id_fkey'
            columns: ['company_id', 'entry_id']
            isOneToOne: false
            referencedRelation: 'finance_entries'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'finance_payments_company_id_account_id_fkey'
            columns: ['company_id', 'account_id']
            isOneToOne: false
            referencedRelation: 'finance_accounts'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          id: string
          company_id: string
          account_id: string
          line_date: string
          description: string
          amount_cents: number
          fingerprint: string
          matched_payment_id: string | null
          ignored: boolean
          imported_by: string | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      automation_runs: {
        Row: {
          id: number
          company_id: string
          job: string
          trigger: 'schedule' | 'dashboard' | 'manual'
          run_date: string
          started_at: Timestamp
          finished_at: Timestamp | null
          ok: boolean
          created_count: number
          detail: string | null
          actor_id: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      portal_links: {
        Row: {
          id: string
          company_id: string
          order_id: string
          expires_at: Timestamp
          revoked_at: Timestamp | null
          created_by: string | null
          created_at: Timestamp
          last_viewed_at: Timestamp | null
          view_count: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      order_signatures: {
        Row: {
          id: string
          company_id: string
          order_id: string
          document: SignatureDocument
          signer_role: SignatureRole
          signer_name: string
          image_data: string
          image_sha256: string
          recorded_by: string | null
          signed_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      member_signatures: {
        Row: {
          company_id: string
          user_id: string
          signer_name: string
          image_data: string
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      digital_services: {
        Row: {
          id: string
          company_id: string
          number: number
          client_id: string
          kind: DigitalKind
          name: string
          url: string | null
          status: DigitalStatus
          repository_url: string | null
          hosting_provider: string | null
          domain_expires_on: string | null
          launched_on: string | null
          notes: string | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'digital_services_company_id_client_id_fkey'
            columns: ['company_id', 'client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
      contracts: {
        Row: {
          id: string
          company_id: string
          number: number
          client_id: string
          digital_service_id: string | null
          description: string
          amount_cents: number
          interval_months: number
          billing_day: number
          start_date: string
          end_date: string | null
          category_id: string | null
          status: ContractStatus
          status_reason: string | null
          notes: string | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'contracts_company_id_client_id_fkey'
            columns: ['company_id', 'client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'contracts_company_id_digital_service_id_fkey'
            columns: ['company_id', 'digital_service_id']
            isOneToOne: false
            referencedRelation: 'digital_services'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
      appointments: {
        Row: {
          id: string
          company_id: string
          number: number
          kind: AppointmentKind
          title: string
          notes: string | null
          client_id: string
          equipment_id: string | null
          order_id: string | null
          assigned_to: string | null
          starts_at: Timestamp
          ends_at: Timestamp
          location: string | null
          status: AppointmentStatus
          status_reason: string | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'appointments_company_id_client_id_fkey'
            columns: ['company_id', 'client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'appointments_company_id_equipment_id_fkey'
            columns: ['company_id', 'equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'appointments_company_id_order_id_fkey'
            columns: ['company_id', 'order_id']
            isOneToOne: false
            referencedRelation: 'service_orders'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
      warranty_claims: {
        Row: {
          id: string
          company_id: string
          number: number
          original_order_id: string
          item_id: string | null
          return_order_id: string
          reason: string
          covered: boolean
          expires_on: string | null
          courtesy_reason: string | null
          status: WarrantyClaimStatus
          resolution: string | null
          decided_by: string | null
          decided_at: Timestamp | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'warranty_claims_company_id_original_order_id_fkey'
            columns: ['company_id', 'original_order_id']
            isOneToOne: false
            referencedRelation: 'service_orders'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'warranty_claims_company_id_return_order_id_fkey'
            columns: ['company_id', 'return_order_id']
            isOneToOne: false
            referencedRelation: 'service_orders'
            referencedColumns: ['company_id', 'id']
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      my_permissions: { Args: { p_company_id: string }; Returns: string[] }
      create_company: { Args: { p_name: string; p_legal_name?: string | null }; Returns: string }
      can_create_company: { Args: Record<string, never>; Returns: boolean }
      update_member: {
        Args: { p_member_id: string; p_role: MemberRole; p_status: MemberStatus }
        Returns: undefined
      }
      set_member_permission: {
        Args: { p_member_id: string; p_permission_key: string; p_granted: boolean | null }
        Returns: undefined
      }
      create_invitation: {
        Args: { p_company_id: string; p_email: string; p_role: MemberRole; p_valid_days?: number }
        Returns: string
      }
      revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      list_company_members: {
        Args: { p_company_id: string }
        Returns: {
          member_id: string
          user_id: string
          full_name: string | null
          email: string
          role: MemberRole
          status: MemberStatus
          created_at: Timestamp
        }[]
      }
      find_client_duplicates: {
        Args: {
          p_company_id: string
          p_name: string
          p_email?: string | null
          p_phone?: string | null
          p_tax_id?: string | null
          p_exclude_id?: string | null
        }
        Returns: { id: string; code: number; name: string; reason: string }[]
      }
      save_client: {
        Args: { p_company_id: string; p_client_id: string | null; p_data: Json; p_sensitive?: Json }
        Returns: string
      }
      set_client_archived: { Args: { p_client_id: string; p_archived: boolean }; Returns: undefined }
      export_clients: {
        Args: { p_company_id: string; p_include_archived?: boolean }
        Returns: {
          code: number
          kind: ClientKind
          name: string
          trade_name: string | null
          tax_id: string | null
          email: string | null
          phone: string | null
          whatsapp: string | null
          zip_code: string | null
          street: string | null
          street_number: string | null
          complement: string | null
          district: string | null
          city: string | null
          state: string | null
          marketing_consent: boolean
          created_at: Timestamp
        }[]
      }
      save_equipment: {
        Args: { p_company_id: string; p_equipment_id: string | null; p_data: Json }
        Returns: string
      }
      set_equipment_archived: { Args: { p_equipment_id: string; p_archived: boolean }; Returns: undefined }
      global_search: {
        Args: { p_company_id: string; p_query: string }
        Returns: { kind: 'client' | 'equipment' | 'order'; id: string; code: number; title: string; subtitle: string }[]
      }
      create_service_order: { Args: { p_company_id: string; p_data: Json }; Returns: string }
      update_service_order: { Args: { p_order_id: string; p_data: Json }; Returns: undefined }
      change_service_order_status: {
        Args: { p_order_id: string; p_to: string; p_reason?: string | null }
        Returns: undefined
      }
      assign_service_order: { Args: { p_order_id: string; p_user_id: string | null }; Returns: undefined }
      add_service_order_note: { Args: { p_order_id: string; p_note: string }; Returns: undefined }
      list_assignable_members: {
        Args: { p_company_id: string }
        Returns: { user_id: string; full_name: string | null; email: string; role: MemberRole }[]
      }
      service_order_stats: {
        Args: { p_company_id: string }
        Returns: { status: string; total: number; overdue: number }[]
      }
      seed_service_catalog: { Args: { p_company_id: string }; Returns: number }
      adjust_stock: {
        Args: {
          p_product_id: string
          p_kind: StockMovementKind
          p_qty: number
          p_reason: string
          p_serial?: string | null
        }
        Returns: number
      }
      save_purchase: { Args: { p_company_id: string; p_purchase_id: string | null; p_data: Json }; Returns: string }
      receive_purchase: { Args: { p_purchase_id: string }; Returns: undefined }
      cancel_purchase: { Args: { p_purchase_id: string }; Returns: undefined }
      add_order_item: { Args: { p_order_id: string; p_data: Json }; Returns: string }
      remove_order_item: { Args: { p_item_id: string; p_reason: string }; Returns: undefined }
      service_order_totals: {
        Args: { p_order_id: string }
        Returns: {
          services_cents: number
          parts_cents: number
          discount_cents: number
          total_cents: number
          cost_cents: number | null
          margin_cents: number | null
        }[]
      }
      low_stock_count: { Args: { p_company_id: string }; Returns: number }
      list_warranties: {
        Args: { p_company_id: string; p_status?: string; p_query?: string | null; p_order_id?: string | null; p_limit?: number; p_offset?: number }
        Returns: {
          item_id: string
          order_id: string
          order_number: number
          client_id: string
          client_name: string
          equipment_label: string | null
          kind: OrderItemKind
          description: string
          serial_number: string | null
          warranty_days: number
          delivered_at: Timestamp
          expires_on: string
          days_left: number
          open_claims: number
          total_count: number
        }[]
      }
      open_warranty_claim: { Args: { p_order_id: string; p_data: Json }; Returns: { claim_id: string; return_order_id: string }[] }
      decide_warranty_claim: { Args: { p_claim_id: string; p_status: WarrantyClaimStatus; p_note?: string | null }; Returns: undefined }
      report_orders_summary: {
        Args: { p_company_id: string; p_from: string; p_to: string }
        Returns: {
          opened: number
          delivered: number
          canceled: number
          unrepairable: number
          open_now: number
          avg_turnaround_hours: number | null
          median_turnaround_hours: number | null
          due_tracked: number
          on_time: number
          warranty_returns: number
        }[]
      }
      report_by_technician: {
        Args: { p_company_id: string; p_from: string; p_to: string }
        Returns: { user_id: string | null; name: string; delivered: number; avg_turnaround_hours: number | null; revenue_cents: number | null; warranty_returns: number }[]
      }
      report_top_items: {
        Args: { p_company_id: string; p_from: string; p_to: string; p_limit?: number }
        Returns: { kind: OrderItemKind; description: string; qty: number; orders: number; revenue_cents: number; cost_cents: number | null }[]
      }
      report_top_clients: {
        Args: { p_company_id: string; p_from: string; p_to: string; p_limit?: number }
        Returns: { client_id: string; name: string; entries: number; billed_cents: number; received_cents: number; open_cents: number }[]
      }
      report_receivables_aging: { Args: { p_company_id: string }; Returns: { bucket: string; sort: number; entries: number; open_cents: number }[] }
      report_monthly: {
        Args: { p_company_id: string; p_months?: number }
        Returns: { month: string; opened: number; delivered: number; billed_cents: number | null; received_cents: number | null; paid_cents: number | null }[]
      }
      run_automations: { Args: { p_company_id: string }; Returns: Json }
      run_contract_billing_now: { Args: { p_company_id: string }; Returns: Json }
      automation_alerts: {
        Args: { p_company_id: string }
        Returns: { kind: string; severity: 'danger' | 'attn' | 'info'; title: string; total: number; amount_cents: number | null; items: Json; link: string }[]
      }
      create_portal_link: { Args: { p_order_id: string; p_days?: number }; Returns: { link_id: string; token: string; expires_at: Timestamp }[] }
      revoke_portal_link: { Args: { p_link_id: string }; Returns: undefined }
      portal_order: { Args: { p_token: string }; Returns: Json }
      portal_decide: { Args: { p_token: string; p_approve: boolean; p_name: string; p_note?: string | null }; Returns: undefined }
      sign_order: {
        Args: { p_order_id: string; p_document: SignatureDocument; p_role: SignatureRole; p_signer_name: string; p_image_data: string }
        Returns: string
      }
      save_my_signature: { Args: { p_company_id: string; p_signer_name: string; p_image_data: string }; Returns: undefined }
      save_digital_service: { Args: { p_company_id: string; p_id: string | null; p_data: Json }; Returns: string }
      save_contract: { Args: { p_company_id: string; p_id: string | null; p_data: Json }; Returns: string }
      set_contract_status: { Args: { p_id: string; p_status: ContractStatus; p_reason?: string | null }; Returns: undefined }
      generate_contract_charges: { Args: { p_company_id: string; p_until?: string | null; p_contract_id?: string | null }; Returns: number }
      contract_overview: {
        Args: { p_company_id: string }
        Returns: { contract_id: string; next_due: string | null; billed_count: number; open_cents: number; overdue_cents: number }[]
      }
      expiring_domains: { Args: { p_company_id: string; p_days?: number }; Returns: { id: string; name: string; client_name: string; domain_expires_on: string }[] }
      save_appointment: { Args: { p_company_id: string; p_id: string | null; p_data: Json }; Returns: string }
      set_appointment_status: { Args: { p_id: string; p_status: AppointmentStatus; p_reason?: string | null }; Returns: undefined }
      convert_appointment_to_order: { Args: { p_id: string; p_reported_problem?: string | null }; Returns: string }
      appointments_today: { Args: { p_company_id: string }; Returns: { total: number; mine: number; next_starts_at: Timestamp | null }[] }
      warranty_stats: { Args: { p_company_id: string }; Returns: { active_items: number; expiring_items: number; open_claims: number }[] }
      seed_finance_defaults: { Args: { p_company_id: string }; Returns: undefined }
      create_finance_entry: { Args: { p_company_id: string; p_data: Json }; Returns: string }
      update_finance_entry: { Args: { p_entry_id: string; p_data: Json }; Returns: undefined }
      cancel_finance_entry: { Args: { p_entry_id: string; p_reason: string }; Returns: undefined }
      register_payment: { Args: { p_entry_id: string; p_data: Json }; Returns: string }
      reverse_payment: { Args: { p_payment_id: string; p_reason: string }; Returns: string }
      finance_summary: {
        Args: { p_company_id: string; p_from: string; p_to: string }
        Returns: {
          billed_cents: number
          expenses_cents: number
          estimated_result_cents: number
          received_cents: number
          paid_cents: number
          cash_result_cents: number
          receivable_open_cents: number
          receivable_overdue_cents: number
          payable_open_cents: number
          payable_overdue_cents: number
          balance_cents: number
        }[]
      }
      cash_flow: {
        Args: { p_company_id: string; p_from: string; p_to: string; p_group?: 'day' | 'month' }
        Returns: { period: string; in_cents: number; out_cents: number; net_cents: number; balance_cents: number }[]
      }
      order_margins: {
        Args: { p_company_id: string; p_from: string; p_to: string }
        Returns: {
          order_id: string
          number: number
          client_name: string
          delivered_at: Timestamp
          revenue_cents: number
          cost_cents: number
          margin_cents: number
          received_cents: number
        }[]
      }
      service_category_results: {
        Args: { p_company_id: string; p_from: string; p_to: string }
        Returns: { category: string; label: string; items: number; revenue_cents: number; cost_cents: number; margin_cents: number }[]
      }
      import_statement: {
        Args: { p_account_id: string; p_lines: Json }
        Returns: { imported: number; skipped: number }[]
      }
      match_statement_line: { Args: { p_line_id: string; p_payment_id: string | null }; Returns: undefined }
      set_statement_line_ignored: { Args: { p_line_id: string; p_ignored: boolean }; Returns: undefined }
      statement_suggestions: {
        Args: { p_line_id: string }
        Returns: { payment_id: string; paid_at: string; amount_cents: number; entry_description: string; days_apart: number }[]
      }
    }
    Enums: {
      member_role: MemberRole
      member_status: MemberStatus
      client_kind: ClientKind
      contact_channel: ContactChannel
      service_mode: ServiceMode
      order_priority: OrderPriority
      order_event_kind: OrderEventKind
      stock_movement_kind: StockMovementKind
      purchase_status: PurchaseStatus
      order_item_kind: OrderItemKind
      warranty_claim_status: WarrantyClaimStatus
      appointment_kind: AppointmentKind
      digital_kind: DigitalKind
      signature_document: SignatureDocument
      signature_role: SignatureRole
      digital_status: DigitalStatus
      contract_status: ContractStatus
      appointment_status: AppointmentStatus
      finance_direction: FinanceDirection
      payment_method: PaymentMethod
      finance_account_kind: FinanceAccountKind
    }
    CompositeTypes: { [_ in never]: never }
  }
}
