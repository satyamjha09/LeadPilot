import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { LEAD_STATUS_OPTIONS, LeadStatusLabel, normalizeLeadStatus } from '@/src/lib/leadStatus';

interface LeadStatusSelectProps {
  value: string;
  onValueChange: (value: LeadStatusLabel) => void;
  disabled?: boolean;
}

export default function LeadStatusSelect({ value, onValueChange, disabled }: LeadStatusSelectProps) {
  const normalized = normalizeLeadStatus(value) || (LEAD_STATUS_OPTIONS.includes(value as LeadStatusLabel) ? value : '');

  return (
    <Select
      value={normalized || undefined}
      onValueChange={(next) => onValueChange(next as LeadStatusLabel)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-[160px]">
        <SelectValue placeholder="Set status" />
      </SelectTrigger>
      <SelectContent>
        {LEAD_STATUS_OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
