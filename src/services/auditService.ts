import { supabase } from "@/integrations/supabase/client";

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  oldData?: any;
  newData?: any;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
  success: boolean;
  errorMessage?: string;
}

 export const logAuditEvent = async (event: Omit<AuditLog, "id" | "timestamp">) => {
   let userId = event.userId;
   
   if (!userId) {
     const { data: { user } } = await supabase.auth.getUser();
     userId = user?.id || null;
   }
 
   const { error } = await supabase.from("audit_logs").insert({
     user_id: userId,
    action: event.action,
    resource: event.resource,
    resource_id: event.resourceId,
    old_data: event.oldData,
    new_data: event.newData,
    ip_address: event.ipAddress,
    user_agent: event.userAgent,
    success: event.success,
    error_message: event.errorMessage,
  });

  if (error) {
    console.error("Error logging audit event:", error);
  }
};
