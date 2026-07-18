export type Profile =
  'core' | 'cryptographic-integrity' | 'secure-service' | 'federation' | 'sdk' | 'explorer';

export interface CheckResult {
  id: string;
  category: string;
  profile: Profile;
  expected: string;
  actual: string;
  pass: boolean;
}
