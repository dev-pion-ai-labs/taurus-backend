export { AiModule } from './ai.module';
export { AiService } from './ai.service';
export { ImplementationAiService } from './implementation-ai.service';
export { ImplementationToolExecutor } from './tools/implementation-tool-executor';
export type {
  GeneratedQuestion,
  OnboardingInsights,
  TransformationReportData,
} from './ai.service';
export type { PlanResult, ArtifactResult } from './implementation-ai.service';
export type {
  CompanyType,
  PrimaryAudience,
  ReportGoal,
  ConfidenceNote,
  MaturityStage,
  ValueRange,
  MaturityLadder,
  ExecutiveBrief,
  DecisionBlock,
  NinetyDayPlan,
  NinetyDayAction,
  ExecutionBlocker,
  RiskTradeoff,
  AssumptionsAndLimitations,
  PeerContext,
  DepartmentSignal,
  ReportFraming,
  TransformationReportBriefing,
  BriefingOutput,
  ReportSnapshot,
  SnapshotStat,
} from './types/report-briefing.types';
