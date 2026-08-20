import { useRef } from 'react';
import { Paperclip, Trash as Trash2, Download, FileText, Image, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { useFinanceAttachments, useUploadFinanceAttachment, useDeleteFinanceAttachment, type FinanceAttachment } from '@/hooks/useFinanceAttachments';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp';
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mime }: { mime: string | null }) {
  if (mime?.startsWith('image/')) return <Image className="h-4 w-4 text-blue-500" />;
  return <FileText className="h-4 w-4 text-red-500" />;
}

export default function FinanceAttachments({ accountType, accountId }: { accountType: 'payable' | 'receivable'; accountId: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: attachments = [], isLoading } = useFinanceAttachments(accountType, accountId);
  const upload = useUploadFinanceAttachment();
  const remove = useDeleteFinanceAttachment();

  if (!accountId) return null;

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name} excede 10 MB`);
        return;
      }
      upload.mutate({ accountType, accountId, file });
    });
  };

  const handleDownload = async (att: FinanceAttachment) => {
    const { data, error } = await supabase.storage.from('finance-attachments').createSignedUrl(att.file_path, 300);
    if (error || !data?.signedUrl) {
      toast.error('Erro ao gerar link de download');
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Paperclip className="h-4 w-4" /> Comprovantes ({attachments.length})
        </label>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          Anexar
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {isLoading && <Loader2 className="h-4 w-4 animate-spin mx-auto" />}

      {attachments.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-2 p-2 rounded-md border bg-muted/30 text-xs">
              <FileIcon mime={att.mime_type} />
              <span className="flex-1 truncate font-medium" title={att.file_name}>{att.file_name}</span>
              <span className="text-muted-foreground whitespace-nowrap">{formatSize(att.file_size)}</span>
              <span className="text-muted-foreground whitespace-nowrap">{format(parseISO(att.created_at), 'dd/MM/yy')}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Baixar" onClick={() => handleDownload(att)}>
                <Download className="h-3 w-3" />
              </Button>
              <DeleteConfirmButton onConfirm={() => remove.mutate(att)} title="Remover anexo?" description={`"${att.file_name}" será removido permanentemente.`} size="h-6 w-6" iconSize="h-3 w-3" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
