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
      accounts_payable: {
        Row: {
          account_id: string | null
          amount: number
          amount_paid: number
          bank_name: string | null
          barcode: string | null
          boleto_number: string | null
          category: string
          cost_center_id: string | null
          created_at: string
          description: string
          due_date: string
          id: string
          installment_number: number | null
          invoice_id: string | null
          is_recurring: boolean
          notes: string | null
          payment_date: string | null
          payment_method: string | null
          status: string
          supplier_id: string | null
          total_installments: number | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount?: number
          amount_paid?: number
          bank_name?: string | null
          barcode?: string | null
          boleto_number?: string | null
          category?: string
          cost_center_id?: string | null
          created_at?: string
          description?: string
          due_date: string
          id?: string
          installment_number?: number | null
          invoice_id?: string | null
          is_recurring?: boolean
          notes?: string | null
          payment_date?: string | null
          payment_method?: string | null
          status?: string
          supplier_id?: string | null
          total_installments?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          amount_paid?: number
          bank_name?: string | null
          barcode?: string | null
          boleto_number?: string | null
          category?: string
          cost_center_id?: string | null
          created_at?: string
          description?: string
          due_date?: string
          id?: string
          installment_number?: number | null
          invoice_id?: string | null
          is_recurring?: boolean
          notes?: string | null
          payment_date?: string | null
          payment_method?: string | null
          status?: string
          supplier_id?: string | null
          total_installments?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_price_history"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "accounts_payable_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      accounts_receivable: {
        Row: {
          account_id: string | null
          amount: number
          amount_received: number
          category: string
          client_cnpj: string | null
          client_id: string | null
          client_name: string
          cost_center_id: string | null
          created_at: string
          description: string
          due_date: string
          id: string
          installment_number: number | null
          notes: string | null
          payment_date: string | null
          payment_method: string | null
          sale_order_id: string | null
          status: string
          total_installments: number | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount?: number
          amount_received?: number
          category?: string
          client_cnpj?: string | null
          client_id?: string | null
          client_name?: string
          cost_center_id?: string | null
          created_at?: string
          description?: string
          due_date: string
          id?: string
          installment_number?: number | null
          notes?: string | null
          payment_date?: string | null
          payment_method?: string | null
          sale_order_id?: string | null
          status?: string
          total_installments?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          amount_received?: number
          category?: string
          client_cnpj?: string | null
          client_id?: string | null
          client_name?: string
          cost_center_id?: string | null
          created_at?: string
          description?: string
          due_date?: string
          id?: string
          installment_number?: number | null
          notes?: string | null
          payment_date?: string | null
          payment_method?: string | null
          sale_order_id?: string | null
          status?: string
          total_installments?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_receivable_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "accounts_receivable_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "accounts_receivable_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      artisanal_recipes: {
        Row: {
          active: boolean
          artisanal_product_name: string
          base_product_name: string
          base_time_minutes: number
          created_at: string
          default_contractor_id: string | null
          id: string
          labor_cost_per_meter: number
          name: string
          notes: string | null
          updated_at: string
          yield_per_meter: number
        }
        Insert: {
          active?: boolean
          artisanal_product_name: string
          base_product_name: string
          base_time_minutes?: number
          created_at?: string
          default_contractor_id?: string | null
          id?: string
          labor_cost_per_meter?: number
          name: string
          notes?: string | null
          updated_at?: string
          yield_per_meter?: number
        }
        Update: {
          active?: boolean
          artisanal_product_name?: string
          base_product_name?: string
          base_time_minutes?: number
          created_at?: string
          default_contractor_id?: string | null
          id?: string
          labor_cost_per_meter?: number
          name?: string
          notes?: string | null
          updated_at?: string
          yield_per_meter?: number
        }
        Relationships: [
          {
            foreignKeyName: "artisanal_recipes_default_contractor_id_fkey"
            columns: ["default_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          error_message: string | null
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          resource: string
          resource_id: string | null
          success: boolean | null
          timestamp: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          resource: string
          resource_id?: string | null
          success?: boolean | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          resource?: string
          resource_id?: string | null
          success?: boolean | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      automation_executions: {
        Row: {
          context: Json
          error_message: string | null
          executed_at: string
          id: string
          result: Json
          status: string
          trigger: string
          workflow_id: string
          workflow_name: string
        }
        Insert: {
          context?: Json
          error_message?: string | null
          executed_at?: string
          id?: string
          result?: Json
          status: string
          trigger: string
          workflow_id: string
          workflow_name: string
        }
        Update: {
          context?: Json
          error_message?: string | null
          executed_at?: string
          id?: string
          result?: Json
          status?: string
          trigger?: string
          workflow_id?: string
          workflow_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "automation_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_workflows: {
        Row: {
          actions: Json
          category: string
          conditions: Json
          created_at: string
          description: string
          enabled: boolean
          execution_count: number
          id: string
          last_run_at: string | null
          name: string
          success_count: number
          trigger: string
          trigger_label: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          category?: string
          conditions?: Json
          created_at?: string
          description?: string
          enabled?: boolean
          execution_count?: number
          id?: string
          last_run_at?: string | null
          name: string
          success_count?: number
          trigger: string
          trigger_label?: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          category?: string
          conditions?: Json
          created_at?: string
          description?: string
          enabled?: boolean
          execution_count?: number
          id?: string
          last_run_at?: string | null
          name?: string
          success_count?: number
          trigger?: string
          trigger_label?: string
          updated_at?: string
        }
        Relationships: []
      }
      bank_accounts: {
        Row: {
          account_number: string | null
          account_type: string
          active: boolean
          agency: string | null
          bank_name: string
          created_at: string
          current_balance: number
          id: string
          initial_balance: number
          name: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          account_type?: string
          active?: boolean
          agency?: string | null
          bank_name?: string
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          name: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          account_type?: string
          active?: boolean
          agency?: string | null
          bank_name?: string
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      baus: {
        Row: {
          active: boolean | null
          altura_cm: number
          capacidade_kg: number | null
          comprimento_cm: number
          created_at: string | null
          id: string
          largura_cm: number
          nome: string
          notas: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          altura_cm: number
          capacidade_kg?: number | null
          comprimento_cm: number
          created_at?: string | null
          id?: string
          largura_cm: number
          nome: string
          notas?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          altura_cm?: number
          capacidade_kg?: number | null
          comprimento_cm?: number
          created_at?: string | null
          id?: string
          largura_cm?: number
          nome?: string
          notas?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      bill_of_materials: {
        Row: {
          created_at: string | null
          id: string
          master_id: string | null
          material_id: string | null
          quantity_required: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          master_id?: string | null
          material_id?: string | null
          quantity_required: number
        }
        Update: {
          created_at?: string | null
          id?: string
          master_id?: string | null
          material_id?: string | null
          quantity_required?: number
        }
        Relationships: [
          {
            foreignKeyName: "bill_of_materials_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "product_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_of_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_of_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_material_projected_availability"
            referencedColumns: ["id"]
          },
        ]
      }
      bin_locations: {
        Row: {
          active: boolean
          aisle: string | null
          bin: string | null
          capacity: number | null
          code: string
          created_at: string
          id: string
          name: string
          rack: string | null
          shelf: string | null
          updated_at: string
          warehouse: string
          zone: string | null
        }
        Insert: {
          active?: boolean
          aisle?: string | null
          bin?: string | null
          capacity?: number | null
          code: string
          created_at?: string
          id?: string
          name?: string
          rack?: string | null
          shelf?: string | null
          updated_at?: string
          warehouse?: string
          zone?: string | null
        }
        Update: {
          active?: boolean
          aisle?: string | null
          bin?: string | null
          capacity?: number | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          rack?: string | null
          shelf?: string | null
          updated_at?: string
          warehouse?: string
          zone?: string | null
        }
        Relationships: []
      }
      bom_operations: {
        Row: {
          active: boolean
          cost_per_hour: number
          cost_per_pair: number | null
          created_at: string
          id: string
          notes: string | null
          operation_name: string
          required_skill_level: number | null
          resource_name: string | null
          sheet_id: string
          sort_order: number
          stage: string
          standard_time_minutes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          cost_per_hour?: number
          cost_per_pair?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          operation_name?: string
          required_skill_level?: number | null
          resource_name?: string | null
          sheet_id: string
          sort_order?: number
          stage?: string
          standard_time_minutes?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          cost_per_hour?: number
          cost_per_pair?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          operation_name?: string
          required_skill_level?: number | null
          resource_name?: string | null
          sheet_id?: string
          sort_order?: number
          stage?: string
          standard_time_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bom_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      bom_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          materials_snapshot: Json | null
          operations_snapshot: Json | null
          sheet_id: string
          snapshot: Json
          status: string
          version_number: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          materials_snapshot?: Json | null
          operations_snapshot?: Json | null
          sheet_id: string
          snapshot?: Json
          status?: string
          version_number?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          materials_snapshot?: Json | null
          operations_snapshot?: Json | null
          sheet_id?: string
          snapshot?: Json
          status?: string
          version_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "bom_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      box_types: {
        Row: {
          active: boolean | null
          altura_cm: number
          comprimento_cm: number
          created_at: string | null
          empilhamento_maximo: number | null
          id: string
          interno: boolean | null
          largura_cm: number
          min_stock: number
          nome: string
          peso_kg: number | null
          quantity: number
          supplier_id: string | null
          unit_price: number
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          altura_cm: number
          comprimento_cm: number
          created_at?: string | null
          empilhamento_maximo?: number | null
          id?: string
          interno?: boolean | null
          largura_cm: number
          min_stock?: number
          nome: string
          peso_kg?: number | null
          quantity?: number
          supplier_id?: string | null
          unit_price?: number
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          altura_cm?: number
          comprimento_cm?: number
          created_at?: string | null
          empilhamento_maximo?: number | null
          id?: string
          interno?: boolean | null
          largura_cm?: number
          min_stock?: number
          nome?: string
          peso_kg?: number | null
          quantity?: number
          supplier_id?: string | null
          unit_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "box_types_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "box_types_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      budgets: {
        Row: {
          account_id: string | null
          actual_amount: number
          cost_center_id: string | null
          created_at: string
          id: string
          notes: string | null
          period: string
          planned_amount: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          actual_amount?: number
          cost_center_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          period?: string
          planned_amount?: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          actual_amount?: number
          cost_center_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          period?: string
          planned_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      care_instructions: {
        Row: {
          created_at: string
          id: string
          instruction_text_en: string | null
          instruction_text_es: string | null
          instruction_text_pt: string | null
          name: string
          symbols: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          instruction_text_en?: string | null
          instruction_text_es?: string | null
          instruction_text_pt?: string | null
          name: string
          symbols?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          instruction_text_en?: string | null
          instruction_text_es?: string | null
          instruction_text_pt?: string | null
          name?: string
          symbols?: Json | null
        }
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          level: number
          name: string
          parent_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          level?: number
          name: string
          parent_id?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          level?: number
          name?: string
          parent_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_representatives: {
        Row: {
          client_id: string
          created_at: string
          id: string
          representative_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          representative_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          representative_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_representatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_representatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_representatives_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          accepts_bundled_packaging: boolean | null
          active: boolean
          address_manual_override: boolean | null
          address_override_history: Json | null
          bairro: string | null
          cep: string | null
          cidade: string | null
          client_number: string | null
          cnpj: string | null
          codigo_municipio: string | null
          contato: string | null
          created_at: string
          credit_limit: number
          economic_group_id: string | null
          email: string | null
          endereco: string | null
          endereco_manual_override: boolean
          endereco_updated_at: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          is_favorite: boolean
          logo_url: string | null
          nome_fantasia: string | null
          notes: string | null
          razao_social: string
          silk_url: string | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          accepts_bundled_packaging?: boolean | null
          active?: boolean
          address_manual_override?: boolean | null
          address_override_history?: Json | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          client_number?: string | null
          cnpj?: string | null
          codigo_municipio?: string | null
          contato?: string | null
          created_at?: string
          credit_limit?: number
          economic_group_id?: string | null
          email?: string | null
          endereco?: string | null
          endereco_manual_override?: boolean
          endereco_updated_at?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          is_favorite?: boolean
          logo_url?: string | null
          nome_fantasia?: string | null
          notes?: string | null
          razao_social: string
          silk_url?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          accepts_bundled_packaging?: boolean | null
          active?: boolean
          address_manual_override?: boolean | null
          address_override_history?: Json | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          client_number?: string | null
          cnpj?: string | null
          codigo_municipio?: string | null
          contato?: string | null
          created_at?: string
          credit_limit?: number
          economic_group_id?: string | null
          email?: string | null
          endereco?: string | null
          endereco_manual_override?: boolean
          endereco_updated_at?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          is_favorite?: boolean
          logo_url?: string | null
          nome_fantasia?: string | null
          notes?: string | null
          razao_social?: string
          silk_url?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "economic_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_entries: {
        Row: {
          cost_per_unit: number
          created_at: string
          entry_date: string
          entry_type: string
          gross_margin: number
          id: string
          invoice_number: string | null
          labor_cost: number
          material_cost: number
          nfe_id: string | null
          notes: string | null
          order_id: string | null
          overhead_cost: number
          quantity: number
          revenue: number
          sale_order_id: string | null
          total_cogs: number
        }
        Insert: {
          cost_per_unit?: number
          created_at?: string
          entry_date?: string
          entry_type?: string
          gross_margin?: number
          id?: string
          invoice_number?: string | null
          labor_cost?: number
          material_cost?: number
          nfe_id?: string | null
          notes?: string | null
          order_id?: string | null
          overhead_cost?: number
          quantity?: number
          revenue?: number
          sale_order_id?: string | null
          total_cogs?: number
        }
        Update: {
          cost_per_unit?: number
          created_at?: string
          entry_date?: string
          entry_type?: string
          gross_margin?: number
          id?: string
          invoice_number?: string | null
          labor_cost?: number
          material_cost?: number
          nfe_id?: string | null
          notes?: string | null
          order_id?: string | null
          overhead_cost?: number
          quantity?: number
          revenue?: number
          sale_order_id?: string | null
          total_cogs?: number
        }
        Relationships: [
          {
            foreignKeyName: "cogs_entries_nfe_id_fkey"
            columns: ["nfe_id"]
            isOneToOne: false
            referencedRelation: "nfe_emitidas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "cogs_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "cogs_entries_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "cogs_entries_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cogs_entries_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      colors: {
        Row: {
          acabamento_disponivel: Json | null
          cor_id: string
          created_at: string
          estoque_por_material: Json | null
          id: string
          imagem_swatch: string | null
          materiais_compativeis: Json | null
          nome: string
          referencia_hex: string | null
          referencia_pantone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          acabamento_disponivel?: Json | null
          cor_id?: string
          created_at?: string
          estoque_por_material?: Json | null
          id?: string
          imagem_swatch?: string | null
          materiais_compativeis?: Json | null
          nome?: string
          referencia_hex?: string | null
          referencia_pantone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          acabamento_disponivel?: Json | null
          cor_id?: string
          created_at?: string
          estoque_por_material?: Json | null
          id?: string
          imagem_swatch?: string | null
          materiais_compativeis?: Json | null
          nome?: string
          referencia_hex?: string | null
          referencia_pantone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          active: boolean
          ambiente: string
          bairro: string
          cep: string
          certificate_path: string | null
          cfop: string
          cidade: string
          cnpj: string
          codigo_municipio: string
          complemento: string
          created_at: string
          id: string
          inscricao_estadual: string
          is_primary: boolean
          logradouro: string
          natureza_operacao: string
          nome_fantasia: string
          numero: string
          razao_social: string
          regime_tributario: string
          serie_nfe: number
          uf: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          ambiente?: string
          bairro?: string
          cep?: string
          certificate_path?: string | null
          cfop?: string
          cidade?: string
          cnpj: string
          codigo_municipio?: string
          complemento?: string
          created_at?: string
          id?: string
          inscricao_estadual?: string
          is_primary?: boolean
          logradouro?: string
          natureza_operacao?: string
          nome_fantasia?: string
          numero?: string
          razao_social: string
          regime_tributario?: string
          serie_nfe?: number
          uf?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          ambiente?: string
          bairro?: string
          cep?: string
          certificate_path?: string | null
          cfop?: string
          cidade?: string
          cnpj?: string
          codigo_municipio?: string
          complemento?: string
          created_at?: string
          id?: string
          inscricao_estadual?: string
          is_primary?: boolean
          logradouro?: string
          natureza_operacao?: string
          nome_fantasia?: string
          numero?: string
          razao_social?: string
          regime_tributario?: string
          serie_nfe?: number
          uf?: string
          updated_at?: string
        }
        Relationships: []
      }
      component_sheets: {
        Row: {
          created_at: string
          default_sole_group_id: string | null
          dimensions_length: number | null
          dimensions_thickness: number | null
          dimensions_unit: string | null
          dimensions_width: number | null
          group_id: string | null
          id: string
          notes: string | null
          product_id: string
          updated_at: string
          waste_pct: number | null
          yield_per_size: Json | null
          yield_per_sole: Json | null
        }
        Insert: {
          created_at?: string
          default_sole_group_id?: string | null
          dimensions_length?: number | null
          dimensions_thickness?: number | null
          dimensions_unit?: string | null
          dimensions_width?: number | null
          group_id?: string | null
          id?: string
          notes?: string | null
          product_id: string
          updated_at?: string
          waste_pct?: number | null
          yield_per_size?: Json | null
          yield_per_sole?: Json | null
        }
        Update: {
          created_at?: string
          default_sole_group_id?: string | null
          dimensions_length?: number | null
          dimensions_thickness?: number | null
          dimensions_unit?: string | null
          dimensions_width?: number | null
          group_id?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          updated_at?: string
          waste_pct?: number | null
          yield_per_size?: Json | null
          yield_per_sole?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "component_sheets_default_sole_group_id_fkey"
            columns: ["default_sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_sheets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      contractors: {
        Row: {
          active: boolean
          address: string | null
          city: string | null
          cnpj_cpf: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          payment_days: number
          phone: string | null
          service_type: string | null
          state: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          city?: string | null
          cnpj_cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          payment_days?: number
          phone?: string | null
          service_type?: string | null
          state?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          city?: string | null
          cnpj_cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          payment_days?: number
          phone?: string | null
          service_type?: string | null
          state?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cost_centers: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      cost_parameters: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: number
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: number
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      cost_policies: {
        Row: {
          active: boolean
          created_at: string
          freight_allocation_pct: number
          id: string
          monthly_production_target: number
          notes: string | null
          overhead_monthly_total: number
          overhead_rate_per_pair: number
          packaging_cost_per_pair: number
          updated_at: string
          valuation_method: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          freight_allocation_pct?: number
          id?: string
          monthly_production_target?: number
          notes?: string | null
          overhead_monthly_total?: number
          overhead_rate_per_pair?: number
          packaging_cost_per_pair?: number
          updated_at?: string
          valuation_method?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          freight_allocation_pct?: number
          id?: string
          monthly_production_target?: number
          notes?: string | null
          overhead_monthly_total?: number
          overhead_rate_per_pair?: number
          packaging_cost_per_pair?: number
          updated_at?: string
          valuation_method?: string
        }
        Relationships: []
      }
      cost_variance_reports: {
        Row: {
          actual_labor_cost: number
          actual_material_cost: number
          actual_overhead: number
          created_at: string
          id: string
          labor_variance: number
          material_variance: number
          notes: string | null
          order_id: string
          overhead_variance: number
          period: string | null
          quantity_produced: number
          sale_order_id: string | null
          standard_labor_cost: number
          standard_material_cost: number
          standard_overhead: number
          total_actual_cost: number
          total_standard_cost: number
          total_variance: number
          variance_pct: number
        }
        Insert: {
          actual_labor_cost?: number
          actual_material_cost?: number
          actual_overhead?: number
          created_at?: string
          id?: string
          labor_variance?: number
          material_variance?: number
          notes?: string | null
          order_id: string
          overhead_variance?: number
          period?: string | null
          quantity_produced?: number
          sale_order_id?: string | null
          standard_labor_cost?: number
          standard_material_cost?: number
          standard_overhead?: number
          total_actual_cost?: number
          total_standard_cost?: number
          total_variance?: number
          variance_pct?: number
        }
        Update: {
          actual_labor_cost?: number
          actual_material_cost?: number
          actual_overhead?: number
          created_at?: string
          id?: string
          labor_variance?: number
          material_variance?: number
          notes?: string | null
          order_id?: string
          overhead_variance?: number
          period?: string | null
          quantity_produced?: number
          sale_order_id?: string | null
          standard_labor_cost?: number
          standard_material_cost?: number
          standard_overhead?: number
          total_actual_cost?: number
          total_standard_cost?: number
          total_variance?: number
          variance_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "cost_variance_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_variance_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "cost_variance_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_variance_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "cost_variance_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "cost_variance_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_variance_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      cycle_count_items: {
        Row: {
          adjusted: boolean
          bin_location: string | null
          counted_quantity: number | null
          created_at: string
          cycle_count_id: string
          id: string
          lot_number: string | null
          notes: string | null
          product_id: string
          system_quantity: number
          variance: number | null
        }
        Insert: {
          adjusted?: boolean
          bin_location?: string | null
          counted_quantity?: number | null
          created_at?: string
          cycle_count_id: string
          id?: string
          lot_number?: string | null
          notes?: string | null
          product_id: string
          system_quantity?: number
          variance?: number | null
        }
        Update: {
          adjusted?: boolean
          bin_location?: string | null
          counted_quantity?: number | null
          created_at?: string
          cycle_count_id?: string
          id?: string
          lot_number?: string | null
          notes?: string | null
          product_id?: string
          system_quantity?: number
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_items_cycle_count_id_fkey"
            columns: ["cycle_count_id"]
            isOneToOne: false
            referencedRelation: "cycle_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      cycle_counts: {
        Row: {
          accuracy_pct: number | null
          accurate_items: number | null
          approved_by: string | null
          count_date: string
          count_number: string
          counted_by: string | null
          created_at: string
          id: string
          notes: string | null
          status: string
          total_items: number | null
          updated_at: string
        }
        Insert: {
          accuracy_pct?: number | null
          accurate_items?: number | null
          approved_by?: string | null
          count_date?: string
          count_number?: string
          counted_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          total_items?: number | null
          updated_at?: string
        }
        Update: {
          accuracy_pct?: number | null
          accurate_items?: number | null
          approved_by?: string | null
          count_date?: string
          count_number?: string
          counted_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          total_items?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      default_lead_times: {
        Row: {
          assembly_capacity_per_day: number | null
          created_at: string
          cutting_capacity_per_day: number | null
          finishing_capacity_per_day: number | null
          gluing_capacity_per_day: number
          id: string
          lead_time_acabamento_dias: number
          lead_time_buffer_material_dias: number
          lead_time_colagem_dias: number | null
          lead_time_corte_dias: number
          lead_time_costura_dias: number
          lead_time_expedicao_dias: number | null
          lead_time_montagem_dias: number
          lead_time_silk_dias: number | null
          notes: string | null
          sewing_capacity_per_day: number | null
          shoe_category: string
          silk_capacity_per_day: number
          soling_capacity_per_day: number | null
          updated_at: string
        }
        Insert: {
          assembly_capacity_per_day?: number | null
          created_at?: string
          cutting_capacity_per_day?: number | null
          finishing_capacity_per_day?: number | null
          gluing_capacity_per_day?: number
          id?: string
          lead_time_acabamento_dias?: number
          lead_time_buffer_material_dias?: number
          lead_time_colagem_dias?: number | null
          lead_time_corte_dias?: number
          lead_time_costura_dias?: number
          lead_time_expedicao_dias?: number | null
          lead_time_montagem_dias?: number
          lead_time_silk_dias?: number | null
          notes?: string | null
          sewing_capacity_per_day?: number | null
          shoe_category: string
          silk_capacity_per_day?: number
          soling_capacity_per_day?: number | null
          updated_at?: string
        }
        Update: {
          assembly_capacity_per_day?: number | null
          created_at?: string
          cutting_capacity_per_day?: number | null
          finishing_capacity_per_day?: number | null
          gluing_capacity_per_day?: number
          id?: string
          lead_time_acabamento_dias?: number
          lead_time_buffer_material_dias?: number
          lead_time_colagem_dias?: number | null
          lead_time_corte_dias?: number
          lead_time_costura_dias?: number
          lead_time_expedicao_dias?: number | null
          lead_time_montagem_dias?: number
          lead_time_silk_dias?: number | null
          notes?: string | null
          sewing_capacity_per_day?: number | null
          shoe_category?: string
          silk_capacity_per_day?: number
          soling_capacity_per_day?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      economic_group_representatives: {
        Row: {
          created_at: string
          economic_group_id: string
          id: string
          representative_id: string
        }
        Insert: {
          created_at?: string
          economic_group_id: string
          id?: string
          representative_id: string
        }
        Update: {
          created_at?: string
          economic_group_id?: string
          id?: string
          representative_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "economic_group_representatives_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "economic_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "economic_group_representatives_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      economic_groups: {
        Row: {
          billing_email: string | null
          created_at: string
          description: string | null
          finance_contact_name: string | null
          group_number: string | null
          id: string
          important_info: string | null
          is_favorite: boolean
          logo_url: string | null
          name: string
          silk_url: string | null
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          created_at?: string
          description?: string | null
          finance_contact_name?: string | null
          group_number?: string | null
          id?: string
          important_info?: string | null
          is_favorite?: boolean
          logo_url?: string | null
          name: string
          silk_url?: string | null
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          created_at?: string
          description?: string | null
          finance_contact_name?: string | null
          group_number?: string | null
          id?: string
          important_info?: string | null
          is_favorite?: boolean
          logo_url?: string | null
          name?: string
          silk_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      employee_absences: {
        Row: {
          absence_type: string
          created_at: string
          document_url: string | null
          employee_id: string
          end_date: string
          id: string
          justified: boolean | null
          notes: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          absence_type: string
          created_at?: string
          document_url?: string | null
          employee_id: string
          end_date: string
          id?: string
          justified?: boolean | null
          notes?: string | null
          start_date: string
          updated_at?: string
        }
        Update: {
          absence_type?: string
          created_at?: string
          document_url?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          justified?: boolean | null
          notes?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_advances: {
        Row: {
          advance_date: string
          amount: number
          created_at: string
          description: string | null
          employee_id: string
          id: string
          receipt_url: string | null
          status: string
          time: string | null
          updated_at: string
        }
        Insert: {
          advance_date?: string
          amount?: number
          created_at?: string
          description?: string | null
          employee_id: string
          id?: string
          receipt_url?: string | null
          status?: string
          time?: string | null
          updated_at?: string
        }
        Update: {
          advance_date?: string
          amount?: number
          created_at?: string
          description?: string | null
          employee_id?: string
          id?: string
          receipt_url?: string | null
          status?: string
          time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_bank_hours: {
        Row: {
          balance_after: number
          created_at: string
          date: string
          employee_id: string
          hours_added: number
          hours_removed: number
          id: string
          reason: string | null
        }
        Insert: {
          balance_after: number
          created_at?: string
          date: string
          employee_id: string
          hours_added?: number
          hours_removed?: number
          id?: string
          reason?: string | null
        }
        Update: {
          balance_after?: number
          created_at?: string
          date?: string
          employee_id?: string
          hours_added?: number
          hours_removed?: number
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      employee_payroll: {
        Row: {
          base_salary: number
          created_at: string
          deductions_amount: number
          employee_id: string
          id: string
          net_salary: number
          overtime_amount: number
          period_date: string
          status: string
          updated_at: string
        }
        Insert: {
          base_salary?: number
          created_at?: string
          deductions_amount?: number
          employee_id: string
          id?: string
          net_salary?: number
          overtime_amount?: number
          period_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          base_salary?: number
          created_at?: string
          deductions_amount?: number
          employee_id?: string
          id?: string
          net_salary?: number
          overtime_amount?: number
          period_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_skills: {
        Row: {
          created_at: string | null
          employee_id: string | null
          id: string
          proficiency_level: number | null
          skill_name: string
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          id?: string
          proficiency_level?: number | null
          skill_name: string
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          id?: string
          proficiency_level?: number | null
          skill_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_skills_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean
          admission_date: string | null
          created_at: string
          department: string | null
          external_id: string | null
          id: string
          name: string
          notes: string | null
          overtime_hourly_rate: number | null
          phone: string | null
          pix_key: string | null
          pix_type: string | null
          role: string | null
          salary: number
          updated_at: string
          whatsapp: string | null
          work_schedule_id: string | null
        }
        Insert: {
          active?: boolean
          admission_date?: string | null
          created_at?: string
          department?: string | null
          external_id?: string | null
          id?: string
          name: string
          notes?: string | null
          overtime_hourly_rate?: number | null
          phone?: string | null
          pix_key?: string | null
          pix_type?: string | null
          role?: string | null
          salary?: number
          updated_at?: string
          whatsapp?: string | null
          work_schedule_id?: string | null
        }
        Update: {
          active?: boolean
          admission_date?: string | null
          created_at?: string
          department?: string | null
          external_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          overtime_hourly_rate?: number | null
          phone?: string | null
          pix_key?: string | null
          pix_type?: string | null
          role?: string | null
          salary?: number
          updated_at?: string
          whatsapp?: string | null
          work_schedule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_work_schedule_id_fkey"
            columns: ["work_schedule_id"]
            isOneToOne: false
            referencedRelation: "work_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          acquisition_date: string | null
          code: string | null
          created_at: string
          id: string
          manufacturer: string | null
          model: string | null
          name: string
          notes: string | null
          sector: string | null
          serial_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          acquisition_date?: string | null
          code?: string | null
          created_at?: string
          id?: string
          manufacturer?: string | null
          model?: string | null
          name: string
          notes?: string | null
          sector?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          acquisition_date?: string | null
          code?: string | null
          created_at?: string
          id?: string
          manufacturer?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          sector?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      equipment_downtime: {
        Row: {
          created_at: string | null
          end_time: string | null
          equipment_id: string | null
          id: string
          impacted_order_id: string | null
          reason: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          end_time?: string | null
          equipment_id?: string | null
          id?: string
          impacted_order_id?: string | null
          reason: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          end_time?: string | null
          equipment_id?: string | null
          id?: string
          impacted_order_id?: string | null
          reason?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_downtime_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "production_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_downtime_impacted_order_id_fkey"
            columns: ["impacted_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_downtime_impacted_order_id_fkey"
            columns: ["impacted_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "equipment_downtime_impacted_order_id_fkey"
            columns: ["impacted_order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_downtime_impacted_order_id_fkey"
            columns: ["impacted_order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
        ]
      }
      factoring_config: {
        Row: {
          active: boolean
          created_at: string
          id: string
          monthly_interest_rate: number
          name: string
          notes: string | null
          receiving_days: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_interest_rate?: number
          name?: string
          notes?: string | null
          receiving_days?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_interest_rate?: number
          name?: string
          notes?: string | null
          receiving_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      finance_attachments: {
        Row: {
          account_id: string
          account_type: string
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          uploaded_by: string | null
        }
        Insert: {
          account_id: string
          account_type: string
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          account_id?: string
          account_type?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      financial_entries: {
        Row: {
          account_id: string | null
          amount: number
          bank_account_id: string | null
          collection: string | null
          cost_center_id: string | null
          created_at: string
          description: string
          entry_date: string
          id: string
          notes: string | null
          reconciled: boolean
          reconciled_at: string | null
          reference_id: string | null
          reference_type: string | null
          sku: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount?: number
          bank_account_id?: string | null
          collection?: string | null
          cost_center_id?: string | null
          created_at?: string
          description?: string
          entry_date?: string
          id?: string
          notes?: string | null
          reconciled?: boolean
          reconciled_at?: string | null
          reference_id?: string | null
          reference_type?: string | null
          sku?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          bank_account_id?: string | null
          collection?: string | null
          cost_center_id?: string | null
          created_at?: string
          description?: string
          entry_date?: string
          id?: string
          notes?: string | null
          reconciled?: boolean
          reconciled_at?: string | null
          reference_id?: string | null
          reference_type?: string | null
          sku?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      finished_goods_receipts: {
        Row: {
          cost_per_unit: number
          created_at: string
          id: string
          inspected_at: string | null
          inspected_by: string | null
          inspection_status: string
          lot_number: string | null
          notes: string | null
          order_id: string
          production_date: string | null
          quantity_good: number
          quantity_rework: number
          quantity_scrap: number
          receipt_number: string
          received_at: string | null
          received_by: string | null
          sale_order_id: string | null
          total_cost: number
          updated_at: string
        }
        Insert: {
          cost_per_unit?: number
          created_at?: string
          id?: string
          inspected_at?: string | null
          inspected_by?: string | null
          inspection_status?: string
          lot_number?: string | null
          notes?: string | null
          order_id: string
          production_date?: string | null
          quantity_good?: number
          quantity_rework?: number
          quantity_scrap?: number
          receipt_number?: string
          received_at?: string | null
          received_by?: string | null
          sale_order_id?: string | null
          total_cost?: number
          updated_at?: string
        }
        Update: {
          cost_per_unit?: number
          created_at?: string
          id?: string
          inspected_at?: string | null
          inspected_by?: string | null
          inspection_status?: string
          lot_number?: string | null
          notes?: string | null
          order_id?: string
          production_date?: string | null
          quantity_good?: number
          quantity_rework?: number
          quantity_scrap?: number
          receipt_number?: string
          received_at?: string | null
          received_by?: string | null
          sale_order_id?: string | null
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finished_goods_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "finished_goods_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "finished_goods_receipts_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "finished_goods_receipts_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_receipts_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      fiscal_config: {
        Row: {
          ambiente: string
          bairro: string
          cep: string
          certificate_path: string | null
          cfop: string
          cidade: string
          cnpj: string
          codigo_municipio: string
          complemento: string
          created_at: string
          id: string
          inscricao_estadual: string
          logradouro: string
          natureza_operacao: string
          nome_fantasia: string
          numero: string
          razao_social: string
          regime_tributario: string
          serie_nfe: number
          uf: string
          updated_at: string
        }
        Insert: {
          ambiente?: string
          bairro?: string
          cep?: string
          certificate_path?: string | null
          cfop?: string
          cidade?: string
          cnpj?: string
          codigo_municipio?: string
          complemento?: string
          created_at?: string
          id?: string
          inscricao_estadual?: string
          logradouro?: string
          natureza_operacao?: string
          nome_fantasia?: string
          numero?: string
          razao_social?: string
          regime_tributario?: string
          serie_nfe?: number
          uf?: string
          updated_at?: string
        }
        Update: {
          ambiente?: string
          bairro?: string
          cep?: string
          certificate_path?: string | null
          cfop?: string
          cidade?: string
          cnpj?: string
          codigo_municipio?: string
          complemento?: string
          created_at?: string
          id?: string
          inscricao_estadual?: string
          logradouro?: string
          natureza_operacao?: string
          nome_fantasia?: string
          numero?: string
          razao_social?: string
          regime_tributario?: string
          serie_nfe?: number
          uf?: string
          updated_at?: string
        }
        Relationships: []
      }
      goods_issue_items: {
        Row: {
          bin_location: string | null
          created_at: string
          goods_issue_id: string
          id: string
          lot_number: string | null
          product_id: string | null
          product_name: string
          product_sku: string | null
          quantity: number
          reservation_id: string | null
          total_cost: number
          unit: string | null
          unit_cost: number
        }
        Insert: {
          bin_location?: string | null
          created_at?: string
          goods_issue_id: string
          id?: string
          lot_number?: string | null
          product_id?: string | null
          product_name?: string
          product_sku?: string | null
          quantity?: number
          reservation_id?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
        }
        Update: {
          bin_location?: string | null
          created_at?: string
          goods_issue_id?: string
          id?: string
          lot_number?: string | null
          product_id?: string | null
          product_name?: string
          product_sku?: string | null
          quantity?: number
          reservation_id?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_issue_items_goods_issue_id_fkey"
            columns: ["goods_issue_id"]
            isOneToOne: false
            referencedRelation: "goods_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "goods_issue_items_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "material_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_issues: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          issue_number: string
          issue_type: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          order_id: string
          reversed_at: string | null
          reversed_by: string | null
          sale_order_id: string | null
          status: string
          total_value: number
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          issue_number?: string
          issue_type?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          order_id: string
          reversed_at?: string | null
          reversed_by?: string | null
          sale_order_id?: string | null
          status?: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          issue_number?: string
          issue_type?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          order_id?: string
          reversed_at?: string | null
          reversed_by?: string | null
          sale_order_id?: string | null
          status?: string
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_issues_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issues_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "goods_issues_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issues_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "goods_issues_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "goods_issues_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issues_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      group_colors: {
        Row: {
          color_id: string
          created_at: string
          group_id: string
          id: string
        }
        Insert: {
          color_id: string
          created_at?: string
          group_id: string
          id?: string
        }
        Update: {
          color_id?: string
          created_at?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_colors_color_id_fkey"
            columns: ["color_id"]
            isOneToOne: false
            referencedRelation: "colors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_colors_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_supplier_materials: {
        Row: {
          active: boolean
          color: string | null
          composition: string | null
          created_at: string
          group_id: string
          id: string
          invoice_date: string | null
          invoice_key: string | null
          invoice_number: string | null
          invoice_value: number | null
          material_code: string | null
          material_name: string
          minimum_order: number | null
          notes: string | null
          stock_available: number | null
          supplier_id: string
          thickness: string | null
          unit: string
          unit_price: number
          updated_at: string
          weight: string | null
          width: string | null
        }
        Insert: {
          active?: boolean
          color?: string | null
          composition?: string | null
          created_at?: string
          group_id: string
          id?: string
          invoice_date?: string | null
          invoice_key?: string | null
          invoice_number?: string | null
          invoice_value?: number | null
          material_code?: string | null
          material_name?: string
          minimum_order?: number | null
          notes?: string | null
          stock_available?: number | null
          supplier_id: string
          thickness?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
          weight?: string | null
          width?: string | null
        }
        Update: {
          active?: boolean
          color?: string | null
          composition?: string | null
          created_at?: string
          group_id?: string
          id?: string
          invoice_date?: string | null
          invoice_key?: string | null
          invoice_number?: string | null
          invoice_value?: number | null
          material_code?: string | null
          material_name?: string
          minimum_order?: number | null
          notes?: string | null
          stock_available?: number | null
          supplier_id?: string
          thickness?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
          weight?: string | null
          width?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_supplier_materials_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_supplier_materials_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "group_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      group_suppliers: {
        Row: {
          created_at: string
          group_id: string
          id: string
          lead_time_days: number | null
          min_free_shipping: number | null
          notes: string | null
          payment_terms: string | null
          standard_shipping_cost: number | null
          supplier_address: string | null
          supplier_cnpj: string | null
          supplier_contact: string | null
          supplier_email: string | null
          supplier_name: string
          supplier_phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          lead_time_days?: number | null
          min_free_shipping?: number | null
          notes?: string | null
          payment_terms?: string | null
          standard_shipping_cost?: number | null
          supplier_address?: string | null
          supplier_cnpj?: string | null
          supplier_contact?: string | null
          supplier_email?: string | null
          supplier_name?: string
          supplier_phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          lead_time_days?: number | null
          min_free_shipping?: number | null
          notes?: string | null
          payment_terms?: string | null
          standard_shipping_cost?: number | null
          supplier_address?: string | null
          supplier_cnpj?: string | null
          supplier_contact?: string | null
          supplier_email?: string | null
          supplier_name?: string
          supplier_phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_suppliers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          name: string
          recurring: boolean
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          name: string
          recurring?: boolean
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          name?: string
          recurring?: boolean
        }
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          product_id: string | null
          quantity: number
          reference_id: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          product_id?: string | null
          quantity: number
          reference_id?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          product_id?: string | null
          quantity?: number
          reference_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          added_to_stock: boolean
          cfop: string | null
          created_at: string
          discount: number | null
          id: string
          invoice_id: string
          ncm: string | null
          product_code: string | null
          product_id: string | null
          product_name: string
          quantity: number
          total_price: number
          unit: string | null
          unit_price: number
        }
        Insert: {
          added_to_stock?: boolean
          cfop?: string | null
          created_at?: string
          discount?: number | null
          id?: string
          invoice_id: string
          ncm?: string | null
          product_code?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          total_price?: number
          unit?: string | null
          unit_price?: number
        }
        Update: {
          added_to_stock?: boolean
          cfop?: string | null
          created_at?: string
          discount?: number | null
          id?: string
          invoice_id?: string
          ncm?: string | null
          product_code?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          total_price?: number
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_price_history"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          discount_value: number | null
          freight_value: number | null
          id: string
          invoice_key: string | null
          invoice_number: string
          invoice_series: string | null
          issue_date: string | null
          notes: string | null
          status: string
          supplier_id: string | null
          total_value: number
          updated_at: string
          xml_data: string | null
        }
        Insert: {
          created_at?: string
          discount_value?: number | null
          freight_value?: number | null
          id?: string
          invoice_key?: string | null
          invoice_number?: string
          invoice_series?: string | null
          issue_date?: string | null
          notes?: string | null
          status?: string
          supplier_id?: string | null
          total_value?: number
          updated_at?: string
          xml_data?: string | null
        }
        Update: {
          created_at?: string
          discount_value?: number | null
          freight_value?: number | null
          id?: string
          invoice_key?: string | null
          invoice_number?: string
          invoice_series?: string | null
          issue_date?: string | null
          notes?: string | null
          status?: string
          supplier_id?: string | null
          total_value?: number
          updated_at?: string
          xml_data?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      item_types: {
        Row: {
          active: boolean | null
          altura_cm: number | null
          comprimento_cm: number | null
          created_at: string | null
          id: string
          largura_cm: number | null
          nome: string
          peso_kg: number | null
          updated_at: string | null
          volume_cm3: number | null
        }
        Insert: {
          active?: boolean | null
          altura_cm?: number | null
          comprimento_cm?: number | null
          created_at?: string | null
          id?: string
          largura_cm?: number | null
          nome: string
          peso_kg?: number | null
          updated_at?: string | null
          volume_cm3?: number | null
        }
        Update: {
          active?: boolean | null
          altura_cm?: number | null
          comprimento_cm?: number | null
          created_at?: string | null
          id?: string
          largura_cm?: number | null
          nome?: string
          peso_kg?: number | null
          updated_at?: string | null
          volume_cm3?: number | null
        }
        Relationships: []
      }
      label_templates: {
        Row: {
          created_at: string
          height_mm: number
          id: string
          is_active: boolean | null
          layout_config: Json
          name: string
          type: string
          width_mm: number
        }
        Insert: {
          created_at?: string
          height_mm: number
          id?: string
          is_active?: boolean | null
          layout_config: Json
          name: string
          type: string
          width_mm: number
        }
        Update: {
          created_at?: string
          height_mm?: number
          id?: string
          is_active?: boolean | null
          layout_config?: Json
          name?: string
          type?: string
          width_mm?: number
        }
        Relationships: []
      }
      labor_costs: {
        Row: {
          active: boolean
          cost_center_id: string | null
          created_at: string
          hour_cost: number
          id: string
          notes: string | null
          operation_name: string
          time_per_unit_minutes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          cost_center_id?: string | null
          created_at?: string
          hour_cost?: number
          id?: string
          notes?: string | null
          operation_name: string
          time_per_unit_minutes?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          cost_center_id?: string | null
          created_at?: string
          hour_cost?: number
          id?: string
          notes?: string | null
          operation_name?: string
          time_per_unit_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "labor_costs_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      loading_manifest_items: {
        Row: {
          client_name: string | null
          destination: string | null
          id: string
          manifest_id: string
          nfe_number: string | null
          notes: string | null
          sale_order_id: string | null
          total_pairs: number | null
          valor_nf: number | null
          volumes_count: number | null
          weight_kg: number | null
        }
        Insert: {
          client_name?: string | null
          destination?: string | null
          id?: string
          manifest_id: string
          nfe_number?: string | null
          notes?: string | null
          sale_order_id?: string | null
          total_pairs?: number | null
          valor_nf?: number | null
          volumes_count?: number | null
          weight_kg?: number | null
        }
        Update: {
          client_name?: string | null
          destination?: string | null
          id?: string
          manifest_id?: string
          nfe_number?: string | null
          notes?: string | null
          sale_order_id?: string | null
          total_pairs?: number | null
          valor_nf?: number | null
          volumes_count?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loading_manifest_items_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "loading_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loading_manifest_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "loading_manifest_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loading_manifest_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      loading_manifests: {
        Row: {
          created_at: string | null
          created_by: string | null
          dispatch_date: string
          driver_name: string | null
          id: string
          manifest_number: string
          notes: string | null
          status: string | null
          total_pairs: number | null
          total_volume_m3: number | null
          total_weight_kg: number | null
          transport_company_id: string | null
          updated_at: string | null
          vehicle_plate: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          dispatch_date?: string
          driver_name?: string | null
          id?: string
          manifest_number: string
          notes?: string | null
          status?: string | null
          total_pairs?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          transport_company_id?: string | null
          updated_at?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          dispatch_date?: string
          driver_name?: string | null
          id?: string
          manifest_number?: string
          notes?: string | null
          status?: string | null
          total_pairs?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          transport_company_id?: string | null
          updated_at?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loading_manifests_transport_company_id_fkey"
            columns: ["transport_company_id"]
            isOneToOne: false
            referencedRelation: "transport_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      lot_tracking: {
        Row: {
          bin_location_id: string | null
          created_at: string
          expiry_date: string | null
          id: string
          invoice_id: string | null
          lot_number: string
          notes: string | null
          product_id: string
          quantity_available: number
          quantity_consumed: number
          quantity_received: number
          received_date: string | null
          status: string
          supplier_id: string | null
          supplier_lot: string | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          bin_location_id?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          invoice_id?: string | null
          lot_number?: string
          notes?: string | null
          product_id: string
          quantity_available?: number
          quantity_consumed?: number
          quantity_received?: number
          received_date?: string | null
          status?: string
          supplier_id?: string | null
          supplier_lot?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          bin_location_id?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          invoice_id?: string | null
          lot_number?: string
          notes?: string | null
          product_id?: string
          quantity_available?: number
          quantity_consumed?: number
          quantity_received?: number
          received_date?: string | null
          status?: string
          supplier_id?: string | null
          supplier_lot?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lot_tracking_bin_location_id_fkey"
            columns: ["bin_location_id"]
            isOneToOne: false
            referencedRelation: "bin_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_price_history"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "lot_tracking_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      maintenance_logs: {
        Row: {
          cost: number | null
          created_at: string
          description: string
          equipment_id: string
          id: string
          notes: string | null
          performed_at: string
          performed_by: string | null
          plan_id: string | null
          type: string
        }
        Insert: {
          cost?: number | null
          created_at?: string
          description: string
          equipment_id: string
          id?: string
          notes?: string | null
          performed_at?: string
          performed_by?: string | null
          plan_id?: string | null
          type?: string
        }
        Update: {
          cost?: number | null
          created_at?: string
          description?: string
          equipment_id?: string
          id?: string
          notes?: string | null
          performed_at?: string
          performed_by?: string | null
          plan_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_logs_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_logs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "maintenance_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_plans: {
        Row: {
          created_at: string
          description: string
          equipment_id: string
          frequency_days: number
          id: string
          is_active: boolean
          last_performed_at: string | null
          next_due_at: string | null
          responsible: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          equipment_id: string
          frequency_days?: number
          id?: string
          is_active?: boolean
          last_performed_at?: string | null
          next_due_at?: string | null
          responsible?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          equipment_id?: string
          frequency_days?: number
          id?: string
          is_active?: boolean
          last_performed_at?: string | null
          next_due_at?: string | null
          responsible?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_plans_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      material_audit_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string | null
          id: string
          new_stock: number | null
          previous_stock: number | null
          product_id: string | null
          product_name: string
          product_sku: string | null
          quantity_change: number | null
          reversed: boolean | null
          reversed_at: string | null
          reversed_by: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string | null
          id?: string
          new_stock?: number | null
          previous_stock?: number | null
          product_id?: string | null
          product_name: string
          product_sku?: string | null
          quantity_change?: number | null
          reversed?: boolean | null
          reversed_at?: string | null
          reversed_by?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string | null
          id?: string
          new_stock?: number | null
          previous_stock?: number | null
          product_id?: string | null
          product_name?: string
          product_sku?: string | null
          quantity_change?: number | null
          reversed?: boolean | null
          reversed_at?: string | null
          reversed_by?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      material_color_groups: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      material_reservations: {
        Row: {
          batch_id: string | null
          consumed_at: string | null
          created_at: string
          expedite: boolean
          id: string
          location: string | null
          lot_number: string | null
          notes: string | null
          order_id: string
          product_id: string
          quantity_consumed: number
          quantity_reserved: number
          reservation_type: string
          reserved_by: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          consumed_at?: string | null
          created_at?: string
          expedite?: boolean
          id?: string
          location?: string | null
          lot_number?: string | null
          notes?: string | null
          order_id: string
          product_id: string
          quantity_consumed?: number
          quantity_reserved?: number
          reservation_type?: string
          reserved_by?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          consumed_at?: string | null
          created_at?: string
          expedite?: boolean
          id?: string
          location?: string | null
          lot_number?: string | null
          notes?: string | null
          order_id?: string
          product_id?: string
          quantity_consumed?: number
          quantity_reserved?: number
          reservation_type?: string
          reserved_by?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "material_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      materials: {
        Row: {
          category: string | null
          created_at: string | null
          default_supplier_id: string | null
          id: string
          last_price: number | null
          lead_time_days: number | null
          name: string
          stock_actual: number | null
          stock_min: number | null
          unit_measure: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          default_supplier_id?: string | null
          id?: string
          last_price?: number | null
          lead_time_days?: number | null
          name: string
          stock_actual?: number | null
          stock_min?: number | null
          unit_measure?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          default_supplier_id?: string | null
          id?: string
          last_price?: number | null
          lead_time_days?: number | null
          name?: string
          stock_actual?: number | null
          stock_min?: number | null
          unit_measure?: string | null
        }
        Relationships: []
      }
      mrp_suggestions: {
        Row: {
          available_quantity: number
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          order_id: string | null
          priority: string
          product_id: string | null
          product_name: string | null
          required_quantity: number
          resolved_at: string | null
          resolved_by: string | null
          sale_order_id: string | null
          shortage_quantity: number
          status: string
          suggestion_type: string
          updated_at: string
        }
        Insert: {
          available_quantity?: number
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          priority?: string
          product_id?: string | null
          product_name?: string | null
          required_quantity?: number
          resolved_at?: string | null
          resolved_by?: string | null
          sale_order_id?: string | null
          shortage_quantity?: number
          status?: string
          suggestion_type?: string
          updated_at?: string
        }
        Update: {
          available_quantity?: number
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          priority?: string
          product_id?: string | null
          product_name?: string | null
          required_quantity?: number
          resolved_at?: string | null
          resolved_by?: string | null
          sale_order_id?: string | null
          shortage_quantity?: number
          status?: string
          suggestion_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mrp_suggestions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrp_suggestions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrp_suggestions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrp_suggestions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      nfe_emitidas: {
        Row: {
          chave_acesso: string | null
          cnpj_emitente: string | null
          company_id: string | null
          created_at: string
          danfe_url: string | null
          data_cancelamento: string | null
          data_emissao: string | null
          id: string
          idempotency_key: string | null
          justificativa_cancelamento: string | null
          motivo_rejeicao: string | null
          numero: string | null
          protocolo: string | null
          protocolo_cancelamento: string | null
          ref_nfe: string
          sale_order_id: string | null
          serie: string | null
          status: string
          updated_at: string
          valor_total: number
          xml_url: string | null
        }
        Insert: {
          chave_acesso?: string | null
          cnpj_emitente?: string | null
          company_id?: string | null
          created_at?: string
          danfe_url?: string | null
          data_cancelamento?: string | null
          data_emissao?: string | null
          id?: string
          idempotency_key?: string | null
          justificativa_cancelamento?: string | null
          motivo_rejeicao?: string | null
          numero?: string | null
          protocolo?: string | null
          protocolo_cancelamento?: string | null
          ref_nfe?: string
          sale_order_id?: string | null
          serie?: string | null
          status?: string
          updated_at?: string
          valor_total?: number
          xml_url?: string | null
        }
        Update: {
          chave_acesso?: string | null
          cnpj_emitente?: string | null
          company_id?: string | null
          created_at?: string
          danfe_url?: string | null
          data_cancelamento?: string | null
          data_emissao?: string | null
          id?: string
          idempotency_key?: string | null
          justificativa_cancelamento?: string | null
          motivo_rejeicao?: string | null
          numero?: string | null
          protocolo?: string | null
          protocolo_cancelamento?: string | null
          ref_nfe?: string
          sale_order_id?: string | null
          serie?: string | null
          status?: string
          updated_at?: string
          valor_total?: number
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_emitidas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_emitidas_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "nfe_emitidas_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_emitidas_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          message: string
          read: boolean | null
          sector: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          read?: boolean | null
          sector?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          read?: boolean | null
          sector?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      order_costs: {
        Row: {
          breakdown: Json
          calculated_at: string
          color: string | null
          id: string
          labor_cost: number
          margin: number
          margin_pct: number
          material_cost: number
          overhead_cost: number
          packaging_cost: number | null
          quantity: number
          reference_id: string | null
          revenue: number
          sale_order_id: string
          sale_order_item_id: string | null
          total_cost: number
        }
        Insert: {
          breakdown?: Json
          calculated_at?: string
          color?: string | null
          id?: string
          labor_cost?: number
          margin?: number
          margin_pct?: number
          material_cost?: number
          overhead_cost?: number
          packaging_cost?: number | null
          quantity: number
          reference_id?: string | null
          revenue?: number
          sale_order_id: string
          sale_order_item_id?: string | null
          total_cost?: number
        }
        Update: {
          breakdown?: Json
          calculated_at?: string
          color?: string | null
          id?: string
          labor_cost?: number
          margin?: number
          margin_pct?: number
          material_cost?: number
          overhead_cost?: number
          packaging_cost?: number | null
          quantity?: number
          reference_id?: string | null
          revenue?: number
          sale_order_id?: string
          sale_order_item_id?: string | null
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_costs_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_costs_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "order_costs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "order_costs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_costs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      order_stages: {
        Row: {
          actual_time_minutes: number | null
          completed_at: string | null
          completed_by: string | null
          cost_per_hour: number | null
          cost_per_pair: number | null
          created_at: string
          defects: string | null
          id: string
          observations: string | null
          order_id: string
          quantity_processed: number
          quantity_total: number
          stage_name: string
          stage_order: number
          standard_time_minutes: number | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_time_minutes?: number | null
          completed_at?: string | null
          completed_by?: string | null
          cost_per_hour?: number | null
          cost_per_pair?: number | null
          created_at?: string
          defects?: string | null
          id?: string
          observations?: string | null
          order_id: string
          quantity_processed?: number
          quantity_total?: number
          stage_name: string
          stage_order?: number
          standard_time_minutes?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_time_minutes?: number | null
          completed_at?: string | null
          completed_by?: string | null
          cost_per_hour?: number | null
          cost_per_pair?: number | null
          created_at?: string
          defects?: string | null
          id?: string
          observations?: string | null
          order_id?: string
          quantity_processed?: number
          quantity_total?: number
          stage_name?: string
          stage_order?: number
          standard_time_minutes?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
        ]
      }
      orders: {
        Row: {
          actual_cost_per_pair: number | null
          color: string | null
          cost_variance: number | null
          created_at: string
          grade: Json | null
          id: string
          is_ahead_of_schedule: boolean | null
          item_observation: string | null
          labor_cost: number | null
          last_sector_finished_at: string | null
          material_cost: number | null
          material_status: string | null
          mod_cost: number | null
          notes: string | null
          order_number: string
          overhead_cost: number | null
          packaging_product_id: string | null
          packaging_quantity: number
          packaging_type: string
          planned_delivery: string | null
          planned_start: string | null
          production_line: string | null
          production_step: string | null
          quantity: number
          reference_id: string
          responsible: string | null
          sale_order_id: string
          sale_order_item_id: string | null
          standard_cost_per_pair: number | null
          status: string
          total_production_cost: number | null
          updated_at: string
        }
        Insert: {
          actual_cost_per_pair?: number | null
          color?: string | null
          cost_variance?: number | null
          created_at?: string
          grade?: Json | null
          id?: string
          is_ahead_of_schedule?: boolean | null
          item_observation?: string | null
          labor_cost?: number | null
          last_sector_finished_at?: string | null
          material_cost?: number | null
          material_status?: string | null
          mod_cost?: number | null
          notes?: string | null
          order_number?: string
          overhead_cost?: number | null
          packaging_product_id?: string | null
          packaging_quantity?: number
          packaging_type?: string
          planned_delivery?: string | null
          planned_start?: string | null
          production_line?: string | null
          production_step?: string | null
          quantity?: number
          reference_id: string
          responsible?: string | null
          sale_order_id: string
          sale_order_item_id?: string | null
          standard_cost_per_pair?: number | null
          status?: string
          total_production_cost?: number | null
          updated_at?: string
        }
        Update: {
          actual_cost_per_pair?: number | null
          color?: string | null
          cost_variance?: number | null
          created_at?: string
          grade?: Json | null
          id?: string
          is_ahead_of_schedule?: boolean | null
          item_observation?: string | null
          labor_cost?: number | null
          last_sector_finished_at?: string | null
          material_cost?: number | null
          material_status?: string | null
          mod_cost?: number | null
          notes?: string | null
          order_number?: string
          overhead_cost?: number | null
          packaging_product_id?: string | null
          packaging_quantity?: number
          packaging_type?: string
          planned_delivery?: string | null
          planned_start?: string | null
          production_line?: string | null
          production_step?: string | null
          quantity?: number
          reference_id?: string
          responsible?: string | null
          sale_order_id?: string
          sale_order_item_id?: string | null
          standard_cost_per_pair?: number | null
          status?: string
          total_production_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_item_id_fkey"
            columns: ["sale_order_item_id"]
            isOneToOne: false
            referencedRelation: "sale_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      overhead_allocations: {
        Row: {
          allocation_base: string
          cost_center_id: string | null
          cost_type: string
          created_at: string
          id: string
          notes: string | null
          period: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          allocation_base?: string
          cost_center_id?: string | null
          cost_type?: string
          created_at?: string
          id?: string
          notes?: string | null
          period?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          allocation_base?: string
          cost_center_id?: string | null
          cost_type?: string
          created_at?: string
          id?: string
          notes?: string | null
          period?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "overhead_allocations_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_catalog: {
        Row: {
          altura_ext: number | null
          capacidade_pares: number | null
          comprimento_ext: number | null
          created_at: string
          id: string
          is_active: boolean | null
          largura_ext: number | null
          nome: string
          tipo: string | null
          updated_at: string
        }
        Insert: {
          altura_ext?: number | null
          capacidade_pares?: number | null
          comprimento_ext?: number | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          largura_ext?: number | null
          nome: string
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          altura_ext?: number | null
          capacidade_pares?: number | null
          comprimento_ext?: number | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          largura_ext?: number | null
          nome?: string
          tipo?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      packaging_configs: {
        Row: {
          active: boolean
          altura_cm: number
          box_type_id: string | null
          can_be_inverted: boolean
          can_be_rotated: boolean
          comprimento_cm: number
          cost_per_unit: number | null
          created_at: string
          ext_altura_cm: number | null
          ext_comprimento_cm: number | null
          ext_largura_cm: number | null
          fragile_sides: Json | null
          id: string
          label_config: Json | null
          largura_cm: number
          material: string
          max_stack_height: number | null
          max_weight_kg: number | null
          minimum_order: number | null
          nome: string
          notes: string | null
          packaging_type: string
          padding_material: string | null
          padding_required: boolean
          padding_thickness_mm: number | null
          pairs_per_box: number
          peso_kg: number | null
          product_id: string | null
          protection_level: string
          sheet_id: string | null
          sole_group_id: string | null
          sole_product_id: string | null
          stackable: boolean
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          altura_cm?: number
          box_type_id?: string | null
          can_be_inverted?: boolean
          can_be_rotated?: boolean
          comprimento_cm?: number
          cost_per_unit?: number | null
          created_at?: string
          ext_altura_cm?: number | null
          ext_comprimento_cm?: number | null
          ext_largura_cm?: number | null
          fragile_sides?: Json | null
          id?: string
          label_config?: Json | null
          largura_cm?: number
          material?: string
          max_stack_height?: number | null
          max_weight_kg?: number | null
          minimum_order?: number | null
          nome?: string
          notes?: string | null
          packaging_type?: string
          padding_material?: string | null
          padding_required?: boolean
          padding_thickness_mm?: number | null
          pairs_per_box?: number
          peso_kg?: number | null
          product_id?: string | null
          protection_level?: string
          sheet_id?: string | null
          sole_group_id?: string | null
          sole_product_id?: string | null
          stackable?: boolean
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          altura_cm?: number
          box_type_id?: string | null
          can_be_inverted?: boolean
          can_be_rotated?: boolean
          comprimento_cm?: number
          cost_per_unit?: number | null
          created_at?: string
          ext_altura_cm?: number | null
          ext_comprimento_cm?: number | null
          ext_largura_cm?: number | null
          fragile_sides?: Json | null
          id?: string
          label_config?: Json | null
          largura_cm?: number
          material?: string
          max_stack_height?: number | null
          max_weight_kg?: number | null
          minimum_order?: number | null
          nome?: string
          notes?: string | null
          packaging_type?: string
          padding_material?: string | null
          padding_required?: boolean
          padding_thickness_mm?: number | null
          pairs_per_box?: number
          peso_kg?: number | null
          product_id?: string | null
          protection_level?: string
          sheet_id?: string | null
          sole_group_id?: string | null
          sole_product_id?: string | null
          stackable?: boolean
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_configs_box_type_id_fkey"
            columns: ["box_type_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "packaging_configs_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "packaging_configs_sole_group_id_fkey"
            columns: ["sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "packaging_configs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      packaging_types: {
        Row: {
          created_at: string | null
          height_cm: number | null
          id: string
          is_active: boolean | null
          length_cm: number | null
          max_capacity_pairs: number | null
          name: string
          type: string | null
          updated_at: string | null
          width_cm: number | null
        }
        Insert: {
          created_at?: string | null
          height_cm?: number | null
          id?: string
          is_active?: boolean | null
          length_cm?: number | null
          max_capacity_pairs?: number | null
          name: string
          type?: string | null
          updated_at?: string | null
          width_cm?: number | null
        }
        Update: {
          created_at?: string | null
          height_cm?: number | null
          id?: string
          is_active?: boolean | null
          length_cm?: number | null
          max_capacity_pairs?: number | null
          name?: string
          type?: string | null
          updated_at?: string | null
          width_cm?: number | null
        }
        Relationships: []
      }
      picking_list_items: {
        Row: {
          created_at: string
          id: string
          location: string | null
          lot_number: string | null
          picked: boolean | null
          picked_at: string | null
          picked_by: string | null
          picking_list_id: string
          product_id: string
          quantity_picked: number
          quantity_required: number
          reservation_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          lot_number?: string | null
          picked?: boolean | null
          picked_at?: string | null
          picked_by?: string | null
          picking_list_id: string
          product_id: string
          quantity_picked?: number
          quantity_required?: number
          reservation_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          lot_number?: string | null
          picked?: boolean | null
          picked_at?: string | null
          picked_by?: string | null
          picking_list_id?: string
          product_id?: string
          quantity_picked?: number
          quantity_required?: number
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "picking_list_items_picking_list_id_fkey"
            columns: ["picking_list_id"]
            isOneToOne: false
            referencedRelation: "picking_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "picking_list_items_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "material_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      picking_lists: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          order_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "picking_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "picking_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
        ]
      }
      print_job_items: {
        Row: {
          color: string | null
          id: string
          print_job_id: string | null
          quantity: number | null
          reference_id: string | null
          serial_end: string | null
          serial_start: string | null
          size: string | null
        }
        Insert: {
          color?: string | null
          id?: string
          print_job_id?: string | null
          quantity?: number | null
          reference_id?: string | null
          serial_end?: string | null
          serial_start?: string | null
          size?: string | null
        }
        Update: {
          color?: string | null
          id?: string
          print_job_id?: string | null
          quantity?: number | null
          reference_id?: string | null
          serial_end?: string | null
          serial_start?: string | null
          size?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_job_items_print_job_id_fkey"
            columns: ["print_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_job_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "product_references"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          batch_name: string | null
          created_at: string
          id: string
          order_ids: Json | null
          status: string | null
          template_id: string | null
          total_labels: number | null
          user_id: string | null
        }
        Insert: {
          batch_name?: string | null
          created_at?: string
          id?: string
          order_ids?: Json | null
          status?: string | null
          template_id?: string | null
          total_labels?: number | null
          user_id?: string | null
        }
        Update: {
          batch_name?: string | null
          created_at?: string
          id?: string
          order_ids?: Json | null
          status?: string | null
          template_id?: string | null
          total_labels?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "label_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      product_groups: {
        Row: {
          auto_component_sheet: boolean
          box_type_colmeia_id: string | null
          box_type_fitilho_id: string | null
          box_type_id: string | null
          box_type_master_id: string | null
          calculation_method: string | null
          colors: string | null
          consumption_unit: string | null
          created_at: string
          description: string | null
          dimensions_length: number | null
          dimensions_thickness: number | null
          dimensions_unit: string | null
          dimensions_width: number | null
          id: string
          insole_included: boolean
          is_bom_color_source: boolean
          name: string
          package_price: number | null
          package_weight_kg: number | null
          pairs_per_box_colmeia: number | null
          pairs_per_box_fitilho: number | null
          pairs_per_box_individual: number | null
          pairs_per_box_master: number | null
          parent_group_id: string | null
          metros_fitilho_per_amarrado: number | null
          shared_specs: boolean
          silk_url: string | null
          unit_weight_kg: number | null
          updated_at: string
        }
        Insert: {
          auto_component_sheet?: boolean
          box_type_colmeia_id?: string | null
          box_type_fitilho_id?: string | null
          box_type_id?: string | null
          box_type_master_id?: string | null
          calculation_method?: string | null
          colors?: string | null
          consumption_unit?: string | null
          created_at?: string
          description?: string | null
          dimensions_length?: number | null
          dimensions_thickness?: number | null
          dimensions_unit?: string | null
          dimensions_width?: number | null
          id?: string
          insole_included?: boolean
          is_bom_color_source?: boolean
          name: string
          package_price?: number | null
          package_weight_kg?: number | null
          pairs_per_box_colmeia?: number | null
          pairs_per_box_fitilho?: number | null
          pairs_per_box_individual?: number | null
          pairs_per_box_master?: number | null
          parent_group_id?: string | null
          metros_fitilho_per_amarrado?: number | null
          shared_specs?: boolean
          silk_url?: string | null
          unit_weight_kg?: number | null
          updated_at?: string
        }
        Update: {
          auto_component_sheet?: boolean
          box_type_colmeia_id?: string | null
          box_type_fitilho_id?: string | null
          box_type_id?: string | null
          box_type_master_id?: string | null
          calculation_method?: string | null
          colors?: string | null
          consumption_unit?: string | null
          created_at?: string
          description?: string | null
          dimensions_length?: number | null
          dimensions_thickness?: number | null
          dimensions_unit?: string | null
          dimensions_width?: number | null
          id?: string
          insole_included?: boolean
          is_bom_color_source?: boolean
          name?: string
          package_price?: number | null
          package_weight_kg?: number | null
          pairs_per_box_colmeia?: number | null
          pairs_per_box_fitilho?: number | null
          pairs_per_box_individual?: number | null
          pairs_per_box_master?: number | null
          parent_group_id?: string | null
          metros_fitilho_per_amarrado?: number | null
          shared_specs?: boolean
          silk_url?: string | null
          unit_weight_kg?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_groups_box_type_colmeia_id_fkey"
            columns: ["box_type_colmeia_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_groups_box_type_fitilho_id_fkey"
            columns: ["box_type_fitilho_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_groups_box_type_id_fkey"
            columns: ["box_type_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_groups_box_type_master_id_fkey"
            columns: ["box_type_master_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_groups_parent_group_id_fkey"
            columns: ["parent_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      product_masters: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          main_image_url: string | null
          name: string
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          main_image_url?: string | null
          name: string
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          main_image_url?: string | null
          name?: string
        }
        Relationships: []
      }
      product_price_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_price: number
          previous_price: number
          product_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_price: number
          previous_price: number
          product_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_price?: number
          previous_price?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      product_references: {
        Row: {
          barcode: string | null
          code: string
          collection: string | null
          colors: string | null
          cost_price: number
          created_at: string
          description: string | null
          has_straps: boolean
          id: string
          image_url: string | null
          name: string
          sale_price: number
          shoe_category: string | null
          sizes: string | null
          status: string
          strap_colors: Json | null
          technical_sheet_id: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          code?: string
          collection?: string | null
          colors?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          has_straps?: boolean
          id?: string
          image_url?: string | null
          name: string
          sale_price?: number
          shoe_category?: string | null
          sizes?: string | null
          status?: string
          strap_colors?: Json | null
          technical_sheet_id?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          code?: string
          collection?: string | null
          colors?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          has_straps?: boolean
          id?: string
          image_url?: string | null
          name?: string
          sale_price?: number
          shoe_category?: string | null
          sizes?: string | null
          status?: string
          strap_colors?: Json | null
          technical_sheet_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_references_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_references_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      product_technical_sheets: {
        Row: {
          consumption_per_pair: number
          created_at: string | null
          id: string
          material_id: string | null
          parent_product_id: string | null
          reference_date: string | null
          reference_product_id: string | null
          updated_at: string | null
        }
        Insert: {
          consumption_per_pair: number
          created_at?: string | null
          id?: string
          material_id?: string | null
          parent_product_id?: string | null
          reference_date?: string | null
          reference_product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          consumption_per_pair?: number
          created_at?: string | null
          id?: string
          material_id?: string | null
          parent_product_id?: string | null
          reference_date?: string | null
          reference_product_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      product_variants: {
        Row: {
          active: boolean | null
          color_hex: string | null
          color_name: string | null
          created_at: string | null
          id: string
          master_id: string | null
          size: string | null
          size_eu: string | null
          size_uk: string | null
          size_us: string | null
          sku: string
          unit_price: number | null
          variant_image_url: string | null
        }
        Insert: {
          active?: boolean | null
          color_hex?: string | null
          color_name?: string | null
          created_at?: string | null
          id?: string
          master_id?: string | null
          size?: string | null
          size_eu?: string | null
          size_uk?: string | null
          size_us?: string | null
          sku: string
          unit_price?: number | null
          variant_image_url?: string | null
        }
        Update: {
          active?: boolean | null
          color_hex?: string | null
          color_name?: string | null
          created_at?: string | null
          id?: string
          master_id?: string | null
          size?: string | null
          size_eu?: string | null
          size_uk?: string | null
          size_us?: string | null
          sku?: string
          unit_price?: number | null
          variant_image_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "product_masters"
            referencedColumns: ["id"]
          },
        ]
      }
      production_consumptions: {
        Row: {
          actual_cost: number
          actual_quantity: number
          component_name: string | null
          component_type: string
          created_at: string
          id: string
          notes: string | null
          order_id: string
          product_id: string | null
          standard_cost: number
          standard_quantity: number
          superseded_at: string | null
          superseded_reason: string | null
          updated_at: string
          variance_cost: number | null
          variance_quantity: number | null
        }
        Insert: {
          actual_cost?: number
          actual_quantity?: number
          component_name?: string | null
          component_type?: string
          created_at?: string
          id?: string
          notes?: string | null
          order_id: string
          product_id?: string | null
          standard_cost?: number
          standard_quantity?: number
          superseded_at?: string | null
          superseded_reason?: string | null
          updated_at?: string
          variance_cost?: number | null
          variance_quantity?: number | null
        }
        Update: {
          actual_cost?: number
          actual_quantity?: number
          component_name?: string | null
          component_type?: string
          created_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          product_id?: string | null
          standard_cost?: number
          standard_quantity?: number
          superseded_at?: string | null
          superseded_reason?: string | null
          updated_at?: string
          variance_cost?: number | null
          variance_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_consumptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_consumptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_consumptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_consumptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      production_equipment: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          id: string
          last_maintenance_date: string | null
          name: string
          purchase_date: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          id?: string
          last_maintenance_date?: string | null
          name: string
          purchase_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          id?: string
          last_maintenance_date?: string | null
          name?: string
          purchase_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      production_finishing_packages: {
        Row: {
          color: string | null
          created_at: string
          grade: Json | null
          id: string
          packed_at: string | null
          quantity: number
          reference_id: string | null
          sale_order_id: string | null
          shipped_at: string | null
          status: string
          store_name: string | null
          wave_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          grade?: Json | null
          id?: string
          packed_at?: string | null
          quantity: number
          reference_id?: string | null
          sale_order_id?: string | null
          shipped_at?: string | null
          status?: string
          store_name?: string | null
          wave_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          grade?: Json | null
          id?: string
          packed_at?: string | null
          quantity?: number
          reference_id?: string | null
          sale_order_id?: string | null
          shipped_at?: string | null
          status?: string
          store_name?: string | null
          wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_finishing_packages_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_finishing_packages_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_finishing_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_finishing_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_finishing_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_finishing_packages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "normalized_production_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_finishing_packages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "production_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_finishing_packages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_wave_detail"
            referencedColumns: ["wave_id"]
          },
        ]
      }
      production_orders: {
        Row: {
          created_at: string | null
          current_sector: string | null
          due_date: string
          id: string
          is_priority: boolean | null
          last_sector_finished_at: string | null
          quantity: number
          scheduled_date: string | null
          status: string | null
          updated_at: string | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_sector?: string | null
          due_date: string
          id?: string
          is_priority?: boolean | null
          last_sector_finished_at?: string | null
          quantity: number
          scheduled_date?: string | null
          status?: string | null
          updated_at?: string | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_sector?: string | null
          due_date?: string
          id?: string
          is_priority?: boolean | null
          last_sector_finished_at?: string | null
          quantity?: number
          scheduled_date?: string | null
          status?: string | null
          updated_at?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "vw_production_labels"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      production_wave_item_sources: {
        Row: {
          client_id: string | null
          created_at: string
          grade: Json | null
          id: string
          quantity: number
          sale_order_id: string | null
          sale_order_item_id: string | null
          store_name: string | null
          wave_item_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          grade?: Json | null
          id?: string
          quantity: number
          sale_order_id?: string | null
          sale_order_item_id?: string | null
          store_name?: string | null
          wave_item_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          grade?: Json | null
          id?: string
          quantity?: number
          sale_order_id?: string | null
          sale_order_item_id?: string | null
          store_name?: string | null
          wave_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_wave_item_sources_wave_item_id_fkey"
            columns: ["wave_item_id"]
            isOneToOne: false
            referencedRelation: "production_wave_items"
            referencedColumns: ["id"]
          },
        ]
      }
      production_wave_items: {
        Row: {
          color: string
          created_at: string
          grade: Json | null
          id: string
          reference_id: string
          sole_product_id: string | null
          sort_order: number
          status: Database["public"]["Enums"]["stage_status_enum"]
          total_quantity: number
          wave_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          grade?: Json | null
          id?: string
          reference_id: string
          sole_product_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["stage_status_enum"]
          total_quantity?: number
          wave_id: string
        }
        Update: {
          color?: string
          created_at?: string
          grade?: Json | null
          id?: string
          reference_id?: string
          sole_product_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["stage_status_enum"]
          total_quantity?: number
          wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_wave_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "production_wave_items_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "normalized_production_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "production_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_wave_detail"
            referencedColumns: ["wave_id"]
          },
        ]
      }
      production_wave_rework: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          inspection_id: string | null
          origin_stage: string
          product_ref: string | null
          quantity: number
          reason: string | null
          status: string
          wave_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_id?: string | null
          origin_stage: string
          product_ref?: string | null
          quantity: number
          reason?: string | null
          status?: string
          wave_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_id?: string | null
          origin_stage?: string
          product_ref?: string | null
          quantity?: number
          reason?: string | null
          status?: string
          wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_wave_rework_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_rework_product_ref_fkey"
            columns: ["product_ref"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_rework_product_ref_fkey"
            columns: ["product_ref"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_wave_rework_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "normalized_production_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_rework_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "production_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_rework_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_wave_detail"
            referencedColumns: ["wave_id"]
          },
        ]
      }
      production_wave_stages: {
        Row: {
          capacity_per_day: number
          created_at: string
          finished_at: string | null
          id: string
          notes: string | null
          operator_id: string | null
          produced_quantity: number
          progress_pct: number
          stage: Database["public"]["Enums"]["production_stage_enum"]
          started_at: string | null
          status: Database["public"]["Enums"]["stage_status_enum"]
          updated_at: string
          wave_id: string
        }
        Insert: {
          capacity_per_day?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          notes?: string | null
          operator_id?: string | null
          produced_quantity?: number
          progress_pct?: number
          stage: Database["public"]["Enums"]["production_stage_enum"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["stage_status_enum"]
          updated_at?: string
          wave_id: string
        }
        Update: {
          capacity_per_day?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          notes?: string | null
          operator_id?: string | null
          produced_quantity?: number
          progress_pct?: number
          stage?: Database["public"]["Enums"]["production_stage_enum"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["stage_status_enum"]
          updated_at?: string
          wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_wave_stages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "normalized_production_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_stages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "production_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_stages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_wave_detail"
            referencedColumns: ["wave_id"]
          },
        ]
      }
      production_waves: {
        Row: {
          acabamento_start_date: string | null
          code: string
          colagem_start_date: string | null
          corte_forracao_start_date: string | null
          corte_palmilha_start_date: string | null
          created_at: string
          created_by: string | null
          current_stage:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline: string | null
          finished_at: string | null
          id: string
          material_ready_date: string | null
          mesa_start_date: string | null
          montagem_start_date: string | null
          notes: string | null
          purchase_deadline: string | null
          silk_start_date: string | null
          solagem_start_date: string | null
          start_mode: string
          started_at: string | null
          status: Database["public"]["Enums"]["wave_status_enum"]
          total_items: number
          total_pairs: number
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          acabamento_start_date?: string | null
          code: string
          colagem_start_date?: string | null
          corte_forracao_start_date?: string | null
          corte_palmilha_start_date?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline?: string | null
          finished_at?: string | null
          id?: string
          material_ready_date?: string | null
          mesa_start_date?: string | null
          montagem_start_date?: string | null
          notes?: string | null
          purchase_deadline?: string | null
          silk_start_date?: string | null
          solagem_start_date?: string | null
          start_mode?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["wave_status_enum"]
          total_items?: number
          total_pairs?: number
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          acabamento_start_date?: string | null
          code?: string
          colagem_start_date?: string | null
          corte_forracao_start_date?: string | null
          corte_palmilha_start_date?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline?: string | null
          finished_at?: string | null
          id?: string
          material_ready_date?: string | null
          mesa_start_date?: string | null
          montagem_start_date?: string | null
          notes?: string | null
          purchase_deadline?: string | null
          silk_start_date?: string | null
          solagem_start_date?: string | null
          start_mode?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["wave_status_enum"]
          total_items?: number
          total_pairs?: number
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          box_type_id: string | null
          brand: string | null
          calculation_method: string | null
          category: string
          color: string
          consumption_unit: string | null
          conversion_rate: number | null
          created_at: string
          current_stock: number | null
          dimensions_height: number | null
          dimensions_length: number | null
          dimensions_thickness: number | null
          dimensions_unit: string | null
          dimensions_width: number | null
          expiration_date: string | null
          group_id: string | null
          heel_height: number | null
          id: string
          image_url: string | null
          insole_mode: Database["public"]["Enums"]["insole_mode_enum"]
          is_artisanal: boolean
          is_chemical: boolean
          is_fachetado: boolean
          is_standard_sole_item: boolean
          lead_time_days: number | null
          linked_last_id: string | null
          location: string
          lot_number: string | null
          material_color_group_id: string | null
          max_stock: number
          min_order_quantity: number | null
          min_stock: number
          min_stock_grade: Json | null
          model: string | null
          name: string
          pairs_per_package: number
          preferred_supplier_id: string | null
          price_retail: number | null
          price_wholesale: number | null
          production_unit: string | null
          purchase_order_unit: string | null
          purchase_unit: string | null
          quantity: number
          requires_sewing: boolean | null
          reserved_stock: number | null
          safety_stock: number | null
          sku: string
          sole_material: string | null
          sole_moq: number | null
          sole_technical_notes: string | null
          stock_grade: Json | null
          supplier_id: string | null
          supplier_lead_time_days: number | null
          technical_name: string | null
          unit: string
          unit_price: number
          updated_at: string
          yield_per_meter: number | null
          yield_unit: string | null
        }
        Insert: {
          active?: boolean
          box_type_id?: string | null
          brand?: string | null
          calculation_method?: string | null
          category: string
          color?: string
          consumption_unit?: string | null
          conversion_rate?: number | null
          created_at?: string
          current_stock?: number | null
          dimensions_height?: number | null
          dimensions_length?: number | null
          dimensions_thickness?: number | null
          dimensions_unit?: string | null
          dimensions_width?: number | null
          expiration_date?: string | null
          group_id?: string | null
          heel_height?: number | null
          id?: string
          image_url?: string | null
          insole_mode?: Database["public"]["Enums"]["insole_mode_enum"]
          is_artisanal?: boolean
          is_chemical?: boolean
          is_fachetado?: boolean
          is_standard_sole_item?: boolean
          lead_time_days?: number | null
          linked_last_id?: string | null
          location?: string
          lot_number?: string | null
          material_color_group_id?: string | null
          max_stock?: number
          min_order_quantity?: number | null
          min_stock?: number
          min_stock_grade?: Json | null
          model?: string | null
          name: string
          pairs_per_package?: number
          preferred_supplier_id?: string | null
          price_retail?: number | null
          price_wholesale?: number | null
          production_unit?: string | null
          purchase_order_unit?: string | null
          purchase_unit?: string | null
          quantity?: number
          requires_sewing?: boolean | null
          reserved_stock?: number | null
          safety_stock?: number | null
          sku: string
          sole_material?: string | null
          sole_moq?: number | null
          sole_technical_notes?: string | null
          stock_grade?: Json | null
          supplier_id?: string | null
          supplier_lead_time_days?: number | null
          technical_name?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
          yield_per_meter?: number | null
          yield_unit?: string | null
        }
        Update: {
          active?: boolean
          box_type_id?: string | null
          brand?: string | null
          calculation_method?: string | null
          category?: string
          color?: string
          consumption_unit?: string | null
          conversion_rate?: number | null
          created_at?: string
          current_stock?: number | null
          dimensions_height?: number | null
          dimensions_length?: number | null
          dimensions_thickness?: number | null
          dimensions_unit?: string | null
          dimensions_width?: number | null
          expiration_date?: string | null
          group_id?: string | null
          heel_height?: number | null
          id?: string
          image_url?: string | null
          insole_mode?: Database["public"]["Enums"]["insole_mode_enum"]
          is_artisanal?: boolean
          is_chemical?: boolean
          is_fachetado?: boolean
          is_standard_sole_item?: boolean
          lead_time_days?: number | null
          linked_last_id?: string | null
          location?: string
          lot_number?: string | null
          material_color_group_id?: string | null
          max_stock?: number
          min_order_quantity?: number | null
          min_stock?: number
          min_stock_grade?: Json | null
          model?: string | null
          name?: string
          pairs_per_package?: number
          preferred_supplier_id?: string | null
          price_retail?: number | null
          price_wholesale?: number | null
          production_unit?: string | null
          purchase_order_unit?: string | null
          purchase_unit?: string | null
          quantity?: number
          requires_sewing?: boolean | null
          reserved_stock?: number | null
          safety_stock?: number | null
          sku?: string
          sole_material?: string | null
          sole_moq?: number | null
          sole_technical_notes?: string | null
          stock_grade?: Json | null
          supplier_id?: string | null
          supplier_lead_time_days?: number | null
          technical_name?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
          yield_per_meter?: number | null
          yield_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_box_type_id_fkey"
            columns: ["box_type_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "products_material_color_group_id_fkey"
            columns: ["material_color_group_id"]
            isOneToOne: false
            referencedRelation: "material_color_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_preferred_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_preferred_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          approved?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          approved?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          color: string | null
          created_at: string
          current_stock: number
          grade: Json | null
          id: string
          max_stock: number
          min_stock: number
          product_id: string
          purchase_order_id: string
          quantity: number
          suggested_quantity: number
          unit: string
          unit_price: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          current_stock?: number
          grade?: Json | null
          id?: string
          max_stock?: number
          min_stock?: number
          product_id: string
          purchase_order_id: string
          quantity?: number
          suggested_quantity?: number
          unit?: string
          unit_price?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          current_stock?: number
          grade?: Json | null
          id?: string
          max_stock?: number
          min_stock?: number
          product_id?: string
          purchase_order_id?: string
          quantity?: number
          suggested_quantity?: number
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_overdue_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          auto_generated: boolean
          created_at: string
          eta_days: number | null
          expedite: boolean
          id: string
          notes: string | null
          order_number: string
          promised_date: string | null
          received_date: string | null
          reference_order_id: string | null
          status: string
          supplier_id: string | null
          supplier_name: string
          total_value: number
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean
          created_at?: string
          eta_days?: number | null
          expedite?: boolean
          id?: string
          notes?: string | null
          order_number?: string
          promised_date?: string | null
          received_date?: string | null
          reference_order_id?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean
          created_at?: string
          eta_days?: number | null
          expedite?: boolean
          id?: string
          notes?: string | null
          order_number?: string
          promised_date?: string | null
          received_date?: string | null
          reference_order_id?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      quality_checklists: {
        Row: {
          created_at: string | null
          id: string
          name: string
          requirements: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          requirements?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          requirements?: Json | null
        }
        Relationships: []
      }
      quality_inspections: {
        Row: {
          checklist_id: string | null
          created_at: string | null
          defect_quantity: number
          id: string
          inspector_id: string
          notes: string | null
          order_id: string | null
          results: Json | null
          rework_required: boolean
          status: string | null
          wave_stage_id: string | null
        }
        Insert: {
          checklist_id?: string | null
          created_at?: string | null
          defect_quantity?: number
          id?: string
          inspector_id: string
          notes?: string | null
          order_id?: string | null
          results?: Json | null
          rework_required?: boolean
          status?: string | null
          wave_stage_id?: string | null
        }
        Update: {
          checklist_id?: string | null
          created_at?: string | null
          defect_quantity?: number
          id?: string
          inspector_id?: string
          notes?: string | null
          order_id?: string | null
          results?: Json | null
          rework_required?: boolean
          status?: string | null
          wave_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspections_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "quality_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quality_inspections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quality_inspections_wave_stage_id_fkey"
            columns: ["wave_stage_id"]
            isOneToOne: false
            referencedRelation: "production_wave_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_wave_stage_id_fkey"
            columns: ["wave_stage_id"]
            isOneToOne: false
            referencedRelation: "v_stage_quality"
            referencedColumns: ["wave_stage_id"]
          },
        ]
      }
      quality_records: {
        Row: {
          can_rework: boolean | null
          cause: string | null
          corrective_action: string | null
          cost: number | null
          created_at: string
          description: string | null
          id: string
          order_id: string
          quantity: number
          record_type: string
          registered_by: string | null
          reported_by: string | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string | null
          stage_id: string | null
          stage_name: string
          updated_at: string
        }
        Insert: {
          can_rework?: boolean | null
          cause?: string | null
          corrective_action?: string | null
          cost?: number | null
          created_at?: string
          description?: string | null
          id?: string
          order_id: string
          quantity?: number
          record_type?: string
          registered_by?: string | null
          reported_by?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          stage_id?: string | null
          stage_name?: string
          updated_at?: string
        }
        Update: {
          can_rework?: boolean | null
          cause?: string | null
          corrective_action?: string | null
          cost?: number | null
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string
          quantity?: number
          record_type?: string
          registered_by?: string | null
          reported_by?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          stage_id?: string | null
          stage_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quality_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quality_records_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "order_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      quarantine_stock: {
        Row: {
          created_at: string
          id: string
          lot_id: string | null
          order_id: string | null
          product_id: string
          quality_record_id: string | null
          quantity: number
          reason: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lot_id?: string | null
          order_id?: string | null
          product_id: string
          quality_record_id?: string | null
          quantity?: number
          reason?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lot_id?: string | null
          order_id?: string | null
          product_id?: string
          quality_record_id?: string | null
          quantity?: number
          reason?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quarantine_stock_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lot_tracking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quarantine_stock_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "quarantine_stock_quality_record_id_fkey"
            columns: ["quality_record_id"]
            isOneToOne: false
            referencedRelation: "quality_records"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_stock: {
        Row: {
          color: string
          created_at: string
          id: string
          location: string | null
          notes: string | null
          quantity: number
          reference_id: string
          size: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          location?: string | null
          notes?: string | null
          quantity?: number
          reference_id: string
          size?: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          location?: string | null
          notes?: string | null
          quantity?: number
          reference_id?: string
          size?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ready_stock_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_stock_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      reference_color_variants: {
        Row: {
          active: boolean
          barcode: string
          color: string
          created_at: string
          description_override: string | null
          id: string
          image_url: string | null
          ncm: string | null
          reference_id: string
          sku: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          barcode?: string
          color?: string
          created_at?: string
          description_override?: string | null
          id?: string
          image_url?: string | null
          ncm?: string | null
          reference_id: string
          sku?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          barcode?: string
          color?: string
          created_at?: string
          description_override?: string | null
          id?: string
          image_url?: string | null
          ncm?: string | null
          reference_id?: string
          sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_color_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_color_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      reference_material_variants: {
        Row: {
          active: boolean
          barcode: string | null
          created_at: string | null
          description_override: string | null
          display_order: number
          id: string
          material_name: string
          ncm: string | null
          reference_id: string
          sku: string | null
          unit_price_override: number | null
          updated_at: string | null
          upper_material_product_id: string | null
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          created_at?: string | null
          description_override?: string | null
          display_order?: number
          id?: string
          material_name: string
          ncm?: string | null
          reference_id: string
          sku?: string | null
          unit_price_override?: number | null
          updated_at?: string | null
          upper_material_product_id?: string | null
        }
        Update: {
          active?: boolean
          barcode?: string | null
          created_at?: string | null
          description_override?: string | null
          display_order?: number
          id?: string
          material_name?: string
          ncm?: string | null
          reference_id?: string
          sku?: string | null
          unit_price_override?: number | null
          updated_at?: string | null
          upper_material_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reference_material_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "reference_material_variants_upper_material_product_id_fkey"
            columns: ["upper_material_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_upper_material_product_id_fkey"
            columns: ["upper_material_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_upper_material_product_id_fkey"
            columns: ["upper_material_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      reference_materials: {
        Row: {
          color: string | null
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity_per_unit: number
          reference_id: string
          sizes: string | null
          supplier: string | null
          weight: string | null
          width: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity_per_unit?: number
          reference_id: string
          sizes?: string | null
          supplier?: string | null
          weight?: string | null
          width?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity_per_unit?: number
          reference_id?: string
          sizes?: string | null
          supplier?: string | null
          weight?: string | null
          width?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "reference_materials_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_materials_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      representatives: {
        Row: {
          active: boolean
          bairro: string | null
          cep: string | null
          cidade: string | null
          commission_pct: number
          complemento: string | null
          created_at: string
          email: string | null
          endereco: string | null
          estado: string | null
          id: string
          name: string
          notes: string | null
          numero: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          commission_pct?: number
          complemento?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          name: string
          notes?: string | null
          numero?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          commission_pct?: number
          complemento?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          name?: string
          notes?: string | null
          numero?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reservation_batches: {
        Row: {
          created_at: string
          id: string
          order_id: string
          result: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          result?: Json | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          result?: Json | null
          status?: string
        }
        Relationships: []
      }
      resync_queue: {
        Row: {
          artisanal_order_id: string | null
          enqueued_at: string
          id: string
          order_id: string | null
          processed_at: string | null
          processed_result: Json | null
          reason: string
          triggered_by: string
        }
        Insert: {
          artisanal_order_id?: string | null
          enqueued_at?: string
          id?: string
          order_id?: string | null
          processed_at?: string | null
          processed_result?: Json | null
          reason: string
          triggered_by: string
        }
        Update: {
          artisanal_order_id?: string | null
          enqueued_at?: string
          id?: string
          order_id?: string | null
          processed_at?: string | null
          processed_result?: Json | null
          reason?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "resync_queue_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resync_queue_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "resync_queue_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resync_queue_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
        ]
      }
      sale_order_items: {
        Row: {
          color: string | null
          created_at: string
          fichas: number
          grade: Json | null
          id: string
          item_size: number | null
          material_variant_id: string | null
          observation: string | null
          quantity: number
          reference_id: string
          sale_order_id: string
          strap_colors: Json | null
          unit_price: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          fichas?: number
          grade?: Json | null
          id?: string
          item_size?: number | null
          material_variant_id?: string | null
          observation?: string | null
          quantity?: number
          reference_id: string
          sale_order_id: string
          strap_colors?: Json | null
          unit_price?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          fichas?: number
          grade?: Json | null
          id?: string
          item_size?: number | null
          material_variant_id?: string | null
          observation?: string | null
          quantity?: number
          reference_id?: string
          sale_order_id?: string
          strap_colors?: Json | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_order_items_material_variant_id_fkey"
            columns: ["material_variant_id"]
            isOneToOne: false
            referencedRelation: "reference_material_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sale_order_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_order_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      sale_orders: {
        Row: {
          billing_week: string | null
          checked_by: string | null
          client_cnpj: string | null
          client_contact: string | null
          client_id: string | null
          client_name: string
          client_order_number: string
          commission_value: number
          created_at: string
          delivery_deadline: string | null
          delivery_month: string | null
          delivery_week: string | null
          factoring_config_id: string | null
          id: string
          is_factoring: boolean
          manual_billing_override: boolean
          manual_override_reason: string | null
          modalidade_frete: string | null
          nfe: string | null
          notes: string | null
          order_number: string
          original_min_billing_date: string | null
          packaging_mode: string | null
          packaging_product_id: string | null
          packaging_quantity: number
          payment_condition: string | null
          remessa: string | null
          representative: string | null
          representative_id: string | null
          scheduled_dispatch_at: string | null
          shipped_at: string | null
          status: string
          total: number
          transport_company_id: string | null
          updated_at: string
          valor_frete: number | null
        }
        Insert: {
          billing_week?: string | null
          checked_by?: string | null
          client_cnpj?: string | null
          client_contact?: string | null
          client_id?: string | null
          client_name?: string
          client_order_number?: string
          commission_value?: number
          created_at?: string
          delivery_deadline?: string | null
          delivery_month?: string | null
          delivery_week?: string | null
          factoring_config_id?: string | null
          id?: string
          is_factoring?: boolean
          manual_billing_override?: boolean
          manual_override_reason?: string | null
          modalidade_frete?: string | null
          nfe?: string | null
          notes?: string | null
          order_number?: string
          original_min_billing_date?: string | null
          packaging_mode?: string | null
          packaging_product_id?: string | null
          packaging_quantity?: number
          payment_condition?: string | null
          remessa?: string | null
          representative?: string | null
          representative_id?: string | null
          scheduled_dispatch_at?: string | null
          shipped_at?: string | null
          status?: string
          total?: number
          transport_company_id?: string | null
          updated_at?: string
          valor_frete?: number | null
        }
        Update: {
          billing_week?: string | null
          checked_by?: string | null
          client_cnpj?: string | null
          client_contact?: string | null
          client_id?: string | null
          client_name?: string
          client_order_number?: string
          commission_value?: number
          created_at?: string
          delivery_deadline?: string | null
          delivery_month?: string | null
          delivery_week?: string | null
          factoring_config_id?: string | null
          id?: string
          is_factoring?: boolean
          manual_billing_override?: boolean
          manual_override_reason?: string | null
          modalidade_frete?: string | null
          nfe?: string | null
          notes?: string | null
          order_number?: string
          original_min_billing_date?: string | null
          packaging_mode?: string | null
          packaging_product_id?: string | null
          packaging_quantity?: number
          payment_condition?: string | null
          remessa?: string | null
          representative?: string | null
          representative_id?: string | null
          scheduled_dispatch_at?: string | null
          shipped_at?: string | null
          status?: string
          total?: number
          transport_company_id?: string | null
          updated_at?: string
          valor_frete?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sale_orders_factoring_config_id_fkey"
            columns: ["factoring_config_id"]
            isOneToOne: false
            referencedRelation: "factoring_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sale_orders_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_transport_company_id_fkey"
            columns: ["transport_company_id"]
            isOneToOne: false
            referencedRelation: "transport_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          period_month: number
          period_year: number
          representative_id: string | null
          target_amount: number
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          period_month: number
          period_year: number
          representative_id?: string | null
          target_amount: number
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          period_month?: number
          period_year?: number
          representative_id?: string | null
          target_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_targets_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      service_orders: {
        Row: {
          artisanal_base_color: string | null
          artisanal_for_order_meters: number | null
          artisanal_for_stock_meters: number | null
          artisanal_output_color: string | null
          artisanal_output_meters: number | null
          artisanal_output_name: string | null
          artisanal_recipe_id: string | null
          artisanal_stock_entry_done: boolean | null
          contractor_id: string
          created_at: string
          description: string
          id: string
          material_color: string | null
          material_meters: number | null
          material_name: string | null
          materials_sent: Json | null
          notes: string | null
          order_number: string
          quantity: number
          receipt_generated_at: string | null
          receipt_number: string | null
          sale_order_id: string | null
          service_date: string
          service_time: string | null
          signed_photo_url: string | null
          status: string
          total_value: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          artisanal_base_color?: string | null
          artisanal_for_order_meters?: number | null
          artisanal_for_stock_meters?: number | null
          artisanal_output_color?: string | null
          artisanal_output_meters?: number | null
          artisanal_output_name?: string | null
          artisanal_recipe_id?: string | null
          artisanal_stock_entry_done?: boolean | null
          contractor_id: string
          created_at?: string
          description?: string
          id?: string
          material_color?: string | null
          material_meters?: number | null
          material_name?: string | null
          materials_sent?: Json | null
          notes?: string | null
          order_number?: string
          quantity?: number
          receipt_generated_at?: string | null
          receipt_number?: string | null
          sale_order_id?: string | null
          service_date?: string
          service_time?: string | null
          signed_photo_url?: string | null
          status?: string
          total_value?: number
          unit_price?: number
          updated_at?: string
        }
        Update: {
          artisanal_base_color?: string | null
          artisanal_for_order_meters?: number | null
          artisanal_for_stock_meters?: number | null
          artisanal_output_color?: string | null
          artisanal_output_meters?: number | null
          artisanal_output_name?: string | null
          artisanal_recipe_id?: string | null
          artisanal_stock_entry_done?: boolean | null
          contractor_id?: string
          created_at?: string
          description?: string
          id?: string
          material_color?: string | null
          material_meters?: number | null
          material_name?: string | null
          materials_sent?: Json | null
          notes?: string | null
          order_number?: string
          quantity?: number
          receipt_generated_at?: string | null
          receipt_number?: string | null
          sale_order_id?: string | null
          service_date?: string
          service_time?: string | null
          signed_photo_url?: string | null
          status?: string
          total_value?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_orders_artisanal_recipe_id_fkey"
            columns: ["artisanal_recipe_id"]
            isOneToOne: false
            referencedRelation: "artisanal_recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "service_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      sheet_catalog_models: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          sheet_id: string
          sort_order: number
          strap_assignments: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          sheet_id: string
          sort_order?: number
          strap_assignments?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          sheet_id?: string
          sort_order?: number
          strap_assignments?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_catalog_models_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_catalog_models_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      sheet_material_grading: {
        Row: {
          created_at: string | null
          id: string
          sheet_material_id: string
          size_number: number
          specific_consumption: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          sheet_material_id: string
          size_number: number
          specific_consumption: number
        }
        Update: {
          created_at?: string | null
          id?: string
          sheet_material_id?: string
          size_number?: number
          specific_consumption?: number
        }
        Relationships: [
          {
            foreignKeyName: "sheet_material_grading_sheet_material_id_fkey"
            columns: ["sheet_material_id"]
            isOneToOne: false
            referencedRelation: "sheet_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_materials: {
        Row: {
          color: string | null
          color_id: string | null
          consumption_per_size: Json | null
          consumption_type: string | null
          created_at: string
          group_id: string | null
          id: string
          notes: string | null
          part_name: string | null
          product_id: string
          quantity_per_unit: number
          sector: string | null
          sheet_id: string
          sizes: string | null
          supplier: string | null
          wastage_percentage: number | null
          weight: string | null
          width: string | null
        }
        Insert: {
          color?: string | null
          color_id?: string | null
          consumption_per_size?: Json | null
          consumption_type?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          notes?: string | null
          part_name?: string | null
          product_id: string
          quantity_per_unit?: number
          sector?: string | null
          sheet_id: string
          sizes?: string | null
          supplier?: string | null
          wastage_percentage?: number | null
          weight?: string | null
          width?: string | null
        }
        Update: {
          color?: string | null
          color_id?: string | null
          consumption_per_size?: Json | null
          consumption_type?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          notes?: string | null
          part_name?: string | null
          product_id?: string
          quantity_per_unit?: number
          sector?: string | null
          sheet_id?: string
          sizes?: string | null
          supplier?: string | null
          wastage_percentage?: number | null
          weight?: string | null
          width?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_materials_color_id_fkey"
            columns: ["color_id"]
            isOneToOne: false
            referencedRelation: "colors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sheet_materials_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      shoe_category_lead_times: {
        Row: {
          acabamento_dias: number
          buffer_material_dias: number
          corte_dias: number
          costura_dias: number
          created_at: string
          id: string
          montagem_dias: number
          shoe_category: string
          updated_at: string
        }
        Insert: {
          acabamento_dias?: number
          buffer_material_dias?: number
          corte_dias?: number
          costura_dias?: number
          created_at?: string
          id?: string
          montagem_dias?: number
          shoe_category: string
          updated_at?: string
        }
        Update: {
          acabamento_dias?: number
          buffer_material_dias?: number
          corte_dias?: number
          costura_dias?: number
          created_at?: string
          id?: string
          montagem_dias?: number
          shoe_category?: string
          updated_at?: string
        }
        Relationships: []
      }
      silk_shoe_category: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sole_silk_registrations: {
        Row: {
          client_id: string | null
          created_at: string | null
          economic_group_id: string | null
          id: string
          shoe_category: string | null
          silk_name: string
          silk_url: string | null
          sole_product_id: string | null
          sole_type: string
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          economic_group_id?: string | null
          id?: string
          shoe_category?: string | null
          silk_name: string
          silk_url?: string | null
          sole_product_id?: string | null
          sole_type: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          economic_group_id?: string | null
          id?: string
          shoe_category?: string | null
          silk_name?: string
          silk_url?: string | null
          sole_product_id?: string | null
          sole_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sole_silk_registrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "economic_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      sole_size_conjugations: {
        Row: {
          created_at: string | null
          display_order: number
          id: string
          size_key: string
          sizes: number[]
          sole_group_id: string
        }
        Insert: {
          created_at?: string | null
          display_order?: number
          id?: string
          size_key: string
          sizes: number[]
          sole_group_id: string
        }
        Update: {
          created_at?: string | null
          display_order?: number
          id?: string
          size_key?: string
          sizes?: number[]
          sole_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sole_size_conjugations_sole_group_id_fkey"
            columns: ["sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      sole_standard_items_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: string
          new_consumption: number | null
          new_unit: string | null
          old_consumption: number | null
          old_unit: string | null
          size: number
          sole_product_id: string
          standard_item_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_consumption?: number | null
          new_unit?: string | null
          old_consumption?: number | null
          old_unit?: string | null
          size: number
          sole_product_id: string
          standard_item_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_consumption?: number | null
          new_unit?: string | null
          old_consumption?: number | null
          old_unit?: string | null
          size?: number
          sole_product_id?: string
          standard_item_id?: string
        }
        Relationships: []
      }
      sole_standard_items_consumption: {
        Row: {
          consumption: number
          created_at: string
          id: string
          size: number
          sole_product_id: string
          standard_item_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          consumption?: number
          created_at?: string
          id?: string
          size: number
          sole_product_id: string
          standard_item_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          consumption?: number
          created_at?: string
          id?: string
          size?: number
          sole_product_id?: string
          standard_item_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      sole_structures: {
        Row: {
          component_type: string
          consumption_default: number | null
          created_at: string
          default_group_id: string | null
          default_material_id: string | null
          id: string
          insole_material_id: string | null
          lining_material_id: string | null
          sole_id: string | null
          updated_at: string
        }
        Insert: {
          component_type: string
          consumption_default?: number | null
          created_at?: string
          default_group_id?: string | null
          default_material_id?: string | null
          id?: string
          insole_material_id?: string | null
          lining_material_id?: string | null
          sole_id?: string | null
          updated_at?: string
        }
        Update: {
          component_type?: string
          consumption_default?: number | null
          created_at?: string
          default_group_id?: string | null
          default_material_id?: string | null
          id?: string
          insole_material_id?: string | null
          lining_material_id?: string | null
          sole_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sole_structures_default_group_id_fkey"
            columns: ["default_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sole_structures_insole_material_id_fkey"
            columns: ["insole_material_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_insole_material_id_fkey"
            columns: ["insole_material_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_insole_material_id_fkey"
            columns: ["insole_material_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sole_structures_lining_material_id_fkey"
            columns: ["lining_material_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_lining_material_id_fkey"
            columns: ["lining_material_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_lining_material_id_fkey"
            columns: ["lining_material_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      sole_technical_specs: {
        Row: {
          consumption: number | null
          created_at: string
          fachete_lining_consumption_dm2: number | null
          id: string
          insole_consumption_dm2: number | null
          lining_consumption_dm2: number | null
          reference_date: string | null
          reference_sole_id: string | null
          size: number
          sole_id: string | null
          updated_at: string
        }
        Insert: {
          consumption?: number | null
          created_at?: string
          fachete_lining_consumption_dm2?: number | null
          id?: string
          insole_consumption_dm2?: number | null
          lining_consumption_dm2?: number | null
          reference_date?: string | null
          reference_sole_id?: string | null
          size: number
          sole_id?: string | null
          updated_at?: string
        }
        Update: {
          consumption?: number | null
          created_at?: string
          fachete_lining_consumption_dm2?: number | null
          id?: string
          insole_consumption_dm2?: number | null
          lining_consumption_dm2?: number | null
          reference_date?: string | null
          reference_sole_id?: string | null
          size?: number
          sole_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          description: string | null
          id: string
          movement_type: string
          new_stock: number
          order_id: string | null
          previous_stock: number
          product_id: string
          quantity: number
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          movement_type?: string
          new_stock?: number
          order_id?: string | null
          previous_stock?: number
          product_id: string
          quantity?: number
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          movement_type?: string
          new_stock?: number
          order_id?: string | null
          previous_stock?: number
          product_id?: string
          quantity?: number
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          avg_lead_time_days: number | null
          city: string | null
          cnpj: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          ie: string | null
          is_own_manufacturing: boolean | null
          last_purchase_date: string | null
          lead_time_days: number | null
          name: string
          notes: string | null
          on_time_rate: number | null
          payment_terms: string | null
          phone: string | null
          state: string | null
          trade_name: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          avg_lead_time_days?: number | null
          city?: string | null
          cnpj?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          ie?: string | null
          is_own_manufacturing?: boolean | null
          last_purchase_date?: string | null
          lead_time_days?: number | null
          name: string
          notes?: string | null
          on_time_rate?: number | null
          payment_terms?: string | null
          phone?: string | null
          state?: string | null
          trade_name?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          avg_lead_time_days?: number | null
          city?: string | null
          cnpj?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          ie?: string | null
          is_own_manufacturing?: boolean | null
          last_purchase_date?: string | null
          lead_time_days?: number | null
          name?: string
          notes?: string | null
          on_time_rate?: number | null
          payment_terms?: string | null
          phone?: string | null
          state?: string | null
          trade_name?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      technical_reference_materials: {
        Row: {
          alternative_products: Json | null
          created_at: string
          cut_length: number | null
          cut_thickness: number | null
          cut_unit: string | null
          cut_width: number | null
          id: string
          is_critical: boolean
          notes: string | null
          product_id: string | null
          quantity_needed: number
          sequence: number
          technical_reference_id: string
          unit: string
          updated_at: string
          waste_factor: number
        }
        Insert: {
          alternative_products?: Json | null
          created_at?: string
          cut_length?: number | null
          cut_thickness?: number | null
          cut_unit?: string | null
          cut_width?: number | null
          id?: string
          is_critical?: boolean
          notes?: string | null
          product_id?: string | null
          quantity_needed?: number
          sequence?: number
          technical_reference_id: string
          unit?: string
          updated_at?: string
          waste_factor?: number
        }
        Update: {
          alternative_products?: Json | null
          created_at?: string
          cut_length?: number | null
          cut_thickness?: number | null
          cut_unit?: string | null
          cut_width?: number | null
          id?: string
          is_critical?: boolean
          notes?: string | null
          product_id?: string | null
          quantity_needed?: number
          sequence?: number
          technical_reference_id?: string
          unit?: string
          updated_at?: string
          waste_factor?: number
        }
        Relationships: [
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "technical_reference_materials_technical_reference_id_fkey"
            columns: ["technical_reference_id"]
            isOneToOne: false
            referencedRelation: "technical_references"
            referencedColumns: ["id"]
          },
        ]
      }
      technical_references: {
        Row: {
          category: string
          cost_calculated: boolean
          created_at: string
          description: string | null
          dimensional_check: boolean
          dimensions_unit: string
          estimated_cost: number | null
          estimated_production_time: number | null
          final_height: number
          final_length: number
          final_width: number
          id: string
          is_valid: boolean
          last_validated_at: string | null
          material_availability: boolean
          name: string
          reference_code: string
          sheet_id: string
          status: string
          tolerance: number
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          validation_errors: Json | null
          validation_warnings: Json | null
        }
        Insert: {
          category?: string
          cost_calculated?: boolean
          created_at?: string
          description?: string | null
          dimensional_check?: boolean
          dimensions_unit?: string
          estimated_cost?: number | null
          estimated_production_time?: number | null
          final_height?: number
          final_length?: number
          final_width?: number
          id?: string
          is_valid?: boolean
          last_validated_at?: string | null
          material_availability?: boolean
          name?: string
          reference_code?: string
          sheet_id: string
          status?: string
          tolerance?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          validation_errors?: Json | null
          validation_warnings?: Json | null
        }
        Update: {
          category?: string
          cost_calculated?: boolean
          created_at?: string
          description?: string | null
          dimensional_check?: boolean
          dimensions_unit?: string
          estimated_cost?: number | null
          estimated_production_time?: number | null
          final_height?: number
          final_length?: number
          final_width?: number
          id?: string
          is_valid?: boolean
          last_validated_at?: string | null
          material_availability?: boolean
          name?: string
          reference_code?: string
          sheet_id?: string
          status?: string
          tolerance?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          validation_errors?: Json | null
          validation_warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "technical_references_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_references_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      technical_sheet_insole_colors: {
        Row: {
          created_at: string
          id: string
          insole_color: string
          sheet_id: string
          sole_color: string
        }
        Insert: {
          created_at?: string
          id?: string
          insole_color: string
          sheet_id: string
          sole_color: string
        }
        Update: {
          created_at?: string
          id?: string
          insole_color?: string
          sheet_id?: string
          sole_color?: string
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_insole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_insole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      technical_sheet_lining_colors: {
        Row: {
          cabedal_color: string
          created_at: string
          id: string
          lining_color: string
          sheet_id: string
        }
        Insert: {
          cabedal_color: string
          created_at?: string
          id?: string
          lining_color: string
          sheet_id: string
        }
        Update: {
          cabedal_color?: string
          created_at?: string
          id?: string
          lining_color?: string
          sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_lining_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_lining_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      technical_sheet_operations: {
        Row: {
          created_at: string
          id: string
          labor_cost_id: string
          minutes_per_unit: number
          sheet_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          labor_cost_id: string
          minutes_per_unit?: number
          sheet_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          labor_cost_id?: string
          minutes_per_unit?: number
          sheet_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_operations_labor_cost_id_fkey"
            columns: ["labor_cost_id"]
            isOneToOne: false
            referencedRelation: "labor_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      technical_sheet_overhead_history: {
        Row: {
          changed_by: string
          created_at: string
          id: string
          new_value: number | null
          old_value: number | null
          sheet_id: string
        }
        Insert: {
          changed_by: string
          created_at?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          sheet_id: string
        }
        Update: {
          changed_by?: string
          created_at?: string
          id?: string
          new_value?: number | null
          old_value?: number | null
          sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_overhead_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_overhead_history_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_overhead_history_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      technical_sheet_palmilha_colors: {
        Row: {
          cabedal_color: string
          created_at: string
          id: string
          palmilha_color: string
          palmilha_group_id: string | null
          palmilha_product_id: string | null
          sheet_id: string
        }
        Insert: {
          cabedal_color: string
          created_at?: string
          id?: string
          palmilha_color: string
          palmilha_group_id?: string | null
          palmilha_product_id?: string | null
          sheet_id: string
        }
        Update: {
          cabedal_color?: string
          created_at?: string
          id?: string
          palmilha_color?: string
          palmilha_group_id?: string | null
          palmilha_product_id?: string | null
          sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_palmilha_colors_palmilha_group_id_fkey"
            columns: ["palmilha_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_palmilha_product_id_fkey"
            columns: ["palmilha_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_palmilha_product_id_fkey"
            columns: ["palmilha_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_palmilha_product_id_fkey"
            columns: ["palmilha_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      technical_sheet_snapshots: {
        Row: {
          bom_snapshot: Json
          color: string | null
          consumption_snapshot: Json
          frozen_at: string
          frozen_by: string | null
          id: string
          primary_sole_id: string | null
          quantity: number
          reference_size: number | null
          sale_order_id: string | null
          sale_order_item_id: string | null
          sheet_id: string
          sheet_name: string
          sheet_version: number
          sole_drives_consumption: boolean
        }
        Insert: {
          bom_snapshot: Json
          color?: string | null
          consumption_snapshot: Json
          frozen_at?: string
          frozen_by?: string | null
          id?: string
          primary_sole_id?: string | null
          quantity: number
          reference_size?: number | null
          sale_order_id?: string | null
          sale_order_item_id?: string | null
          sheet_id: string
          sheet_name: string
          sheet_version?: number
          sole_drives_consumption?: boolean
        }
        Update: {
          bom_snapshot?: Json
          color?: string | null
          consumption_snapshot?: Json
          frozen_at?: string
          frozen_by?: string | null
          id?: string
          primary_sole_id?: string | null
          quantity?: number
          reference_size?: number | null
          sale_order_id?: string | null
          sale_order_item_id?: string | null
          sheet_id?: string
          sheet_name?: string
          sheet_version?: number
          sole_drives_consumption?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_snapshots_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      technical_sheet_sole_colors: {
        Row: {
          created_at: string
          id: string
          product_color: string
          sheet_id: string
          sole_group_id: string
          sole_product_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_color: string
          sheet_id: string
          sole_group_id: string
          sole_product_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_color?: string
          sheet_id?: string
          sole_group_id?: string
          sole_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_sole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_group_id_fkey"
            columns: ["sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
        ]
      }
      technical_sheets: {
        Row: {
          acabamento_tiras: string | null
          acceptance_criteria: string | null
          approvals: Json | null
          assembly_capacity_per_day: number | null
          assembly_instructions: string | null
          assembly_steps: Json | null
          assembly_time_minutes: number | null
          barcode: string | null
          box_type_id: string | null
          brand: string | null
          care_instructions: string | null
          certifications: string | null
          change_log: Json | null
          code: string | null
          cola_cure_time: string | null
          cola_type: string | null
          collection: string | null
          color_images: Json | null
          colors: string | null
          commercial_description: string | null
          components_accessories: Json | null
          consumption_loss_pct: number | null
          cor_palmilha_id: string | null
          cor_predominante_id: string | null
          cor_solado_id: string | null
          cor_tiras_id: string | null
          cost_price: number | null
          country_origin: string | null
          created_at: string
          custom_overhead: number | null
          cutting_capacity_per_day: number | null
          daily_capacity_pairs: number | null
          data_ultima_revisao: string | null
          default_silk_url: string | null
          description: string | null
          direct_components: Json | null
          expedition_capacity_per_day: number | null
          fachete_consumption: number | null
          fachete_consumption_per_size: Json | null
          fachete_material: string | null
          finishing_capacity_per_day: number | null
          fit_type: string | null
          gender: string | null
          gluing_capacity_per_day: number
          handling_time_minutes: number
          has_straps: boolean | null
          heel_base: string | null
          heel_height: string | null
          heel_material: string | null
          heel_type: string | null
          id: string
          image_url: string | null
          images: Json | null
          insole_color: string | null
          insole_consumption: number | null
          insole_consumption_per_size: Json | null
          insole_material: string | null
          insole_plate_product: string | null
          insole_ready_made: boolean
          insole_thickness: string | null
          keywords: string | null
          label_info: Json | null
          last_code: string | null
          last_exclusive: boolean | null
          last_name: string | null
          last_notes: string | null
          lead_time_acabamento_dias: number
          lead_time_buffer_material_dias: number
          lead_time_colagem_dias: number | null
          lead_time_corte_dias: number
          lead_time_costura_dias: number
          lead_time_expedicao_dias: number | null
          lead_time_montagem_dias: number
          lead_time_silk_dias: number | null
          legal_composition: string | null
          lining_accessories: Json | null
          lining_consumption: number | null
          lining_consumption_per_size: Json | null
          lining_material: string | null
          lining_weight: string | null
          machine_settings: Json | null
          material_solado_tipo: string | null
          measurements: Json | null
          model: string | null
          name: string
          ncm: string | null
          obs_harmonizacao: string | null
          packaging_box_dimensions: string | null
          packaging_notes: string | null
          packaging_tissue: string | null
          palletization: Json | null
          primary_sole_id: string | null
          process_difficulty: string | null
          production_sectors: Json
          qtd_prevista: number | null
          quality_tests: Json | null
          reference_size: number | null
          responsavel_revisao: string | null
          responsible_person: string | null
          safety_margin_pct: number | null
          sale_price: number | null
          sampling_plan: string | null
          sewing_capacity_per_day: number | null
          shoe_category: string | null
          shoe_category_id: string | null
          silk_capacity_per_day: number
          size_multipliers: Json | null
          sizes: string | null
          sole_code: string | null
          sole_color: string | null
          sole_consumption: number | null
          sole_drives_consumption: boolean
          sole_group_id: string | null
          sole_material: string | null
          sole_process: string | null
          sole_type: string | null
          status: string
          status_ficha: string
          stitch_spec: string | null
          storage_instructions: string | null
          strap_colors: Json | null
          suggested_price: number | null
          tolerances: Json | null
          updated_at: string
          upper_consumption: number | null
          upper_consumption_per_size: Json | null
          upper_finish: string | null
          upper_material: string | null
          upper_thickness: string | null
          version: number
          version_number: string | null
        }
        Insert: {
          acabamento_tiras?: string | null
          acceptance_criteria?: string | null
          approvals?: Json | null
          assembly_capacity_per_day?: number | null
          assembly_instructions?: string | null
          assembly_steps?: Json | null
          assembly_time_minutes?: number | null
          barcode?: string | null
          box_type_id?: string | null
          brand?: string | null
          care_instructions?: string | null
          certifications?: string | null
          change_log?: Json | null
          code?: string | null
          cola_cure_time?: string | null
          cola_type?: string | null
          collection?: string | null
          color_images?: Json | null
          colors?: string | null
          commercial_description?: string | null
          components_accessories?: Json | null
          consumption_loss_pct?: number | null
          cor_palmilha_id?: string | null
          cor_predominante_id?: string | null
          cor_solado_id?: string | null
          cor_tiras_id?: string | null
          cost_price?: number | null
          country_origin?: string | null
          created_at?: string
          custom_overhead?: number | null
          cutting_capacity_per_day?: number | null
          daily_capacity_pairs?: number | null
          data_ultima_revisao?: string | null
          default_silk_url?: string | null
          description?: string | null
          direct_components?: Json | null
          expedition_capacity_per_day?: number | null
          fachete_consumption?: number | null
          fachete_consumption_per_size?: Json | null
          fachete_material?: string | null
          finishing_capacity_per_day?: number | null
          fit_type?: string | null
          gender?: string | null
          gluing_capacity_per_day?: number
          handling_time_minutes?: number
          has_straps?: boolean | null
          heel_base?: string | null
          heel_height?: string | null
          heel_material?: string | null
          heel_type?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          insole_color?: string | null
          insole_consumption?: number | null
          insole_consumption_per_size?: Json | null
          insole_material?: string | null
          insole_plate_product?: string | null
          insole_ready_made?: boolean
          insole_thickness?: string | null
          keywords?: string | null
          label_info?: Json | null
          last_code?: string | null
          last_exclusive?: boolean | null
          last_name?: string | null
          last_notes?: string | null
          lead_time_acabamento_dias?: number
          lead_time_buffer_material_dias?: number
          lead_time_colagem_dias?: number | null
          lead_time_corte_dias?: number
          lead_time_costura_dias?: number
          lead_time_expedicao_dias?: number | null
          lead_time_montagem_dias?: number
          lead_time_silk_dias?: number | null
          legal_composition?: string | null
          lining_accessories?: Json | null
          lining_consumption?: number | null
          lining_consumption_per_size?: Json | null
          lining_material?: string | null
          lining_weight?: string | null
          machine_settings?: Json | null
          material_solado_tipo?: string | null
          measurements?: Json | null
          model?: string | null
          name: string
          ncm?: string | null
          obs_harmonizacao?: string | null
          packaging_box_dimensions?: string | null
          packaging_notes?: string | null
          packaging_tissue?: string | null
          palletization?: Json | null
          primary_sole_id?: string | null
          process_difficulty?: string | null
          production_sectors?: Json
          qtd_prevista?: number | null
          quality_tests?: Json | null
          reference_size?: number | null
          responsavel_revisao?: string | null
          responsible_person?: string | null
          safety_margin_pct?: number | null
          sale_price?: number | null
          sampling_plan?: string | null
          sewing_capacity_per_day?: number | null
          shoe_category?: string | null
          shoe_category_id?: string | null
          silk_capacity_per_day?: number
          size_multipliers?: Json | null
          sizes?: string | null
          sole_code?: string | null
          sole_color?: string | null
          sole_consumption?: number | null
          sole_drives_consumption?: boolean
          sole_group_id?: string | null
          sole_material?: string | null
          sole_process?: string | null
          sole_type?: string | null
          status?: string
          status_ficha?: string
          stitch_spec?: string | null
          storage_instructions?: string | null
          strap_colors?: Json | null
          suggested_price?: number | null
          tolerances?: Json | null
          updated_at?: string
          upper_consumption?: number | null
          upper_consumption_per_size?: Json | null
          upper_finish?: string | null
          upper_material?: string | null
          upper_thickness?: string | null
          version?: number
          version_number?: string | null
        }
        Update: {
          acabamento_tiras?: string | null
          acceptance_criteria?: string | null
          approvals?: Json | null
          assembly_capacity_per_day?: number | null
          assembly_instructions?: string | null
          assembly_steps?: Json | null
          assembly_time_minutes?: number | null
          barcode?: string | null
          box_type_id?: string | null
          brand?: string | null
          care_instructions?: string | null
          certifications?: string | null
          change_log?: Json | null
          code?: string | null
          cola_cure_time?: string | null
          cola_type?: string | null
          collection?: string | null
          color_images?: Json | null
          colors?: string | null
          commercial_description?: string | null
          components_accessories?: Json | null
          consumption_loss_pct?: number | null
          cor_palmilha_id?: string | null
          cor_predominante_id?: string | null
          cor_solado_id?: string | null
          cor_tiras_id?: string | null
          cost_price?: number | null
          country_origin?: string | null
          created_at?: string
          custom_overhead?: number | null
          cutting_capacity_per_day?: number | null
          daily_capacity_pairs?: number | null
          data_ultima_revisao?: string | null
          default_silk_url?: string | null
          description?: string | null
          direct_components?: Json | null
          expedition_capacity_per_day?: number | null
          fachete_consumption?: number | null
          fachete_consumption_per_size?: Json | null
          fachete_material?: string | null
          finishing_capacity_per_day?: number | null
          fit_type?: string | null
          gender?: string | null
          gluing_capacity_per_day?: number
          handling_time_minutes?: number
          has_straps?: boolean | null
          heel_base?: string | null
          heel_height?: string | null
          heel_material?: string | null
          heel_type?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          insole_color?: string | null
          insole_consumption?: number | null
          insole_consumption_per_size?: Json | null
          insole_material?: string | null
          insole_plate_product?: string | null
          insole_ready_made?: boolean
          insole_thickness?: string | null
          keywords?: string | null
          label_info?: Json | null
          last_code?: string | null
          last_exclusive?: boolean | null
          last_name?: string | null
          last_notes?: string | null
          lead_time_acabamento_dias?: number
          lead_time_buffer_material_dias?: number
          lead_time_colagem_dias?: number | null
          lead_time_corte_dias?: number
          lead_time_costura_dias?: number
          lead_time_expedicao_dias?: number | null
          lead_time_montagem_dias?: number
          lead_time_silk_dias?: number | null
          legal_composition?: string | null
          lining_accessories?: Json | null
          lining_consumption?: number | null
          lining_consumption_per_size?: Json | null
          lining_material?: string | null
          lining_weight?: string | null
          machine_settings?: Json | null
          material_solado_tipo?: string | null
          measurements?: Json | null
          model?: string | null
          name?: string
          ncm?: string | null
          obs_harmonizacao?: string | null
          packaging_box_dimensions?: string | null
          packaging_notes?: string | null
          packaging_tissue?: string | null
          palletization?: Json | null
          primary_sole_id?: string | null
          process_difficulty?: string | null
          production_sectors?: Json
          qtd_prevista?: number | null
          quality_tests?: Json | null
          reference_size?: number | null
          responsavel_revisao?: string | null
          responsible_person?: string | null
          safety_margin_pct?: number | null
          sale_price?: number | null
          sampling_plan?: string | null
          sewing_capacity_per_day?: number | null
          shoe_category?: string | null
          shoe_category_id?: string | null
          silk_capacity_per_day?: number
          size_multipliers?: Json | null
          sizes?: string | null
          sole_code?: string | null
          sole_color?: string | null
          sole_consumption?: number | null
          sole_drives_consumption?: boolean
          sole_group_id?: string | null
          sole_material?: string | null
          sole_process?: string | null
          sole_type?: string | null
          status?: string
          status_ficha?: string
          stitch_spec?: string | null
          storage_instructions?: string | null
          strap_colors?: Json | null
          suggested_price?: number | null
          tolerances?: Json | null
          updated_at?: string
          upper_consumption?: number | null
          upper_consumption_per_size?: Json | null
          upper_finish?: string | null
          upper_material?: string | null
          upper_thickness?: string | null
          version?: number
          version_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheets_box_type_id_fkey"
            columns: ["box_type_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_cor_palmilha_id_fkey"
            columns: ["cor_palmilha_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_cor_predominante_id_fkey"
            columns: ["cor_predominante_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_cor_solado_id_fkey"
            columns: ["cor_solado_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_cor_tiras_id_fkey"
            columns: ["cor_tiras_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_primary_sole_id_fkey"
            columns: ["primary_sole_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_primary_sole_id_fkey"
            columns: ["primary_sole_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_primary_sole_id_fkey"
            columns: ["primary_sole_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "technical_sheets_shoe_category_id_fkey"
            columns: ["shoe_category_id"]
            isOneToOne: false
            referencedRelation: "silk_shoe_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_sole_group_id_fkey"
            columns: ["sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      time_exceptions: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string
          employee_external_id: string | null
          employee_name: string
          id: string
          import_batch: string | null
          record_date: string
          resolution_notes: string | null
          severity: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string
          employee_external_id?: string | null
          employee_name: string
          id?: string
          import_batch?: string | null
          record_date: string
          resolution_notes?: string | null
          severity?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string
          employee_external_id?: string | null
          employee_name?: string
          id?: string
          import_batch?: string | null
          record_date?: string
          resolution_notes?: string | null
          severity?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      time_import_logs: {
        Row: {
          batch_id: string | null
          created_at: string
          end_date: string | null
          error_count: number
          error_messages: Json | null
          file_name: string
          id: string
          imported_by: string | null
          inserted_count: number
          notes: string | null
          skipped_count: number
          start_date: string | null
          status: string
          total_rows: number
          updated_count: number
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          end_date?: string | null
          error_count?: number
          error_messages?: Json | null
          file_name: string
          id?: string
          imported_by?: string | null
          inserted_count?: number
          notes?: string | null
          skipped_count?: number
          start_date?: string | null
          status?: string
          total_rows?: number
          updated_count?: number
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          end_date?: string | null
          error_count?: number
          error_messages?: Json | null
          file_name?: string
          id?: string
          imported_by?: string | null
          inserted_count?: number
          notes?: string | null
          skipped_count?: number
          start_date?: string | null
          status?: string
          total_rows?: number
          updated_count?: number
        }
        Relationships: []
      }
      time_records: {
        Row: {
          created_at: string
          department: string
          employee_external_id: string
          employee_name: string
          id: string
          import_batch: string
          punches: Json
          record_date: string
        }
        Insert: {
          created_at?: string
          department?: string
          employee_external_id?: string
          employee_name: string
          id?: string
          import_batch?: string
          punches?: Json
          record_date: string
        }
        Update: {
          created_at?: string
          department?: string
          employee_external_id?: string
          employee_name?: string
          id?: string
          import_batch?: string
          punches?: Json
          record_date?: string
        }
        Relationships: []
      }
      transport_companies: {
        Row: {
          active: boolean | null
          condicoes_pagamento: string | null
          created_at: string | null
          documento: string | null
          email: string | null
          endereco: Json | null
          id: string
          nome: string
          observacoes: string | null
          seguro: boolean | null
          servicos: string[] | null
          sla_dias: number | null
          telefone: string | null
          tipo_pessoa: Database["public"]["Enums"]["pessoa_tipo"] | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          documento?: string | null
          email?: string | null
          endereco?: Json | null
          id?: string
          nome: string
          observacoes?: string | null
          seguro?: boolean | null
          servicos?: string[] | null
          sla_dias?: number | null
          telefone?: string | null
          tipo_pessoa?: Database["public"]["Enums"]["pessoa_tipo"] | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          documento?: string | null
          email?: string | null
          endereco?: Json | null
          id?: string
          nome?: string
          observacoes?: string | null
          seguro?: boolean | null
          servicos?: string[] | null
          sla_dias?: number | null
          telefone?: string | null
          tipo_pessoa?: Database["public"]["Enums"]["pessoa_tipo"] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      transport_company_rates: {
        Row: {
          created_at: string | null
          estado: string
          id: string
          minimo: number | null
          moeda: string | null
          tipo_valor: Database["public"]["Enums"]["tarifa_tipo"] | null
          transport_company_id: string
          updated_at: string | null
          valor_capital: number | null
          valor_interior: number | null
          vigencia_fim: string | null
          vigencia_inicio: string | null
        }
        Insert: {
          created_at?: string | null
          estado: string
          id?: string
          minimo?: number | null
          moeda?: string | null
          tipo_valor?: Database["public"]["Enums"]["tarifa_tipo"] | null
          transport_company_id: string
          updated_at?: string | null
          valor_capital?: number | null
          valor_interior?: number | null
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Update: {
          created_at?: string | null
          estado?: string
          id?: string
          minimo?: number | null
          moeda?: string | null
          tipo_valor?: Database["public"]["Enums"]["tarifa_tipo"] | null
          transport_company_id?: string
          updated_at?: string | null
          valor_capital?: number | null
          valor_interior?: number | null
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transport_company_rates_transport_company_id_fkey"
            columns: ["transport_company_id"]
            isOneToOne: false
            referencedRelation: "transport_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          can_edit: boolean
          can_view: boolean
          id: string
          module: string
          user_id: string
        }
        Insert: {
          can_edit?: boolean
          can_view?: boolean
          id?: string
          module: string
          user_id: string
        }
        Update: {
          can_edit?: boolean
          can_view?: boolean
          id?: string
          module?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      variant_group_images: {
        Row: {
          created_at: string
          group_id: string
          id: string
          image_url: string
          updated_at: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          image_url: string
          updated_at?: string
          variant_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          image_url?: string
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_group_images_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_group_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "reference_color_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      wip_ledger: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          credit_account: string | null
          debit_account: string | null
          description: string | null
          entry_date: string
          entry_type: string
          goods_issue_id: string | null
          id: string
          order_id: string
          quantity: number | null
          sale_order_id: string | null
          stage_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          credit_account?: string | null
          debit_account?: string | null
          description?: string | null
          entry_date?: string
          entry_type?: string
          goods_issue_id?: string | null
          id?: string
          order_id: string
          quantity?: number | null
          sale_order_id?: string | null
          stage_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          credit_account?: string | null
          debit_account?: string | null
          description?: string | null
          entry_date?: string
          entry_type?: string
          goods_issue_id?: string | null
          id?: string
          order_id?: string
          quantity?: number | null
          sale_order_id?: string | null
          stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wip_ledger_goods_issue_id_fkey"
            columns: ["goods_issue_id"]
            isOneToOne: false
            referencedRelation: "goods_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wip_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wip_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "wip_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wip_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "wip_ledger_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "wip_ledger_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wip_ledger_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "wip_ledger_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "order_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      work_schedules: {
        Row: {
          created_at: string
          entry_time: string
          exit_time: string
          holiday_multiplier: number
          id: string
          is_default: boolean
          lunch_end: string
          lunch_start: string
          minimum_overtime_minutes: number
          name: string
          night_overtime_multiplier: number
          overtime_multiplier: number
          saturday_entry: string | null
          saturday_exit: string | null
          tolerance_minutes: number
          updated_at: string
          weekly_hours: number
        }
        Insert: {
          created_at?: string
          entry_time?: string
          exit_time?: string
          holiday_multiplier?: number
          id?: string
          is_default?: boolean
          lunch_end?: string
          lunch_start?: string
          minimum_overtime_minutes?: number
          name?: string
          night_overtime_multiplier?: number
          overtime_multiplier?: number
          saturday_entry?: string | null
          saturday_exit?: string | null
          tolerance_minutes?: number
          updated_at?: string
          weekly_hours?: number
        }
        Update: {
          created_at?: string
          entry_time?: string
          exit_time?: string
          holiday_multiplier?: number
          id?: string
          is_default?: boolean
          lunch_end?: string
          lunch_start?: string
          minimum_overtime_minutes?: number
          name?: string
          night_overtime_multiplier?: number
          overtime_multiplier?: number
          saturday_entry?: string | null
          saturday_exit?: string | null
          tolerance_minutes?: number
          updated_at?: string
          weekly_hours?: number
        }
        Relationships: []
      }
    }
    Views: {
      normalized_production_status: {
        Row: {
          code: string | null
          id: string | null
          normalized_status: string | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          normalized_status?: never
        }
        Update: {
          code?: string | null
          id?: string | null
          normalized_status?: never
        }
        Relationships: []
      }
      product_stock_with_reservations: {
        Row: {
          active: boolean | null
          available_quantity: number | null
          box_type_id: string | null
          brand: string | null
          calculation_method: string | null
          category: string | null
          color: string | null
          consumption_unit: string | null
          conversion_rate: number | null
          created_at: string | null
          current_stock: number | null
          dimensions_height: number | null
          dimensions_length: number | null
          dimensions_thickness: number | null
          dimensions_unit: string | null
          dimensions_width: number | null
          expiration_date: string | null
          group_id: string | null
          heel_height: number | null
          id: string | null
          image_url: string | null
          in_production_quantity: number | null
          insole_mode: Database["public"]["Enums"]["insole_mode_enum"] | null
          is_artisanal: boolean | null
          is_chemical: boolean | null
          is_standard_sole_item: boolean | null
          lead_time_days: number | null
          linked_last_id: string | null
          location: string | null
          lot_number: string | null
          max_stock: number | null
          min_order_quantity: number | null
          min_stock: number | null
          min_stock_grade: Json | null
          model: string | null
          name: string | null
          pairs_per_package: number | null
          preferred_supplier_id: string | null
          price_retail: number | null
          price_wholesale: number | null
          production_unit: string | null
          purchase_order_unit: string | null
          purchase_unit: string | null
          quantity: number | null
          requires_sewing: boolean | null
          reserved_quantity: number | null
          reserved_stock: number | null
          safety_stock: number | null
          sku: string | null
          sole_material: string | null
          sole_moq: number | null
          sole_technical_notes: string | null
          stock_grade: Json | null
          supplier_id: string | null
          supplier_lead_time_days: number | null
          technical_name: string | null
          unit: string | null
          unit_price: number | null
          updated_at: string | null
          yield_per_meter: number | null
          yield_unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_box_type_id_fkey"
            columns: ["box_type_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "products_preferred_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_preferred_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      purchase_projection_timeline: {
        Row: {
          data_chegada_material: string | null
          data_entrega_cliente: string | null
          data_inicio_acabamento: string | null
          data_inicio_colagem: string | null
          data_inicio_corte: string | null
          data_inicio_costura: string | null
          data_inicio_expedicao: string | null
          data_inicio_mesa: string | null
          data_inicio_montagem: string | null
          data_inicio_silk: string | null
          data_limite_compra: string | null
          estoque_atual: number | null
          grupo_material: string | null
          lead_time_acabamento_dias: number | null
          lead_time_buffer_material_dias: number | null
          lead_time_colagem_dias: number | null
          lead_time_corte_dias: number | null
          lead_time_costura_dias: number | null
          lead_time_expedicao_dias: number | null
          lead_time_mesa_dias: number | null
          lead_time_montagem_dias: number | null
          lead_time_silk_dias: number | null
          material: string | null
          material_group_id: string | null
          material_id: string | null
          min_stock: number | null
          op_quantity: number | null
          order_id: string | null
          order_status: string | null
          pedido_ref: string | null
          quantidade_necessaria: number | null
          reference_id: string | null
          referencia_nome: string | null
          sale_order_id: string | null
          supplier_id: string | null
          supplier_lead_time_days: number | null
          supplier_name: string | null
          unidade: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "products_group_id_fkey"
            columns: ["material_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      report_material_needs_by_group: {
        Row: {
          current_stock: number | null
          group_name: string | null
          material_name: string | null
          missing_qty: number | null
          total_needed: number | null
          unit: string | null
        }
        Relationships: []
      }
      sale_order_min_billing: {
        Row: {
          delivery_deadline: string | null
          manual_billing_override: boolean | null
          min_billing_date: string | null
          original_min_billing_date: string | null
          sale_order_id: string | null
        }
        Insert: {
          delivery_deadline?: string | null
          manual_billing_override?: boolean | null
          min_billing_date?: never
          original_min_billing_date?: string | null
          sale_order_id?: string | null
        }
        Update: {
          delivery_deadline?: string | null
          manual_billing_override?: boolean | null
          min_billing_date?: never
          original_min_billing_date?: string | null
          sale_order_id?: string | null
        }
        Relationships: []
      }
      v_capacity_driven_lead_times: {
        Row: {
          assembly_capacity_per_day: number | null
          current_load_acabamento: number | null
          current_load_colagem: number | null
          current_load_corte: number | null
          current_load_expedicao: number | null
          current_load_forracao: number | null
          current_load_montagem: number | null
          current_load_silk: number | null
          cutting_capacity_per_day: number | null
          dynamic_days_acabamento: number | null
          dynamic_days_colagem: number | null
          dynamic_days_corte: number | null
          dynamic_days_forracao: number | null
          dynamic_days_montagem: number | null
          dynamic_days_silk: number | null
          finishing_capacity_per_day: number | null
          forracao_capacity_per_day: number | null
          gluing_capacity_per_day: number | null
          lead_time_buffer_material_dias: number | null
          notes: string | null
          shoe_category: string | null
          silk_capacity_per_day: number | null
          total_dynamic_lead_time_days: number | null
        }
        Relationships: []
      }
      v_client_credit_exposure: {
        Row: {
          available_credit: number | null
          client_id: string | null
          credit_limit: number | null
          nome_fantasia: string | null
          open_ar_count: number | null
          open_exposure: number | null
          razao_social: string | null
        }
        Relationships: []
      }
      v_late_orders: {
        Row: {
          client_name: string | null
          color: string | null
          days_late: number | null
          due_date: string | null
          id: string | null
          order_number: string | null
          quantity: number | null
          reference_code: string | null
          reference_id: string | null
          reference_name: string | null
          sale_order_id: string | null
          sale_order_number: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_packaging_costs"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      v_mrp_needs: {
        Row: {
          balance: number | null
          current_stock: number | null
          earliest_deadline: string | null
          order_ids: string[] | null
          orders_count: number | null
          product_id: string | null
          product_name: string | null
          total_required: number | null
        }
        Relationships: []
      }
      v_order_profitability: {
        Row: {
          client_name: string | null
          last_calculated_at: string | null
          margin_pct: number | null
          order_number: string | null
          sale_order_id: string | null
          status: string | null
          total_cost: number | null
          total_labor: number | null
          total_margin: number | null
          total_material: number | null
          total_overhead: number | null
          total_revenue: number | null
          total_units: number | null
        }
        Relationships: []
      }
      v_overdue_purchase_orders: {
        Row: {
          days_overdue: number | null
          id: string | null
          order_number: string | null
          promised_date: string | null
          status: string | null
          supplier_id: string | null
          supplier_name: string | null
          total_value: number | null
        }
        Insert: {
          days_overdue?: never
          id?: string | null
          order_number?: string | null
          promised_date?: string | null
          status?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_value?: number | null
        }
        Update: {
          days_overdue?: never
          id?: string | null
          order_number?: string | null
          promised_date?: string | null
          status?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      v_packaging_costs: {
        Row: {
          packaging_cost_per_pair: number | null
          sheet_id: string | null
        }
        Relationships: []
      }
      v_product_price_summary: {
        Row: {
          avg_price: number | null
          last_purchased: string | null
          latest_price: number | null
          max_price: number | null
          min_price: number | null
          previous_price: number | null
          product_id: string | null
          product_name: string | null
          purchase_count: number | null
          supplier_id: string | null
          supplier_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      v_production_planning_kpis: {
        Row: {
          daily_capacity: number | null
          days_of_backlog: number | null
          in_progress_pairs: number | null
          orders_count: number | null
          pending_pairs: number | null
          risk_level: string | null
          sector: string | null
          total_pairs: number | null
        }
        Relationships: []
      }
      v_sector_board: {
        Row: {
          active_wave: Json | null
          completed_count: number | null
          next_wave: Json | null
          ord: number | null
          stage: Database["public"]["Enums"]["production_stage_enum"] | null
        }
        Relationships: []
      }
      v_sector_load: {
        Row: {
          load_acabamento: number | null
          load_colagem: number | null
          load_corte: number | null
          load_expedicao: number | null
          load_forracao: number | null
          load_montagem: number | null
          load_silk: number | null
          shoe_category: string | null
        }
        Relationships: []
      }
      v_stage_quality: {
        Row: {
          defect_rate: number | null
          inspections_count: number | null
          produced_quantity: number | null
          stage: Database["public"]["Enums"]["production_stage_enum"] | null
          total_defects: number | null
          wave_id: string | null
          wave_stage_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_wave_stages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "normalized_production_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_stages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "production_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_stages_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_wave_detail"
            referencedColumns: ["wave_id"]
          },
        ]
      }
      v_supplier_price_history: {
        Row: {
          invoice_id: string | null
          invoice_number: string | null
          issue_date: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          supplier_id: string | null
          supplier_name: string | null
          unit: string | null
          unit_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      v_wave_detail: {
        Row: {
          acabamento_start_date: string | null
          code: string | null
          colagem_start_date: string | null
          corte_forracao_start_date: string | null
          corte_palmilha_start_date: string | null
          current_stage:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline: string | null
          items: Json | null
          material_ready_date: string | null
          mesa_start_date: string | null
          montagem_start_date: string | null
          purchase_deadline: string | null
          silk_start_date: string | null
          solagem_start_date: string | null
          stages: Json | null
          total_items: number | null
          total_pairs: number | null
          wave_id: string | null
          wave_status: Database["public"]["Enums"]["wave_status_enum"] | null
          week_end: string | null
          week_start: string | null
        }
        Insert: {
          acabamento_start_date?: string | null
          code?: string | null
          colagem_start_date?: string | null
          corte_forracao_start_date?: string | null
          corte_palmilha_start_date?: string | null
          current_stage?:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline?: string | null
          items?: never
          material_ready_date?: string | null
          mesa_start_date?: string | null
          montagem_start_date?: string | null
          purchase_deadline?: string | null
          silk_start_date?: string | null
          solagem_start_date?: string | null
          stages?: never
          total_items?: number | null
          total_pairs?: number | null
          wave_id?: string | null
          wave_status?: Database["public"]["Enums"]["wave_status_enum"] | null
          week_end?: string | null
          week_start?: string | null
        }
        Update: {
          acabamento_start_date?: string | null
          code?: string | null
          colagem_start_date?: string | null
          corte_forracao_start_date?: string | null
          corte_palmilha_start_date?: string | null
          current_stage?:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline?: string | null
          items?: never
          material_ready_date?: string | null
          mesa_start_date?: string | null
          montagem_start_date?: string | null
          purchase_deadline?: string | null
          silk_start_date?: string | null
          solagem_start_date?: string | null
          stages?: never
          total_items?: number | null
          total_pairs?: number | null
          wave_id?: string | null
          wave_status?: Database["public"]["Enums"]["wave_status_enum"] | null
          week_end?: string | null
          week_start?: string | null
        }
        Relationships: []
      }
      v_wave_orders: {
        Row: {
          client_fantasy: string | null
          client_name: string | null
          delivery_deadline: string | null
          order_number: string | null
          order_status: string | null
          sale_order_id: string | null
          source_count: number | null
          total_pairs: number | null
          wave_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_wave_items_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "normalized_production_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "production_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_wave_detail"
            referencedColumns: ["wave_id"]
          },
        ]
      }
      vw_cash_flow_projection: {
        Row: {
          daily_net: number | null
          due_date: string | null
          total_inflow: number | null
          total_outflow: number | null
        }
        Relationships: []
      }
      vw_costura_queue: {
        Row: {
          color: string | null
          grade: Json | null
          order_id: string | null
          order_number: string | null
          planned_delivery: string | null
          planned_start: string | null
          quantity: number | null
          quantity_processed: number | null
          quantity_total: number | null
          reference_code: string | null
          reference_name: string | null
          sale_order_id: string | null
          sewing_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      vw_material_projected_availability: {
        Row: {
          id: string | null
          name: string | null
          projected_availability: number | null
          stock_actual: number | null
          stock_min: number | null
          total_reserved: number | null
        }
        Relationships: []
      }
      vw_necessidade_corte: {
        Row: {
          consumo_unitario: number | null
          material: string | null
          modelo: string | null
          order_number: string | null
          part_name: string | null
          qty_pedido: number | null
          total_necessario: number | null
          unidade: string | null
          wastage_percentage: number | null
        }
        Relationships: []
      }
      vw_necessidade_costura: {
        Row: {
          componente_a_costurar: string | null
          modelo: string | null
          operacao_costura: string | null
          order_number: string | null
        }
        Relationships: []
      }
      vw_production_labels: {
        Row: {
          color_name: string | null
          display_image: string | null
          product_name: string | null
          size: string | null
          sku: string | null
          variant_id: string | null
        }
        Relationships: []
      }
      vw_supplier_quality_rating: {
        Row: {
          quality_score: number | null
          supplier_id: string | null
          supplier_name: string | null
          total_receipts: number | null
        }
        Relationships: []
      }
      vw_virtual_cfo_cashflow: {
        Row: {
          categoria: string | null
          data_movimento: string | null
          status: string | null
          tipo: string | null
          valor: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _calc_required_per_size: {
        Args: {
          p_consumption_per_size: Json
          p_fallback_consumption: number
          p_order_grade: Json
          p_order_quantity: number
        }
        Returns: number
      }
      _is_immediate_debit_category: {
        Args: { p_category: string }
        Returns: boolean
      }
      _resolve_upper_option: {
        Args: { p_color: string; p_reference_id: string }
        Returns: {
          consumption: number
          consumption_per_size: Json
          group_name: string
        }[]
      }
      add_business_days:
        | { Args: { p_days: number; p_start_date: string }; Returns: string }
        | { Args: { p_days: number; p_start_date: string }; Returns: string }
      adjust_stock: {
        Args: {
          p_delta: number
          p_expected_previous_qty: number
          p_new_grade?: Json
          p_new_qty: number
          p_product_id: string
          p_reason: string
        }
        Returns: {
          current_db_qty: number
          error_message: string
          success: boolean
        }[]
      }
      advance_wave_stage: {
        Args: {
          p_stage?: Database["public"]["Enums"]["production_stage_enum"]
          p_wave_id: string
        }
        Returns: Database["public"]["Enums"]["production_stage_enum"]
      }
      assert_admin_or_gerente: { Args: never; Returns: undefined }
      audit_unit_divergences: { Args: never; Returns: Json }
      auto_assign_sale_order_to_wave: {
        Args: { p_sale_order_id: string }
        Returns: string
      }
      auto_start_due_waves: { Args: never; Returns: number }
      calc_required_for_grade: {
        Args: {
          p_consumption_per_size: Json
          p_order_grade: Json
          p_quantity_per_unit: number
          p_total_quantity: number
        }
        Returns: number
      }
      calculate_order_consumption:
        | {
            Args: {
              p_color: string
              p_order_quantity: number
              p_reference_id: string
              p_size?: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_color: string
              p_material_variant_id?: string
              p_order_quantity: number
              p_reference_id: string
              p_size?: number
            }
            Returns: Json
          }
      calculate_order_consumption_by_grade:
        | {
            Args: { p_color: string; p_grade: Json; p_reference_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_color: string
              p_grade: Json
              p_material_variant_id?: string
              p_reference_id: string
            }
            Returns: Json
          }
      calculate_order_cost: {
        Args: {
          p_persist?: boolean
          p_sale_order_id: string
          p_sale_order_item_id?: string
        }
        Returns: Json
      }
      calculate_order_item_costs: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      cancel_wave: {
        Args: { p_reason?: string; p_wave_id: string }
        Returns: undefined
      }
      check_schema_objects: { Args: never; Returns: Json }
      check_stock_availability:
        | {
            Args: { p_order_quantity: number; p_reference_id: string }
            Returns: {
              available: number
              product_id: string
              product_name: string
              required: number
              sufficient: boolean
            }[]
          }
        | {
            Args: {
              p_color?: string
              p_order_quantity: number
              p_reference_id: string
            }
            Returns: {
              available: number
              product_id: string
              product_name: string
              required: number
              sufficient: boolean
            }[]
          }
        | {
            Args: {
              p_color?: string
              p_order_grade?: Json
              p_order_quantity: number
              p_reference_id: string
            }
            Returns: {
              available: number
              product_id: string
              product_name: string
              required: number
              sufficient: boolean
            }[]
          }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
      compute_min_billing_date: {
        Args: { p_sale_order_id: string }
        Returns: string
      }
      compute_wave_timeline: {
        Args: { p_sale_order_ids: string[] }
        Returns: {
          acabamento_start_date: string
          colagem_start_date: string
          corte_forracao_start_date: string
          corte_palmilha_start_date: string
          earliest_deadline: string
          material_ready_date: string
          mesa_start_date: string
          montagem_start_date: string
          purchase_deadline: string
          silk_start_date: string
          solagem_start_date: string
        }[]
      }
      confirm_picking_reservation: {
        Args: { p_picked_by?: string; p_reservation_id: string }
        Returns: undefined
      }
      convert_reservation_to_out: {
        Args: { p_order_id: string; p_product_id?: string }
        Returns: undefined
      }
      create_artisanal_product_with_stock: {
        Args: {
          p_color?: string
          p_name: string
          p_order_id?: string
          p_quantity?: number
          p_reason?: string
          p_unit?: string
        }
        Returns: string
      }
      create_product_with_initial_stock: {
        Args: {
          p_category?: string
          p_description?: string
          p_group_id?: string
          p_location?: string
          p_max_stock?: number
          p_min_stock?: number
          p_name: string
          p_quantity?: number
          p_reason?: string
          p_sku?: string
          p_supplier_id?: string
          p_unit?: string
          p_unit_price?: number
        }
        Returns: string
      }
      create_production_wave:
        | {
            Args: {
              p_sale_order_ids: string[]
              p_start_mode?: string
              p_week_start?: string
            }
            Returns: string
          }
        | {
            Args: { p_sale_order_ids: string[]; p_week_start: string }
            Returns: string
          }
      create_solo_wave: { Args: { p_sale_order_id: string }; Returns: string }
      create_wave_from_sale_order: {
        Args: { p_sale_order_id: string }
        Returns: string
      }
      debit_packaging_for_order: {
        Args: {
          p_order_id: string
          p_order_quantity: number
          p_packaging_mode?: string
          p_reference_id: string
          p_sale_order_id: string
        }
        Returns: Json
      }
      debit_packaging_for_order_atomic: {
        Args: {
          p_order_id: string
          p_packaging_product_id: string
          p_packaging_type?: string
          p_quantity: number
        }
        Returns: Json
      }
      debit_packaging_stock: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      debit_packaging_stock_atomic: {
        Args: {
          p_packaging_id: string
          p_quantity: number
          p_reference_id: string
          p_reference_type: string
        }
        Returns: undefined
      }
      debit_sole_stock_by_grade: {
        Args: {
          p_color: string
          p_order_grade: Json
          p_order_id: string
          p_reference_id: string
        }
        Returns: undefined
      }
      debit_stock_for_order:
        | {
            Args: { p_order_quantity: number; p_reference_id: string }
            Returns: undefined
          }
        | {
            Args: {
              p_color?: string
              p_order_quantity: number
              p_reference_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_color: string
              p_order_id: string
              p_order_quantity: number
              p_reference_id: string
            }
            Returns: undefined
          }
      debit_strap_materials: {
        Args: {
          p_color: string
          p_order_id: string
          p_order_quantity: number
          p_reference_id: string
        }
        Returns: undefined
      }
      debit_strap_stock: {
        Args: {
          p_order_grade?: Json
          p_order_id?: string
          p_order_quantity: number
          p_strap_colors: Json
        }
        Returns: undefined
      }
      delete_empty_sale_order: {
        Args: { p_sale_order_id: string }
        Returns: boolean
      }
      estimate_delivery_date: {
        Args: { p_quantity: number; p_shoe_category: string }
        Returns: string
      }
      finalize_production_sector: {
        Args: { p_current_sector: string; p_order_id: string }
        Returns: Json
      }
      fn_audit_log_cleanup: { Args: never; Returns: undefined }
      fn_projected_demand:
        | {
            Args: never
            Returns: {
              earliest_deadline: string
              order_ids: string[]
              orders_count: number
              product_id: string
              product_name: string
              total_required: number
            }[]
          }
        | { Args: { p_product_id: string }; Returns: number }
      force_sale_order_production: {
        Args: { p_sale_order_id: string }
        Returns: Json
      }
      freeze_technical_sheet:
        | {
            Args: {
              p_color: string
              p_quantity: number
              p_reference_id: string
              p_sale_order_id: string
              p_sale_order_item_id: string
              p_size?: number
            }
            Returns: string
          }
        | {
            Args: {
              p_color: string
              p_grade?: Json
              p_quantity: number
              p_reference_id: string
              p_sale_order_id: string
              p_sale_order_item_id: string
              p_size?: number
            }
            Returns: string
          }
      generate_purchase_orders_from_mrp: {
        Args: { p_product_ids?: string[] }
        Returns: string[]
      }
      get_applied_migrations: {
        Args: never
        Returns: {
          name: string
          statements_count: number
          version: string
        }[]
      }
      get_distinct_batches: {
        Args: never
        Returns: {
          import_batch: string
        }[]
      }
      get_in_production_stock: {
        Args: never
        Returns: {
          in_production_quantity: number
          product_id: string
        }[]
      }
      get_insole_mode: {
        Args: { p_sole_product_id: string }
        Returns: Database["public"]["Enums"]["insole_mode_enum"]
      }
      get_inventory_summary: { Args: never; Returns: Json }
      get_material_conversion_info: {
        Args: { p_product_id: string }
        Returns: {
          dm2_per_unit: number
          target_unit: string
          waste_pct: number
        }[]
      }
      get_order_material_status: {
        Args: { p_order_id: string }
        Returns: string
      }
      get_sole_group_id_for_product: {
        Args: { p_product_id: string }
        Returns: string
      }
      get_sole_size_key: {
        Args: { p_shoe_size: number; p_sole_group_id: string }
        Returns: string
      }
      get_wave_material_needs: {
        Args: { p_sale_order_ids: string[] }
        Returns: {
          artisanal_recipe_id: string
          artisanal_recipe_name: string
          base_needed_qty: number
          base_product_id: string
          base_product_name: string
          base_shortage: number
          base_stock_qty: number
          color: string
          is_artisanal: boolean
          needed_qty: number
          os_send_date: string
          product_id: string
          product_name: string
          shortage: number
          stock_qty: number
          supplier_id: string
          supplier_lead_time_days: number
          supplier_name: string
          unit: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hybrid_debit_stock_for_order:
        | {
            Args: {
              p_color?: string
              p_order_id?: string
              p_order_quantity: number
              p_reference_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_color?: string
              p_order_id?: string
              p_order_quantity: number
              p_reference_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_color: string
              p_order_grade?: Json
              p_order_id: string
              p_order_quantity: number
              p_reference_id: string
            }
            Returns: Json
          }
      import_time_records_safe: { Args: { records: Json }; Returns: Json }
      is_admin_or_gerente: { Args: { _user_id: string }; Returns: boolean }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      is_approved_user: { Args: never; Returns: boolean }
      kanban_stage_to_wave_stage: {
        Args: { p_stage_name: string }
        Returns: Database["public"]["Enums"]["production_stage_enum"]
      }
      next_manifest_number: { Args: never; Returns: string }
      parse_iso_billing_week: { Args: { p_text: string }; Returns: string }
      process_order_stock_out: {
        Args: { p_order_id: string; p_product_id: string; p_quantity: number }
        Returns: Json
      }
      process_resync_queue: { Args: { p_limit?: number }; Returns: Json }
      propagate_component_sole_to_sheets: {
        Args: { p_component_sheet_id: string; p_sole_group_id: string }
        Returns: Json
      }
      recalc_sale_order_total: {
        Args: { p_sale_order_id: string }
        Returns: number
      }
      register_defect_and_adjust_wave: {
        Args: {
          p_color?: string
          p_defect_qty: number
          p_product_ref?: string
          p_reason: string
          p_wave_stage_id: string
        }
        Returns: Json
      }
      register_order_shipment: {
        Args: {
          p_checked_by?: string
          p_manifest_id?: string
          p_sale_order_ids: string[]
        }
        Returns: number
      }
      release_order_reservations: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      repair_missing_wave_assignments: { Args: never; Returns: number }
      reserve_material_for_order: {
        Args: {
          p_order_id: string
          p_product_id: string
          p_quantity_needed: number
        }
        Returns: undefined
      }
      resolve_billing_week_for_order: {
        Args: { p_sale_order_id: string }
        Returns: string
      }
      resolve_material_product: {
        Args: {
          p_check_stock?: boolean
          p_color: string
          p_group_name: string
          p_required?: number
        }
        Returns: {
          available_qty: number
          matched_by: string
          product_id: string
          product_name: string
        }[]
      }
      resolve_sole_color: {
        Args: { p_product_color: string; p_sheet_id: string }
        Returns: {
          sole_color: string
          sole_product_id: string
        }[]
      }
      resolve_upper_material_for_variant: {
        Args: {
          p_color: string
          p_group_name: string
          p_required: number
          p_variant_id: string
        }
        Returns: {
          available_qty: number
          matched_by: string
          product_id: string
          product_name: string
        }[]
      }
      restore_product_stocks_for_order: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      restore_sole_grade_for_order: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      resync_all_production_metrics: { Args: never; Returns: undefined }
      resync_op_atomic: { Args: { p_order_id: string }; Returns: Json }
      run_consumption_integration_tests: {
        Args: never
        Returns: {
          case_name: string
          message: string
          ok: boolean
        }[]
      }
      sector_display_to_enum: {
        Args: { p_name: string }
        Returns: Database["public"]["Enums"]["production_stage_enum"]
      }
      split_wave_to_finishing: { Args: { p_wave_id: string }; Returns: number }
      stage_order:
        | { Args: { p_stage: string }; Returns: number }
        | {
            Args: { s: Database["public"]["Enums"]["production_stage_enum"] }
            Returns: number
          }
      stage_starts_with_wave: {
        Args: { s: Database["public"]["Enums"]["production_stage_enum"] }
        Returns: boolean
      }
      start_wave: { Args: { p_wave_id: string }; Returns: undefined }
      sync_sale_order_wave_items: {
        Args: { p_sale_order_id: string }
        Returns: undefined
      }
      sync_wave_from_kanban: {
        Args: { p_wave_id: string }
        Returns: Database["public"]["Enums"]["production_stage_enum"]
      }
      try_reserve_materials: {
        Args: {
          p_allow_expedite?: boolean
          p_color?: string
          p_consider_safety_stock?: boolean
          p_consolidate_po?: boolean
          p_order_id: string
          p_order_quantity: number
          p_permit_partial?: boolean
          p_priority?: string
          p_production_date?: string
          p_reference_id: string
        }
        Returns: Json
      }
      update_sale_order_atomic: {
        Args: { p_header: Json; p_items: Json; p_order_id: string }
        Returns: Json
      }
      update_wave_timeline: { Args: { p_wave_id: string }; Returns: undefined }
      upsert_po_item_atomic:
        | {
            Args: {
              p_color?: string
              p_grade?: Json
              p_notes?: string
              p_order_id: string
              p_product_id: string
              p_quantity: number
              p_unit_price: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_color?: string
              p_current_stock?: number
              p_grade_delta?: Json
              p_max_stock?: number
              p_min_stock?: number
              p_po_id: string
              p_product_id: string
              p_qty_delta: number
              p_unit?: string
              p_unit_price: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_notes?: string
              p_product_id: string
              p_purchase_order_id: string
              p_quantity: number
              p_unit_price: number
            }
            Returns: undefined
          }
      upsert_purchase_order_items: {
        Args: { p_items: Json; p_order_id: string }
        Returns: undefined
      }
      upsert_purchase_order_items_atomic: {
        Args: { p_items: Json; p_order_id: string }
        Returns: undefined
      }
      upsert_ready_stock_atomic: {
        Args: {
          p_color: string
          p_location?: string
          p_notes?: string
          p_qty_delta: number
          p_reference_id: string
          p_size: string
        }
        Returns: undefined
      }
      wave_is_active: { Args: { wave_id: string }; Returns: boolean }
      wave_stage_to_kanban_stages: {
        Args: { s: Database["public"]["Enums"]["production_stage_enum"] }
        Returns: string[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "gerente"
        | "producao"
        | "almoxarifado"
        | "comercial"
        | "consulta"
      insole_mode_enum: "cortar" | "pronta_na_cor"
      pessoa_tipo: "FISICA" | "JURIDICA"
      production_stage_enum:
        | "corte"
        | "palmilha"
        | "costura"
        | "montagem"
        | "solagem"
        | "mesa"
        | "acabamento"
        | "corte_palmilha"
        | "corte_forracao"
        | "silk"
        | "colagem"
        | "expedicao"
      stage_status_enum: "pending" | "in_progress" | "completed" | "blocked"
      tarifa_tipo: "POR_KG" | "POR_M3" | "FIXO"
      wave_status_enum:
        | "draft"
        | "planning"
        | "running"
        | "finished"
        | "cancelled"
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
      app_role: [
        "admin",
        "gerente",
        "producao",
        "almoxarifado",
        "comercial",
        "consulta",
      ],
      insole_mode_enum: ["cortar", "pronta_na_cor"],
      pessoa_tipo: ["FISICA", "JURIDICA"],
      production_stage_enum: [
        "corte",
        "palmilha",
        "costura",
        "montagem",
        "solagem",
        "mesa",
        "acabamento",
        "corte_palmilha",
        "corte_forracao",
        "silk",
        "colagem",
        "expedicao",
      ],
      stage_status_enum: ["pending", "in_progress", "completed", "blocked"],
      tarifa_tipo: ["POR_KG", "POR_M3", "FIXO"],
      wave_status_enum: [
        "draft",
        "planning",
        "running",
        "finished",
        "cancelled",
      ],
    },
  },
} as const
