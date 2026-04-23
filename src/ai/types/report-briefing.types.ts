export type CompanyType =
  | 'Enterprise'
  | 'ProfServices'
  | 'Startup'
  | 'ProductTech';

export type PrimaryAudience = 'CLevel' | 'Partner' | 'Founder';

export type ReportGoal = 'Decide' | 'Align' | 'Validate' | 'Explore';

export type ConfidenceNote =
  | 'data-grounded'
  | 'directional'
  | 'order-of-magnitude';

export type MaturityStage = 'Early' | 'Working' | 'Scaling' | 'Native';

export interface ValueRange {
  low: number;
  high: number;
  logic: string;
  assumptions: string[];
  confidenceNote: ConfidenceNote;
}

export interface MaturityLadder {
  stage: MaturityStage;
  evidence: string;
  gaps: string;
}

export interface ExecutiveBrief {
  thesis: string;
  bigMove: string;
  decisionsRequired: string[];
  valueSummary: ValueRange;
  portfolioMaturity: MaturityLadder;
  deliveryMaturity: MaturityLadder;
}

export interface SnapshotStat {
  label: string;
  value: string;
}

/**
 * A 5-second scannable summary that sits at the very top of the report.
 * Designed so a reader can get the gist before reading the full briefing.
 */
export interface ReportSnapshot {
  headline: string;
  bottomLine: string;
  keyStats: SnapshotStat[];
  watchouts: string[];
  readingTime: string;
  confidenceNote: ConfidenceNote;
}

export interface ExecutionBlocker {
  blocker: string;
  category: 'organizational' | 'technical' | 'behavioral';
  mitigation: string;
}

export interface NinetyDayAction {
  title: string;
  ownerRole: string;
  week: string;
  successSignal: string;
}

export interface NinetyDayPlan {
  objective: string;
  actions: NinetyDayAction[];
}

export interface RiskTradeoff {
  risk: string;
  resistanceSource: string;
  mitigation: string;
}

export interface DecisionBlock {
  id: string;
  decision: string;
  whyNow: {
    urgency: string;
    costOfInaction: string;
  };
  value: ValueRange;
  ownership: {
    accountableRole: string;
    supportingRoles: string[];
  };
  executionReality: ExecutionBlocker[];
  ninetyDayPlan: NinetyDayPlan;
  proofPoint: {
    metric: string;
    threshold: string;
    reviewBy: string;
  };
  dependencies: string[];
  risksAndTradeoffs: RiskTradeoff[];
}

export interface AssumptionsAndLimitations {
  scopeOfInputData: string;
  uncertaintyNotes: string[];
  validationRequired: string[];
}

export interface PeerContext {
  note: string;
  confidence: 'directional' | 'none';
  sources: string[];
}

export interface DepartmentSignal {
  department: string;
  observation: string;
  relevantDecisionBlockIds: string[];
}

export interface ReportFraming {
  companyType: CompanyType;
  primaryAudience: PrimaryAudience;
  reportGoal: ReportGoal;
  inferenceRationale: string;
  thesis: string;
  bigMove: string;
  decisionsRequired: string[];
  valueLow: number;
  valueHigh: number;
  peerContextNote: string;
  keyAssumptions: string[];
  portfolioMaturityStage: MaturityStage;
  deliveryMaturityStage: MaturityStage;
}

export interface BriefingOutput {
  snapshot: ReportSnapshot;
  executiveBrief: ExecutiveBrief;
  decisionBlocks: DecisionBlock[];
  departmentSignal: DepartmentSignal[];
  assumptionsAndLimitations: AssumptionsAndLimitations;
  peerContext: PeerContext;
}

export interface TransformationReportBriefing {
  companyType: CompanyType;
  primaryAudience: PrimaryAudience;
  reportGoal: ReportGoal;
  snapshot: ReportSnapshot;
  executiveBrief: ExecutiveBrief;
  decisionBlocks: DecisionBlock[];
  departmentSignal: DepartmentSignal[];
  assumptionsAndLimitations: AssumptionsAndLimitations;
  peerContext: PeerContext;
}

export const COMPANY_TYPES: CompanyType[] = [
  'Enterprise',
  'ProfServices',
  'Startup',
  'ProductTech',
];
export const PRIMARY_AUDIENCES: PrimaryAudience[] = [
  'CLevel',
  'Partner',
  'Founder',
];
export const REPORT_GOALS: ReportGoal[] = [
  'Decide',
  'Align',
  'Validate',
  'Explore',
];
export const MATURITY_STAGES: MaturityStage[] = [
  'Early',
  'Working',
  'Scaling',
  'Native',
];
