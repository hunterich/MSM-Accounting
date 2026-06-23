export type FolderDestinationConfig = {
  label: string;   // friendly: "External drive", "Google Drive", "OneDrive", custom
  path: string;    // absolute folder path on the server
  enabled: boolean;
};

export type DestinationResultStatus = 'OK' | 'SKIPPED' | 'FAILED';

export type DestinationResult = {
  label: string;
  path: string;
  status: DestinationResultStatus;
  error?: string;
};

export type BackupSettingsShape = {
  enabled: boolean;
  frequency: 'DAILY' | 'TWICE_DAILY' | 'WEEKLY';
  times: string[];               // "HH:MM"
  retentionDailyCount: number;
  retentionMonthlyCount: number;
  canonicalDir: string | null;
  folderDestinations: FolderDestinationConfig[];
  downloadEnabled: boolean;
  pgToolsPathOverride: string | null;
};
