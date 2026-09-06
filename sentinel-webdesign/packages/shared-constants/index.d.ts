/**
 * @sentinel/shared-constants — TypeScript Type Definitions
 * Enterprise BFSI Authority for Severity, Status, and UI Weights
 */

export type Severity =
  | 'Critical'
  | 'Warning'
  | 'Predictive-Warning'
  | 'Healthy'
  | 'Info'
  | 'DATA_UNAVAILABLE';

export type SeverityColor = '#ef4444' | '#f59e0b' | '#10b981' | '#3b82f6' | '#94a3b8';

export interface SeverityEnum {
  readonly CRITICAL: 'Critical';
  readonly WARNING: 'Warning';
  readonly PREDICTIVE_WARNING: 'Predictive-Warning';
  readonly HEALTHY: 'Healthy';
  readonly INFO: 'Info';
  readonly DATA_UNAVAILABLE: 'DATA_UNAVAILABLE';
}

export interface IncidentPriorityEnum {
  readonly P1: 'P1 - CRITICAL';
  readonly P2: 'P2 - HIGH';
  readonly P3: 'P3 - MODERATE';
  readonly P4: 'P4 - LOW';
}

export const SEVERITY: SeverityEnum;
export const SEVERITY_COLORS: Record<Severity, SeverityColor>;
export const SEVERITY_WEIGHTS: Record<Severity, number>;
export const INCIDENT_PRIORITY: IncidentPriorityEnum;

export function normalizeSeverity(raw?: string | null): Severity;
export function getStatusColor(status?: string | null): string;
