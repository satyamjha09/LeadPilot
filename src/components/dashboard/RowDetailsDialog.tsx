import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import StatusBadge from '@/src/components/dashboard/StatusBadge';
import { getLeadStatus, hasMeetLink } from '@/src/lib/rowUtils';
import { ExcelRow } from '@/src/types';

interface RowDetailsDialogProps {
  row: ExcelRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RowDetailsDialog({ row, open, onOpenChange }: RowDetailsDialogProps) {
  if (!row) return null;

  const status = getLeadStatus(row);
  const meetLink = String(row['Meeting Details'] || '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.full_name || 'Lead details'}</DialogTitle>
          <DialogDescription>Full row information from the imported source.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <StatusBadge status={status} />
          </div>
          <Separator />
          <Detail label="Email" value={row.email} />
          <Detail label="Date of Demo" value={row['Date of Demo']} />
          <Detail label="Time of Demo" value={row['Time of Demo']} />
          <Detail
            label="Meeting Details"
            value={
              hasMeetLink(meetLink) ? (
                <a href={meetLink} target="_blank" rel="noreferrer" className="text-primary underline">
                  Open Google Meet
                </a>
              ) : (
                '-'
              )
            }
          />
          <Detail label="lead_status" value={row.lead_status} />
          <Detail label="Remarks" value={row.Remarks || '-'} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2 break-words font-medium">{value || '-'}</span>
    </div>
  );
}
