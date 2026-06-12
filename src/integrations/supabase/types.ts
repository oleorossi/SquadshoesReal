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
          reference_id: string | null
          reference_type: string | null
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
          reference_id?: string | null
          reference_type?: string | null
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
          reference_id?: string | null
          reference_type?: string | null
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
          {
            foreignKeyName: "accounts_receivable_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "accounts_receivable_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_value: number | null
          min_value: number
          required_role: string
          rule_type: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_value?: number | null
          min_value?: number
          required_role: string
          rule_type: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_value?: number | null
          min_value?: number
          required_role?: string
          rule_type?: string
        }
        Relationships: []
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
          {
            foreignKeyName: "artisanal_recipes_default_contractor_id_fkey"
            columns: ["default_contractor_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_metrics"
            referencedColumns: ["contractor_id"]
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
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      bank_hours_movements: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          employee_id: string
          id: string
          minutes: number
          movement_date: string
          movement_type: string
          overtime_pct: number
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          employee_id: string
          id?: string
          minutes: number
          movement_date: string
          movement_type?: string
          overtime_pct?: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          employee_id?: string
          id?: string
          minutes?: number
          movement_date?: string
          movement_type?: string
          overtime_pct?: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_hours_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "bank_hours_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_hours_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "bank_hours_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "bank_hours_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "bank_hours_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      bank_reconciliation_items: {
        Row: {
          amount: number
          bank_reference: string | null
          description: string | null
          id: string
          matched_at: string | null
          matched_by: string | null
          matched_to_id: string | null
          matched_to_type: string | null
          movement_date: string
          movement_type: string
          notes: string | null
          reconciliation_id: string
          status: string
        }
        Insert: {
          amount: number
          bank_reference?: string | null
          description?: string | null
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          matched_to_id?: string | null
          matched_to_type?: string | null
          movement_date: string
          movement_type: string
          notes?: string | null
          reconciliation_id: string
          status?: string
        }
        Update: {
          amount?: number
          bank_reference?: string | null
          description?: string | null
          id?: string
          matched_at?: string | null
          matched_by?: string | null
          matched_to_id?: string | null
          matched_to_type?: string | null
          movement_date?: string
          movement_type?: string
          notes?: string | null
          reconciliation_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliation_items_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliations: {
        Row: {
          bank_account_id: string
          id: string
          imported_at: string
          imported_by: string | null
          matched_count: number
          notes: string | null
          reconciliation_date: string
          status: string
          total_credits: number
          total_debits: number
          unmatched_count: number
        }
        Insert: {
          bank_account_id: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          matched_count?: number
          notes?: string | null
          reconciliation_date: string
          status?: string
          total_credits?: number
          total_debits?: number
          unmatched_count?: number
        }
        Update: {
          bank_account_id?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          matched_count?: number
          notes?: string | null
          reconciliation_date?: string
          status?: string
          total_credits?: number
          total_debits?: number
          unmatched_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
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
      benefits_config: {
        Row: {
          created_at: string
          health_plan_default: number
          id: string
          monthly_hours: number
          night_bonus_pct: number
          night_shift_end_min: number
          night_shift_start_min: number
          notes: string | null
          overtime_100_pct: number
          overtime_50_pct: number
          updated_at: string
          va_monthly_value: number
          vr_daily_value: number
          vt_daily_value: number
          vt_employee_discount_pct: number
        }
        Insert: {
          created_at?: string
          health_plan_default?: number
          id?: string
          monthly_hours?: number
          night_bonus_pct?: number
          night_shift_end_min?: number
          night_shift_start_min?: number
          notes?: string | null
          overtime_100_pct?: number
          overtime_50_pct?: number
          updated_at?: string
          va_monthly_value?: number
          vr_daily_value?: number
          vt_daily_value?: number
          vt_employee_discount_pct?: number
        }
        Update: {
          created_at?: string
          health_plan_default?: number
          id?: string
          monthly_hours?: number
          night_bonus_pct?: number
          night_shift_end_min?: number
          night_shift_start_min?: number
          notes?: string | null
          overtime_100_pct?: number
          overtime_50_pct?: number
          updated_at?: string
          va_monthly_value?: number
          vr_daily_value?: number
          vt_daily_value?: number
          vt_employee_discount_pct?: number
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "bom_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "bom_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "bom_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "bom_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "bom_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "bom_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "bom_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "bom_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          metros_per_amarrado_default: number | null
          min_stock: number
          nome: string
          empty_weight_kg: number | null
          pairs_per_box_default: number | null
          peso_kg: number | null
          quantity: number
          supplier_id: string | null
          tipo: Database["public"]["Enums"]["box_type_kind"] | null
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
          metros_per_amarrado_default?: number | null
          min_stock: number
          nome: string
          empty_weight_kg?: number | null
          pairs_per_box_default?: number | null
          peso_kg?: number | null
          quantity: number
          supplier_id?: string | null
          tipo?: Database["public"]["Enums"]["box_type_kind"] | null
          unit_price: number
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
          metros_per_amarrado_default?: number | null
          min_stock?: number
          nome?: string
          empty_weight_kg?: number | null
          pairs_per_box_default?: number | null
          peso_kg?: number | null
          quantity?: number
          supplier_id?: string | null
          tipo?: Database["public"]["Enums"]["box_type_kind"] | null
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
            foreignKeyName: "client_representatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_representatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_representatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
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
          address_manual_override: string | null
          address_override_history: Json | null
          bairro: string | null
          birthday: string | null
          branch_code: string | null
          branch_name: string | null
          cep: string | null
          cidade: string | null
          client_number: string | null
          client_type: string | null
          cnpj: string | null
          codigo_municipio: string | null
          commercial_block: boolean
          commercial_block_date: string | null
          commercial_block_reason: string | null
          complemento: string | null
          consumidor_final: number | null
          contato: string | null
          created_at: string
          credit_limit: number
          economic_group_id: string | null
          email: string | null
          endereco: string | null
          endereco_manual_override: string | null
          endereco_updated_at: string | null
          estado: string | null
          gestaoclick_id: string | null
          icms_contribuinte: boolean | null
          id: string
          indicador_ie: number | null
          inscricao_estadual: string | null
          is_favorite: boolean
          is_matriz: boolean
          logo_url: string | null
          max_discount_pct: number
          nome_fantasia: string | null
          notes: string | null
          numero: string | null
          optante_simples_nacional: boolean
          preferred_transporter_id: string | null
          price_list_id: string | null
          razao_social: string
          regime_tributario: string | null
          sales_channel: string | null
          score_class: string | null
          silk_url: string | null
          suframa: string | null
          tags: string[] | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          accepts_bundled_packaging?: boolean | null
          active?: boolean
          address_manual_override?: string | null
          address_override_history?: Json | null
          bairro?: string | null
          birthday?: string | null
          branch_code?: string | null
          branch_name?: string | null
          cep?: string | null
          cidade?: string | null
          client_number?: string | null
          client_type?: string | null
          cnpj?: string | null
          codigo_municipio?: string | null
          commercial_block?: boolean
          commercial_block_date?: string | null
          commercial_block_reason?: string | null
          complemento?: string | null
          consumidor_final?: number | null
          contato?: string | null
          created_at?: string
          credit_limit?: number
          economic_group_id?: string | null
          email?: string | null
          endereco?: string | null
          endereco_manual_override?: string | null
          endereco_updated_at?: string | null
          estado?: string | null
          gestaoclick_id?: string | null
          icms_contribuinte?: boolean | null
          id?: string
          indicador_ie?: number | null
          inscricao_estadual?: string | null
          is_favorite?: boolean
          is_matriz?: boolean
          logo_url?: string | null
          max_discount_pct?: number
          nome_fantasia?: string | null
          notes?: string | null
          numero?: string | null
          optante_simples_nacional?: boolean
          preferred_transporter_id?: string | null
          price_list_id?: string | null
          razao_social: string
          regime_tributario?: string | null
          sales_channel?: string | null
          score_class?: string | null
          silk_url?: string | null
          suframa?: string | null
          tags?: string[] | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          accepts_bundled_packaging?: boolean | null
          active?: boolean
          address_manual_override?: string | null
          address_override_history?: Json | null
          bairro?: string | null
          birthday?: string | null
          branch_code?: string | null
          branch_name?: string | null
          cep?: string | null
          cidade?: string | null
          client_number?: string | null
          client_type?: string | null
          cnpj?: string | null
          codigo_municipio?: string | null
          commercial_block?: boolean
          commercial_block_date?: string | null
          commercial_block_reason?: string | null
          complemento?: string | null
          consumidor_final?: number | null
          contato?: string | null
          created_at?: string
          credit_limit?: number
          economic_group_id?: string | null
          email?: string | null
          endereco?: string | null
          endereco_manual_override?: string | null
          endereco_updated_at?: string | null
          estado?: string | null
          gestaoclick_id?: string | null
          icms_contribuinte?: boolean | null
          id?: string
          indicador_ie?: number | null
          inscricao_estadual?: string | null
          is_favorite?: boolean
          is_matriz?: boolean
          logo_url?: string | null
          max_discount_pct?: number
          nome_fantasia?: string | null
          notes?: string | null
          numero?: string | null
          optante_simples_nacional?: boolean
          preferred_transporter_id?: string | null
          price_list_id?: string | null
          razao_social?: string
          regime_tributario?: string | null
          sales_channel?: string | null
          score_class?: string | null
          silk_url?: string | null
          suframa?: string | null
          tags?: string[] | null
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
          {
            foreignKeyName: "clients_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_credit"
            referencedColumns: ["economic_group_id"]
          },
          {
            foreignKeyName: "clients_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_kpis"
            referencedColumns: ["economic_group_id"]
          },
          {
            foreignKeyName: "clients_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      cnab_remittance_files: {
        Row: {
          bank_account_id: string | null
          cnab_layout: string
          file_content: string | null
          filename: string
          generated_at: string
          generated_by: string | null
          id: string
          notes: string | null
          return_filename: string | null
          return_received_at: string | null
          status: string
          total_records: number
          total_value: number
        }
        Insert: {
          bank_account_id?: string | null
          cnab_layout: string
          file_content?: string | null
          filename: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          notes?: string | null
          return_filename?: string | null
          return_received_at?: string | null
          status?: string
          total_records?: number
          total_value?: number
        }
        Update: {
          bank_account_id?: string | null
          cnab_layout?: string
          file_content?: string | null
          filename?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          notes?: string | null
          return_filename?: string | null
          return_received_at?: string | null
          status?: string
          total_records?: number
          total_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "cnab_remittance_files_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      cnab_remittance_items: {
        Row: {
          accounts_receivable_id: string | null
          amount: number
          boleto_number: string
          created_at: string
          due_date: string
          file_id: string
          id: string
          nosso_numero: string | null
          occurrence_code: string | null
          processed: boolean
          return_motive: string | null
          return_occurrence_code: string | null
        }
        Insert: {
          accounts_receivable_id?: string | null
          amount: number
          boleto_number: string
          created_at?: string
          due_date: string
          file_id: string
          id?: string
          nosso_numero?: string | null
          occurrence_code?: string | null
          processed?: boolean
          return_motive?: string | null
          return_occurrence_code?: string | null
        }
        Update: {
          accounts_receivable_id?: string | null
          amount?: number
          boleto_number?: string
          created_at?: string
          due_date?: string
          file_id?: string
          id?: string
          nosso_numero?: string | null
          occurrence_code?: string | null
          processed?: boolean
          return_motive?: string | null
          return_occurrence_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cnab_remittance_items_accounts_receivable_id_fkey"
            columns: ["accounts_receivable_id"]
            isOneToOne: false
            referencedRelation: "accounts_receivable"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cnab_remittance_items_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "cnab_remittance_files"
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "cogs_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          {
            foreignKeyName: "cogs_entries_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "cogs_entries_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
      commission_tiers: {
        Row: {
          active: boolean
          commission_pct: number
          created_at: string
          id: string
          max_value: number | null
          min_value: number
          notes: string | null
          representative_id: string
          trigger_event: string
        }
        Insert: {
          active?: boolean
          commission_pct: number
          created_at?: string
          id?: string
          max_value?: number | null
          min_value: number
          notes?: string | null
          representative_id: string
          trigger_event?: string
        }
        Update: {
          active?: boolean
          commission_pct?: number
          created_at?: string
          id?: string
          max_value?: number | null
          min_value?: number
          notes?: string | null
          representative_id?: string
          trigger_event?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_tiers_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          active: boolean
          ambiente: string
          bairro: string
          cep: string
          cfop: string
          cfop_industrial_externo: string | null
          cfop_industrial_interno: string | null
          cfop_revenda_externo: string | null
          cfop_revenda_interno: string | null
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
          pis_cofins_regime: string
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
          cfop?: string
          cfop_industrial_externo?: string | null
          cfop_industrial_interno?: string | null
          cfop_revenda_externo?: string | null
          cfop_revenda_interno?: string | null
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
          pis_cofins_regime?: string
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
          cfop?: string
          cfop_industrial_externo?: string | null
          cfop_industrial_interno?: string | null
          cfop_revenda_externo?: string | null
          cfop_revenda_interno?: string | null
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
          pis_cofins_regime?: string
          razao_social?: string
          regime_tributario?: string
          serie_nfe?: number
          uf?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          caepf: string | null
          cei: string | null
          cep: string | null
          cidade: string | null
          cno: string | null
          cnpj: string | null
          cpf: string | null
          created_at: string
          email: string | null
          endereco: string | null
          id: string
          is_default: boolean
          nome_fantasia: string | null
          razao_social: string
          telefone: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          caepf?: string | null
          cei?: string | null
          cep?: string | null
          cidade?: string | null
          cno?: string | null
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          id?: string
          is_default?: boolean
          nome_fantasia?: string | null
          razao_social: string
          telefone?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          caepf?: string | null
          cei?: string | null
          cep?: string | null
          cidade?: string | null
          cno?: string | null
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          id?: string
          is_default?: boolean
          nome_fantasia?: string | null
          razao_social?: string
          telefone?: string | null
          uf?: string | null
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
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "component_sheets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_service_rates: {
        Row: {
          contractor_id: string
          created_at: string
          id: string
          notes: string | null
          price_per_pair: number
          sector: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          contractor_id: string
          created_at?: string
          id?: string
          notes?: string | null
          price_per_pair: number
          sector: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          contractor_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          price_per_pair?: number
          sector?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_service_rates_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_service_rates_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_metrics"
            referencedColumns: ["contractor_id"]
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
          default_lead_days: number | null
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
          default_lead_days?: number | null
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
          default_lead_days?: number | null
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
          default_commission_pct: number
          default_tax_pct: number
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
          default_commission_pct?: number
          default_tax_pct?: number
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
          default_commission_pct?: number
          default_tax_pct?: number
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "cost_variance_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          {
            foreignKeyName: "cost_variance_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "cost_variance_reports_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      crm_campaigns: {
        Row: {
          campaign_type: string
          channel: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          is_active: boolean
          message_template: string | null
          name: string
          start_date: string
          target_filter: Json
          total_contacted: number
          total_converted: number
        }
        Insert: {
          campaign_type?: string
          channel?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean
          message_template?: string | null
          name: string
          start_date?: string
          target_filter?: Json
          total_contacted?: number
          total_converted?: number
        }
        Update: {
          campaign_type?: string
          channel?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean
          message_template?: string | null
          name?: string
          start_date?: string
          target_filter?: Json
          total_contacted?: number
          total_converted?: number
        }
        Relationships: []
      }
      crm_interactions: {
        Row: {
          attachment_url: string | null
          client_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          direction: string
          external_contact_name: string | null
          id: string
          interaction_type: string
          notes: string | null
          outcome: string | null
          representative_id: string | null
          scheduled_for: string | null
          subject: string
        }
        Insert: {
          attachment_url?: string | null
          client_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          external_contact_name?: string | null
          id?: string
          interaction_type?: string
          notes?: string | null
          outcome?: string | null
          representative_id?: string | null
          scheduled_for?: string | null
          subject: string
        }
        Update: {
          attachment_url?: string | null
          client_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          external_contact_name?: string | null
          id?: string
          interaction_type?: string
          notes?: string | null
          outcome?: string | null
          representative_id?: string | null
          scheduled_for?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_interactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_interactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_interactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_interactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_interactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_interactions_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_nps_responses: {
        Row: {
          category: string | null
          client_id: string | null
          contact_method: string | null
          feedback: string | null
          id: string
          responded_at: string
          sale_order_id: string | null
          score: number
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          contact_method?: string | null
          feedback?: string | null
          id?: string
          responded_at?: string
          sale_order_id?: string | null
          score: number
        }
        Update: {
          category?: string | null
          client_id?: string | null
          contact_method?: string | null
          feedback?: string | null
          id?: string
          responded_at?: string
          sale_order_id?: string | null
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_nps_responses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_nps_responses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_nps_responses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_nps_responses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_nps_responses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "crm_nps_responses_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "crm_nps_responses_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_nps_responses_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "crm_nps_responses_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "crm_nps_responses_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      cte_emissions: {
        Row: {
          created_at: string
          cte_chave: string | null
          cte_number: string
          cte_type: string
          destination_city: string | null
          destination_uf: string
          emission_date: string
          freight_modality: string | null
          freight_value: number
          id: string
          origin_city: string | null
          origin_uf: string
          protocol: string | null
          related_nfe_chaves: string[] | null
          related_nfe_ids: string[] | null
          status: string
          transporter_cnpj: string | null
          transporter_name: string | null
          xml: string | null
        }
        Insert: {
          created_at?: string
          cte_chave?: string | null
          cte_number: string
          cte_type?: string
          destination_city?: string | null
          destination_uf: string
          emission_date?: string
          freight_modality?: string | null
          freight_value?: number
          id?: string
          origin_city?: string | null
          origin_uf: string
          protocol?: string | null
          related_nfe_chaves?: string[] | null
          related_nfe_ids?: string[] | null
          status?: string
          transporter_cnpj?: string | null
          transporter_name?: string | null
          xml?: string | null
        }
        Update: {
          created_at?: string
          cte_chave?: string | null
          cte_number?: string
          cte_type?: string
          destination_city?: string | null
          destination_uf?: string
          emission_date?: string
          freight_modality?: string | null
          freight_value?: number
          id?: string
          origin_city?: string | null
          origin_uf?: string
          protocol?: string | null
          related_nfe_chaves?: string[] | null
          related_nfe_ids?: string[] | null
          status?: string
          transporter_cnpj?: string | null
          transporter_name?: string | null
          xml?: string | null
        }
        Relationships: []
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
            foreignKeyName: "cycle_count_items_cycle_count_id_fkey"
            columns: ["cycle_count_id"]
            isOneToOne: false
            referencedRelation: "v_cycle_counts_summary"
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
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "cycle_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
      cyclic_inventory_counts: {
        Row: {
          count_status: string
          counted_at: string | null
          counted_by: string | null
          counted_qty: number | null
          divergence_qty: number | null
          expected_qty: number
          id: string
          notes: string | null
          product_id: string
          run_id: string
        }
        Insert: {
          count_status?: string
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          divergence_qty?: number | null
          expected_qty: number
          id?: string
          notes?: string | null
          product_id: string
          run_id: string
        }
        Update: {
          count_status?: string
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          divergence_qty?: number | null
          expected_qty?: number
          id?: string
          notes?: string | null
          product_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cyclic_inventory_counts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "cyclic_inventory_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      cyclic_inventory_runs: {
        Row: {
          abc_class: string
          completed_at: string | null
          counted_products: number
          divergences_count: number
          id: string
          notes: string | null
          run_date: string
          scheduled_at: string
          scheduled_by: string | null
          status: string
          total_divergence_value: number
          total_products: number
        }
        Insert: {
          abc_class: string
          completed_at?: string | null
          counted_products?: number
          divergences_count?: number
          id?: string
          notes?: string | null
          run_date?: string
          scheduled_at?: string
          scheduled_by?: string | null
          status?: string
          total_divergence_value?: number
          total_products?: number
        }
        Update: {
          abc_class?: string
          completed_at?: string | null
          counted_products?: number
          divergences_count?: number
          id?: string
          notes?: string | null
          run_date?: string
          scheduled_at?: string
          scheduled_by?: string | null
          status?: string
          total_divergence_value?: number
          total_products?: number
        }
        Relationships: []
      }
      default_lead_times: {
        Row: {
          assembly_capacity_per_day: number | null
          costura_capacity_per_day: number
          created_at: string
          cutting_capacity_per_day: number | null
          expedition_capacity_per_day: number | null
          finishing_capacity_per_day: number | null
          gluing_capacity_per_day: number | null
          id: string
          lead_time_acabamento_dias: number
          lead_time_buffer_material_dias: number
          lead_time_colagem_dias: number | null
          lead_time_corte_dias: number
          lead_time_costura_dias: number
          lead_time_expedicao_dias: number | null
          lead_time_montagem_dias: number
          lead_time_silk_dias: number | null
          mesa_daily_capacity: number | null
          notes: string | null
          sewing_capacity_per_day: number | null
          shoe_category: string
          silk_capacity_per_day: number | null
          soling_capacity_per_day: number | null
          updated_at: string
        }
        Insert: {
          assembly_capacity_per_day?: number | null
          costura_capacity_per_day?: number
          created_at?: string
          cutting_capacity_per_day?: number | null
          expedition_capacity_per_day?: number | null
          finishing_capacity_per_day?: number | null
          gluing_capacity_per_day?: number | null
          id?: string
          lead_time_acabamento_dias?: number
          lead_time_buffer_material_dias?: number
          lead_time_colagem_dias?: number | null
          lead_time_corte_dias?: number
          lead_time_costura_dias?: number
          lead_time_expedicao_dias?: number | null
          lead_time_montagem_dias?: number
          lead_time_silk_dias?: number | null
          mesa_daily_capacity?: number | null
          notes?: string | null
          sewing_capacity_per_day?: number | null
          shoe_category: string
          silk_capacity_per_day?: number | null
          soling_capacity_per_day?: number | null
          updated_at?: string
        }
        Update: {
          assembly_capacity_per_day?: number | null
          costura_capacity_per_day?: number
          created_at?: string
          cutting_capacity_per_day?: number | null
          expedition_capacity_per_day?: number | null
          finishing_capacity_per_day?: number | null
          gluing_capacity_per_day?: number | null
          id?: string
          lead_time_acabamento_dias?: number
          lead_time_buffer_material_dias?: number
          lead_time_colagem_dias?: number | null
          lead_time_corte_dias?: number
          lead_time_costura_dias?: number
          lead_time_expedicao_dias?: number | null
          lead_time_montagem_dias?: number
          lead_time_silk_dias?: number | null
          mesa_daily_capacity?: number | null
          notes?: string | null
          sewing_capacity_per_day?: number | null
          shoe_category?: string
          silk_capacity_per_day?: number | null
          soling_capacity_per_day?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      delivery_route_stops: {
        Row: {
          address_snapshot: Json
          delivered_at: string | null
          distance_from_previous_km: number | null
          eta_minutes_from_start: number | null
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          receiver_name: string | null
          route_id: string
          sale_order_id: string | null
          status: string
          stop_order: number
        }
        Insert: {
          address_snapshot: Json
          delivered_at?: string | null
          distance_from_previous_km?: number | null
          eta_minutes_from_start?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          receiver_name?: string | null
          route_id: string
          sale_order_id?: string | null
          status?: string
          stop_order: number
        }
        Update: {
          address_snapshot?: Json
          delivered_at?: string | null
          distance_from_previous_km?: number | null
          eta_minutes_from_start?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          receiver_name?: string | null
          route_id?: string
          sale_order_id?: string | null
          status?: string
          stop_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_route_stops_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "delivery_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_route_stops_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "v_delivery_routes_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_route_stops_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_route_stops_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_route_stops_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_route_stops_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_route_stops_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      delivery_routes: {
        Row: {
          cost_per_pair: number | null
          created_at: string
          driver_id: string | null
          estimated_duration_min: number | null
          fuel_cost_brl: number | null
          id: string
          name: string | null
          notes: string | null
          origin_address: Json | null
          scheduled_date: string
          status: string
          total_cost_brl: number | null
          total_distance_km: number | null
          updated_at: string
          vehicle_id: string | null
          wear_cost_brl: number | null
        }
        Insert: {
          cost_per_pair?: number | null
          created_at?: string
          driver_id?: string | null
          estimated_duration_min?: number | null
          fuel_cost_brl?: number | null
          id?: string
          name?: string | null
          notes?: string | null
          origin_address?: Json | null
          scheduled_date: string
          status?: string
          total_cost_brl?: number | null
          total_distance_km?: number | null
          updated_at?: string
          vehicle_id?: string | null
          wear_cost_brl?: number | null
        }
        Update: {
          cost_per_pair?: number | null
          created_at?: string
          driver_id?: string | null
          estimated_duration_min?: number | null
          fuel_cost_brl?: number | null
          id?: string
          name?: string | null
          notes?: string | null
          origin_address?: Json | null
          scheduled_date?: string
          status?: string
          total_cost_brl?: number | null
          total_distance_km?: number | null
          updated_at?: string
          vehicle_id?: string | null
          wear_cost_brl?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_routes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_routes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_tracking: {
        Row: {
          actual_delivery_date: string | null
          created_at: string
          events: Json
          expected_delivery_date: string | null
          id: string
          last_update_at: string
          manifest_id: string | null
          recipient_name: string | null
          recipient_signature_url: string | null
          sale_order_id: string | null
          status: string
          tracking_code: string | null
          tracking_url: string | null
          transporter_id: string | null
        }
        Insert: {
          actual_delivery_date?: string | null
          created_at?: string
          events?: Json
          expected_delivery_date?: string | null
          id?: string
          last_update_at?: string
          manifest_id?: string | null
          recipient_name?: string | null
          recipient_signature_url?: string | null
          sale_order_id?: string | null
          status?: string
          tracking_code?: string | null
          tracking_url?: string | null
          transporter_id?: string | null
        }
        Update: {
          actual_delivery_date?: string | null
          created_at?: string
          events?: Json
          expected_delivery_date?: string | null
          id?: string
          last_update_at?: string
          manifest_id?: string | null
          recipient_name?: string | null
          recipient_signature_url?: string | null
          sale_order_id?: string | null
          status?: string
          tracking_code?: string | null
          tracking_url?: string | null
          transporter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_tracking_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "shipping_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tracking_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_tracking_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tracking_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_tracking_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_tracking_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "delivery_tracking_transporter_id_fkey"
            columns: ["transporter_id"]
            isOneToOne: false
            referencedRelation: "transporters"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active: boolean
          cnh: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          cnh?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          cnh?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      economic_group_attachments: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          economic_group_id: string
          file_name: string
          file_url: string
          id: string
          mime_type: string | null
          size_bytes: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          economic_group_id: string
          file_name: string
          file_url: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          economic_group_id?: string
          file_name?: string
          file_url?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "economic_group_attachments_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "economic_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "economic_group_attachments_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_credit"
            referencedColumns: ["economic_group_id"]
          },
          {
            foreignKeyName: "economic_group_attachments_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_kpis"
            referencedColumns: ["economic_group_id"]
          },
        ]
      }
      economic_group_audit_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          economic_group_id: string
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          economic_group_id: string
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          economic_group_id?: string
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "economic_group_audit_log_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "economic_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "economic_group_audit_log_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_credit"
            referencedColumns: ["economic_group_id"]
          },
          {
            foreignKeyName: "economic_group_audit_log_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_kpis"
            referencedColumns: ["economic_group_id"]
          },
        ]
      }
      economic_group_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          economic_group_id: string
          email: string | null
          id: string
          is_primary: boolean
          name: string
          notes: string | null
          phone: string | null
          role: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          economic_group_id: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          role: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          economic_group_id?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "economic_group_contacts_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "economic_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "economic_group_contacts_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_credit"
            referencedColumns: ["economic_group_id"]
          },
          {
            foreignKeyName: "economic_group_contacts_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_kpis"
            referencedColumns: ["economic_group_id"]
          },
        ]
      }
      economic_group_notes: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          economic_group_id: string
          id: string
          note_type: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          economic_group_id: string
          id?: string
          note_type?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          economic_group_id?: string
          id?: string
          note_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "economic_group_notes_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "economic_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "economic_group_notes_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_credit"
            referencedColumns: ["economic_group_id"]
          },
          {
            foreignKeyName: "economic_group_notes_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_kpis"
            referencedColumns: ["economic_group_id"]
          },
        ]
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
            foreignKeyName: "economic_group_representatives_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_credit"
            referencedColumns: ["economic_group_id"]
          },
          {
            foreignKeyName: "economic_group_representatives_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_kpis"
            referencedColumns: ["economic_group_id"]
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
          aging_alert_days: number
          billing_email: string | null
          block_new_orders: boolean
          block_reason: string | null
          created_at: string
          credit_limit: number
          default_discount_pct: number
          default_factoring_config_id: string | null
          default_modalidade_frete: string | null
          default_payment_condition: string | null
          default_price_list_id: string | null
          default_transport_company_id: string | null
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
          aging_alert_days?: number
          billing_email?: string | null
          block_new_orders?: boolean
          block_reason?: string | null
          created_at?: string
          credit_limit?: number
          default_discount_pct?: number
          default_factoring_config_id?: string | null
          default_modalidade_frete?: string | null
          default_payment_condition?: string | null
          default_price_list_id?: string | null
          default_transport_company_id?: string | null
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
          aging_alert_days?: number
          billing_email?: string | null
          block_new_orders?: boolean
          block_reason?: string | null
          created_at?: string
          credit_limit?: number
          default_discount_pct?: number
          default_factoring_config_id?: string | null
          default_modalidade_frete?: string | null
          default_payment_condition?: string | null
          default_price_list_id?: string | null
          default_transport_company_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "economic_groups_default_factoring_config_id_fkey"
            columns: ["default_factoring_config_id"]
            isOneToOne: false
            referencedRelation: "factoring_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "economic_groups_default_price_list_id_fkey"
            columns: ["default_price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "economic_groups_default_transport_company_id_fkey"
            columns: ["default_transport_company_id"]
            isOneToOne: false
            referencedRelation: "transport_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_absences: {
        Row: {
          absence_type: string
          created_at: string
          created_by: string | null
          document_url: string | null
          employee_id: string
          end_date: string
          hours_per_day: number | null
          id: string
          justified: boolean | null
          notes: string | null
          paid: boolean | null
          start_date: string
          updated_at: string
        }
        Insert: {
          absence_type: string
          created_at?: string
          created_by?: string | null
          document_url?: string | null
          employee_id: string
          end_date: string
          hours_per_day?: number | null
          id?: string
          justified?: boolean | null
          notes?: string | null
          paid?: boolean | null
          start_date: string
          updated_at?: string
        }
        Update: {
          absence_type?: string
          created_at?: string
          created_by?: string | null
          document_url?: string | null
          employee_id?: string
          end_date?: string
          hours_per_day?: number | null
          id?: string
          justified?: boolean | null
          notes?: string | null
          paid?: boolean | null
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_absences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_absences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_absences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_absences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_absences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_absences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employee_advances: {
        Row: {
          advance_date: string
          amount: number
          created_at: string
          description: string | null
          employee_id: string
          id: string
          payroll_run_id: string | null
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
          payroll_run_id?: string | null
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
          payroll_run_id?: string | null
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
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_advances_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
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
          hours_added: number
          hours_removed: number
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
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_skills_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_skills_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_skills_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_skills_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_skills_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean
          admission_date: string | null
          bank_hours_initial_min: number
          cost_center: string | null
          cpf: string | null
          created_at: string
          daily_rate: number | null
          department: string | null
          external_id: string | null
          health_plan_value: number
          hourly_rate: number | null
          id: string
          name: string
          night_bonus_pct: number
          notes: string | null
          overtime_100_pct: number
          overtime_50_pct: number
          overtime_hourly_rate: number | null
          overtime_multiplier: number
          payment_type: string
          phone: string | null
          pix_key: string | null
          pix_type: string | null
          receives_va: boolean
          receives_vr: boolean
          receives_vt: boolean
          role: string | null
          salary: number
          termination_date: string | null
          updated_at: string
          whatsapp: string | null
          work_schedule_id: string | null
        }
        Insert: {
          active?: boolean
          admission_date?: string | null
          bank_hours_initial_min?: number
          cost_center?: string | null
          cpf?: string | null
          created_at?: string
          daily_rate?: number | null
          department?: string | null
          external_id?: string | null
          health_plan_value?: number
          hourly_rate?: number | null
          id?: string
          name: string
          night_bonus_pct?: number
          notes?: string | null
          overtime_100_pct?: number
          overtime_50_pct?: number
          overtime_hourly_rate?: number | null
          overtime_multiplier?: number
          payment_type?: string
          phone?: string | null
          pix_key?: string | null
          pix_type?: string | null
          receives_va?: boolean
          receives_vr?: boolean
          receives_vt?: boolean
          role?: string | null
          salary?: number
          termination_date?: string | null
          updated_at?: string
          whatsapp?: string | null
          work_schedule_id?: string | null
        }
        Update: {
          active?: boolean
          admission_date?: string | null
          bank_hours_initial_min?: number
          cost_center?: string | null
          cpf?: string | null
          created_at?: string
          daily_rate?: number | null
          department?: string | null
          external_id?: string | null
          health_plan_value?: number
          hourly_rate?: number | null
          id?: string
          name?: string
          night_bonus_pct?: number
          notes?: string | null
          overtime_100_pct?: number
          overtime_50_pct?: number
          overtime_hourly_rate?: number | null
          overtime_multiplier?: number
          payment_type?: string
          phone?: string | null
          pix_key?: string | null
          pix_type?: string | null
          receives_va?: boolean
          receives_vr?: boolean
          receives_vt?: boolean
          role?: string | null
          salary?: number
          termination_date?: string | null
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
          status: string
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "equipment_downtime_impacted_order_id_fkey"
            columns: ["impacted_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          category: string | null
          collection: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          entry_date: string
          id: string
          nfe_id: string | null
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
          category?: string | null
          collection?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          entry_date?: string
          id?: string
          nfe_id?: string | null
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
          category?: string | null
          collection?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          entry_date?: string
          id?: string
          nfe_id?: string | null
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
          {
            foreignKeyName: "financial_entries_nfe_id_fkey"
            columns: ["nfe_id"]
            isOneToOne: false
            referencedRelation: "nfe_emitidas"
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "finished_goods_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          {
            foreignKeyName: "finished_goods_receipts_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "finished_goods_receipts_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      fiscal_config: {
        Row: {
          ambiente: string
          bairro: string
          cep: string
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
      fiscal_tax_profiles: {
        Row: {
          active: boolean
          aliquota_cofins: number
          aliquota_icms: number
          aliquota_icms_st: number | null
          aliquota_ipi: number
          aliquota_pis: number
          cfop_externo: string
          cfop_interno: string
          created_at: string
          cst_cofins: string
          cst_icms: string
          cst_ipi: string
          cst_pis: string
          description: string
          id: string
          mva_st: number | null
          ncm: string
          notes: string | null
          origem: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          aliquota_cofins?: number
          aliquota_icms?: number
          aliquota_icms_st?: number | null
          aliquota_ipi?: number
          aliquota_pis?: number
          cfop_externo?: string
          cfop_interno?: string
          created_at?: string
          cst_cofins?: string
          cst_icms?: string
          cst_ipi?: string
          cst_pis?: string
          description?: string
          id?: string
          mva_st?: number | null
          ncm: string
          notes?: string | null
          origem?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          aliquota_cofins?: number
          aliquota_icms?: number
          aliquota_icms_st?: number | null
          aliquota_ipi?: number
          aliquota_pis?: number
          cfop_externo?: string
          cfop_interno?: string
          created_at?: string
          cst_cofins?: string
          cst_icms?: string
          cst_ipi?: string
          cst_pis?: string
          description?: string
          id?: string
          mva_st?: number | null
          ncm?: string
          notes?: string | null
          origem?: string
          updated_at?: string
        }
        Relationships: []
      }
      fixed_assets: {
        Row: {
          acquisition_cost: number
          acquisition_date: string
          active: boolean
          asset_code: string
          category: string
          cost_center_id: string | null
          created_at: string
          disposal_date: string | null
          disposal_reason: string | null
          disposal_value: number
          id: string
          name: string
          notes: string | null
          residual_value: number
          status: string
          supplier_id: string | null
          updated_at: string
          useful_life_months: number
        }
        Insert: {
          acquisition_cost?: number
          acquisition_date?: string
          active?: boolean
          asset_code?: string
          category?: string
          cost_center_id?: string | null
          created_at?: string
          disposal_date?: string | null
          disposal_reason?: string | null
          disposal_value?: number
          id?: string
          name?: string
          notes?: string | null
          residual_value?: number
          status?: string
          supplier_id?: string | null
          updated_at?: string
          useful_life_months?: number
        }
        Update: {
          acquisition_cost?: number
          acquisition_date?: string
          active?: boolean
          asset_code?: string
          category?: string
          cost_center_id?: string | null
          created_at?: string
          disposal_date?: string | null
          disposal_reason?: string | null
          disposal_value?: number
          id?: string
          name?: string
          notes?: string | null
          residual_value?: number
          status?: string
          supplier_id?: string | null
          updated_at?: string
          useful_life_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      freight_tables: {
        Row: {
          active: boolean
          delivery_days: number | null
          destination_uf: string
          id: string
          notes: string | null
          origin_uf: string | null
          price_fixed: number | null
          price_per_kg: number | null
          transporter_id: string
          valid_from: string
          valid_to: string | null
          weight_max_kg: number | null
          weight_min_kg: number
        }
        Insert: {
          active?: boolean
          delivery_days?: number | null
          destination_uf: string
          id?: string
          notes?: string | null
          origin_uf?: string | null
          price_fixed?: number | null
          price_per_kg?: number | null
          transporter_id: string
          valid_from?: string
          valid_to?: string | null
          weight_max_kg?: number | null
          weight_min_kg?: number
        }
        Update: {
          active?: boolean
          delivery_days?: number | null
          destination_uf?: string
          id?: string
          notes?: string | null
          origin_uf?: string | null
          price_fixed?: number | null
          price_per_kg?: number | null
          transporter_id?: string
          valid_from?: string
          valid_to?: string | null
          weight_max_kg?: number | null
          weight_min_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "freight_tables_transporter_id_fkey"
            columns: ["transporter_id"]
            isOneToOne: false
            referencedRelation: "transporters"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_prices: {
        Row: {
          fuel_type: string
          price_per_liter: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          fuel_type: string
          price_per_liter: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          fuel_type?: string
          price_per_liter?: number
          updated_at?: string
          updated_by?: string | null
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
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "goods_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "goods_issues_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          {
            foreignKeyName: "goods_issues_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "goods_issues_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      goods_receipt_inspections: {
        Row: {
          created_at: string
          id: string
          inspector: string | null
          nc_reason: string | null
          product_id: string
          purchase_order_id: string
          qty_approved: number
          qty_received: number
          qty_rejected: number
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          inspector?: string | null
          nc_reason?: string | null
          product_id: string
          purchase_order_id: string
          qty_approved?: number
          qty_received?: number
          qty_rejected?: number
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          inspector?: string | null
          nc_reason?: string | null
          product_id?: string
          purchase_order_id?: string
          qty_approved?: number
          qty_received?: number
          qty_rejected?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_open_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_inspections_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_overdue_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      group_color_sources: {
        Row: {
          created_at: string
          created_by: string | null
          group_id: string
          source_group_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          group_id: string
          source_group_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          group_id?: string
          source_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_color_sources_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_color_sources_source_group_id_fkey"
            columns: ["source_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
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
          notes: string | null
          optional: boolean
          recurring: boolean
          scope: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          name: string
          notes?: string | null
          optional?: boolean
          recurring?: boolean
          scope?: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          name?: string
          notes?: string | null
          optional?: boolean
          recurring?: boolean
          scope?: string
        }
        Relationships: []
      }
      inventory_count_items: {
        Row: {
          abc_class: string | null
          adjusted: boolean
          count_id: string
          counted_qty: number | null
          created_at: string
          divergence: number | null
          expected_qty: number
          id: string
          product_id: string
          unit_price: number
        }
        Insert: {
          abc_class?: string | null
          adjusted?: boolean
          count_id: string
          counted_qty?: number | null
          created_at?: string
          divergence?: number | null
          expected_qty?: number
          id?: string
          product_id: string
          unit_price?: number
        }
        Update: {
          abc_class?: string | null
          adjusted?: boolean
          count_id?: string
          counted_qty?: number | null
          created_at?: string
          divergence?: number | null
          expected_qty?: number
          id?: string
          product_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_items_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          completed_at: string | null
          count_number: string
          counted_products: number
          created_at: string
          divergences_count: number
          id: string
          notes: string | null
          run_date: string
          scope: string
          status: string
          total_divergence_value: number
          total_products: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          count_number: string
          counted_products?: number
          created_at?: string
          divergences_count?: number
          id?: string
          notes?: string | null
          run_date?: string
          scope?: string
          status?: string
          total_divergence_value?: number
          total_products?: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          count_number?: string
          counted_products?: number
          created_at?: string
          divergences_count?: number
          id?: string
          notes?: string | null
          run_date?: string
          scope?: string
          status?: string
          total_divergence_value?: number
          total_products?: number
          updated_at?: string
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
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
      lasts: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          heel_height_mm: number | null
          heel_type: string | null
          id: string
          material: string | null
          name: string
          notes: string | null
          owner_client_id: string | null
          size_range_max: number | null
          size_range_min: number | null
          status: string
          toe_shape: string | null
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          heel_height_mm?: number | null
          heel_type?: string | null
          id?: string
          material?: string | null
          name: string
          notes?: string | null
          owner_client_id?: string | null
          size_range_max?: number | null
          size_range_min?: number | null
          status?: string
          toe_shape?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          heel_height_mm?: number | null
          heel_type?: string | null
          id?: string
          material?: string | null
          name?: string
          notes?: string | null
          owner_client_id?: string | null
          size_range_max?: number | null
          size_range_min?: number | null
          status?: string
          toe_shape?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      leather_hides: {
        Row: {
          area_dm2: number
          available_dm2: number | null
          created_at: string
          curtume: string | null
          hide_code: string
          id: string
          is_active: boolean
          notes: string | null
          origin: string | null
          product_id: string
          quality_class: string | null
          received_date: string | null
          thickness_mm: number | null
          used_dm2: number
        }
        Insert: {
          area_dm2: number
          available_dm2?: number | null
          created_at?: string
          curtume?: string | null
          hide_code: string
          id?: string
          is_active?: boolean
          notes?: string | null
          origin?: string | null
          product_id: string
          quality_class?: string | null
          received_date?: string | null
          thickness_mm?: number | null
          used_dm2?: number
        }
        Update: {
          area_dm2?: number
          available_dm2?: number | null
          created_at?: string
          curtume?: string | null
          hide_code?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          origin?: string | null
          product_id?: string
          quality_class?: string | null
          received_date?: string | null
          thickness_mm?: number | null
          used_dm2?: number
        }
        Relationships: [
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "leather_hides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      lgpd_consents: {
        Row: {
          client_id: string | null
          consent_purpose: string
          consent_type: string
          contact_id: string | null
          employee_id: string | null
          granted: boolean
          granted_at: string
          id: string
          ip_address: string | null
          notes: string | null
          revoked_at: string | null
          source: string | null
          user_agent: string | null
        }
        Insert: {
          client_id?: string | null
          consent_purpose: string
          consent_type: string
          contact_id?: string | null
          employee_id?: string | null
          granted?: boolean
          granted_at?: string
          id?: string
          ip_address?: string | null
          notes?: string | null
          revoked_at?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Update: {
          client_id?: string | null
          consent_purpose?: string
          consent_type?: string
          contact_id?: string | null
          employee_id?: string | null
          granted?: boolean
          granted_at?: string
          id?: string
          ip_address?: string | null
          notes?: string | null
          revoked_at?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lgpd_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lgpd_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lgpd_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lgpd_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lgpd_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lgpd_consents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "lgpd_consents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lgpd_consents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "lgpd_consents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "lgpd_consents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "lgpd_consents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      lgpd_requests: {
        Row: {
          description: string | null
          id: string
          legal_basis: string | null
          opened_at: string
          request_number: string
          request_type: string
          resolution: string | null
          resolution_attachment_url: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject_document: string | null
          subject_id: string
          subject_name: string | null
          subject_type: string
        }
        Insert: {
          description?: string | null
          id?: string
          legal_basis?: string | null
          opened_at?: string
          request_number?: string
          request_type: string
          resolution?: string | null
          resolution_attachment_url?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_document?: string | null
          subject_id: string
          subject_name?: string | null
          subject_type: string
        }
        Update: {
          description?: string | null
          id?: string
          legal_basis?: string | null
          opened_at?: string
          request_number?: string
          request_type?: string
          resolution?: string | null
          resolution_attachment_url?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_document?: string | null
          subject_id?: string
          subject_name?: string | null
          subject_type?: string
        }
        Relationships: []
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
        Relationships: []
      }
      loading_manifests: {
        Row: {
          created_at: string
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
          updated_at: string
          vehicle_plate: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dispatch_date: string
          driver_name?: string | null
          id?: string
          manifest_number: string
          notes?: string | null
          status?: string | null
          total_pairs?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          transport_company_id?: string | null
          updated_at?: string
          vehicle_plate?: string | null
        }
        Update: {
          created_at?: string
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
          updated_at?: string
          vehicle_plate?: string | null
        }
        Relationships: []
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
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
          performed_at: string
          performed_by?: string | null
          plan_id?: string | null
          type: string
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
        Relationships: []
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
          frequency_days: number
          id?: string
          is_active: boolean
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
        Relationships: []
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
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "material_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      material_color_groups: {
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
      material_reservations: {
        Row: {
          batch_id: string | null
          consumed_at: string | null
          created_at: string
          expedite: boolean
          id: string
          location: string | null
          lot_number: string | null
          metadata: Json
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
          metadata?: Json
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
          metadata?: Json
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "material_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
      mdfe_emissions: {
        Row: {
          closed_at: string | null
          created_at: string
          destination_uf: string
          driver_cpf: string | null
          driver_name: string | null
          emission_date: string
          id: string
          mdfe_chave: string | null
          mdfe_number: string
          modal: string
          notes: string | null
          origin_uf: string
          protocol: string | null
          related_cte_ids: string[] | null
          related_nfe_chaves: string[] | null
          status: string
          total_pairs: number
          total_value: number
          total_weight_kg: number
          vehicle_plate: string | null
          vehicle_renavam: string | null
          xml: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          destination_uf: string
          driver_cpf?: string | null
          driver_name?: string | null
          emission_date?: string
          id?: string
          mdfe_chave?: string | null
          mdfe_number: string
          modal?: string
          notes?: string | null
          origin_uf: string
          protocol?: string | null
          related_cte_ids?: string[] | null
          related_nfe_chaves?: string[] | null
          status?: string
          total_pairs?: number
          total_value?: number
          total_weight_kg?: number
          vehicle_plate?: string | null
          vehicle_renavam?: string | null
          xml?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          destination_uf?: string
          driver_cpf?: string | null
          driver_name?: string | null
          emission_date?: string
          id?: string
          mdfe_chave?: string | null
          mdfe_number?: string
          modal?: string
          notes?: string | null
          origin_uf?: string
          protocol?: string | null
          related_cte_ids?: string[] | null
          related_nfe_chaves?: string[] | null
          status?: string
          total_pairs?: number
          total_value?: number
          total_weight_kg?: number
          vehicle_plate?: string | null
          vehicle_renavam?: string | null
          xml?: string | null
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "mrp_suggestions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "mrp_suggestions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      ncm_change_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_ncm: string | null
          old_ncm: string | null
          product_id: string | null
          technical_sheet_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_ncm?: string | null
          old_ncm?: string | null
          product_id?: string | null
          technical_sheet_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_ncm?: string | null
          old_ncm?: string | null
          product_id?: string | null
          technical_sheet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "ncm_change_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncm_change_log_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncm_change_log_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "ncm_change_log_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "ncm_change_log_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncm_change_log_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "ncm_change_log_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "ncm_change_log_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_cce: {
        Row: {
          correction_text: string
          created_at: string
          emitted_at: string | null
          emitted_by: string | null
          id: string
          nfe_chave: string
          nfe_id: string | null
          nfe_number: string
          protocol: string | null
          sefaz_response: string | null
          sequencia: number
          status: string
          xml: string | null
        }
        Insert: {
          correction_text: string
          created_at?: string
          emitted_at?: string | null
          emitted_by?: string | null
          id?: string
          nfe_chave: string
          nfe_id?: string | null
          nfe_number: string
          protocol?: string | null
          sefaz_response?: string | null
          sequencia: number
          status?: string
          xml?: string | null
        }
        Update: {
          correction_text?: string
          created_at?: string
          emitted_at?: string | null
          emitted_by?: string | null
          id?: string
          nfe_chave?: string
          nfe_id?: string | null
          nfe_number?: string
          protocol?: string | null
          sefaz_response?: string | null
          sequencia?: number
          status?: string
          xml?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_cce_nfe_id_fkey"
            columns: ["nfe_id"]
            isOneToOne: false
            referencedRelation: "nfe_emitidas"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_devolucoes: {
        Row: {
          chave_acesso: string | null
          cnpj_emitente: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          data_emissao: string | null
          id: string
          idempotency_key: string | null
          itens: Json
          motivo: string
          motivo_rejeicao: string | null
          nfe_original_id: string
          numero: string | null
          protocolo: string | null
          provider_nfe_id: string | null
          ref_nfe: string | null
          sale_order_id: string | null
          serie: string | null
          status: string
          tp_amb_sefaz: string | null
          updated_at: string
          valor_total: number | null
        }
        Insert: {
          chave_acesso?: string | null
          cnpj_emitente?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          data_emissao?: string | null
          id?: string
          idempotency_key?: string | null
          itens: Json
          motivo: string
          motivo_rejeicao?: string | null
          nfe_original_id: string
          numero?: string | null
          protocolo?: string | null
          provider_nfe_id?: string | null
          ref_nfe?: string | null
          sale_order_id?: string | null
          serie?: string | null
          status?: string
          tp_amb_sefaz?: string | null
          updated_at?: string
          valor_total?: number | null
        }
        Update: {
          chave_acesso?: string | null
          cnpj_emitente?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          data_emissao?: string | null
          id?: string
          idempotency_key?: string | null
          itens?: Json
          motivo?: string
          motivo_rejeicao?: string | null
          nfe_original_id?: string
          numero?: string | null
          protocolo?: string | null
          provider_nfe_id?: string | null
          ref_nfe?: string | null
          sale_order_id?: string | null
          serie?: string | null
          status?: string
          tp_amb_sefaz?: string | null
          updated_at?: string
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_devolucoes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_devolucoes_nfe_original_id_fkey"
            columns: ["nfe_original_id"]
            isOneToOne: false
            referencedRelation: "nfe_emitidas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_devolucoes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "nfe_devolucoes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_devolucoes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "nfe_devolucoes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "nfe_devolucoes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      nfe_emitidas: {
        Row: {
          chave_acesso: string | null
          cnpj_destinatario: string | null
          cnpj_emitente: string | null
          company_id: string | null
          created_at: string
          danfe_url: string | null
          data_cancelamento: string | null
          data_emissao: string | null
          gc_detail_response: Json | null
          gc_emit_response: Json | null
          gc_request_payload: Json | null
          gc_response_payload: Json | null
          id: string
          justificativa_cancelamento: string | null
          motivo_rejeicao: string | null
          nome_destinatario: string | null
          numero: string | null
          protocolo: string | null
          protocolo_cancelamento: string | null
          provider_nfe_id: string | null
          ref_nfe: string
          sale_order_id: string | null
          serie: string | null
          status: string
          tp_amb_sefaz: string | null
          updated_at: string
          valor_total: number
          xml_url: string | null
        }
        Insert: {
          chave_acesso?: string | null
          cnpj_destinatario?: string | null
          cnpj_emitente?: string | null
          company_id?: string | null
          created_at?: string
          danfe_url?: string | null
          data_cancelamento?: string | null
          data_emissao?: string | null
          gc_detail_response?: Json | null
          gc_emit_response?: Json | null
          gc_request_payload?: Json | null
          gc_response_payload?: Json | null
          id?: string
          justificativa_cancelamento?: string | null
          motivo_rejeicao?: string | null
          nome_destinatario?: string | null
          numero?: string | null
          protocolo?: string | null
          protocolo_cancelamento?: string | null
          provider_nfe_id?: string | null
          ref_nfe?: string
          sale_order_id?: string | null
          serie?: string | null
          status?: string
          tp_amb_sefaz?: string | null
          updated_at?: string
          valor_total?: number
          xml_url?: string | null
        }
        Update: {
          chave_acesso?: string | null
          cnpj_destinatario?: string | null
          cnpj_emitente?: string | null
          company_id?: string | null
          created_at?: string
          danfe_url?: string | null
          data_cancelamento?: string | null
          data_emissao?: string | null
          gc_detail_response?: Json | null
          gc_emit_response?: Json | null
          gc_request_payload?: Json | null
          gc_response_payload?: Json | null
          id?: string
          justificativa_cancelamento?: string | null
          motivo_rejeicao?: string | null
          nome_destinatario?: string | null
          numero?: string | null
          protocolo?: string | null
          protocolo_cancelamento?: string | null
          provider_nfe_id?: string | null
          ref_nfe?: string
          sale_order_id?: string | null
          serie?: string | null
          status?: string
          tp_amb_sefaz?: string | null
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
          {
            foreignKeyName: "nfe_emitidas_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "nfe_emitidas_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      note_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "note_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      note_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          done: boolean
          id: string
          note_id: string | null
          priority: string
          text: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          id?: string
          note_id?: string | null
          priority?: string
          text: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          id?: string
          note_id?: string | null
          priority?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_tasks_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          folder_id: string | null
          icon: string | null
          id: string
          parent_id: string | null
          pinned: boolean
          position: number
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: string
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string
          parent_id?: string | null
          pinned?: boolean
          position?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string
          parent_id?: string | null
          pinned?: boolean
          position?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "note_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          category: string | null
          created_at: string | null
          dedupe_key: string | null
          id: string
          link: string | null
          message: string
          payload: Json | null
          read: boolean | null
          resolved_at: string | null
          sector: string | null
          severity: string | null
          user_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          id?: string
          link?: string | null
          message: string
          payload?: Json | null
          read?: boolean | null
          resolved_at?: string | null
          sector?: string | null
          severity?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          id?: string
          link?: string | null
          message?: string
          payload?: Json | null
          read?: boolean | null
          resolved_at?: string | null
          sector?: string | null
          severity?: string | null
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
          packaging_cost: number
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
          packaging_cost?: number
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
          packaging_cost?: number
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "order_costs_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "order_costs_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_costs_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "order_costs_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "order_costs_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "order_costs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "order_costs_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      order_lots: {
        Row: {
          completed_at: string | null
          created_at: string
          current_sector: string | null
          expected_complete_date: string | null
          id: string
          lot_number: number
          notes: string | null
          order_id: string
          quantity: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_sector?: string | null
          expected_complete_date?: string | null
          id?: string
          lot_number: number
          notes?: string | null
          order_id: string
          quantity: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_sector?: string | null
          expected_complete_date?: string | null
          id?: string
          lot_number?: number
          notes?: string | null
          order_id?: string
          quantity?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
        ]
      }
      order_stages: {
        Row: {
          actual_time_minutes: number | null
          blocked_reason: string | null
          blocked_until: string | null
          completed_at: string | null
          completed_by: string | null
          cost_per_hour: number | null
          cost_per_pair: number | null
          created_at: string
          defects: string | null
          id: string
          observations: string | null
          operator_employee_id: string | null
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
          blocked_reason?: string | null
          blocked_until?: string | null
          completed_at?: string | null
          completed_by?: string | null
          cost_per_hour?: number | null
          cost_per_pair?: number | null
          created_at?: string
          defects?: string | null
          id?: string
          observations?: string | null
          operator_employee_id?: string | null
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
          blocked_reason?: string | null
          blocked_until?: string | null
          completed_at?: string | null
          completed_by?: string | null
          cost_per_hour?: number | null
          cost_per_pair?: number | null
          created_at?: string
          defects?: string | null
          id?: string
          observations?: string | null
          operator_employee_id?: string | null
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
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          cross_dock_sale_order_id: string | null
          due_date: string | null
          grade: Json | null
          id: string
          is_ahead_of_schedule: boolean | null
          is_cross_dock: boolean
          item_observation: string | null
          labor_cost: number | null
          last_sector_finished_at: string | null
          material_cost: number | null
          material_status: string | null
          mod_cost: number | null
          notes: string | null
          order_number: string
          outsourced_at: string | null
          outsourced_returned_at: string | null
          outsourced_sector: string | null
          outsourced_to_contractor_id: string | null
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
          cross_dock_sale_order_id?: string | null
          due_date?: string | null
          grade?: Json | null
          id?: string
          is_ahead_of_schedule?: boolean | null
          is_cross_dock?: boolean
          item_observation?: string | null
          labor_cost?: number | null
          last_sector_finished_at?: string | null
          material_cost?: number | null
          material_status?: string | null
          mod_cost?: number | null
          notes?: string | null
          order_number?: string
          outsourced_at?: string | null
          outsourced_returned_at?: string | null
          outsourced_sector?: string | null
          outsourced_to_contractor_id?: string | null
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
          cross_dock_sale_order_id?: string | null
          due_date?: string | null
          grade?: Json | null
          id?: string
          is_ahead_of_schedule?: boolean | null
          is_cross_dock?: boolean
          item_observation?: string | null
          labor_cost?: number | null
          last_sector_finished_at?: string | null
          material_cost?: number | null
          material_status?: string | null
          mod_cost?: number | null
          notes?: string | null
          order_number?: string
          outsourced_at?: string | null
          outsourced_returned_at?: string | null
          outsourced_sector?: string | null
          outsourced_to_contractor_id?: string | null
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
            foreignKeyName: "orders_cross_dock_sale_order_id_fkey"
            columns: ["cross_dock_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_cross_dock_sale_order_id_fkey"
            columns: ["cross_dock_sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_cross_dock_sale_order_id_fkey"
            columns: ["cross_dock_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_cross_dock_sale_order_id_fkey"
            columns: ["cross_dock_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_cross_dock_sale_order_id_fkey"
            columns: ["cross_dock_sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_outsourced_to_contractor_id_fkey"
            columns: ["outsourced_to_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_outsourced_to_contractor_id_fkey"
            columns: ["outsourced_to_contractor_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_metrics"
            referencedColumns: ["contractor_id"]
          },
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
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
      overtime_resolutions: {
        Row: {
          bank_minutes: number
          bank_movement_id: string | null
          created_at: string
          decision: string
          employee_id: string
          financial_entry_id: string | null
          hourly_rate_snapshot: number
          id: string
          month: string
          multiplier_snapshot: number
          notes: string | null
          overtime_minutes_total: number
          pay_amount: number
          pay_minutes: number
          payroll_run_id: string | null
          period_type: string
          resolved_at: string
          resolved_by: string | null
        }
        Insert: {
          bank_minutes?: number
          bank_movement_id?: string | null
          created_at?: string
          decision: string
          employee_id: string
          financial_entry_id?: string | null
          hourly_rate_snapshot: number
          id?: string
          month: string
          multiplier_snapshot: number
          notes?: string | null
          overtime_minutes_total?: number
          pay_amount?: number
          pay_minutes?: number
          payroll_run_id?: string | null
          period_type?: string
          resolved_at?: string
          resolved_by?: string | null
        }
        Update: {
          bank_minutes?: number
          bank_movement_id?: string | null
          created_at?: string
          decision?: string
          employee_id?: string
          financial_entry_id?: string | null
          hourly_rate_snapshot?: number
          id?: string
          month?: string
          multiplier_snapshot?: number
          notes?: string | null
          overtime_minutes_total?: number
          pay_amount?: number
          pay_minutes?: number
          payroll_run_id?: string | null
          period_type?: string
          resolved_at?: string
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "overtime_resolutions_bank_movement_id_fkey"
            columns: ["bank_movement_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_resolutions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "overtime_resolutions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_resolutions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "overtime_resolutions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "overtime_resolutions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "overtime_resolutions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "overtime_resolutions_financial_entry_id_fkey"
            columns: ["financial_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_resolutions_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
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
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "packaging_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "packaging_configs_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "packaging_configs_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "packaging_configs_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "packaging_configs_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configs_sole_group_id_fkey"
            columns: ["sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
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
      payroll_runs: {
        Row: {
          absence_discount: number
          absent_days: number
          advances_total: number
          approved_at: string | null
          base_salary: number
          business_days: number
          business_days_worked: number
          created_at: string
          deductions_amount: number
          dsr_value: number
          employee_id: string
          expected_minutes: number
          health_plan_discount: number
          hourly_rate: number
          id: string
          inss_value: number
          irrf_value: number
          net_salary: number
          night_bonus_value: number
          night_minutes: number
          normal_minutes: number
          normal_value: number
          notes: string | null
          overtime_100_minutes: number
          overtime_100_value: number
          overtime_50_minutes: number
          overtime_50_value: number
          overtime_amount: number
          overtime_paid_value: number
          paid_at: string | null
          period: string
          premium_minutes: number
          premium_value: number
          status: string
          total_descontos: number
          total_liquido: number
          total_proventos: number
          updated_at: string
          va_value: number
          vr_value: number
          vt_employee_discount: number
          vt_total_value: number
          worked_minutes: number
        }
        Insert: {
          absence_discount?: number
          absent_days?: number
          advances_total?: number
          approved_at?: string | null
          base_salary?: number
          business_days?: number
          business_days_worked?: number
          created_at?: string
          deductions_amount?: number
          dsr_value?: number
          employee_id: string
          expected_minutes?: number
          health_plan_discount?: number
          hourly_rate?: number
          id?: string
          inss_value?: number
          irrf_value?: number
          net_salary?: number
          night_bonus_value?: number
          night_minutes?: number
          normal_minutes?: number
          normal_value?: number
          notes?: string | null
          overtime_100_minutes?: number
          overtime_100_value?: number
          overtime_50_minutes?: number
          overtime_50_value?: number
          overtime_amount?: number
          overtime_paid_value?: number
          paid_at?: string | null
          period: string
          premium_minutes?: number
          premium_value?: number
          status?: string
          total_descontos?: number
          total_liquido?: number
          total_proventos?: number
          updated_at?: string
          va_value?: number
          vr_value?: number
          vt_employee_discount?: number
          vt_total_value?: number
          worked_minutes?: number
        }
        Update: {
          absence_discount?: number
          absent_days?: number
          advances_total?: number
          approved_at?: string | null
          base_salary?: number
          business_days?: number
          business_days_worked?: number
          created_at?: string
          deductions_amount?: number
          dsr_value?: number
          employee_id?: string
          expected_minutes?: number
          health_plan_discount?: number
          hourly_rate?: number
          id?: string
          inss_value?: number
          irrf_value?: number
          net_salary?: number
          night_bonus_value?: number
          night_minutes?: number
          normal_minutes?: number
          normal_value?: number
          notes?: string | null
          overtime_100_minutes?: number
          overtime_100_value?: number
          overtime_50_minutes?: number
          overtime_50_value?: number
          overtime_amount?: number
          overtime_paid_value?: number
          paid_at?: string | null
          period?: string
          premium_minutes?: number
          premium_value?: number
          status?: string
          total_descontos?: number
          total_liquido?: number
          total_proventos?: number
          updated_at?: string
          va_value?: number
          vr_value?: number
          vt_employee_discount?: number
          vt_total_value?: number
          worked_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      picking_items: {
        Row: {
          bin_location: string | null
          color: string | null
          conferred_at: string | null
          conferred_qty: number
          ean_scanned: string | null
          expected_qty: number
          id: string
          lot_id: string | null
          notes: string | null
          picked_at: string | null
          picked_qty: number
          picking_session_id: string
          product_id: string | null
          reference_id: string | null
          size: string | null
          status: string
        }
        Insert: {
          bin_location?: string | null
          color?: string | null
          conferred_at?: string | null
          conferred_qty?: number
          ean_scanned?: string | null
          expected_qty: number
          id?: string
          lot_id?: string | null
          notes?: string | null
          picked_at?: string | null
          picked_qty?: number
          picking_session_id: string
          product_id?: string | null
          reference_id?: string | null
          size?: string | null
          status?: string
        }
        Update: {
          bin_location?: string | null
          color?: string | null
          conferred_at?: string | null
          conferred_qty?: number
          ean_scanned?: string | null
          expected_qty?: number
          id?: string
          lot_id?: string | null
          notes?: string | null
          picked_at?: string | null
          picked_qty?: number
          picking_session_id?: string
          product_id?: string | null
          reference_id?: string | null
          size?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "picking_items_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "production_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_picking_session_id_fkey"
            columns: ["picking_session_id"]
            isOneToOne: false
            referencedRelation: "picking_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "picking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "picking_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "picking_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "picking_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "picking_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "picking_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "picking_lists_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
      picking_sessions: {
        Row: {
          completed_at: string | null
          conferred_by: string | null
          created_at: string
          divergence_notes: string | null
          id: string
          picking_type: string
          sale_order_id: string | null
          separator_id: string | null
          session_number: string
          started_at: string | null
          status: string
          total_pairs: number
          total_volumes: number
          total_weight_kg: number
          wave_id: string | null
        }
        Insert: {
          completed_at?: string | null
          conferred_by?: string | null
          created_at?: string
          divergence_notes?: string | null
          id?: string
          picking_type?: string
          sale_order_id?: string | null
          separator_id?: string | null
          session_number?: string
          started_at?: string | null
          status?: string
          total_pairs?: number
          total_volumes?: number
          total_weight_kg?: number
          wave_id?: string | null
        }
        Update: {
          completed_at?: string | null
          conferred_by?: string | null
          created_at?: string
          divergence_notes?: string | null
          id?: string
          picking_type?: string
          sale_order_id?: string | null
          separator_id?: string | null
          session_number?: string
          started_at?: string | null
          status?: string
          total_pairs?: number
          total_volumes?: number
          total_weight_kg?: number
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "picking_sessions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "picking_sessions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_sessions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "picking_sessions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "picking_sessions_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "picking_sessions_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "production_waves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picking_sessions_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_wave_detail"
            referencedColumns: ["wave_id"]
          },
        ]
      }
      price_list_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          min_quantity: number
          notes: string | null
          price_list_id: string
          reference_id: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          min_quantity?: number
          notes?: string | null
          price_list_id: string
          reference_id: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          min_quantity?: number
          notes?: string | null
          price_list_id?: string
          reference_id?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_list_items_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "price_list_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "price_list_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "price_list_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "price_list_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          active: boolean
          channel: string
          client_id: string | null
          created_at: string
          id: string
          is_promotional: boolean
          name: string
          notes: string | null
          region_uf: string | null
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          channel?: string
          client_id?: string | null
          created_at?: string
          id?: string
          is_promotional?: boolean
          name: string
          notes?: string | null
          region_uf?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          channel?: string
          client_id?: string | null
          created_at?: string
          id?: string
          is_promotional?: boolean
          name?: string
          notes?: string | null
          region_uf?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "price_lists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "price_lists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "price_lists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      pricing_simulations: {
        Row: {
          cash_price: number
          commission_pct: number
          created_at: string
          created_by: string | null
          factoring_days: number
          factoring_rate_pct: number
          factoring_total_pct: number
          freight_cost: number
          id: string
          labor_cost: number
          material_cost: number
          notes: string | null
          overhead_cost: number
          packaging_cost: number
          profit_margin_pct: number
          real_profit: number
          sheet_code: string | null
          sheet_id: string | null
          sheet_name: string | null
          suggested_price: number
          tax_pct: number
          total_cost: number
        }
        Insert: {
          cash_price?: number
          commission_pct?: number
          created_at?: string
          created_by?: string | null
          factoring_days?: number
          factoring_rate_pct?: number
          factoring_total_pct?: number
          freight_cost?: number
          id?: string
          labor_cost?: number
          material_cost?: number
          notes?: string | null
          overhead_cost?: number
          packaging_cost?: number
          profit_margin_pct?: number
          real_profit?: number
          sheet_code?: string | null
          sheet_id?: string | null
          sheet_name?: string | null
          suggested_price?: number
          tax_pct?: number
          total_cost?: number
        }
        Update: {
          cash_price?: number
          commission_pct?: number
          created_at?: string
          created_by?: string | null
          factoring_days?: number
          factoring_rate_pct?: number
          factoring_total_pct?: number
          freight_cost?: number
          id?: string
          labor_cost?: number
          material_cost?: number
          notes?: string | null
          overhead_cost?: number
          packaging_cost?: number
          profit_margin_pct?: number
          real_profit?: number
          sheet_code?: string | null
          sheet_id?: string | null
          sheet_name?: string | null
          suggested_price?: number
          tax_pct?: number
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_simulations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_simulations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "pricing_simulations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "pricing_simulations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_simulations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "pricing_simulations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "pricing_simulations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          insole_included: boolean | null
          is_bom_color_source: boolean
          metros_fitilho_per_amarrado: number | null
          name: string
          package_price: number | null
          package_weight_kg: number | null
          pairs_per_box_colmeia: number | null
          pairs_per_box_fitilho: number | null
          pairs_per_box_individual: number | null
          pairs_per_box_master: number | null
          parent_group_id: string | null
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
          insole_included?: boolean | null
          is_bom_color_source?: boolean
          metros_fitilho_per_amarrado?: number | null
          name: string
          package_price?: number | null
          package_weight_kg?: number | null
          pairs_per_box_colmeia?: number | null
          pairs_per_box_fitilho?: number | null
          pairs_per_box_individual?: number | null
          pairs_per_box_master?: number | null
          parent_group_id?: string | null
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
          insole_included?: boolean | null
          is_bom_color_source?: boolean
          metros_fitilho_per_amarrado?: number | null
          name?: string
          package_price?: number | null
          package_weight_kg?: number | null
          pairs_per_box_colmeia?: number | null
          pairs_per_box_fitilho?: number | null
          pairs_per_box_individual?: number | null
          pairs_per_box_master?: number | null
          parent_group_id?: string | null
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
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "product_price_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "product_references_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "product_references_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_references_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "product_references_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "product_references_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "product_technical_sheets_reference_product_id_fkey"
            columns: ["reference_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
      production_alerts: {
        Row: {
          alert_key: string
          alert_type: string
          body: string
          created_at: string
          dismissed_at: string | null
          dismissed_by: string | null
          id: string
          notification_error: string | null
          notification_status: string | null
          notified_at: string | null
          payload: Json
          severity: string
          title: string
        }
        Insert: {
          alert_key: string
          alert_type: string
          body: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          notification_error?: string | null
          notification_status?: string | null
          notified_at?: string | null
          payload?: Json
          severity: string
          title: string
        }
        Update: {
          alert_key?: string
          alert_type?: string
          body?: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          notification_error?: string | null
          notification_status?: string | null
          notified_at?: string | null
          payload?: Json
          severity?: string
          title?: string
        }
        Relationships: []
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_consumptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "production_consumptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_finishing_packages_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_finishing_packages_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_finishing_packages_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_finishing_packages_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_finishing_packages_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
            foreignKeyName: "production_finishing_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_finishing_packages_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
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
      production_lots: {
        Row: {
          block_reason: string | null
          blocked_at: string | null
          blocked_by: string | null
          color: string | null
          created_at: string
          expiry_date: string | null
          id: string
          is_blocked: boolean
          lot_number: string
          notes: string | null
          order_id: string | null
          produced_date: string | null
          raw_material_lots: Json | null
          reference_id: string | null
          total_pairs: number
          updated_at: string
        }
        Insert: {
          block_reason?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          color?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          is_blocked?: boolean
          lot_number: string
          notes?: string | null
          order_id?: string | null
          produced_date?: string | null
          raw_material_lots?: Json | null
          reference_id?: string | null
          total_pairs?: number
          updated_at?: string
        }
        Update: {
          block_reason?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          color?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          is_blocked?: boolean
          lot_number?: string
          notes?: string | null
          order_id?: string | null
          produced_date?: string | null
          raw_material_lots?: Json | null
          reference_id?: string | null
          total_pairs?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_lots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_lots_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_lots_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_lots_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_lots_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_lots_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_lots_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_lots_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
      production_settings: {
        Row: {
          costura_dispatch_horizon_days: number
          costura_overflow_tolerance_pct: number
          costura_pairs_per_day_total: number
          id: boolean
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          costura_dispatch_horizon_days?: number
          costura_overflow_tolerance_pct?: number
          costura_pairs_per_day_total?: number
          id?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          costura_dispatch_horizon_days?: number
          costura_overflow_tolerance_pct?: number
          costura_pairs_per_day_total?: number
          id?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      production_setup_times: {
        Row: {
          created_at: string
          from_color: string | null
          from_reference_id: string | null
          id: string
          notes: string | null
          setup_minutes: number
          stage_name: string
          to_color: string | null
          to_reference_id: string | null
        }
        Insert: {
          created_at?: string
          from_color?: string | null
          from_reference_id?: string | null
          id?: string
          notes?: string | null
          setup_minutes?: number
          stage_name: string
          to_color?: string | null
          to_reference_id?: string | null
        }
        Update: {
          created_at?: string
          from_color?: string | null
          from_reference_id?: string | null
          id?: string
          notes?: string | null
          setup_minutes?: number
          stage_name?: string
          to_color?: string | null
          to_reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_setup_times_from_reference_id_fkey"
            columns: ["from_reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_setup_times_from_reference_id_fkey"
            columns: ["from_reference_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_setup_times_from_reference_id_fkey"
            columns: ["from_reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_setup_times_from_reference_id_fkey"
            columns: ["from_reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_setup_times_from_reference_id_fkey"
            columns: ["from_reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_setup_times_from_reference_id_fkey"
            columns: ["from_reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_setup_times_from_reference_id_fkey"
            columns: ["from_reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_setup_times_to_reference_id_fkey"
            columns: ["to_reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_setup_times_to_reference_id_fkey"
            columns: ["to_reference_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_setup_times_to_reference_id_fkey"
            columns: ["to_reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_setup_times_to_reference_id_fkey"
            columns: ["to_reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_setup_times_to_reference_id_fkey"
            columns: ["to_reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_setup_times_to_reference_id_fkey"
            columns: ["to_reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_setup_times_to_reference_id_fkey"
            columns: ["to_reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      production_stop_reasons: {
        Row: {
          active: boolean
          category: string
          code: string
          created_at: string
          description: string
          id: string
          impacts_availability: boolean
          impacts_performance: boolean
          is_planned: boolean
        }
        Insert: {
          active?: boolean
          category?: string
          code: string
          created_at?: string
          description: string
          id?: string
          impacts_availability?: boolean
          impacts_performance?: boolean
          is_planned?: boolean
        }
        Update: {
          active?: boolean
          category?: string
          code?: string
          created_at?: string
          description?: string
          id?: string
          impacts_availability?: boolean
          impacts_performance?: boolean
          is_planned?: boolean
        }
        Relationships: []
      }
      production_stops: {
        Row: {
          created_at: string
          duration_minutes: number | null
          ended_at: string | null
          id: string
          observation: string | null
          order_id: string | null
          reason_id: string
          reported_by: string | null
          stage_name: string
          started_at: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          observation?: string | null
          order_id?: string | null
          reason_id: string
          reported_by?: string | null
          stage_name: string
          started_at?: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          observation?: string | null
          order_id?: string | null
          reason_id?: string
          reported_by?: string | null
          stage_name?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_stops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_stops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_stops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_stops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_stops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_stops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_stops_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "production_stop_reasons"
            referencedColumns: ["id"]
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
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
          block_key: string | null
          block_sequence: number | null
          client_id: string | null
          color: string
          created_at: string
          grade: Json | null
          id: string
          pickup_window:
            | Database["public"]["Enums"]["pickup_window_enum"]
            | null
          reference_id: string
          sole_product_id: string | null
          sort_order: number
          status: Database["public"]["Enums"]["stage_status_enum"]
          store_name: string | null
          total_quantity: number
          wave_id: string
        }
        Insert: {
          block_key?: string | null
          block_sequence?: number | null
          client_id?: string | null
          color?: string
          created_at?: string
          grade?: Json | null
          id?: string
          pickup_window?:
            | Database["public"]["Enums"]["pickup_window_enum"]
            | null
          reference_id: string
          sole_product_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["stage_status_enum"]
          store_name?: string | null
          total_quantity?: number
          wave_id: string
        }
        Update: {
          block_key?: string | null
          block_sequence?: number | null
          client_id?: string | null
          color?: string
          created_at?: string
          grade?: Json | null
          id?: string
          pickup_window?:
            | Database["public"]["Enums"]["pickup_window_enum"]
            | null
          reference_id?: string
          sole_product_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["stage_status_enum"]
          store_name?: string | null
          total_quantity?: number
          wave_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_wave_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "production_wave_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "production_wave_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "production_wave_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
            referencedColumns: ["client_id"]
          },
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_wave_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_wave_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_wave_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_wave_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "production_wave_items_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_wave_rework_product_ref_fkey"
            columns: ["product_ref"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "production_wave_rework_product_ref_fkey"
            columns: ["product_ref"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_wave_rework_product_ref_fkey"
            columns: ["product_ref"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_wave_rework_product_ref_fkey"
            columns: ["product_ref"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "production_wave_rework_product_ref_fkey"
            columns: ["product_ref"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
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
          corte_start_date: string | null
          costura_start_date: string | null
          created_at: string
          created_by: string | null
          current_stage:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline: string | null
          finished_at: string | null
          id: string
          late_creation: boolean
          material_ready_date: string | null
          mesa_start_date: string | null
          montagem_start_date: string | null
          notes: string | null
          pickup_friday_date: string | null
          pickup_tuesday_date: string | null
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
          corte_start_date?: string | null
          costura_start_date?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline?: string | null
          finished_at?: string | null
          id?: string
          late_creation?: boolean
          material_ready_date?: string | null
          mesa_start_date?: string | null
          montagem_start_date?: string | null
          notes?: string | null
          pickup_friday_date?: string | null
          pickup_tuesday_date?: string | null
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
          corte_start_date?: string | null
          costura_start_date?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?:
            | Database["public"]["Enums"]["production_stage_enum"]
            | null
          earliest_deadline?: string | null
          finished_at?: string | null
          id?: string
          late_creation?: boolean
          material_ready_date?: string | null
          mesa_start_date?: string | null
          montagem_start_date?: string | null
          notes?: string | null
          pickup_friday_date?: string | null
          pickup_tuesday_date?: string | null
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
          blocked_qty: number
          box_type_id: string | null
          brand: string | null
          calculation_method: string | null
          category: string
          color: string
          consumption_unit: string | null
          conversion_rate: number | null
          created_at: string
          current_stock: number | null
          default_bin_location_id: string | null
          dimensions_height: number | null
          dimensions_length: number | null
          dimensions_thickness: number | null
          dimensions_unit: string | null
          dimensions_width: number | null
          expiration_date: string | null
          fachete_material_group_id: string | null
          gestaoclick_id: string | null
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
          max_stock: number | null
          min_order_quantity: number | null
          min_stock: number | null
          min_stock_grade: Json | null
          model: string | null
          name: string
          ncm: string | null
          pairs_per_package: number
          preferred_supplier_id: string | null
          price_retail: number | null
          price_wholesale: number | null
          production_unit: string | null
          purchase_order_unit: string | null
          purchase_unit: string | null
          quantity: number
          quarantine_qty: number
          requires_sewing: boolean | null
          reserved_stock: number | null
          safety_stock: number | null
          sku: string
          sole_classification:
            | Database["public"]["Enums"]["sole_classification_enum"]
            | null
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
          blocked_qty?: number
          box_type_id?: string | null
          brand?: string | null
          calculation_method?: string | null
          category: string
          color?: string
          consumption_unit?: string | null
          conversion_rate?: number | null
          created_at?: string
          current_stock?: number | null
          default_bin_location_id?: string | null
          dimensions_height?: number | null
          dimensions_length?: number | null
          dimensions_thickness?: number | null
          dimensions_unit?: string | null
          dimensions_width?: number | null
          expiration_date?: string | null
          fachete_material_group_id?: string | null
          gestaoclick_id?: string | null
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
          max_stock?: number | null
          min_order_quantity?: number | null
          min_stock?: number | null
          min_stock_grade?: Json | null
          model?: string | null
          name: string
          ncm?: string | null
          pairs_per_package?: number
          preferred_supplier_id?: string | null
          price_retail?: number | null
          price_wholesale?: number | null
          production_unit?: string | null
          purchase_order_unit?: string | null
          purchase_unit?: string | null
          quantity?: number
          quarantine_qty?: number
          requires_sewing?: boolean | null
          reserved_stock?: number | null
          safety_stock?: number | null
          sku: string
          sole_classification?:
            | Database["public"]["Enums"]["sole_classification_enum"]
            | null
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
          blocked_qty?: number
          box_type_id?: string | null
          brand?: string | null
          calculation_method?: string | null
          category?: string
          color?: string
          consumption_unit?: string | null
          conversion_rate?: number | null
          created_at?: string
          current_stock?: number | null
          default_bin_location_id?: string | null
          dimensions_height?: number | null
          dimensions_length?: number | null
          dimensions_thickness?: number | null
          dimensions_unit?: string | null
          dimensions_width?: number | null
          expiration_date?: string | null
          fachete_material_group_id?: string | null
          gestaoclick_id?: string | null
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
          max_stock?: number | null
          min_order_quantity?: number | null
          min_stock?: number | null
          min_stock_grade?: Json | null
          model?: string | null
          name?: string
          ncm?: string | null
          pairs_per_package?: number
          preferred_supplier_id?: string | null
          price_retail?: number | null
          price_wholesale?: number | null
          production_unit?: string | null
          purchase_order_unit?: string | null
          purchase_unit?: string | null
          quantity?: number
          quarantine_qty?: number
          requires_sewing?: boolean | null
          reserved_stock?: number | null
          safety_stock?: number | null
          sku?: string
          sole_classification?:
            | Database["public"]["Enums"]["sole_classification_enum"]
            | null
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
            foreignKeyName: "products_default_bin_location_id_fkey"
            columns: ["default_bin_location_id"]
            isOneToOne: false
            referencedRelation: "bin_locations"
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
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
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
          is_sales_rep: boolean
          sales_target_monthly_brl: number | null
          sales_target_monthly_pairs: number | null
          updated_at: string
        }
        Insert: {
          approved?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id: string
          is_sales_rep?: boolean
          sales_target_monthly_brl?: number | null
          sales_target_monthly_pairs?: number | null
          updated_at?: string
        }
        Update: {
          approved?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_sales_rep?: boolean
          sales_target_monthly_brl?: number | null
          sales_target_monthly_pairs?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      punch_clock_params: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          param_key: string
          valid_from: string
          valid_to: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          param_key: string
          valid_from: string
          valid_to?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          param_key?: string
          valid_from?: string
          valid_to?: string | null
          value?: Json
        }
        Relationships: []
      }
      purchase_approval_tiers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_value: number | null
          min_value: number
          name: string
          notes: string | null
          required_role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_value?: number | null
          min_value?: number
          name?: string
          notes?: string | null
          required_role?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_value?: number | null
          min_value?: number
          name?: string
          notes?: string | null
          required_role?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_approvals: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          purchase_order_id: string
          rejection_reason: string | null
          required_role: string
          status: string
          tier_name: string | null
          total_value: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          purchase_order_id: string
          rejection_reason?: string | null
          required_role: string
          status?: string
          tier_name?: string | null
          total_value?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          purchase_order_id?: string
          rejection_reason?: string | null
          required_role?: string
          status?: string
          tier_name?: string | null
          total_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_approvals_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_approvals_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_open_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_approvals_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_overdue_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
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
          received_at: string | null
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
          received_at?: string | null
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
          received_at?: string | null
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
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_open_purchase_orders"
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
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          auto_generated: boolean
          cancelled_at: string | null
          created_at: string
          eta_days: number | null
          expedite: boolean
          id: string
          idempotency_key: string | null
          is_late_origin: boolean
          linked_sale_order_ids: string[] | null
          notes: string | null
          order_number: string
          promised_date: string | null
          received_at: string | null
          received_date: string | null
          reference_order_id: string | null
          rejection_reason: string | null
          status: string
          supplier_id: string | null
          supplier_name: string
          total_value: number
          updated_at: string
        }
        Insert: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auto_generated?: boolean
          cancelled_at?: string | null
          created_at?: string
          eta_days?: number | null
          expedite?: boolean
          id?: string
          idempotency_key?: string | null
          is_late_origin?: boolean
          linked_sale_order_ids?: string[] | null
          notes?: string | null
          order_number?: string
          promised_date?: string | null
          received_at?: string | null
          received_date?: string | null
          reference_order_id?: string | null
          rejection_reason?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auto_generated?: boolean
          cancelled_at?: string | null
          created_at?: string
          eta_days?: number | null
          expedite?: boolean
          id?: string
          idempotency_key?: string | null
          is_late_origin?: boolean
          linked_sale_order_ids?: string[] | null
          notes?: string | null
          order_number?: string
          promised_date?: string | null
          received_at?: string | null
          received_date?: string | null
          reference_order_id?: string | null
          rejection_reason?: string | null
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
      purchase_quotation_items: {
        Row: {
          id: string
          notes: string | null
          product_id: string
          quantity: number
          quotation_id: string
          unit: string
        }
        Insert: {
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          quotation_id: string
          unit?: string
        }
        Update: {
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          quotation_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "purchase_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_quotation_prices: {
        Row: {
          discount_pct: number | null
          id: string
          notes: string | null
          quotation_item_id: string
          response_id: string
          unit_price: number
        }
        Insert: {
          discount_pct?: number | null
          id?: string
          notes?: string | null
          quotation_item_id: string
          response_id: string
          unit_price: number
        }
        Update: {
          discount_pct?: number | null
          id?: string
          notes?: string | null
          quotation_item_id?: string
          response_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_quotation_prices_quotation_item_id_fkey"
            columns: ["quotation_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_quotation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_prices_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "purchase_quotation_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_quotation_responses: {
        Row: {
          contacted_at: string
          delivery_days: number | null
          freight_type: string | null
          freight_value: number | null
          id: string
          is_winner: boolean
          notes: string | null
          payment_terms: string | null
          quotation_id: string
          responded_at: string | null
          supplier_id: string
          total_value: number | null
          validity_days: number | null
        }
        Insert: {
          contacted_at?: string
          delivery_days?: number | null
          freight_type?: string | null
          freight_value?: number | null
          id?: string
          is_winner?: boolean
          notes?: string | null
          payment_terms?: string | null
          quotation_id: string
          responded_at?: string | null
          supplier_id: string
          total_value?: number | null
          validity_days?: number | null
        }
        Update: {
          contacted_at?: string
          delivery_days?: number | null
          freight_type?: string | null
          freight_value?: number | null
          id?: string
          is_winner?: boolean
          notes?: string | null
          payment_terms?: string | null
          quotation_id?: string
          responded_at?: string | null
          supplier_id?: string
          total_value?: number | null
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_quotation_responses_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "purchase_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_responses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotation_responses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      purchase_quotations: {
        Row: {
          created_at: string
          deadline: string | null
          decided_by: string | null
          decision_at: string | null
          decision_notes: string | null
          id: string
          notes: string | null
          origin_mrp_suggestion_id: string | null
          quotation_number: string
          requested_at: string
          selected_supplier_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          decided_by?: string | null
          decision_at?: string | null
          decision_notes?: string | null
          id?: string
          notes?: string | null
          origin_mrp_suggestion_id?: string | null
          quotation_number?: string
          requested_at?: string
          selected_supplier_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          decided_by?: string | null
          decision_at?: string | null
          decision_notes?: string | null
          id?: string
          notes?: string | null
          origin_mrp_suggestion_id?: string | null
          quotation_number?: string
          requested_at?: string
          selected_supplier_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_quotations_selected_supplier_id_fkey"
            columns: ["selected_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_quotations_selected_supplier_id_fkey"
            columns: ["selected_supplier_id"]
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
      quality_defect_catalog: {
        Row: {
          active: boolean
          can_rework: boolean
          category: string
          code: string
          created_at: string
          default_sector: string | null
          default_severity: string
          description: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          can_rework?: boolean
          category: string
          code: string
          created_at?: string
          default_sector?: string | null
          default_severity: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          can_rework?: boolean
          category?: string
          code?: string
          created_at?: string
          default_sector?: string | null
          default_severity?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      quality_defects: {
        Row: {
          category: string
          cost_impact: number
          created_at: string
          defect_code: string
          defect_description: string
          id: string
          inspection_id: string | null
          notes: string | null
          photo_url: string | null
          quantity_affected: number
          resolution: string
          severity: string
        }
        Insert: {
          category?: string
          cost_impact?: number
          created_at?: string
          defect_code: string
          defect_description: string
          id?: string
          inspection_id?: string | null
          notes?: string | null
          photo_url?: string | null
          quantity_affected?: number
          resolution?: string
          severity?: string
        }
        Update: {
          category?: string
          cost_impact?: number
          created_at?: string
          defect_code?: string
          defect_description?: string
          id?: string
          inspection_id?: string | null
          notes?: string | null
          photo_url?: string | null
          quantity_affected?: number
          resolution?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_defects_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_inspection_plans: {
        Row: {
          active: boolean
          aql_accept: number | null
          aql_level: string | null
          aql_reject: number | null
          created_at: string
          id: string
          inspection_items: Json
          inspection_phase: string
          name: string
          product_id: string | null
          sample_size_pct: number
          stage_name: string | null
        }
        Insert: {
          active?: boolean
          aql_accept?: number | null
          aql_level?: string | null
          aql_reject?: number | null
          created_at?: string
          id?: string
          inspection_items?: Json
          inspection_phase: string
          name: string
          product_id?: string | null
          sample_size_pct?: number
          stage_name?: string | null
        }
        Update: {
          active?: boolean
          aql_accept?: number | null
          aql_level?: string | null
          aql_reject?: number | null
          created_at?: string
          id?: string
          inspection_items?: Json
          inspection_phase?: string
          name?: string
          product_id?: string | null
          sample_size_pct?: number
          stage_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "quality_inspection_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quality_inspections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
          defect_catalog_id: string | null
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
          defect_catalog_id?: string | null
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
          defect_catalog_id?: string | null
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
            foreignKeyName: "quality_records_defect_catalog_id_fkey"
            columns: ["defect_catalog_id"]
            isOneToOne: false
            referencedRelation: "quality_defect_catalog"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quality_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
            foreignKeyName: "quarantine_stock_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_lots_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_order_lot_traceability"
            referencedColumns: ["lot_id"]
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "quarantine_stock_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "quarantine_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "ready_stock_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "ready_stock_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_stock_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "ready_stock_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "ready_stock_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "reference_color_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "reference_color_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_color_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "reference_color_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "reference_color_variants_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_material_variants: {
        Row: {
          active: boolean
          available_colors: string[] | null
          barcode: string | null
          created_at: string
          description_override: string | null
          display_order: number
          id: string
          insole_consumption_override: number | null
          insole_material_product_id: string | null
          lining_consumption_override: number | null
          lining_material_product_id: string | null
          material_name: string
          ncm: string | null
          reference_id: string
          sku: string | null
          sole_consumption_override: number | null
          sole_material_product_id: string | null
          unit_price_override: number | null
          updated_at: string
          upper_consumption_override: number | null
          upper_material_product_id: string | null
        }
        Insert: {
          active: boolean
          available_colors?: string[] | null
          barcode?: string | null
          created_at?: string
          description_override?: string | null
          display_order: number
          id?: string
          insole_consumption_override?: number | null
          insole_material_product_id?: string | null
          lining_consumption_override?: number | null
          lining_material_product_id?: string | null
          material_name: string
          ncm?: string | null
          reference_id: string
          sku?: string | null
          sole_consumption_override?: number | null
          sole_material_product_id?: string | null
          unit_price_override?: number | null
          updated_at?: string
          upper_consumption_override?: number | null
          upper_material_product_id?: string | null
        }
        Update: {
          active?: boolean
          available_colors?: string[] | null
          barcode?: string | null
          created_at?: string
          description_override?: string | null
          display_order?: number
          id?: string
          insole_consumption_override?: number | null
          insole_material_product_id?: string | null
          lining_consumption_override?: number | null
          lining_material_product_id?: string | null
          material_name?: string
          ncm?: string | null
          reference_id?: string
          sku?: string | null
          sole_consumption_override?: number | null
          sole_material_product_id?: string | null
          unit_price_override?: number | null
          updated_at?: string
          upper_consumption_override?: number | null
          upper_material_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "reference_material_variants_insole_material_product_id_fkey"
            columns: ["insole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "reference_material_variants_lining_material_product_id_fkey"
            columns: ["lining_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "reference_material_variants_sole_material_product_id_fkey"
            columns: ["sole_material_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "reference_materials_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "reference_materials_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_materials_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "reference_materials_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "reference_materials_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          enqueued_at: string
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
        Relationships: []
      }
      sac_ticket_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: string | null
          id: string
          note: string | null
          ticket_id: string
          to_status: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: string | null
          id?: string
          note?: string | null
          ticket_id: string
          to_status: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: string | null
          id?: string
          note?: string | null
          ticket_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sac_ticket_history_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "sac_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      sac_tickets: {
        Row: {
          client_id: string | null
          color: string | null
          cost_impact: number | null
          defect_category: string | null
          description: string
          id: string
          notes: string | null
          opened_at: string
          pairs_affected: number | null
          photo_url: string | null
          pickup_authorized: boolean
          reference_id: string | null
          refund_amount: number | null
          resolution: string | null
          resolution_type: string | null
          resolved_at: string | null
          resolved_by: string | null
          return_nfe_number: string | null
          sale_order_id: string | null
          size: string | null
          status: string
          ticket_number: string
          ticket_type: string
        }
        Insert: {
          client_id?: string | null
          color?: string | null
          cost_impact?: number | null
          defect_category?: string | null
          description: string
          id?: string
          notes?: string | null
          opened_at?: string
          pairs_affected?: number | null
          photo_url?: string | null
          pickup_authorized?: boolean
          reference_id?: string | null
          refund_amount?: number | null
          resolution?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          return_nfe_number?: string | null
          sale_order_id?: string | null
          size?: string | null
          status?: string
          ticket_number?: string
          ticket_type?: string
        }
        Update: {
          client_id?: string | null
          color?: string | null
          cost_impact?: number | null
          defect_category?: string | null
          description?: string
          id?: string
          notes?: string | null
          opened_at?: string
          pairs_affected?: number | null
          photo_url?: string | null
          pickup_authorized?: boolean
          reference_id?: string | null
          refund_amount?: number | null
          resolution?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          return_nfe_number?: string | null
          sale_order_id?: string | null
          size?: string | null
          status?: string
          ticket_number?: string
          ticket_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sac_tickets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sac_tickets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sac_tickets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sac_tickets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sac_tickets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sac_tickets_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sac_tickets_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sac_tickets_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sac_tickets_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sac_tickets_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sac_tickets_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sac_tickets_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sac_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sac_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sac_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sac_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sac_tickets_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
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
          product_id: string | null
          qty_devolvida: number
          quantity: number
          reference_id: string | null
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
          product_id?: string | null
          qty_devolvida?: number
          quantity?: number
          reference_id?: string | null
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
          product_id?: string | null
          qty_devolvida?: number
          quantity?: number
          reference_id?: string | null
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
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "sale_order_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_order_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      sale_order_lot_allocations: {
        Row: {
          created_at: string
          id: string
          pairs_allocated: number
          production_lot_id: string
          sale_order_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pairs_allocated: number
          production_lot_id: string
          sale_order_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pairs_allocated?: number
          production_lot_id?: string
          sale_order_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_order_lot_allocations_production_lot_id_fkey"
            columns: ["production_lot_id"]
            isOneToOne: false
            referencedRelation: "production_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_lot_allocations_sale_order_item_id_fkey"
            columns: ["sale_order_item_id"]
            isOneToOne: false
            referencedRelation: "sale_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_orders: {
        Row: {
          billing_week: string | null
          brand: string
          checked_by: string | null
          client_cnpj: string | null
          client_contact: string | null
          client_id: string | null
          client_name: string
          client_order_number: string
          client_request_id: string | null
          client_signature_at: string | null
          client_signature_data_url: string | null
          commission_value: number
          costs_dirty_at: string | null
          created_at: string
          deleted_at: string | null
          delivery_deadline: string | null
          delivery_month: string | null
          delivery_week: string | null
          export_currency: string | null
          export_exchange_rate: number | null
          export_incoterm: string | null
          external_nfe_number: string | null
          factoring_config_id: string | null
          id: string
          informacoes_complementares_nf: string | null
          is_factoring: boolean
          is_standalone_nfe: boolean
          manual_billing_override: boolean
          manual_override_reason: string | null
          modalidade_frete: string | null
          nfe: string | null
          nfe_external: boolean
          nfe_required: boolean
          notes: string | null
          order_number: string
          order_type: string
          original_min_billing_date: string | null
          own_delivery: boolean
          packaging_mode: string | null
          packaging_product_id: string | null
          packaging_quantity: number
          parent_order_id: string | null
          payment_condition: string | null
          picking_individually_done_at: string | null
          remessa: string | null
          representative: string | null
          representative_id: string | null
          reservations_outdated_at: string | null
          scheduled_dispatch_at: string | null
          shipped_at: string | null
          shipping_rate_per_pair: number
          status: string
          total: number
          transport_company_id: string | null
          transporter_id: string | null
          updated_at: string
          valor_frete: number | null
          vehicle_plate: string | null
          vehicle_uf: string | null
        }
        Insert: {
          billing_week?: string | null
          brand?: string
          checked_by?: string | null
          client_cnpj?: string | null
          client_contact?: string | null
          client_id?: string | null
          client_name?: string
          client_order_number?: string
          client_request_id?: string | null
          client_signature_at?: string | null
          client_signature_data_url?: string | null
          commission_value?: number
          costs_dirty_at?: string | null
          created_at?: string
          deleted_at?: string | null
          delivery_deadline?: string | null
          delivery_month?: string | null
          delivery_week?: string | null
          export_currency?: string | null
          export_exchange_rate?: number | null
          export_incoterm?: string | null
          external_nfe_number?: string | null
          factoring_config_id?: string | null
          id?: string
          informacoes_complementares_nf?: string | null
          is_factoring?: boolean
          is_standalone_nfe?: boolean
          manual_billing_override?: boolean
          manual_override_reason?: string | null
          modalidade_frete?: string | null
          nfe?: string | null
          nfe_external?: boolean
          nfe_required?: boolean
          notes?: string | null
          order_number?: string
          order_type?: string
          original_min_billing_date?: string | null
          own_delivery?: boolean
          packaging_mode?: string | null
          packaging_product_id?: string | null
          packaging_quantity?: number
          parent_order_id?: string | null
          payment_condition?: string | null
          picking_individually_done_at?: string | null
          remessa?: string | null
          representative?: string | null
          representative_id?: string | null
          reservations_outdated_at?: string | null
          scheduled_dispatch_at?: string | null
          shipped_at?: string | null
          shipping_rate_per_pair?: number
          status?: string
          total?: number
          transport_company_id?: string | null
          transporter_id?: string | null
          updated_at?: string
          valor_frete?: number | null
          vehicle_plate?: string | null
          vehicle_uf?: string | null
        }
        Update: {
          billing_week?: string | null
          brand?: string
          checked_by?: string | null
          client_cnpj?: string | null
          client_contact?: string | null
          client_id?: string | null
          client_name?: string
          client_order_number?: string
          client_request_id?: string | null
          client_signature_at?: string | null
          client_signature_data_url?: string | null
          commission_value?: number
          costs_dirty_at?: string | null
          created_at?: string
          deleted_at?: string | null
          delivery_deadline?: string | null
          delivery_month?: string | null
          delivery_week?: string | null
          export_currency?: string | null
          export_exchange_rate?: number | null
          export_incoterm?: string | null
          external_nfe_number?: string | null
          factoring_config_id?: string | null
          id?: string
          informacoes_complementares_nf?: string | null
          is_factoring?: boolean
          is_standalone_nfe?: boolean
          manual_billing_override?: boolean
          manual_override_reason?: string | null
          modalidade_frete?: string | null
          nfe?: string | null
          nfe_external?: boolean
          nfe_required?: boolean
          notes?: string | null
          order_number?: string
          order_type?: string
          original_min_billing_date?: string | null
          own_delivery?: boolean
          packaging_mode?: string | null
          packaging_product_id?: string | null
          packaging_quantity?: number
          parent_order_id?: string | null
          payment_condition?: string | null
          picking_individually_done_at?: string | null
          remessa?: string | null
          representative?: string | null
          representative_id?: string | null
          reservations_outdated_at?: string | null
          scheduled_dispatch_at?: string | null
          shipped_at?: string | null
          shipping_rate_per_pair?: number
          status?: string
          total?: number
          transport_company_id?: string | null
          transporter_id?: string | null
          updated_at?: string
          valor_frete?: number | null
          vehicle_plate?: string | null
          vehicle_uf?: string | null
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
            foreignKeyName: "sale_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sale_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sale_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
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
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sale_orders_packaging_product_id_fkey"
            columns: ["packaging_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "sale_orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
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
          {
            foreignKeyName: "sale_orders_transporter_id_fkey"
            columns: ["transporter_id"]
            isOneToOne: false
            referencedRelation: "transporters"
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
      sector_distribution_plan: {
        Row: {
          created_at: string
          created_by: string | null
          day_of_week: number
          id: string
          is_locked: boolean
          notes: string | null
          pairs_planned: number
          sector: string
          source: string
          tech_sheet_id: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          day_of_week: number
          id?: string
          is_locked?: boolean
          notes?: string | null
          pairs_planned: number
          sector: string
          source?: string
          tech_sheet_id: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          day_of_week?: number
          id?: string
          is_locked?: boolean
          notes?: string | null
          pairs_planned?: number
          sector?: string
          source?: string
          tech_sheet_id?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "sector_distribution_plan_tech_sheet_id_fkey"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sector_distribution_plan_tech_sheet_id_fkey"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sector_distribution_plan_tech_sheet_id_fkey"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sector_distribution_plan_tech_sheet_id_fkey"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sector_distribution_plan_tech_sheet_id_fkey"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sector_distribution_plan_tech_sheet_id_fkey"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sector_distribution_plan_tech_sheet_id_fkey"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      sector_grouping_config: {
        Row: {
          notes: string | null
          sector: string
          strategy: string
          updated_at: string
        }
        Insert: {
          notes?: string | null
          sector: string
          strategy: string
          updated_at?: string
        }
        Update: {
          notes?: string | null
          sector?: string
          strategy?: string
          updated_at?: string
        }
        Relationships: []
      }
      security_settings: {
        Row: {
          id: string
          ip_whitelist: string[] | null
          lockout_duration_minutes: number
          max_failed_attempts: number
          mfa_required_for_roles: string[] | null
          password_expiry_days: number | null
          password_history_count: number
          password_min_length: number
          password_require_lowercase: boolean
          password_require_number: boolean
          password_require_special: boolean
          password_require_uppercase: boolean
          session_timeout_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          ip_whitelist?: string[] | null
          lockout_duration_minutes?: number
          max_failed_attempts?: number
          mfa_required_for_roles?: string[] | null
          password_expiry_days?: number | null
          password_history_count?: number
          password_min_length?: number
          password_require_lowercase?: boolean
          password_require_number?: boolean
          password_require_special?: boolean
          password_require_uppercase?: boolean
          session_timeout_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          ip_whitelist?: string[] | null
          lockout_duration_minutes?: number
          max_failed_attempts?: number
          mfa_required_for_roles?: string[] | null
          password_expiry_days?: number | null
          password_history_count?: number
          password_min_length?: number
          password_require_lowercase?: boolean
          password_require_number?: boolean
          password_require_special?: boolean
          password_require_uppercase?: boolean
          session_timeout_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      sensitive_field_registry: {
        Row: {
          active: boolean
          allowed_roles: string[] | null
          column_name: string
          id: string
          masking_rule: string | null
          reason: string | null
          sensitivity_level: string
          table_name: string
        }
        Insert: {
          active?: boolean
          allowed_roles?: string[] | null
          column_name: string
          id?: string
          masking_rule?: string | null
          reason?: string | null
          sensitivity_level?: string
          table_name: string
        }
        Update: {
          active?: boolean
          allowed_roles?: string[] | null
          column_name?: string
          id?: string
          masking_rule?: string | null
          reason?: string | null
          sensitivity_level?: string
          table_name?: string
        }
        Relationships: []
      }
      service_order_returns: {
        Row: {
          created_at: string
          created_by: string | null
          defect_notes: string | null
          id: string
          qty_defect: number
          qty_good: number
          qty_loss: number
          returned_at: string
          service_order_id: string
          settlement_id: string | null
          signed_photo_url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          defect_notes?: string | null
          id?: string
          qty_defect?: number
          qty_good?: number
          qty_loss?: number
          returned_at?: string
          service_order_id: string
          settlement_id?: string | null
          signed_photo_url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          defect_notes?: string | null
          id?: string
          qty_defect?: number
          qty_good?: number
          qty_loss?: number
          returned_at?: string
          service_order_id?: string
          settlement_id?: string | null
          signed_photo_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_order_returns_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_order_returns_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_history_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_order_returns_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "v_open_service_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_order_returns_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "v_service_order_balance"
            referencedColumns: ["service_order_id"]
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
          bottleneck_week: string | null
          contractor_id: string
          created_at: string
          delivered_at: string | null
          description: string
          id: string
          linked_sale_order_ids: string[] | null
          material_color: string | null
          material_meters: number | null
          material_name: string | null
          materials_sent: Json | null
          montagem_override_at: string | null
          montagem_override_by: string | null
          montagem_override_reason: string | null
          notes: string | null
          order_id: string | null
          order_number: string
          quantity: number
          quoted_at: string | null
          quoted_deadline: string | null
          quoted_lead_days: number | null
          receipt_generated_at: string | null
          receipt_number: string | null
          related_order_id: string | null
          sale_order_id: string | null
          sector: string | null
          service_date: string
          service_time: string | null
          signed_photo_url: string | null
          status: string
          target_sector: string | null
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
          bottleneck_week?: string | null
          contractor_id: string
          created_at?: string
          delivered_at?: string | null
          description?: string
          id?: string
          linked_sale_order_ids?: string[] | null
          material_color?: string | null
          material_meters?: number | null
          material_name?: string | null
          materials_sent?: Json | null
          montagem_override_at?: string | null
          montagem_override_by?: string | null
          montagem_override_reason?: string | null
          notes?: string | null
          order_id?: string | null
          order_number?: string
          quantity?: number
          quoted_at?: string | null
          quoted_deadline?: string | null
          quoted_lead_days?: number | null
          receipt_generated_at?: string | null
          receipt_number?: string | null
          related_order_id?: string | null
          sale_order_id?: string | null
          sector?: string | null
          service_date?: string
          service_time?: string | null
          signed_photo_url?: string | null
          status?: string
          target_sector?: string | null
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
          bottleneck_week?: string | null
          contractor_id?: string
          created_at?: string
          delivered_at?: string | null
          description?: string
          id?: string
          linked_sale_order_ids?: string[] | null
          material_color?: string | null
          material_meters?: number | null
          material_name?: string | null
          materials_sent?: Json | null
          montagem_override_at?: string | null
          montagem_override_by?: string | null
          montagem_override_reason?: string | null
          notes?: string | null
          order_id?: string | null
          order_number?: string
          quantity?: number
          quoted_at?: string | null
          quoted_deadline?: string | null
          quoted_lead_days?: number | null
          receipt_generated_at?: string | null
          receipt_number?: string | null
          related_order_id?: string | null
          sale_order_id?: string | null
          sector?: string | null
          service_date?: string
          service_time?: string | null
          signed_photo_url?: string | null
          status?: string
          target_sector?: string | null
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
            foreignKeyName: "service_orders_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_metrics"
            referencedColumns: ["contractor_id"]
          },
          {
            foreignKeyName: "service_orders_montagem_override_by_fkey"
            columns: ["montagem_override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "service_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "service_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "service_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "service_orders_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "service_orders_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "v_late_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "service_orders_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "service_orders_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
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
          {
            foreignKeyName: "service_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "service_orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sheet_catalog_models_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sheet_catalog_models_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_catalog_models_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sheet_catalog_models_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sheet_catalog_models_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          material_variant_id: string | null
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
          material_variant_id?: string | null
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
          material_variant_id?: string | null
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
            foreignKeyName: "sheet_materials_material_variant_id_fkey"
            columns: ["material_variant_id"]
            isOneToOne: false
            referencedRelation: "reference_material_variants"
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
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sheet_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sheet_materials_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sheet_materials_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_materials_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sheet_materials_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sheet_materials_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_materials_cleanup_log: {
        Row: {
          cleaned_at: string
          group_name: string | null
          id: string
          product_color: string | null
          product_id: string
          product_name: string | null
          quantity_per_unit: number | null
          reason: string
          sheet_code: string | null
          sheet_id: string
          sheet_name: string | null
          unit_price: number | null
        }
        Insert: {
          cleaned_at?: string
          group_name?: string | null
          id?: string
          product_color?: string | null
          product_id: string
          product_name?: string | null
          quantity_per_unit?: number | null
          reason: string
          sheet_code?: string | null
          sheet_id: string
          sheet_name?: string | null
          unit_price?: number | null
        }
        Update: {
          cleaned_at?: string
          group_name?: string | null
          id?: string
          product_color?: string | null
          product_id?: string
          product_name?: string | null
          quantity_per_unit?: number | null
          reason?: string
          sheet_code?: string | null
          sheet_id?: string
          sheet_name?: string | null
          unit_price?: number | null
        }
        Relationships: []
      }
      shipping_manifests: {
        Row: {
          created_at: string
          created_by: string | null
          destinations_count: number
          driver_name: string | null
          driver_phone: string | null
          emission_date: string
          id: string
          manifest_number: string
          notes: string | null
          origin: string | null
          status: string
          total_pairs: number
          total_value: number
          total_volumes: number
          total_weight_kg: number
          transporter_id: string | null
          transporter_name: string | null
          vehicle_plate: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          destinations_count?: number
          driver_name?: string | null
          driver_phone?: string | null
          emission_date?: string
          id?: string
          manifest_number?: string
          notes?: string | null
          origin?: string | null
          status?: string
          total_pairs?: number
          total_value?: number
          total_volumes?: number
          total_weight_kg?: number
          transporter_id?: string | null
          transporter_name?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          destinations_count?: number
          driver_name?: string | null
          driver_phone?: string | null
          emission_date?: string
          id?: string
          manifest_number?: string
          notes?: string | null
          origin?: string | null
          status?: string
          total_pairs?: number
          total_value?: number
          total_volumes?: number
          total_weight_kg?: number
          transporter_id?: string | null
          transporter_name?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_manifests_transporter_id_fkey"
            columns: ["transporter_id"]
            isOneToOne: false
            referencedRelation: "transporters"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_volumes: {
        Row: {
          contents: Json | null
          created_at: string
          depth_cm: number | null
          destination_address: string | null
          destination_city: string | null
          destination_uf: string | null
          ean: string | null
          height_cm: number | null
          id: string
          is_cross_dock: boolean
          manifest_id: string | null
          sale_order_id: string | null
          status: string
          total_pairs: number
          volume_number: number
          volume_type: string
          weight_kg: number
          width_cm: number | null
        }
        Insert: {
          contents?: Json | null
          created_at?: string
          depth_cm?: number | null
          destination_address?: string | null
          destination_city?: string | null
          destination_uf?: string | null
          ean?: string | null
          height_cm?: number | null
          id?: string
          is_cross_dock?: boolean
          manifest_id?: string | null
          sale_order_id?: string | null
          status?: string
          total_pairs?: number
          volume_number: number
          volume_type?: string
          weight_kg?: number
          width_cm?: number | null
        }
        Update: {
          contents?: Json | null
          created_at?: string
          depth_cm?: number | null
          destination_address?: string | null
          destination_city?: string | null
          destination_uf?: string | null
          ean?: string | null
          height_cm?: number | null
          id?: string
          is_cross_dock?: boolean
          manifest_id?: string | null
          sale_order_id?: string | null
          status?: string
          total_pairs?: number
          volume_number?: number
          volume_type?: string
          weight_kg?: number
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_volumes_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "shipping_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_volumes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_order_min_billing"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "shipping_volumes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_volumes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_order_profitability"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "shipping_volumes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "shipping_volumes_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
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
      sole_color_conjugations: {
        Row: {
          active: boolean
          cabedal_color: string
          created_at: string
          id: string
          is_default: boolean
          palmilha_color: string
          sole_group_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cabedal_color: string
          created_at?: string
          id?: string
          is_default?: boolean
          palmilha_color: string
          sole_group_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cabedal_color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          palmilha_color?: string
          sole_group_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sole_color_conjugations_sole_group_id_fkey"
            columns: ["sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      sole_grade_split_log: {
        Row: {
          conj_key: string
          migrated_at: string
          product_id: string
          qty_split: number
          split_into: string[] | null
        }
        Insert: {
          conj_key: string
          migrated_at?: string
          product_id: string
          qty_split: number
          split_into?: string[] | null
        }
        Update: {
          conj_key?: string
          migrated_at?: string
          product_id?: string
          qty_split?: number
          split_into?: string[] | null
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
            foreignKeyName: "sole_silk_registrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
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
            foreignKeyName: "sole_silk_registrations_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_credit"
            referencedColumns: ["economic_group_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_economic_group_id_fkey"
            columns: ["economic_group_id"]
            isOneToOne: false
            referencedRelation: "v_economic_group_kpis"
            referencedColumns: ["economic_group_id"]
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
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sole_silk_registrations_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: true
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
      sole_size_conjugations_removed_log: {
        Row: {
          display_order: number | null
          removed_at: string
          size_key: string | null
          sizes: number[] | null
          sole_group_id: string | null
        }
        Insert: {
          display_order?: number | null
          removed_at?: string
          size_key?: string | null
          sizes?: number[] | null
          sole_group_id?: string | null
        }
        Update: {
          display_order?: number | null
          removed_at?: string
          size_key?: string | null
          sizes?: number[] | null
          sole_group_id?: string | null
        }
        Relationships: []
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
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sole_standard_items_consumption_standard_item_id_fkey"
            columns: ["standard_item_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      sole_standard_materials: {
        Row: {
          applies_to: Database["public"]["Enums"]["sole_material_applies_enum"]
          consumption_per_pair: number
          created_at: string
          display_order: number
          id: string
          material_product_id: string
          notes: string | null
          sole_group_id: string
          unit_override: string | null
          updated_at: string
        }
        Insert: {
          applies_to?: Database["public"]["Enums"]["sole_material_applies_enum"]
          consumption_per_pair: number
          created_at?: string
          display_order?: number
          id?: string
          material_product_id: string
          notes?: string | null
          sole_group_id: string
          unit_override?: string | null
          updated_at?: string
        }
        Update: {
          applies_to?: Database["public"]["Enums"]["sole_material_applies_enum"]
          consumption_per_pair?: number
          created_at?: string
          display_order?: number
          id?: string
          material_product_id?: string
          notes?: string | null
          sole_group_id?: string
          unit_override?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sole_standard_materials_material_product_id_fkey"
            columns: ["material_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_standard_materials_sole_group_id_fkey"
            columns: ["sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
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
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sole_structures_default_material_id_fkey"
            columns: ["default_material_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sole_structures_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
          insole_lining_consumption_dm2: number | null
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
          insole_lining_consumption_dm2?: number | null
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
          insole_lining_consumption_dm2?: number | null
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
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_reference_sole_id_fkey"
            columns: ["reference_sole_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "sole_technical_specs_sole_id_fkey"
            columns: ["sole_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      sped_exports: {
        Row: {
          file_content: string | null
          filename: string
          generated_at: string
          generated_by: string | null
          id: string
          notes: string | null
          period_end: string
          period_start: string
          sped_type: string
          status: string
          total_records: number
          transmission_protocol: string | null
          validation_log: string | null
        }
        Insert: {
          file_content?: string | null
          filename: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          sped_type: string
          status?: string
          total_records?: number
          transmission_protocol?: string | null
          validation_log?: string | null
        }
        Update: {
          file_content?: string | null
          filename?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          sped_type?: string
          status?: string
          total_records?: number
          transmission_protocol?: string | null
          validation_log?: string | null
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          description: string | null
          id: string
          lot_id: string | null
          movement_type: string
          new_stock: number
          order_id: string | null
          previous_stock: number
          product_id: string
          quantity: number
          unit_price_at_movement: number | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          lot_id?: string | null
          movement_type?: string
          new_stock?: number
          order_id?: string | null
          previous_stock?: number
          product_id: string
          quantity?: number
          unit_price_at_movement?: number | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          lot_id?: string | null
          movement_type?: string
          new_stock?: number
          order_id?: string | null
          previous_stock?: number
          product_id?: string
          quantity?: number
          unit_price_at_movement?: number | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lot_tracking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_lots_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_order_lot_traceability"
            referencedColumns: ["lot_id"]
          },
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
        ]
      }
      stock_quarantines: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          reason: string
          reason_category: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          reason: string
          reason_category?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          reason?: string
          reason_category?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_with_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "purchase_projection_timeline"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "stock_quarantines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_non_conformities: {
        Row: {
          cost_impact: number | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          nc_type: string
          purchase_order_id: string | null
          resolution: string | null
          resolved_at: string | null
          severity: string
          status: string
          supplier_id: string
        }
        Insert: {
          cost_impact?: number | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          nc_type?: string
          purchase_order_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          supplier_id: string
        }
        Update: {
          cost_impact?: number | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          nc_type?: string
          purchase_order_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_non_conformities_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_non_conformities_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_open_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_non_conformities_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_overdue_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_non_conformities_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_non_conformities_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          avg_lead_time_days: number | null
          certifications: string | null
          city: string | null
          cnpj: string | null
          contact_name: string | null
          created_at: string
          delivery_rating: number | null
          email: string | null
          homologation_status: string | null
          id: string
          ie: string | null
          is_own_manufacturing: boolean | null
          last_purchase_date: string | null
          lead_time_days: number | null
          min_order_quantity: number
          name: string
          notes: string | null
          on_time_rate: number | null
          payment_terms: string | null
          phone: string | null
          price_rating: number | null
          quality_rating: number | null
          service_rating: number | null
          state: string | null
          supplier_category: string | null
          trade_name: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          avg_lead_time_days?: number | null
          certifications?: string | null
          city?: string | null
          cnpj?: string | null
          contact_name?: string | null
          created_at?: string
          delivery_rating?: number | null
          email?: string | null
          homologation_status?: string | null
          id?: string
          ie?: string | null
          is_own_manufacturing?: boolean | null
          last_purchase_date?: string | null
          lead_time_days?: number | null
          min_order_quantity?: number
          name: string
          notes?: string | null
          on_time_rate?: number | null
          payment_terms?: string | null
          phone?: string | null
          price_rating?: number | null
          quality_rating?: number | null
          service_rating?: number | null
          state?: string | null
          supplier_category?: string | null
          trade_name?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          avg_lead_time_days?: number | null
          certifications?: string | null
          city?: string | null
          cnpj?: string | null
          contact_name?: string | null
          created_at?: string
          delivery_rating?: number | null
          email?: string | null
          homologation_status?: string | null
          id?: string
          ie?: string | null
          is_own_manufacturing?: boolean | null
          last_purchase_date?: string | null
          lead_time_days?: number | null
          min_order_quantity?: number
          name?: string
          notes?: string | null
          on_time_rate?: number | null
          payment_terms?: string | null
          phone?: string | null
          price_rating?: number | null
          quality_rating?: number | null
          service_rating?: number | null
          state?: string | null
          supplier_category?: string | null
          trade_name?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
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
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "technical_reference_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_references_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_references_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_references_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_references_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_references_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      technical_sheet_box_types: {
        Row: {
          box_type_id: string
          created_at: string
          sheet_id: string
        }
        Insert: {
          box_type_id: string
          created_at?: string
          sheet_id: string
        }
        Update: {
          box_type_id?: string
          created_at?: string
          sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_box_types_box_type_id_fkey"
            columns: ["box_type_id"]
            isOneToOne: false
            referencedRelation: "box_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_box_types_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_box_types_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_box_types_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_box_types_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_box_types_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_box_types_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_box_types_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_insole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_insole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_insole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_insole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_insole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
        Relationships: []
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_operations_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_overhead_history_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_overhead_history_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_overhead_history_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_overhead_history_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_overhead_history_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      technical_sheet_palmilha_colors: {
        Row: {
          cabedal_color: string
          created_at: string
          id: string
          palmilha_color: string
          sheet_id: string
        }
        Insert: {
          cabedal_color: string
          created_at?: string
          id?: string
          palmilha_color: string
          sheet_id: string
        }
        Update: {
          cabedal_color?: string
          created_at?: string
          id?: string
          palmilha_color?: string
          sheet_id?: string
        }
        Relationships: [
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_palmilha_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          outdated_at: string | null
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
          outdated_at?: string | null
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
          outdated_at?: string | null
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
            foreignKeyName: "technical_sheet_snapshots_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_snapshots_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "technical_sheet_sole_colors_sole_product_id_fkey"
            columns: ["sole_product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      technical_sheet_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          change_summary: string | null
          created_at: string
          id: string
          snapshot: Json
          status: string
          technical_sheet_id: string
          valid_from: string
          valid_to: string | null
          version_number: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          change_summary?: string | null
          created_at?: string
          id?: string
          snapshot?: Json
          status?: string
          technical_sheet_id: string
          valid_from?: string
          valid_to?: string | null
          version_number: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          change_summary?: string | null
          created_at?: string
          id?: string
          snapshot?: Json
          status?: string
          technical_sheet_id?: string
          valid_from?: string
          valid_to?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheet_versions_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_versions_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_versions_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "technical_sheet_versions_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheet_versions_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_versions_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "technical_sheet_versions_technical_sheet_id_fkey"
            columns: ["technical_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      technical_sheets: {
        Row: {
          assembly_capacity_per_day: number | null
          assembly_time_minutes: number | null
          aviamento_steps: Json
          box_type_id: string | null
          box_weight_kg: number | null
          brand: string | null
          closure_type: string | null
          code: string | null
          collection: string | null
          color_images: Json | null
          colored_lining_mode: string
          colors: string | null
          components_accessories: Json | null
          construction_type: string
          consumption_loss_pct: number | null
          cor_predominante_id: string | null
          cor_solado_id: string | null
          cost_price: number | null
          costura_capacity_per_day: number
          created_at: string
          custom_overhead: number | null
          cutting_capacity_per_day: number | null
          cutting_plan_calibration_factor: number | null
          cutting_plan_image_url: string | null
          cutting_plan_loss_pct_real: number | null
          cutting_plan_loss_pct_theoretical: number | null
          cutting_plan_notes: string | null
          cutting_plan_pairs_per_chapa: number | null
          default_silk_url: string | null
          description: string | null
          direct_components: Json | null
          ean_by_size: Json | null
          ean_root: string | null
          expedition_capacity_per_day: number | null
          fachete_consumption: number | null
          fachete_consumption_per_size: Json | null
          fachete_material: string | null
          family: string | null
          finishing_capacity_per_day: number | null
          fit_type: string | null
          fit_type_detail: string | null
          gestaoclick_id: string | null
          gluing_capacity_per_day: number | null
          has_colored_lining: boolean
          has_straps: boolean | null
          heel_height: string | null
          id: string
          image_url: string | null
          images: Json | null
          insole_color: string | null
          insole_color_mode: string
          insole_consumption: number | null
          insole_consumption_per_size: Json | null
          insole_consumption_unit: string
          insole_has_lining: boolean | null
          insole_lining_consumption: number | null
          insole_lining_consumption_per_size: Json
          insole_material: string | null
          insole_plate_product: string | null
          insole_ready_made: boolean
          knife_size_ranges: Json | null
          last_id: string | null
          lead_time_acabamento_dias: number
          lead_time_buffer_material_dias: number
          lead_time_colagem_dias: number | null
          lead_time_corte_dias: number
          lead_time_costura_dias: number
          lead_time_expedicao_dias: number | null
          lead_time_montagem_dias: number
          lead_time_silk_dias: number | null
          lining_accessories: Json | null
          lining_consumption: number | null
          lining_consumption_per_size: Json | null
          lining_material: string | null
          max_insole_colors: number
          mesa_daily_capacity: number
          model: string | null
          name: string
          ncm: string | null
          origem_mercadoria: number
          primary_sole_id: string | null
          process_difficulty: string | null
          production_sectors: Json
          reference_size: number | null
          requires_cutting: boolean
          requires_cutting_cabedal: boolean
          requires_sewing: boolean
          safety_margin_pct: number | null
          sale_price: number | null
          sector_notes: Json
          sewing_capacity_per_day: number | null
          shoe_category: string | null
          shoe_category_id: string | null
          silk_capacity_per_day: number | null
          size_multipliers: Json | null
          sizes: string | null
          sole_color: string | null
          sole_consumption: number | null
          sole_drives_consumption: boolean | null
          sole_group_id: string | null
          sole_material: string | null
          sole_process: string | null
          sole_type: string | null
          soling_capacity_per_day: number | null
          status: string
          status_ficha: string
          strap_colors: Json | null
          tags: string[] | null
          theme_story: string | null
          updated_at: string
          upper_consumption: number | null
          upper_consumption_per_size: Json | null
          upper_corte_a_fio: boolean
          upper_material: string | null
          upper_thickness: string | null
          version: number
          version_number: string | null
          weight_per_pair_kg: number | null
        }
        Insert: {
          assembly_capacity_per_day?: number | null
          assembly_time_minutes?: number | null
          aviamento_steps?: Json
          box_type_id?: string | null
          box_weight_kg?: number | null
          brand?: string | null
          closure_type?: string | null
          code?: string | null
          collection?: string | null
          color_images?: Json | null
          colored_lining_mode?: string
          colors?: string | null
          components_accessories?: Json | null
          construction_type?: string
          consumption_loss_pct?: number | null
          cor_predominante_id?: string | null
          cor_solado_id?: string | null
          cost_price?: number | null
          costura_capacity_per_day?: number
          created_at?: string
          custom_overhead?: number | null
          cutting_capacity_per_day?: number | null
          cutting_plan_calibration_factor?: number | null
          cutting_plan_image_url?: string | null
          cutting_plan_loss_pct_real?: number | null
          cutting_plan_loss_pct_theoretical?: number | null
          cutting_plan_notes?: string | null
          cutting_plan_pairs_per_chapa?: number | null
          default_silk_url?: string | null
          description?: string | null
          direct_components?: Json | null
          ean_by_size?: Json | null
          ean_root?: string | null
          expedition_capacity_per_day?: number | null
          fachete_consumption?: number | null
          fachete_consumption_per_size?: Json | null
          fachete_material?: string | null
          family?: string | null
          finishing_capacity_per_day?: number | null
          fit_type?: string | null
          fit_type_detail?: string | null
          gestaoclick_id?: string | null
          gluing_capacity_per_day?: number | null
          has_colored_lining?: boolean
          has_straps?: boolean | null
          heel_height?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          insole_color?: string | null
          insole_color_mode?: string
          insole_consumption?: number | null
          insole_consumption_per_size?: Json | null
          insole_consumption_unit?: string
          insole_has_lining?: boolean | null
          insole_lining_consumption?: number | null
          insole_lining_consumption_per_size?: Json
          insole_material?: string | null
          insole_plate_product?: string | null
          insole_ready_made?: boolean
          knife_size_ranges?: Json | null
          last_id?: string | null
          lead_time_acabamento_dias?: number
          lead_time_buffer_material_dias?: number
          lead_time_colagem_dias?: number | null
          lead_time_corte_dias?: number
          lead_time_costura_dias?: number
          lead_time_expedicao_dias?: number | null
          lead_time_montagem_dias?: number
          lead_time_silk_dias?: number | null
          lining_accessories?: Json | null
          lining_consumption?: number | null
          lining_consumption_per_size?: Json | null
          lining_material?: string | null
          max_insole_colors?: number
          mesa_daily_capacity?: number
          model?: string | null
          name: string
          ncm?: string | null
          origem_mercadoria?: number
          primary_sole_id?: string | null
          process_difficulty?: string | null
          production_sectors?: Json
          reference_size?: number | null
          requires_cutting?: boolean
          requires_cutting_cabedal?: boolean
          requires_sewing?: boolean
          safety_margin_pct?: number | null
          sale_price?: number | null
          sector_notes?: Json
          sewing_capacity_per_day?: number | null
          shoe_category?: string | null
          shoe_category_id?: string | null
          silk_capacity_per_day?: number | null
          size_multipliers?: Json | null
          sizes?: string | null
          sole_color?: string | null
          sole_consumption?: number | null
          sole_drives_consumption?: boolean | null
          sole_group_id?: string | null
          sole_material?: string | null
          sole_process?: string | null
          sole_type?: string | null
          soling_capacity_per_day?: number | null
          status?: string
          status_ficha?: string
          strap_colors?: Json | null
          tags?: string[] | null
          theme_story?: string | null
          updated_at?: string
          upper_consumption?: number | null
          upper_consumption_per_size?: Json | null
          upper_corte_a_fio?: boolean
          upper_material?: string | null
          upper_thickness?: string | null
          version?: number
          version_number?: string | null
          weight_per_pair_kg?: number | null
        }
        Update: {
          assembly_capacity_per_day?: number | null
          assembly_time_minutes?: number | null
          aviamento_steps?: Json
          box_type_id?: string | null
          box_weight_kg?: number | null
          brand?: string | null
          closure_type?: string | null
          code?: string | null
          collection?: string | null
          color_images?: Json | null
          colored_lining_mode?: string
          colors?: string | null
          components_accessories?: Json | null
          construction_type?: string
          consumption_loss_pct?: number | null
          cor_predominante_id?: string | null
          cor_solado_id?: string | null
          cost_price?: number | null
          costura_capacity_per_day?: number
          created_at?: string
          custom_overhead?: number | null
          cutting_capacity_per_day?: number | null
          cutting_plan_calibration_factor?: number | null
          cutting_plan_image_url?: string | null
          cutting_plan_loss_pct_real?: number | null
          cutting_plan_loss_pct_theoretical?: number | null
          cutting_plan_notes?: string | null
          cutting_plan_pairs_per_chapa?: number | null
          default_silk_url?: string | null
          description?: string | null
          direct_components?: Json | null
          ean_by_size?: Json | null
          ean_root?: string | null
          expedition_capacity_per_day?: number | null
          fachete_consumption?: number | null
          fachete_consumption_per_size?: Json | null
          fachete_material?: string | null
          family?: string | null
          finishing_capacity_per_day?: number | null
          fit_type?: string | null
          fit_type_detail?: string | null
          gestaoclick_id?: string | null
          gluing_capacity_per_day?: number | null
          has_colored_lining?: boolean
          has_straps?: boolean | null
          heel_height?: string | null
          id?: string
          image_url?: string | null
          images?: Json | null
          insole_color?: string | null
          insole_color_mode?: string
          insole_consumption?: number | null
          insole_consumption_per_size?: Json | null
          insole_consumption_unit?: string
          insole_has_lining?: boolean | null
          insole_lining_consumption?: number | null
          insole_lining_consumption_per_size?: Json
          insole_material?: string | null
          insole_plate_product?: string | null
          insole_ready_made?: boolean
          knife_size_ranges?: Json | null
          last_id?: string | null
          lead_time_acabamento_dias?: number
          lead_time_buffer_material_dias?: number
          lead_time_colagem_dias?: number | null
          lead_time_corte_dias?: number
          lead_time_costura_dias?: number
          lead_time_expedicao_dias?: number | null
          lead_time_montagem_dias?: number
          lead_time_silk_dias?: number | null
          lining_accessories?: Json | null
          lining_consumption?: number | null
          lining_consumption_per_size?: Json | null
          lining_material?: string | null
          max_insole_colors?: number
          mesa_daily_capacity?: number
          model?: string | null
          name?: string
          ncm?: string | null
          origem_mercadoria?: number
          primary_sole_id?: string | null
          process_difficulty?: string | null
          production_sectors?: Json
          reference_size?: number | null
          requires_cutting?: boolean
          requires_cutting_cabedal?: boolean
          requires_sewing?: boolean
          safety_margin_pct?: number | null
          sale_price?: number | null
          sector_notes?: Json
          sewing_capacity_per_day?: number | null
          shoe_category?: string | null
          shoe_category_id?: string | null
          silk_capacity_per_day?: number | null
          size_multipliers?: Json | null
          sizes?: string | null
          sole_color?: string | null
          sole_consumption?: number | null
          sole_drives_consumption?: boolean | null
          sole_group_id?: string | null
          sole_material?: string | null
          sole_process?: string | null
          sole_type?: string | null
          soling_capacity_per_day?: number | null
          status?: string
          status_ficha?: string
          strap_colors?: Json | null
          tags?: string[] | null
          theme_story?: string | null
          updated_at?: string
          upper_consumption?: number | null
          upper_consumption_per_size?: Json | null
          upper_corte_a_fio?: boolean
          upper_material?: string | null
          upper_thickness?: string | null
          version?: number
          version_number?: string | null
          weight_per_pair_kg?: number | null
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
            foreignKeyName: "technical_sheets_last_id_fkey"
            columns: ["last_id"]
            isOneToOne: false
            referencedRelation: "lasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_sheets_last_id_fkey"
            columns: ["last_id"]
            isOneToOne: false
            referencedRelation: "v_lasts_with_usage"
            referencedColumns: ["id"]
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
          file_path: string | null
          file_size_bytes: number | null
          id: string
          imported_by: string | null
          inserted_count: number
          mime_type: string | null
          notes: string | null
          period_id: string | null
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
          error_count: number
          error_messages?: Json | null
          file_name: string
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          imported_by?: string | null
          inserted_count: number
          mime_type?: string | null
          notes?: string | null
          period_id?: string | null
          skipped_count: number
          start_date?: string | null
          status: string
          total_rows: number
          updated_count: number
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          end_date?: string | null
          error_count?: number
          error_messages?: Json | null
          file_name?: string
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          imported_by?: string | null
          inserted_count?: number
          mime_type?: string | null
          notes?: string | null
          period_id?: string | null
          skipped_count?: number
          start_date?: string | null
          status?: string
          total_rows?: number
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "time_import_logs_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "timesheet_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      time_record_manual_overrides: {
        Row: {
          added_punch: string
          created_at: string
          created_by: string | null
          id: string
          position: number
          punches_after: Json
          punches_before: Json
          reason: string
          time_record_id: string
        }
        Insert: {
          added_punch: string
          created_at?: string
          created_by?: string | null
          id?: string
          position: number
          punches_after: Json
          punches_before: Json
          reason?: string
          time_record_id: string
        }
        Update: {
          added_punch?: string
          created_at?: string
          created_by?: string | null
          id?: string
          position?: number
          punches_after?: Json
          punches_before?: Json
          reason?: string
          time_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_record_manual_overrides_time_record_id_fkey"
            columns: ["time_record_id"]
            isOneToOne: false
            referencedRelation: "time_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_record_manual_overrides_time_record_id_fkey"
            columns: ["time_record_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["time_record_id"]
          },
          {
            foreignKeyName: "time_record_manual_overrides_time_record_id_fkey"
            columns: ["time_record_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["id"]
          },
        ]
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
      time_studies: {
        Row: {
          active: boolean
          allowance_pct: number
          bom_operation_id: string | null
          cost_per_hour: number
          cost_per_minute: number | null
          cost_per_pair: number | null
          created_at: string
          cycles_seconds: number[]
          id: string
          normal_time_minutes: number | null
          notes: string | null
          observed_at: string
          observed_avg_seconds: number
          observed_by: string | null
          operation_name: string
          rating_pct: number
          sample_size: number | null
          sheet_id: string
          stage: string
          standard_time_minutes: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowance_pct?: number
          bom_operation_id?: string | null
          cost_per_hour?: number
          cost_per_minute?: number | null
          cost_per_pair?: number | null
          created_at?: string
          cycles_seconds?: number[]
          id?: string
          normal_time_minutes?: number | null
          notes?: string | null
          observed_at?: string
          observed_avg_seconds?: number
          observed_by?: string | null
          operation_name?: string
          rating_pct?: number
          sample_size?: number | null
          sheet_id: string
          stage?: string
          standard_time_minutes?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowance_pct?: number
          bom_operation_id?: string | null
          cost_per_hour?: number
          cost_per_minute?: number | null
          cost_per_pair?: number | null
          created_at?: string
          cycles_seconds?: number[]
          id?: string
          normal_time_minutes?: number | null
          notes?: string | null
          observed_at?: string
          observed_avg_seconds?: number
          observed_by?: string | null
          operation_name?: string
          rating_pct?: number
          sample_size?: number | null
          sheet_id?: string
          stage?: string
          standard_time_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_studies_bom_operation_id_fkey"
            columns: ["bom_operation_id"]
            isOneToOne: false
            referencedRelation: "bom_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_studies_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_studies_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "time_studies_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "time_studies_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_studies_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "time_studies_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "time_studies_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_periods: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          label: string
          notes: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          label: string
          notes?: string | null
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          label?: string
          notes?: string | null
          start_date?: string
          status?: string
          updated_at?: string
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
        Relationships: []
      }
      transporters: {
        Row: {
          active: boolean
          address_city: string | null
          address_state: string | null
          api_config: Json | null
          bairro: string | null
          cep: string | null
          cnpj: string | null
          codigo_municipio: string | null
          complemento: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          delivery_areas: string[] | null
          endereco: string | null
          gestaoclick_id: string | null
          has_api_integration: boolean
          id: string
          ie: string | null
          ie_isento: boolean
          name: string
          nome_fantasia: string | null
          notes: string | null
          numero: string | null
          rntrc: string | null
          service_modes: string[] | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address_city?: string | null
          address_state?: string | null
          api_config?: Json | null
          bairro?: string | null
          cep?: string | null
          cnpj?: string | null
          codigo_municipio?: string | null
          complemento?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          delivery_areas?: string[] | null
          endereco?: string | null
          gestaoclick_id?: string | null
          has_api_integration?: boolean
          id?: string
          ie?: string | null
          ie_isento?: boolean
          name: string
          nome_fantasia?: string | null
          notes?: string | null
          numero?: string | null
          rntrc?: string | null
          service_modes?: string[] | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address_city?: string | null
          address_state?: string | null
          api_config?: Json | null
          bairro?: string | null
          cep?: string | null
          cnpj?: string | null
          codigo_municipio?: string | null
          complemento?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          delivery_areas?: string[] | null
          endereco?: string | null
          gestaoclick_id?: string | null
          has_api_integration?: boolean
          id?: string
          ie?: string | null
          ie_isento?: boolean
          name?: string
          nome_fantasia?: string | null
          notes?: string | null
          numero?: string | null
          rntrc?: string | null
          service_modes?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      user_mfa_settings: {
        Row: {
          backup_codes: string[] | null
          enrolled_at: string | null
          last_used_at: string | null
          mfa_enabled: boolean
          mfa_method: string | null
          recovery_email: string | null
          recovery_phone: string | null
          totp_secret: string | null
          user_id: string
        }
        Insert: {
          backup_codes?: string[] | null
          enrolled_at?: string | null
          last_used_at?: string | null
          mfa_enabled?: boolean
          mfa_method?: string | null
          recovery_email?: string | null
          recovery_phone?: string | null
          totp_secret?: string | null
          user_id: string
        }
        Update: {
          backup_codes?: string[] | null
          enrolled_at?: string | null
          last_used_at?: string | null
          mfa_enabled?: boolean
          mfa_method?: string | null
          recovery_email?: string | null
          recovery_phone?: string | null
          totp_secret?: string | null
          user_id?: string
        }
        Relationships: []
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
      vehicles: {
        Row: {
          active: boolean
          capacity_kg: number | null
          capacity_m3: number | null
          created_at: string
          default_driver_id: string | null
          fuel_consumption_km_l: number
          fuel_type: string
          id: string
          model: string | null
          plate: string
          type: string | null
          updated_at: string
          wear_cost_per_km: number
        }
        Insert: {
          active?: boolean
          capacity_kg?: number | null
          capacity_m3?: number | null
          created_at?: string
          default_driver_id?: string | null
          fuel_consumption_km_l: number
          fuel_type?: string
          id?: string
          model?: string | null
          plate: string
          type?: string | null
          updated_at?: string
          wear_cost_per_km?: number
        }
        Update: {
          active?: boolean
          capacity_kg?: number | null
          capacity_m3?: number | null
          created_at?: string
          default_driver_id?: string | null
          fuel_consumption_km_l?: number
          fuel_type?: string
          id?: string
          model?: string | null
          plate?: string
          type?: string | null
          updated_at?: string
          wear_cost_per_km?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_default_driver_id_fkey"
            columns: ["default_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_balance_audit_log: {
        Row: {
          action: string
          after_diff_min: number | null
          before_diff_min: number | null
          changed_at: string
          changed_by: string | null
          employee_id: string | null
          id: string
          metadata: Json | null
          reason: string | null
          snapshot_id: string | null
          week_start: string
        }
        Insert: {
          action: string
          after_diff_min?: number | null
          before_diff_min?: number | null
          changed_at?: string
          changed_by?: string | null
          employee_id?: string | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          snapshot_id?: string | null
          week_start: string
        }
        Update: {
          action?: string
          after_diff_min?: number | null
          before_diff_min?: number | null
          changed_at?: string
          changed_by?: string | null
          employee_id?: string | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          snapshot_id?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_balance_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_balance_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_audit_log_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "weekly_balance_snapshot"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_balance_snapshot: {
        Row: {
          apuracao_label: string | null
          computed_at: string
          days_absent: number
          days_partial: number
          days_worked: number
          diff_min: number
          employee_id: string
          expected_min: number
          he_100_min: number
          he_50_min: number
          id: string
          locked_at: string | null
          locked_by: string | null
          locked_reason: string | null
          week_end: string
          week_start: string
          worked_min: number
        }
        Insert: {
          apuracao_label?: string | null
          computed_at?: string
          days_absent?: number
          days_partial?: number
          days_worked?: number
          diff_min?: number
          employee_id: string
          expected_min?: number
          he_100_min?: number
          he_50_min?: number
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          locked_reason?: string | null
          week_end: string
          week_start: string
          worked_min?: number
        }
        Update: {
          apuracao_label?: string | null
          computed_at?: string
          days_absent?: number
          days_partial?: number
          days_worked?: number
          diff_min?: number
          employee_id?: string
          expected_min?: number
          he_100_min?: number
          he_50_min?: number
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          locked_reason?: string | null
          week_end?: string
          week_start?: string
          worked_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_balance_snapshot_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_snapshot_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_balance_snapshot_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_snapshot_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_snapshot_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "weekly_balance_snapshot_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "wip_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
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
            foreignKeyName: "wip_ledger_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "wip_ledger_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
          works_friday: boolean
          works_monday: boolean
          works_saturday: boolean
          works_sunday: boolean
          works_thursday: boolean
          works_tuesday: boolean
          works_wednesday: boolean
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
          works_friday?: boolean
          works_monday?: boolean
          works_saturday?: boolean
          works_sunday?: boolean
          works_thursday?: boolean
          works_tuesday?: boolean
          works_wednesday?: boolean
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
          works_friday?: boolean
          works_monday?: boolean
          works_saturday?: boolean
          works_sunday?: boolean
          works_thursday?: boolean
          works_tuesday?: boolean
          works_wednesday?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      bank_hours_balance: {
        Row: {
          balance_100_min: number | null
          balance_50_min: number | null
          balance_min: number | null
          department: string | null
          employee_id: string | null
          employee_name: string | null
          initial_min: number | null
          last_movement_date: string | null
          movement_count: number | null
          movements_min: number | null
          role: string | null
          timesheet_min: number | null
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
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "products_linked_last_id_fkey"
            columns: ["linked_last_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
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
      purchase_projection_timeline: {
        Row: {
          conversao_dm2: string | null
          data_chegada_material: string | null
          data_entrega_cliente: string | null
          data_inicio_acabamento: string | null
          data_inicio_colagem: string | null
          data_inicio_corte: string | null
          data_inicio_costura: string | null
          data_inicio_mesa: string | null
          data_inicio_montagem: string | null
          data_inicio_palmilha: string | null
          data_inicio_silk: string | null
          data_inicio_solagem: string | null
          data_limite_compra: string | null
          estoque_atual: number | null
          estoque_bruto: number | null
          estoque_reservado: number | null
          grupo_material: string | null
          lead_time_acabamento_dias: number | null
          lead_time_buffer_material_dias: number | null
          lead_time_colagem_dias: number | null
          lead_time_corte_dias: number | null
          lead_time_costura_dias: number | null
          lead_time_forracao_dias: number | null
          lead_time_mesa_dias: number | null
          lead_time_montagem_dias: number | null
          lead_time_palmilha_dias: number | null
          lead_time_silk_dias: number | null
          lead_time_solagem_dias: number | null
          material: string | null
          material_group_id: string | null
          material_id: string | null
          material_lead_time_raw: number | null
          min_stock: number | null
          op_quantity: number | null
          order_id: string | null
          order_status: string | null
          pedido_ref: string | null
          quantidade_necessaria: number | null
          quantidade_necessaria_bruta: number | null
          reference_id: string | null
          referencia_nome: string | null
          sale_order_id: string | null
          supplier_id: string | null
          supplier_lead_time_days: number | null
          supplier_lead_time_raw: number | null
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
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
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
          min_billing_date: string | null
          sale_order_id: string | null
        }
        Insert: {
          min_billing_date?: never
          sale_order_id?: string | null
        }
        Update: {
          min_billing_date?: never
          sale_order_id?: string | null
        }
        Relationships: []
      }
      v_bank_hours_per_sector: {
        Row: {
          department: string | null
          employee_count: number | null
          employees_in_credit: number | null
          employees_in_debit: number | null
          total_balance_min: number | null
          total_credit_min: number | null
          total_debit_min: number | null
        }
        Relationships: []
      }
      v_bank_hours_summary: {
        Row: {
          employee_count: number | null
          employees_in_credit: number | null
          employees_in_debit: number | null
          total_balance_min: number | null
          total_credit_min: number | null
          total_debit_min: number | null
        }
        Relationships: []
      }
      v_bom_audit_issues: {
        Row: {
          colors_in_bom: string | null
          group_id: string | null
          group_name: string | null
          issue_type: string | null
          severity: string | null
          sheet_id: string | null
          variants_count: number | null
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
      v_contractor_history_orders: {
        Row: {
          contractor_id: string | null
          contractor_name: string | null
          created_at: string | null
          days_late: number | null
          description: string | null
          finished_at: string | null
          id: string | null
          is_artisanal: boolean | null
          materials_sent: Json | null
          order_number: string | null
          punctuality: string | null
          quantity: number | null
          quoted_deadline: string | null
          receipt_number: string | null
          sector: string | null
          service_date: string | null
          signed_photo_url: string | null
          status: string | null
          total_value: number | null
          unit_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "service_orders_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_metrics"
            referencedColumns: ["contractor_id"]
          },
        ]
      }
      v_contractor_metrics: {
        Row: {
          active: boolean | null
          avg_late_days: number | null
          cancelled_orders: number | null
          completed_orders: number | null
          contractor_id: string | null
          contractor_name: string | null
          defect_pct: number | null
          last_order_at: string | null
          late_count: number | null
          on_time_count: number | null
          open_orders: number | null
          open_overdue_count: number | null
          service_type: string | null
          total_orders: number | null
          total_quantity: number | null
          total_returned_defect: number | null
          total_returned_good: number | null
          total_returned_loss: number | null
          total_value_all: number | null
          total_value_open: number | null
          total_value_paid: number | null
        }
        Relationships: []
      }
      v_costura_backlog_30d: {
        Row: {
          color: string | null
          in_service_order: boolean | null
          material_ready: boolean | null
          needed_date: string | null
          order_id: string | null
          quantity: number | null
          reference_id: string | null
          sale_order_deadline: string | null
          sale_order_id: string | null
          sale_order_number: string | null
          wave_id: string | null
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_stages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
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
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      v_costura_capacity_plan: {
        Row: {
          capacity_total: number | null
          day: string | null
          dow: number | null
          is_weekend: boolean | null
          occupation_pct: number | null
          overflow_pairs: number | null
          status: string | null
          sum_pairs_internal: number | null
          sum_pairs_outsourced: number | null
        }
        Relationships: []
      }
      v_crm_birthdays_month: {
        Row: {
          birthday: string | null
          client_id: string | null
          day_of_month: number | null
          nome_fantasia: string | null
          razao_social: string | null
        }
        Insert: {
          birthday?: string | null
          client_id?: string | null
          day_of_month?: never
          nome_fantasia?: string | null
          razao_social?: string | null
        }
        Update: {
          birthday?: string | null
          client_id?: string | null
          day_of_month?: never
          nome_fantasia?: string | null
          razao_social?: string | null
        }
        Relationships: []
      }
      v_crm_expected_repurchase: {
        Row: {
          avg_cycle_days: number | null
          client_id: string | null
          days_until_expected: number | null
          expected_repurchase_date: string | null
          last_order_date: string | null
          razao_social: string | null
        }
        Relationships: []
      }
      v_crm_inactive_clients: {
        Row: {
          client_id: string | null
          client_type: string | null
          days_inactive: number | null
          last_order_date: string | null
          nome_fantasia: string | null
          razao_social: string | null
          total_orders: number | null
        }
        Relationships: []
      }
      v_cycle_counts_summary: {
        Row: {
          accuracy_pct: number | null
          accurate_items: number | null
          approved_by: string | null
          count_date: string | null
          count_number: string | null
          counted_by: string | null
          created_at: string | null
          id: string | null
          items_adjusted: number | null
          items_over: number | null
          items_under: number | null
          notes: string | null
          status: string | null
          total_items: number | null
          updated_at: string | null
        }
        Insert: {
          accuracy_pct?: number | null
          accurate_items?: number | null
          approved_by?: string | null
          count_date?: string | null
          count_number?: string | null
          counted_by?: string | null
          created_at?: string | null
          id?: string | null
          items_adjusted?: never
          items_over?: never
          items_under?: never
          notes?: string | null
          status?: string | null
          total_items?: number | null
          updated_at?: string | null
        }
        Update: {
          accuracy_pct?: number | null
          accurate_items?: number | null
          approved_by?: string | null
          count_date?: string | null
          count_number?: string | null
          counted_by?: string | null
          created_at?: string | null
          id?: string | null
          items_adjusted?: never
          items_over?: never
          items_under?: never
          notes?: string | null
          status?: string | null
          total_items?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v_delivery_routes_summary: {
        Row: {
          cost_per_pair: number | null
          created_at: string | null
          delivered_stops: number | null
          driver_id: string | null
          driver_name: string | null
          estimated_duration_min: number | null
          fuel_cost_brl: number | null
          id: string | null
          name: string | null
          notes: string | null
          pending_stops: number | null
          scheduled_date: string | null
          status: string | null
          total_cost_brl: number | null
          total_distance_km: number | null
          total_stops: number | null
          updated_at: string | null
          vehicle_id: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          wear_cost_brl: number | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_routes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_routes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_demand_forecast: {
        Row: {
          avg_last_3_months: number | null
          color: string | null
          confidence: string | null
          last_month_sales: number | null
          momentum_factor: number | null
          months_with_sales: number | null
          prev_month_sales: number | null
          projected_next_month: number | null
          reference_id: string | null
          reference_name: string | null
          sum_last_3_months: number | null
        }
        Relationships: [
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      v_demand_history_monthly: {
        Row: {
          color: string | null
          month: string | null
          orders_count: number | null
          pairs_sold: number | null
          reference_id: string | null
          reference_name: string | null
        }
        Relationships: [
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "sale_order_items_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      v_economic_group_credit: {
        Row: {
          ar_a_vencer: number | null
          ar_atraso_0_30: number | null
          ar_atraso_30_60: number | null
          ar_atraso_60_90: number | null
          ar_atraso_90_mais: number | null
          ar_open_total: number | null
          credit_available: number | null
          credit_limit: number | null
          economic_group_id: string | null
          group_name: string | null
          total_clients: number | null
          total_matriz: number | null
        }
        Relationships: []
      }
      v_economic_group_kpis: {
        Row: {
          avg_days_to_pay: number | null
          avg_ticket: number | null
          economic_group_id: string | null
          group_name: string | null
          last_order_at: string | null
          orders_12m: number | null
          revenue_12m: number | null
          share_of_wallet_pct: number | null
        }
        Relationships: []
      }
      v_employee_pending_summary: {
        Row: {
          department: string | null
          employee_id: string | null
          extra_punch: number | null
          missing_exit: number | null
          name: string | null
          newest_pending: string | null
          oldest_pending: string | null
          only_one_punch: number | null
          pending_count: number | null
          suspicious_short_day: number | null
        }
        Relationships: []
      }
      v_employee_punch_pattern: {
        Row: {
          department: string | null
          employee_id: string | null
          employee_name: string | null
          entry_observed: string | null
          entry_schedule: string | null
          exit_observed: string | null
          exit_schedule: string | null
          external_id: string | null
          lunch_end_observed: string | null
          lunch_end_schedule: string | null
          lunch_start_observed: string | null
          lunch_start_schedule: string | null
          observed_days: number | null
          tolerance_minutes: number | null
        }
        Relationships: []
      }
      v_ficha_sole_range_mismatch: {
        Row: {
          ficha_sizes: string | null
          sheet_code: string | null
          sheet_id: string | null
          sheet_name: string | null
          sole_from: number | null
          sole_group_id: string | null
          sole_group_name: string | null
          sole_to: number | null
          status: string | null
          variants_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "technical_sheets_sole_group_id_fkey"
            columns: ["sole_group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      v_fixed_assets: {
        Row: {
          accumulated_depreciation: number | null
          acquisition_cost: number | null
          acquisition_date: string | null
          active: boolean | null
          asset_code: string | null
          book_value: number | null
          category: string | null
          cost_center_id: string | null
          cost_center_name: string | null
          created_at: string | null
          depreciable_base: number | null
          disposal_date: string | null
          disposal_gain_loss: number | null
          disposal_reason: string | null
          disposal_value: number | null
          fully_depreciated: boolean | null
          id: string | null
          monthly_depreciation: number | null
          months_elapsed: number | null
          name: string | null
          notes: string | null
          ref_date: string | null
          residual_value: number | null
          status: string | null
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string | null
          useful_life_months: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vw_supplier_quality_rating"
            referencedColumns: ["supplier_id"]
          },
        ]
      }
      v_lasts_with_usage: {
        Row: {
          active: boolean | null
          code: string | null
          created_at: string | null
          description: string | null
          heel_height_mm: number | null
          heel_type: string | null
          id: string | null
          material: string | null
          name: string | null
          notes: string | null
          owner_client_id: string | null
          owner_cnpj: string | null
          owner_name: string | null
          sheets_using: number | null
          size_range_max: number | null
          size_range_min: number | null
          status: string | null
          toe_shape: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "v_client_credit_exposure"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_birthdays_month"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_expected_repurchase"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lasts_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "v_crm_inactive_clients"
            referencedColumns: ["client_id"]
          },
        ]
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
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      v_lots_active: {
        Row: {
          bin_code: string | null
          bin_location_id: string | null
          bin_name: string | null
          expired: boolean | null
          expiring_soon: boolean | null
          expiry_date: string | null
          id: string | null
          lot_number: string | null
          notes: string | null
          product_id: string | null
          product_name: string | null
          quantity_available: number | null
          quantity_consumed: number | null
          quantity_received: number | null
          received_date: string | null
          sku: string | null
          status: string | null
          supplier_id: string | null
          supplier_lot: string | null
          supplier_name: string | null
          unit_cost: number | null
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
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "lot_tracking_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
      v_materials_config_issues: {
        Row: {
          color: string | null
          description: string | null
          group_name: string | null
          issue_type: string | null
          product_id: string | null
          product_name: string | null
          severity: string | null
        }
        Relationships: []
      }
      v_mrp_needs: {
        Row: {
          available_now: number | null
          category: string | null
          conversion_rate: number | null
          earliest_deadline: string | null
          lead_time_days: number | null
          min_order_quantity: number | null
          min_stock: number | null
          on_hand: number | null
          order_by_date: string | null
          orders_count: number | null
          preferred_supplier_id: string | null
          product_id: string | null
          product_name: string | null
          projected_demand: number | null
          purchase_order_unit: string | null
          qty_in_po: number | null
          reserved: number | null
          sku: string | null
          suggested_qty: number | null
          supplier_name: string | null
          unit: string | null
          unit_price: number | null
        }
        Relationships: [
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
        ]
      }
      v_ncm_coverage: {
        Row: {
          has_profile: boolean | null
          ncm: string | null
          sheets_using: number | null
        }
        Relationships: []
      }
      v_nfe_sequence_gaps: {
        Row: {
          cnpj_emitente: string | null
          company_id: string | null
          missing_numero: number | null
          serie: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_emitidas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_open_purchase_orders: {
        Row: {
          created_at: string | null
          id: string | null
          linked_pv_count: number | null
          linked_pv_numbers: string[] | null
          linked_sale_order_ids: string[] | null
          order_number: string | null
          status: string | null
          supplier_id: string | null
          supplier_name: string | null
          total_value: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          linked_pv_count?: never
          linked_pv_numbers?: never
          linked_sale_order_ids?: string[] | null
          order_number?: string | null
          status?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_value?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          linked_pv_count?: never
          linked_pv_numbers?: never
          linked_sale_order_ids?: string[] | null
          order_number?: string | null
          status?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_value?: number | null
          updated_at?: string | null
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
      v_open_service_orders: {
        Row: {
          artisanal_output_color: string | null
          artisanal_output_meters: number | null
          artisanal_output_name: string | null
          artisanal_recipe_id: string | null
          contractor_id: string | null
          contractor_name: string | null
          created_at: string | null
          id: string | null
          linked_pv_count: number | null
          linked_pv_numbers: string[] | null
          linked_sale_order_ids: string[] | null
          order_number: string | null
          status: string | null
          total_value: number | null
          updated_at: string | null
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
            foreignKeyName: "service_orders_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_metrics"
            referencedColumns: ["contractor_id"]
          },
        ]
      }
      v_operator_productivity: {
        Row: {
          avg_actual_time_minutes: number | null
          avg_standard_time_minutes: number | null
          efficiency_ratio: number | null
          month: string | null
          operator_employee_id: string | null
          operator_name: string | null
          pairs_processed: number | null
          role: string | null
          stage_name: string | null
          stages_completed: number | null
          stages_with_defects: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "bank_hours_balance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_pending_summary"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_punch_pattern"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "v_pending_time_records"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "order_stages_operator_employee_id_fkey"
            columns: ["operator_employee_id"]
            isOneToOne: false
            referencedRelation: "v_time_pendings"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      v_order_lot_traceability: {
        Row: {
          consumed_at: string | null
          cost_impact: number | null
          description: string | null
          expiry_date: string | null
          lot_id: string | null
          lot_number: string | null
          movement_id: string | null
          order_id: string | null
          product_id: string | null
          product_name: string | null
          quantity_consumed: number | null
          received_date: string | null
          sku: string | null
          supplier_lot: string | null
          supplier_name: string | null
          unit_cost: number | null
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
            referencedRelation: "v_order_pickup_window"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vw_costura_queue"
            referencedColumns: ["order_id"]
          },
        ]
      }
      v_order_pickup_window: {
        Row: {
          block_key: string | null
          block_sequence: number | null
          order_id: string | null
          pickup_date: string | null
          pickup_friday_date: string | null
          pickup_tuesday_date: string | null
          pickup_window:
            | Database["public"]["Enums"]["pickup_window_enum"]
            | null
          sale_order_id: string | null
          wave_id: string | null
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
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
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
          total_packaging: number | null
          total_revenue: number | null
          total_units: number | null
        }
        Relationships: []
      }
      v_order_split_suggestions: {
        Row: {
          bottleneck_capacity: number | null
          color: string | null
          order_id: string | null
          order_number: string | null
          planned_delivery: string | null
          production_step: string | null
          quantity: number | null
          sale_order_id: string | null
          sale_order_number: string | null
          sheet_code: string | null
          sheet_id: string | null
          sheet_name: string | null
          status: string | null
          suggested_lots: number | null
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
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
          },
        ]
      }
      v_outsourced_in_field: {
        Row: {
          artisanal_base_color: string | null
          artisanal_for_order_meters: number | null
          artisanal_for_stock_meters: number | null
          artisanal_output_color: string | null
          artisanal_output_meters: number | null
          artisanal_output_name: string | null
          client_name: string | null
          color: string | null
          contractor_id: string | null
          contractor_name: string | null
          created_at: string | null
          days_late: number | null
          description: string | null
          expected_back: string | null
          id: string | null
          is_artisanal: boolean | null
          material_color: string | null
          material_meters: number | null
          material_name: string | null
          materials_sent: Json | null
          notes: string | null
          op_number: string | null
          order_grade: Json | null
          order_id: string | null
          pairs: number | null
          sale_order_id: string | null
          sale_order_number: string | null
          sector: string | null
          sent_at: string | null
          sheet_name: string | null
          source: string | null
          status: string | null
          total_value: number | null
          unit_price: number | null
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
      v_pending_time_records: {
        Row: {
          department: string | null
          dow: number | null
          employee_external_id: string | null
          employee_id: string | null
          employee_name: string | null
          has_manual_override: boolean | null
          issue_type: string | null
          punch_count: number | null
          punches: Json | null
          record_date: string | null
          time_record_id: string | null
        }
        Relationships: []
      }
      v_product_abc: {
        Row: {
          abc_class: string | null
          cumulative_pct: number | null
          name: string | null
          pct_of_total: number | null
          product_id: string | null
          quantity: number | null
          sku: string | null
          stock_value: number | null
          unit_price: number | null
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
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
      v_products_abc_class: {
        Row: {
          abc_class: string | null
          cumulative_pct: number | null
          name: string | null
          product_id: string | null
          total_value: number | null
        }
        Relationships: []
      }
      v_products_below_rop: {
        Row: {
          available_qty: number | null
          category: string | null
          group_id: string | null
          has_active_po: boolean | null
          max_stock: number | null
          min_stock: number | null
          product_id: string | null
          product_name: string | null
          reserved_stock: number | null
          stock_qty: number | null
          suggested_qty: number | null
          suggested_supplier: string | null
          suggested_supplier_id: string | null
          supplier_lead_days: number | null
          supplier_moq: number | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          available_qty?: never
          category?: string | null
          group_id?: string | null
          has_active_po?: never
          max_stock?: number | null
          min_stock?: number | null
          product_id?: string | null
          product_name?: string | null
          reserved_stock?: never
          stock_qty?: number | null
          suggested_qty?: never
          suggested_supplier?: never
          suggested_supplier_id?: never
          supplier_lead_days?: never
          supplier_moq?: never
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          available_qty?: never
          category?: string | null
          group_id?: string | null
          has_active_po?: never
          max_stock?: number | null
          min_stock?: number | null
          product_id?: string | null
          product_name?: string | null
          reserved_stock?: never
          stock_qty?: number | null
          suggested_qty?: never
          suggested_supplier?: never
          suggested_supplier_id?: never
          supplier_lead_days?: never
          supplier_moq?: never
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      v_products_missing_supplier: {
        Row: {
          category: string | null
          color: string | null
          group_name: string | null
          id: string | null
          min_stock: number | null
          name: string | null
          quantity: number | null
          sku: string | null
          stock_status: string | null
          suggested_supplier_from_group: string | null
          unit: string | null
          unit_price: number | null
          valor_estoque: number | null
        }
        Relationships: []
      }
      v_products_missing_supplier_active_demand: {
        Row: {
          category: string | null
          estoque_atual: number | null
          id: string | null
          min_stock: number | null
          name: string | null
          pvs: string[] | null
          pvs_ativos_consumindo: number | null
          sku: string | null
        }
        Relationships: []
      }
      v_products_with_location: {
        Row: {
          bin_aisle: string | null
          bin_code: string | null
          bin_name: string | null
          bin_position: string | null
          bin_rack: string | null
          bin_shelf: string | null
          bin_warehouse: string | null
          bin_zone: string | null
          category: string | null
          default_bin_location_id: string | null
          id: string | null
          min_stock: number | null
          name: string | null
          quantity: number | null
          sku: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_default_bin_location_id_fkey"
            columns: ["default_bin_location_id"]
            isOneToOne: false
            referencedRelation: "bin_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_pv_outdated_status: {
        Row: {
          client_name: string | null
          has_outdated_snapshot: boolean | null
          oldest_snapshot_outdated_at: string | null
          order_number: string | null
          reservations_outdated_at: string | null
          sale_order_id: string | null
          status: string | null
          status_label: string | null
        }
        Insert: {
          client_name?: string | null
          has_outdated_snapshot?: never
          oldest_snapshot_outdated_at?: never
          order_number?: string | null
          reservations_outdated_at?: string | null
          sale_order_id?: string | null
          status?: string | null
          status_label?: never
        }
        Update: {
          client_name?: string | null
          has_outdated_snapshot?: never
          oldest_snapshot_outdated_at?: never
          order_number?: string | null
          reservations_outdated_at?: string | null
          sale_order_id?: string | null
          status?: string | null
          status_label?: never
        }
        Relationships: []
      }
      v_quality_cost: {
        Row: {
          category: string | null
          defect_count: number | null
          month: string | null
          pairs_affected: number | null
          refugo_cost: number | null
          rework_cost: number | null
          total_cost: number | null
        }
        Relationships: []
      }
      v_quality_pareto: {
        Row: {
          category: string | null
          cumulative_pairs: number | null
          cumulative_pct: number | null
          defect_code: string | null
          defect_description: string | null
          grand_pairs: number | null
          occurrences: number | null
          total_cost_impact: number | null
          total_pairs_affected: number | null
        }
        Relationships: []
      }
      v_quality_pareto_by_sector: {
        Row: {
          category: string | null
          cumulative_pairs: number | null
          cumulative_pct: number | null
          defect_code: string | null
          defect_name: string | null
          occurrences: number | null
          open_count: number | null
          sector: string | null
          sector_total_pairs: number | null
          severity: string | null
          total_cost_impact: number | null
          total_pairs_affected: number | null
        }
        Relationships: []
      }
      v_sale_order_billing_health: {
        Row: {
          ar_count: number | null
          ar_pendente: number | null
          client_name: string | null
          created_at: string | null
          delivery_deadline: string | null
          health: string | null
          nfe_required: boolean | null
          nfes_ativas: number | null
          nfes_autorizadas: number | null
          nfes_canceladas: number | null
          nfes_rejeitadas: number | null
          order_number: string | null
          sale_order_id: string | null
          so_status: string | null
          total: number | null
        }
        Relationships: []
      }
      v_sector_bottlenecks: {
        Row: {
          contributing_orders: Json[] | null
          is_bottleneck: boolean | null
          iso_week: number | null
          iso_year: number | null
          ops_count: number | null
          sector: string | null
          severity: string | null
          total_capacity_week: number | null
          total_pairs_planned: number | null
          utilization_pct: number | null
          week_start: string | null
        }
        Relationships: []
      }
      v_sector_cost_per_minute: {
        Row: {
          avg_allowance_pct: number | null
          avg_cost_per_minute: number | null
          avg_cost_per_pair: number | null
          avg_rating_pct: number | null
          avg_standard_time_minutes: number | null
          stage: string | null
          study_count: number | null
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
      v_sector_load_by_reference: {
        Row: {
          cap_acabamento: number | null
          cap_aviamento: number | null
          cap_colagem: number | null
          cap_corte_forracao: number | null
          cap_corte_palmilha: number | null
          cap_costura: number | null
          cap_expedicao: number | null
          cap_montagem: number | null
          cap_silk: number | null
          cap_solagem: number | null
          capacity_source: string | null
          op_count: number | null
          reference_code: string | null
          reference_name: string | null
          shoe_category: string | null
          tech_sheet_id: string | null
          total_qty: number | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "references"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "technical_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["tech_sheet_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sector_oee: {
        Row: {
          availability_pct: number | null
          downtime_unplanned_min: number | null
          pairs_produced_30d: number | null
          performance_loss_min: number | null
          performance_pct: number | null
          stage_name: string | null
        }
        Relationships: []
      }
      v_sector_weekly_load: {
        Row: {
          capacity_per_day: number | null
          color: string | null
          end_date: string | null
          iso_week: number | null
          iso_year: number | null
          order_id: string | null
          order_number: string | null
          pairs_per_day: number | null
          planned_delivery: string | null
          quantity: number | null
          reference_id: string | null
          sale_order_id: string | null
          sector: string | null
          sheet_id: string | null
          sheet_name: string | null
          start_date: string | null
          status: string | null
          week_start: string | null
          window_days: number | null
        }
        Relationships: []
      }
      v_sector_workload_active: {
        Row: {
          aggregated_grade: Json | null
          aggregated_status: string | null
          color: string | null
          earliest_deadline: string | null
          latest_deadline: string | null
          model_name: string | null
          ops_count: number | null
          order_ids: string[] | null
          order_numbers: string[] | null
          processed_pairs: number | null
          reference_id: string | null
          remaining_pairs: number | null
          sector: string | null
          shoe_category: string | null
          total_pairs: number | null
        }
        Relationships: [
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
            referencedRelation: "v_ficha_sole_range_mismatch"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_order_split_suggestions"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sheets_missing_lining_consumption"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_sku_forecast_summary"
            referencedColumns: ["reference_id"]
          },
          {
            foreignKeyName: "references"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "v_technical_sheets_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      v_service_order_balance: {
        Row: {
          contractor_id: string | null
          last_return_at: string | null
          qty_in_field: number | null
          qty_loss: number | null
          qty_returned_defect: number | null
          qty_returned_good: number | null
          qty_sent: number | null
          service_order_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_orders_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_metrics"
            referencedColumns: ["contractor_id"]
          },
        ]
      }
      v_sheets_missing_lining_consumption: {
        Row: {
          code: string | null
          id: string | null
          lining_material: string | null
          name: string | null
          sizes_no_upper: number | null
          upper_template: Json | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          lining_material?: string | null
          name?: string | null
          sizes_no_upper?: never
          upper_template?: Json | null
        }
        Update: {
          code?: string | null
          id?: string | null
          lining_material?: string | null
          name?: string | null
          sizes_no_upper?: never
          upper_template?: Json | null
        }
        Relationships: []
      }
      v_shoe_category_unmapped: {
        Row: {
          categoria_atual: string | null
          code: string | null
          name: string | null
          row_id: string | null
          tabela: string | null
        }
        Relationships: []
      }
      v_sku_forecast: {
        Row: {
          avg_monthly_forecast: number | null
          color: string | null
          forecast_current_month: number | null
          reference_code: string | null
          reference_id: string | null
          reference_name: string | null
          seasonality_factor_current_month: number | null
          size_name: string | null
          sold_last_6m: number | null
        }
        Relationships: []
      }
      v_sku_forecast_summary: {
        Row: {
          color: string | null
          reference_code: string | null
          reference_id: string | null
          reference_name: string | null
          sizes_count: number | null
          total_forecast_current_month: number | null
          total_forecast_monthly: number | null
          total_sold_6m: number | null
        }
        Relationships: []
      }
      v_soles_audit: {
        Row: {
          drives_consumption_but_no_specs: boolean | null
          fachetado_missing_fachete_specs: boolean | null
          is_fachetado: boolean | null
          missing_insole_specs: boolean | null
          missing_lining_specs: boolean | null
          sheets_using: number | null
          sizes_with_fachete: number | null
          sizes_with_insole: number | null
          sizes_with_lining: number | null
          sizes_with_specs_total: number | null
          sole_color: string | null
          sole_id: string | null
          sole_name: string | null
          sole_sku: string | null
          unit_price: number | null
        }
        Relationships: []
      }
      v_soles_with_specs: {
        Row: {
          color: string | null
          id: string | null
          is_fachetado: boolean | null
          last_updated_at: string | null
          name: string | null
          sheets_using: number | null
          sizes_count: number | null
          sizes_list: string | null
          sku: string | null
        }
        Insert: {
          color?: string | null
          id?: string | null
          is_fachetado?: never
          last_updated_at?: never
          name?: string | null
          sheets_using?: never
          sizes_count?: never
          sizes_list?: never
          sku?: string | null
        }
        Update: {
          color?: string | null
          id?: string | null
          is_fachetado?: never
          last_updated_at?: never
          name?: string | null
          sheets_using?: never
          sizes_count?: never
          sizes_list?: never
          sku?: string | null
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
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_mrp_needs"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_abc"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_abc_class"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_below_rop"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_missing_supplier_active_demand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_products_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_audit"
            referencedColumns: ["sole_id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_soles_with_specs"
            referencedColumns: ["id"]
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
      v_technical_sheets_audit: {
        Row: {
          code: string | null
          created_at: string | null
          id: string | null
          missing_insole_consumption: boolean | null
          missing_insole_material: boolean | null
          missing_lining_consumption: boolean | null
          missing_lining_material: boolean | null
          missing_mod: boolean | null
          missing_production_sectors: boolean | null
          missing_sole_color_mapping: boolean | null
          missing_sole_consumption: boolean | null
          missing_sole_material: boolean | null
          missing_upper_consumption: boolean | null
          missing_upper_material: boolean | null
          name: string | null
          sole_driven_but_specs_missing: boolean | null
          sole_drives_consumption: boolean | null
          sole_fachetado_sem_fachete: boolean | null
          status: string | null
          straps_without_colors: boolean | null
          straps_without_group: boolean | null
          updated_at: string | null
          upper_per_size_partial_no_fallback: boolean | null
        }
        Relationships: []
      }
      v_technical_sheets_audit_summary: {
        Row: {
          fachetado_sem_fachete: number | null
          fichas_100_completas: number | null
          fichas_sole_driven: number | null
          sem_consumo_cabedal: number | null
          sem_consumo_forro: number | null
          sem_consumo_palmilha: number | null
          sem_consumo_solado: number | null
          sem_cores_solado: number | null
          sem_grupo_cabedal: number | null
          sem_grupo_forro: number | null
          sem_grupo_palmilha: number | null
          sem_grupo_solado: number | null
          sem_mod_cadastrado: number | null
          sem_setores_producao: number | null
          sole_driven_sem_specs: number | null
          tiras_sem_cores: number | null
          tiras_sem_grupo: number | null
          total_fichas: number | null
        }
        Relationships: []
      }
      v_time_import_archive: {
        Row: {
          active_record_count: number | null
          batch_id: string | null
          created_at: string | null
          error_count: number | null
          file_name: string | null
          file_path: string | null
          file_size_bytes: number | null
          has_archived_file: boolean | null
          id: string | null
          imported_by: string | null
          inserted_count: number | null
          mime_type: string | null
          period_days: number | null
          period_end: string | null
          period_start: string | null
          skipped_count: number | null
          status: string | null
          total_rows: number | null
          updated_count: number | null
        }
        Insert: {
          active_record_count?: never
          batch_id?: string | null
          created_at?: string | null
          error_count?: number | null
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          has_archived_file?: never
          id?: string | null
          imported_by?: string | null
          inserted_count?: number | null
          mime_type?: string | null
          period_days?: never
          period_end?: string | null
          period_start?: string | null
          skipped_count?: number | null
          status?: string | null
          total_rows?: number | null
          updated_count?: number | null
        }
        Update: {
          active_record_count?: never
          batch_id?: string | null
          created_at?: string | null
          error_count?: number | null
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          has_archived_file?: never
          id?: string | null
          imported_by?: string | null
          inserted_count?: number | null
          mime_type?: string | null
          period_days?: never
          period_end?: string | null
          period_start?: string | null
          skipped_count?: number | null
          status?: string | null
          total_rows?: number | null
          updated_count?: number | null
        }
        Relationships: []
      }
      v_time_pendings: {
        Row: {
          day_summary: Json | null
          days_since: number | null
          department: string | null
          dow: number | null
          employee_external_id: string | null
          employee_id: string | null
          employee_name: string | null
          id: string | null
          punches: Json | null
          punches_count: number | null
          record_date: string | null
          suggestion: Json | null
          urgency: string | null
        }
        Relationships: []
      }
      v_wave_detail: {
        Row: {
          acabamento_start_date: string | null
          code: string | null
          colagem_start_date: string | null
          corte_forracao_start_date: string | null
          corte_palmilha_start_date: string | null
          costura_start_date: string | null
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
          costura_start_date?: string | null
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
          costura_start_date?: string | null
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
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "production_wave_item_sources_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
            referencedColumns: ["sale_order_id"]
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
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_pv_outdated_status"
            referencedColumns: ["sale_order_id"]
          },
          {
            foreignKeyName: "orders_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "v_sale_order_billing_health"
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
      vw_punch_clock_params_current: {
        Row: {
          description: string | null
          param_key: string | null
          valid_from: string | null
          valid_to: string | null
          value: Json | null
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
        | { Args: { p_days: number; p_start: string }; Returns: string }
        | { Args: { p_days: number; p_start_date: string }; Returns: string }
      add_cycle_count_item: {
        Args: {
          p_bin_location?: string
          p_counted_quantity: number
          p_cycle_id: string
          p_lot_number?: string
          p_notes?: string
          p_product_id: string
        }
        Returns: string
      }
      adjust_stock: {
        Args: {
          p_delta: number
          p_expected_previous_qty: number
          p_new_grade?: Json
          p_new_qty: number
          p_order_id?: string
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
      apply_inventory_count: { Args: { p_count_id: string }; Returns: Json }
      apply_manual_punch_completion: {
        Args: {
          p_punch_time: string
          p_reason?: string
          p_time_record_id: string
        }
        Returns: Json
      }
      apply_supplier_to_group: {
        Args: { p_group_id: string; p_supplier_id: string }
        Returns: {
          sample_ids: string[]
          updated_count: number
        }[]
      }
      apply_time_study_to_bom: { Args: { p_study_id: string }; Returns: string }
      assert_admin_or_gerente: { Args: never; Returns: undefined }
      audit_duplicate_triggers: {
        Args: never
        Returns: {
          event: string
          table_name: string
          timing: string
          trigger_count: number
          trigger_names: string[]
        }[]
      }
      audit_stock_drift_report: {
        Args: never
        Returns: {
          category: string
          db_quantity: number
          drift: number
          drift_severity: string
          movement_count: number
          movements_total: number
          name: string
          product_id: string
          sku: string
        }[]
      }
      audit_unit_divergences: { Args: never; Returns: Json }
      auto_assign_sale_order_to_wave: {
        Args: { p_sale_order_id: string }
        Returns: string
      }
      auto_create_wave_from_sale_order: {
        Args: { p_sale_order_id: string }
        Returns: string
      }
      auto_fill_sector_distribution: {
        Args: { p_week_start: string }
        Returns: Json
      }
      auto_start_due_waves: { Args: never; Returns: number }
      biz_days_between: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
      calc_required_for_grade: {
        Args: {
          p_consumption_per_size: Json
          p_order_grade: Json
          p_quantity_per_unit: number
          p_total_quantity: number
        }
        Returns: number
      }
      calculate_day_summary: {
        Args: {
          p_expected_min: number
          p_has_lunch?: boolean
          p_is_holiday?: boolean
          p_minimum_overtime: number
          p_punches: Json
          p_tolerance_min: number
        }
        Returns: Json
      }
      calculate_employee_bank_balance: {
        Args: {
          p_employee_id: string
          p_from?: string
          p_skip_missing?: boolean
          p_to?: string
        }
        Returns: Json
      }
      calculate_order_consumption: {
        Args: {
          p_color: string
          p_material_variant_id?: string
          p_order_quantity: number
          p_reference_id: string
          p_size?: number
        }
        Returns: Json
      }
      calculate_order_consumption_by_grade: {
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
      calculate_order_cost_item: {
        Args: { p_persist?: boolean; p_sale_order_item_id: string }
        Returns: Json
      }
      calculate_sale_order_weight: {
        Args: { p_sale_order_id: string }
        Returns: Json
      }
      calculate_tiered_commission: {
        Args: {
          p_period_total: number
          p_representative_id: string
          p_trigger_event?: string
        }
        Returns: number
      }
      calculate_weekly_he_breakdown: {
        Args: { p_employee_id: string; p_week_start: string }
        Returns: Json
      }
      cancel_wave: {
        Args: { p_reason?: string; p_wave_id: string }
        Returns: undefined
      }
      canonical_stage_order: { Args: { p_stage_name: string }; Returns: number }
      check_schema_objects: { Args: never; Returns: Json }
      check_stock_availability: {
        Args: {
          p_color?: string
          p_order_grade?: Json
          p_order_quantity: number
          p_reference_id: string
          p_strap_colors?: Json
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
      commit_capacity_overflow_outsourcing: {
        Args: { p_assignments: Json }
        Returns: Json
      }
      commit_picking_for_sale_order: {
        Args: { p_sale_order_id: string }
        Returns: Json
      }
      compact_orders_by_ref_color: {
        Args: { p_sale_order_id: string }
        Returns: {
          nf_skipped: number
          ops_kept: number
          ops_removed: number
        }[]
      }
      compact_sale_order: { Args: { p_sale_order_id: string }; Returns: Json }
      compact_sale_order_items: {
        Args: { p_sale_order_id: string }
        Returns: {
          items_kept: number
          items_removed: number
        }[]
      }
      complete_order_stages_bulk: {
        Args: { p_order_id: string; p_stage_names: string[] }
        Returns: number
      }
      complete_punches: {
        Args: {
          p_punches: string[]
          p_reason?: string
          p_time_record_id: string
        }
        Returns: {
          created_at: string
          department: string
          employee_external_id: string
          employee_name: string
          id: string
          import_batch: string
          punches: Json
          record_date: string
        }
        SetofOptions: {
          from: "*"
          to: "time_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      compute_material_ready_date: { Args: { p_items: Json }; Returns: Json }
      compute_min_billing_date: {
        Args: { p_sale_order_id: string }
        Returns: string
      }
      compute_sale_order_nfe_volumes: {
        Args: { p_sale_order_id: string }
        Returns: {
          breakdown: Json
          mode: string
          volumes: number
        }[]
      }
      compute_wave_timeline: {
        Args: { p_sale_order_ids: string[] }
        Returns: {
          acabamento_end_date: string
          acabamento_start_date: string
          colagem_start_date: string
          corte_forracao_start_date: string
          corte_palmilha_start_date: string
          costura_start_date: string
          earliest_deadline: string
          material_ready_date: string
          mesa_start_date: string
          montagem_start_date: string
          pickup_friday_date: string
          pickup_tuesday_date: string
          purchase_deadline: string
          silk_start_date: string
          solagem_start_date: string
        }[]
      }
      confirm_picking_reservation: {
        Args: { p_picked_by?: string; p_reservation_id: string }
        Returns: undefined
      }
      consume_all_reservations_for_order: {
        Args: { p_order_id: string; p_picked_by?: string }
        Returns: Json
      }
      consume_from_lot: {
        Args: {
          p_lot_id: string
          p_notes?: string
          p_order_id: string
          p_quantity: number
        }
        Returns: boolean
      }
      convert_reservation_to_out: {
        Args: { p_order_id: string; p_product_id?: string }
        Returns: undefined
      }
      convert_to_product_unit: {
        Args: { p_qty: number; p_source_unit: string; p_target_unit: string }
        Returns: number
      }
      copy_sole_specs_from: {
        Args: {
          p_overwrite?: boolean
          p_source_sole_id: string
          p_target_sole_id: string
        }
        Returns: Json
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
      create_cycle_count: { Args: { p_notes?: string }; Returns: string }
      create_po_from_quotation: {
        Args: { p_quotation_id: string }
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
          p_force_soft?: boolean
          p_order_id: string
          p_order_quantity: number
          p_packaging_mode?: string
          p_reference_id: string
          p_sale_order_id: string
        }
        Returns: Json
      }
      debit_sole_stock_by_grade: {
        Args: {
          p_color: string
          p_force_soft?: boolean
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
          p_force_soft?: boolean
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
      derive_category_from_group_name: {
        Args: { p_group_name: string }
        Returns: string
      }
      detect_production_bottlenecks_and_alert: { Args: never; Returns: Json }
      detect_wave_capacity_overflow: {
        Args: { p_order_ids: string[] }
        Returns: {
          color: string
          order_id: string
          order_number: string
          quantity: number
          sale_order_id: string
          sector: string
          severity: string
          sheet_id: string
          sheet_name: string
          total_capacity_week: number
          total_pairs_planned: number
          utilization_pct: number
          week_start: string
        }[]
      }
      duplicate_material_variant_bom: {
        Args: {
          p_sheet_id: string
          p_source_variant_id: string
          p_target_variant_id: string
        }
        Returns: number
      }
      estimate_tax_apuration: {
        Args: {
          p_company_id?: string
          p_period_end: string
          p_period_start: string
        }
        Returns: Json
      }
      estimate_weight_per_pair_kg: {
        Args: { p_sheet_id: string }
        Returns: Json
      }
      finalize_cycle_count: {
        Args: { p_apply_adjustments?: boolean; p_cycle_id: string }
        Returns: Json
      }
      finalize_production_sector: {
        Args: { p_current_sector: string; p_order_id: string }
        Returns: Json
      }
      fn_projected_demand: {
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
      force_delete_product: { Args: { p_product_id: string }; Returns: Json }
      force_sale_order_production: {
        Args: { p_sale_order_id: string }
        Returns: Json
      }
      freeze_technical_sheet: {
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
      generate_bloco_k: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: Json
      }
      generate_purchase_orders_from_mrp: {
        Args: { p_product_ids?: string[] }
        Returns: string[]
      }
      generate_rop_purchase_suggestions: { Args: never; Returns: Json }
      get_applied_migrations: {
        Args: never
        Returns: {
          name: string
          statements_count: number
          version: string
        }[]
      }
      get_bank_hours_cutoff: { Args: never; Returns: string }
      get_client_commercial_defaults: {
        Args: { p_client_id: string }
        Returns: {
          block_new_orders: boolean
          block_reason: string
          credit_limit: number
          discount_pct: number
          factoring_config_id: string
          inherited_from: string
          modalidade_frete: string
          payment_condition: string
          price_list_id: string
          transport_company_id: string
        }[]
      }
      get_contractor_rate: {
        Args: { p_contractor_id: string; p_date?: string; p_sector: string }
        Returns: number
      }
      get_distinct_batches: {
        Args: never
        Returns: {
          import_batch: string
        }[]
      }
      get_effective_bom: {
        Args: { p_sheet_id: string; p_variant_id?: string }
        Returns: {
          color: string
          id: string
          notes: string
          product_id: string
          quantity_per_unit: number
          sheet_id: string
          sizes: string
          source: string
          supplier: string
          weight: string
          width: string
        }[]
      }
      get_effective_os_lead_days: {
        Args: { p_service_order_id: string }
        Returns: number
      }
      get_effective_price: {
        Args: {
          p_channel?: string
          p_client_id?: string
          p_color?: string
          p_date?: string
          p_reference_id: string
          p_region_uf?: string
        }
        Returns: number
      }
      get_effective_supplier_lead_days: {
        Args: { p_prod_deadline_days?: number; p_product_id: string }
        Returns: number
      }
      get_employee_expected_minutes: {
        Args: { p_employee_id: string; p_ref_date: string }
        Returns: number
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
          conversion_warning: string
          dm2_per_unit: number
          target_unit: string
          waste_pct: number
        }[]
      }
      get_ncm_from_last_sheet_for_sole: {
        Args: {
          p_exclude_id?: string
          p_primary_sole_id?: string
          p_shoe_category?: string
          p_sole_group_id: string
        }
        Returns: string
      }
      get_nfe_sync_cron_secret: { Args: never; Returns: string }
      get_order_material_status: {
        Args: { p_order_id: string }
        Returns: string
      }
      get_payroll_inputs_for_period: {
        Args: { p_employee_id: string; p_period: string }
        Returns: Json
      }
      get_pending_count_by_employee: {
        Args: { p_max_age_days?: number }
        Returns: {
          department: string
          employee_id: string
          employee_name: string
          overdue_count: number
          pending_count: number
        }[]
      }
      get_punch_clock_param: {
        Args: { p_key: string; p_ref_date?: string }
        Returns: Json
      }
      get_punch_clock_param_int: {
        Args: { p_default?: number; p_key: string; p_ref_date?: string }
        Returns: number
      }
      get_purchase_projection: {
        Args: { p_days?: number }
        Returns: {
          abc_class: string
          abc_cum_share: number
          available_stock: number
          avg_daily_consumption: number
          avg_unit_price: number
          color: string
          consumed_qty: number
          current_stock: number
          days_of_cover: number
          is_artisanal: boolean
          last_purchase_date: string
          product_category: string
          product_id: string
          product_name: string
          purchase_count: number
          recommendation: string
          reserved_stock: number
          suggested_min_stock: number
          suggested_reorder_qty: number
          supplier_id: string
          supplier_lead_time_days: number
          supplier_name: string
          total_purchased_qty: number
          total_purchased_value: number
          unit: string
        }[]
      }
      get_purchase_projection_summary: {
        Args: { p_days?: number }
        Returns: {
          abc_a_count: number
          abc_b_count: number
          abc_c_count: number
          critical_reorder_count: number
          high_stock_count: number
          inactive_count: number
          ok_count: number
          reorder_count: number
          top_10_colors: Json
          top_5_categories: Json
          total_active_products: number
          total_purchase_value: number
          total_reorder_value: number
        }[]
      }
      get_sheet_bottleneck_capacity: {
        Args: { p_sheet_id: string }
        Returns: number
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
      get_wave_pickup_summary: {
        Args: { p_wave_id: string }
        Returns: {
          block_count: number
          pickup_date: string
          pickup_window: Database["public"]["Enums"]["pickup_window_enum"]
          sale_order_count: number
          total_items: number
          total_pairs: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hybrid_debit_stock_for_order: {
        Args: {
          p_color: string
          p_force_soft?: boolean
          p_order_grade?: Json
          p_order_id: string
          p_order_quantity: number
          p_reference_id: string
        }
        Returns: Json
      }
      import_time_records_safe: { Args: { records: Json }; Returns: Json }
      increment_qty_devolvida: {
        Args: { p_qty: number; p_sale_order_item_id: string }
        Returns: Json
      }
      is_admin_or_gerente: { Args: { _user_id: string }; Returns: boolean }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      is_approved_user: { Args: never; Returns: boolean }
      is_business_day: { Args: { p_date: string }; Returns: boolean }
      is_employee_absent_on: {
        Args: { p_date: string; p_employee_id: string }
        Returns: boolean
      }
      kanban_stage_to_wave_stage: {
        Args: { p_stage_name: string }
        Returns: Database["public"]["Enums"]["production_stage_enum"]
      }
      list_active_material_variants: {
        Args: { p_sheet_id: string }
        Returns: {
          active: boolean
          display_order: number
          has_specific_bom: boolean
          id: string
          material_name: string
          reference_id: string
          sku: string
          specific_bom_count: number
        }[]
      }
      list_available_source_colors: {
        Args: { p_group_id: string }
        Returns: {
          color_hex: string
          color_id: string
          color_name: string
          color_pantone: string
          source_group_id: string
          source_group_name: string
        }[]
      }
      list_materials_missing_width: {
        Args: never
        Returns: {
          group_name: string
          has_component_sheet: boolean
          product_id: string
          product_name: string
          product_unit: string
          used_in_sheets: number
        }[]
      }
      list_missing_sole_consumption_sizes: {
        Args: { p_sole_id: string }
        Returns: {
          is_fachetado: boolean
          missing_fachete: boolean
          missing_insole: boolean
          missing_lining: boolean
          size: number
        }[]
      }
      list_orphan_reservations: {
        Args: never
        Returns: {
          order_id: string
          order_number: string
          order_status: string
          product_id: string
          product_name: string
          reservation_id: string
          residual: number
        }[]
      }
      mark_stop_delivered: {
        Args: {
          p_latitude?: number
          p_longitude?: number
          p_notes?: string
          p_receiver_name?: string
          p_stop_id: string
        }
        Returns: boolean
      }
      mdfe_draft_from_manifest: {
        Args: { p_manifest_id: string }
        Returns: Json
      }
      move_stock_status: {
        Args: {
          p_from: string
          p_product_id: string
          p_qty: number
          p_reason?: string
          p_to: string
        }
        Returns: Json
      }
      next_dow: {
        Args: { base_date: string; target_dow: number }
        Returns: string
      }
      normalize_shoe_category: { Args: { p_input: string }; Returns: string }
      notify_costura_overflow: { Args: never; Returns: Json }
      open_inventory_count: { Args: { p_scope?: string }; Returns: string }
      override_service_order_for_montagem: {
        Args: { p_reason: string; p_so_id: string }
        Returns: undefined
      }
      parse_iso_billing_week: { Args: { p_text: string }; Returns: string }
      pay_bank_hours: {
        Args: {
          p_bank_account_id?: string
          p_employee_id: string
          p_hourly_rate: number
          p_hours: number
          p_notes?: string
          p_payment_date?: string
        }
        Returns: Json
      }
      pay_bank_hours_balance: {
        Args: { p_employee_id: string; p_notes?: string; p_pay_minutes: number }
        Returns: Json
      }
      plan_costura_dispatch: {
        Args: { p_horizon_days?: number }
        Returns: Json
      }
      po_alcada_tier: {
        Args: { p_total: number }
        Returns: {
          active: boolean
          created_at: string
          id: string
          max_value: number | null
          min_value: number
          name: string
          notes: string | null
          required_role: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "purchase_approval_tiers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      process_dirty_order_costs: {
        Args: { p_max_orders?: number }
        Returns: Json
      }
      process_order_stock_out: {
        Args: { p_order_id: string; p_product_id: string; p_quantity: number }
        Returns: Json
      }
      process_outdated_reservations: {
        Args: { p_max_orders?: number }
        Returns: Json
      }
      process_resync_queue: { Args: { p_limit?: number }; Returns: Json }
      propagate_component_sole_to_sheets: {
        Args: { p_component_sheet_id: string; p_sole_group_id: string }
        Returns: Json
      }
      prune_old_notifications: {
        Args: {
          p_broadcast_days_to_keep?: number
          p_read_days_to_keep?: number
        }
        Returns: Json
      }
      recalc_delivery_route_costs: {
        Args: { p_route_id: string }
        Returns: undefined
      }
      recalc_supplier_lead_from_history: { Args: never; Returns: Json }
      recall_lot_buyers: {
        Args: { p_lot_id: string }
        Returns: {
          client_cnpj: string
          client_name: string
          delivery_date: string
          nfe_number: string
          pairs_received: number
          sale_order_id: string
          sale_order_number: string
        }[]
      }
      record_lot_intake: {
        Args: {
          p_bin_location_id?: string
          p_expiry_date?: string
          p_invoice_id?: string
          p_notes?: string
          p_product_id: string
          p_quantity: number
          p_received_date?: string
          p_supplier_id?: string
          p_supplier_lot?: string
          p_unit_cost?: number
        }
        Returns: string
      }
      record_receipt_inspection: {
        Args: {
          p_inspector?: string
          p_nc_reason?: string
          p_po_id: string
          p_product_id: string
          p_qty_approved: number
          p_qty_rejected: number
        }
        Returns: string
      }
      refresh_order_reservations: {
        Args: { p_order_id: string }
        Returns: Json
      }
      refresh_supplier_lead_time_stats: {
        Args: { p_supplier_id: string }
        Returns: undefined
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
      reset_order_lots: { Args: { p_order_id: string }; Returns: number }
      resolve_billing_week_for_order: {
        Args: { p_sale_order_id: string }
        Returns: string
      }
      resolve_insole_material_for_variant: {
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
      resolve_item_brand: {
        Args: { p_client_id: string; p_color: string; p_sheet_id: string }
        Returns: string
      }
      resolve_lining_material_for_variant: {
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
      resolve_monthly_overtime: {
        Args: {
          p_bank_minutes: number
          p_decision: string
          p_employee_id: string
          p_month: string
          p_notes?: string
          p_pay_minutes: number
          p_total_minutes: number
        }
        Returns: string
      }
      resolve_palmilha_color: {
        Args: { p_cabedal_color: string; p_sheet_id: string }
        Returns: string
      }
      resolve_sole_color: {
        Args: { p_product_color: string; p_sheet_id: string }
        Returns: {
          sole_color: string
          sole_product_id: string
        }[]
      }
      resolve_sole_for_variant: {
        Args: { p_variant_id: string }
        Returns: {
          available_qty: number
          product_id: string
          product_name: string
        }[]
      }
      resolve_upper_material_for_variant:
        | {
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
        | {
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
      resolve_weekly_overtime: {
        Args: {
          p_bank_minutes: number
          p_decision: string
          p_employee_id: string
          p_notes?: string
          p_pay_minutes: number
          p_total_minutes: number
          p_week_start: string
        }
        Returns: string
      }
      restore_product_stocks_for_order: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      restore_sale_order: { Args: { p_id: string }; Returns: Json }
      restore_sole_grade_for_order: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      resync_op_atomic: { Args: { p_order_id: string }; Returns: Json }
      revert_invoiced_sale_order: {
        Args: { p_reason: string; p_sale_order_id: string }
        Returns: Json
      }
      run_consumption_integration_tests: {
        Args: never
        Returns: {
          case_name: string
          message: string
          ok: boolean
        }[]
      }
      scale_grade_to_total: {
        Args: { p_grade: Json; p_total: number }
        Returns: Json
      }
      sector_display_to_enum: {
        Args: { p_name: string }
        Returns: Database["public"]["Enums"]["production_stage_enum"]
      }
      service_order_payable_amount: {
        Args: { p_so: Database["public"]["Tables"]["service_orders"]["Row"] }
        Returns: number
      }
      snapshot_all_employees_week: {
        Args: { p_lock?: boolean; p_week_start: string }
        Returns: {
          diff_min: number
          employee_id: string
          status: string
        }[]
      }
      snapshot_employee_week: {
        Args: {
          p_employee_id: string
          p_lock?: boolean
          p_reason?: string
          p_week_start: string
        }
        Returns: {
          apuracao_label: string | null
          computed_at: string
          days_absent: number
          days_partial: number
          days_worked: number
          diff_min: number
          employee_id: string
          expected_min: number
          he_100_min: number
          he_50_min: number
          id: string
          locked_at: string | null
          locked_by: string | null
          locked_reason: string | null
          week_end: string
          week_start: string
          worked_min: number
        }
        SetofOptions: {
          from: "*"
          to: "weekly_balance_snapshot"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      soft_delete_sale_order: { Args: { p_id: string }; Returns: Json }
      split_order_into_lots: { Args: { p_order_id: string }; Returns: Json }
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
      start_production_prep_parallel: {
        Args: { p_order_id: string }
        Returns: Json
      }
      start_wave: { Args: { p_wave_id: string }; Returns: undefined }
      suggest_ncm_for_sheet: {
        Args: {
          p_exclude_id?: string
          p_primary_sole_id?: string
          p_shoe_category?: string
          p_sole_group_id?: string
        }
        Returns: string
      }
      suggest_punches_for_record: {
        Args: { p_time_record_id: string }
        Returns: Json
      }
      suggest_pv_deadline: { Args: { p_sale_order_id: string }; Returns: Json }
      sync_product_reserved_stock: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      sync_sale_order_wave_items: {
        Args: { p_sale_order_id: string }
        Returns: undefined
      }
      sync_wave_from_kanban: {
        Args: { p_wave_id: string }
        Returns: Database["public"]["Enums"]["production_stage_enum"]
      }
      tg_create_ap_for_service_order_helper: {
        Args: { p_so: Database["public"]["Tables"]["service_orders"]["Row"] }
        Returns: undefined
      }
      trigger_nfe_sync_cron: { Args: never; Returns: number }
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
      unlock_week: {
        Args: { p_employee_id: string; p_reason: string; p_week_start: string }
        Returns: boolean
      }
      update_sale_order_atomic: {
        Args: { p_header: Json; p_items: Json; p_order_id: string }
        Returns: Json
      }
      update_wave_timeline: { Args: { p_wave_id: string }; Returns: undefined }
      upsert_open_purchase_order: {
        Args: {
          p_items: Json
          p_notes: string
          p_sale_order_id: string
          p_supplier_id: string
          p_supplier_name: string
        }
        Returns: string
      }
      upsert_open_service_order: {
        Args: {
          p_artisanal_recipe_id: string
          p_base_color: string
          p_base_meters_send: number
          p_base_product_name: string
          p_contractor_id: string
          p_for_order_meters: number
          p_for_stock_meters: number
          p_output_color: string
          p_output_name: string
          p_sale_order_id: string
          p_total_meters: number
          p_unit_price: number
        }
        Returns: string
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
      user_has_any_role: { Args: { roles: string[] }; Returns: boolean }
      user_has_role: { Args: { required_role: string }; Returns: boolean }
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
        | "nfe_operator"
        | "rh"
      box_type_kind: "individual" | "master" | "colmeia" | "fitilho"
      insole_mode_enum: "cortar" | "pronta_na_cor"
      pessoa_tipo: "FISICA" | "JURIDICA"
      pickup_window_enum: "tuesday" | "friday"
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
        | "corte_cabedal"
        | "silk"
        | "colagem"
        | "expedicao"
      sole_classification_enum: "tradicional" | "palmilha_pronta" | "conjugado"
      sole_material_applies_enum: "any" | "palmilha_cortada" | "palmilha_pronta"
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
        "nfe_operator",
        "rh",
      ],
      box_type_kind: ["individual", "master", "colmeia", "fitilho"],
      insole_mode_enum: ["cortar", "pronta_na_cor"],
      pessoa_tipo: ["FISICA", "JURIDICA"],
      pickup_window_enum: ["tuesday", "friday"],
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
        "corte_cabedal",
        "silk",
        "colagem",
        "expedicao",
      ],
      sole_classification_enum: ["tradicional", "palmilha_pronta", "conjugado"],
      sole_material_applies_enum: [
        "any",
        "palmilha_cortada",
        "palmilha_pronta",
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
